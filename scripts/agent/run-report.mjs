#!/usr/bin/env node
// Run report (FR-A4.7): the primary artifact a human reads after a run.
//
//   pnpm agent:report --digest   # markdown digest, deterministic, no model
//   pnpm agent:report --json     # the same facts as data
//
// The ephemeral-orchestrator design deletes the participant that used to see the
// whole run, so cross-unit patterns have no observer during it. This script is
// the deterministic half of the replacement: it reads only `.agent/` state
// (never transcripts) and assembles every fact plus the *candidate* cross-unit
// patterns it can detect mechanically.
//
// The synthesis agent then reads this digest — a few KB — instead of a run's
// worth of transcripts. That ordering matters: anything computable here must not
// be paid for in a model pass, and anything the digest already flags cannot be
// missed by a model that only skims.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadUnits, readLearnings, readRunLog } from './state.mjs';
import { classifyRules, loadLedger, pruneCandidates } from './doctrine.mjs';
import { DIMENSION_KEYS, readVerdicts, tallyVerdicts } from './rubric.mjs';
import { argvReader, repoRoot } from './cli.mjs';

const { has } = argvReader(process.argv.slice(2));

const root = repoRoot();

export function collect(root) {
  const units = loadUnits(root);
  const events = readRunLog(root);
  const learnings = readLearnings(root).filter((e) => !e.__parseError);
  const parseErrors = readLearnings(root).filter((e) => e.__parseError);

  const byKind = (kind) => events.filter((e) => e.kind === kind);

  const perUnit = units.units.map((u) => {
    const spawns = byKind('spawned').filter((e) => e.unit === u.id);
    const exits = byKind('exited').filter((e) => e.unit === u.id);
    const breaches = byKind('ceiling-breach').filter((e) => e.unit === u.id);
    const unitLearnings = learnings.filter((l) => l.unit === u.id);
    return {
      id: u.id,
      title: u.title,
      status: u.status,
      committed_sha: u.committed_sha,
      bounce_count: u.bounce_count ?? 0,
      blocked_reason: u.blocked_reason,
      spawns: spawns.length,
      ceiling_breaches: breaches.length,
      wall_clock_seconds: exits.reduce((n, e) => n + (e.elapsed_seconds ?? 0), 0),
      roles: Object.fromEntries(
        Object.entries(u.roles_run ?? {}).map(([role, runs]) => [role, runs.map((r) => r.outcome)]),
      ),
      strengths: unitLearnings.filter((l) => ['strength', 'doctrine-fired'].includes(l.kind)),
      weaknesses: unitLearnings.filter((l) =>
        ['weakness', 'bounce', 'doctrine-gap'].includes(l.kind),
      ),
    };
  });

  return {
    // Carried explicitly: the tooling's repo and the run's repo are not always
    // the same one, so nothing downstream may re-derive this from cwd.
    root,
    stage: units.stage,
    totals: {
      units: perUnit.length,
      committed: perUnit.filter((u) => u.status === 'committed').length,
      blocked: perUnit.filter((u) => u.status === 'blocked').length,
      spawns: byKind('spawned').length,
      ceiling_breaches: byKind('ceiling-breach').length,
      learnings_missing: byKind('learnings-missing').length,
      escalations: byKind('user-escalation').length,
      bounces: perUnit.reduce((n, u) => n + u.bounce_count, 0),
    },
    perUnit,
    patterns: detectPatterns(perUnit, events, learnings),
    integrity: integrityFlags(perUnit, events, parseErrors),
    learnings,
    doctrine: doctrineAudit(root, learnings),
    verdicts: verdictSummary(root),
  };
}

/**
 * The FR-A5.2 audit, computed here because it shares this pass's inputs exactly:
 * one read of `learnings.jsonl`, no transcripts, no model. The synthesis agent
 * gets the classification as a fact and spends its judgement on what to do about
 * a `violated` rule, not on discovering there was one.
 */
export function doctrineAudit(root, learnings) {
  let ledger;
  try {
    ledger = loadLedger(root);
  } catch {
    return null; // no ledger in this repo (fixtures, other repos) — not a run defect
  }
  const classifications = classifyRules({ ledger, learnings });
  return {
    classifications,
    counts: {
      fired: classifications.filter((c) => c.classification === 'fired').length,
      violated: classifications.filter((c) => c.classification === 'violated').length,
      dormant: classifications.filter((c) => c.classification === 'dormant').length,
    },
    // Two-sided capture is a hard input: with no `doctrine-fired` entries every
    // rule reads dormant, which would mark the doctrine's best rules for removal.
    twoSided: learnings.some((l) => l.kind === 'doctrine-fired'),
    pruneCandidates: pruneCandidates(ledger),
  };
}

export function verdictSummary(root) {
  const verdicts = readVerdicts(root).filter((v) => !v.__parseError);
  if (!verdicts.length) return null;
  return { count: verdicts.length, tally: tallyVerdicts(verdicts), verdicts };
}

/**
 * Cross-unit patterns detectable without judgement. These are *candidates* — the
 * synthesis agent confirms or discards them. Detecting them mechanically is what
 * stops the "same anomaly, third time" class of finding from depending on a model
 * happening to notice.
 */
export function detectPatterns(perUnit, events, learnings) {
  return DETECTORS.flatMap((detect) => detect(perUnit, events, learnings));
}

// A role that sends work back across more than one unit is a directive
// problem, not a unit problem — the single most actionable cross-unit signal.
function repeatedBounceRole(perUnit) {
  const senders = {};
  for (const u of perUnit) {
    for (const [role, outcomes] of Object.entries(u.roles ?? {})) {
      if (outcomes.some((o) => o === 'bounced')) (senders[role] ??= []).push(u.id);
    }
  }
  return Object.entries(senders)
    .filter(([, units]) => units.length > 1)
    .map(([role, units]) => ({
      kind: 'repeated-bounce-role',
      detail: `${role} sent work back on ${units.length} units (${units.join(', ')}) — suspect the directive shape, not the units`,
      units,
    }));
}

// The same role failing to deliver more than once is an environment or tooling
// fault (the baseline's hung MCP call), not bad luck.
function repeatedNonDelivery(perUnit) {
  const nonDelivery = {};
  for (const u of perUnit) {
    for (const [role, outcomes] of Object.entries(u.roles ?? {})) {
      const bad = outcomes.filter((o) => NON_DELIVERY.includes(o)).length;
      if (bad) nonDelivery[role] = (nonDelivery[role] ?? 0) + bad;
    }
  }
  return Object.entries(nonDelivery)
    .filter(([, count]) => count > 1)
    .map(([role, count]) => ({
      kind: 'repeated-non-delivery',
      detail: `${role} ran without delivering ${count} times — treat as an environment/tooling fault and prove the root cause`,
      units: perUnit
        .filter((u) => (u.roles?.[role] ?? []).some((o) => NON_DELIVERY.includes(o)))
        .map((u) => u.id),
    }));
}

// Repeated ceiling breaches mean the ceiling is wrong or something hangs
// reproducibly; either way it is a loop-level fact, not a unit-level one.
function repeatedCeilingBreach(_perUnit, events) {
  const units = [...new Set(events.filter((e) => e.kind === 'ceiling-breach').map((e) => e.unit))];
  if (units.length <= 1) return [];
  return [
    {
      kind: 'repeated-ceiling-breach',
      detail: `spawns for ${units.join(', ')} hit the ceiling — re-check the ceiling value and look for a reproducible hang`,
      units,
    },
  ];
}

// The same lesson recorded on several units means it was never applied.
function unappliedLearning(_perUnit, _events, learnings) {
  const actionCounts = new Map();
  for (const l of learnings) {
    const key = normalise(l.action);
    if (!key) continue;
    const entry = actionCounts.get(key) ?? { action: l.action, units: new Set() };
    entry.units.add(l.unit);
    actionCounts.set(key, entry);
  }
  return [...actionCounts.values()]
    .filter(({ units }) => units.size > 1)
    .map(({ action, units }) => ({
      kind: 'unapplied-learning',
      detail: `the same action was recorded on ${units.size} units ("${truncate(action, 80)}") — it was written down and not applied`,
      units: [...units],
    }));
}

// Multiple spawns for one unit means the unit did not fit one lifetime.
function unitNeededManySpawns(perUnit) {
  return perUnit
    .filter((u) => u.spawns > 2)
    .map((u) => ({
      kind: 'unit-needed-many-spawns',
      detail: `${u.id} took ${u.spawns} orchestrator spawns — candidate for splitting`,
      units: [u.id],
    }));
}

const NON_DELIVERY = ['hung', 'no-outcome'];

// Order is the order they appear in the digest, so it is part of the contract.
const DETECTORS = [
  repeatedBounceRole,
  repeatedNonDelivery,
  repeatedCeilingBreach,
  unappliedLearning,
  unitNeededManySpawns,
];

/** Things that invalidate the run's own observability, which AC-A4.7 gates on. */
export function integrityFlags(perUnit, events, parseErrors) {
  const flags = [];
  for (const e of parseErrors) flags.push(`learnings.jsonl:${e.line} is not valid JSON`);
  for (const u of perUnit) {
    if (u.status === 'committed' && (!u.strengths.length || !u.weaknesses.length)) {
      flags.push(
        `${u.id} is committed but its learnings are one-sided (strength=${u.strengths.length} weakness=${u.weaknesses.length})`,
      );
    }
  }
  const spawned = events.filter((e) => e.kind === 'spawned').length;
  const settled =
    events.filter((e) => e.kind === 'exited').length +
    events.filter((e) => e.kind === 'ceiling-breach').length;
  if (spawned !== settled) {
    flags.push(`${spawned} spawn(s) but ${settled} settled event(s) — the run log is incomplete`);
  }
  if (!events.some((e) => e.kind === 'run-finished')) {
    flags.push('no run-finished event — this run was interrupted or is still going');
  }
  return flags;
}

const normalise = (s) =>
  s
    ? String(s)
        .toLowerCase()
        .replace(/[^a-z0-9 ]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
    : '';
const truncate = (s, n) => (String(s).length > n ? `${String(s).slice(0, n)}…` : String(s));

/**
 * The digest is a fixed sequence of markdown sections. Each section is its own
 * function returning the lines it contributes (empty = omitted), so adding or
 * reordering a section is a one-line change here rather than a surgical edit
 * inside a single long builder.
 */
export function digest(data) {
  return [
    ...headerSection(data),
    ...unitsSection(data),
    ...listSection(
      '## Candidate cross-unit patterns (confirm or discard these)',
      data.patterns,
      (p) => [`- **${p.kind}** — ${p.detail}`],
    ),
    ...listSection('## Observability defects (AC-A4.7 gates on these)', data.integrity, (f) => [
      `- ${f}`,
    ]),
    ...learningsSection(
      data,
      '## What worked (strength-class learnings)',
      STRENGTH_KINDS,
      'repeat',
    ),
    ...learningsSection(
      data,
      '## What did not (weakness-class learnings)',
      WEAKNESS_KINDS,
      'change',
    ),
    ...verdictsSection(data),
    ...doctrineSection(data),
    ...failedApproachesSection(data),
    ...synthesisSection(),
    '',
  ].join('\n');
}

const STRENGTH_KINDS = ['strength', 'doctrine-fired'];
const WEAKNESS_KINDS = ['weakness', 'bounce', 'doctrine-gap'];

function headerSection(data) {
  const t = data.totals;
  return [
    `# Run digest — ${data.stage}`,
    '',
    `${t.committed}/${t.units} units committed, ` +
      `${t.blocked} blocked, ${t.spawns} orchestrator spawn(s), ` +
      `${t.bounces} bounce(s), ${t.ceiling_breaches} ceiling breach(es).`,
  ];
}

function unitsSection(data) {
  return [
    '',
    '## Units',
    '',
    '| unit | status | spawns | bounces | roles | strengths | weaknesses |',
    '| --- | --- | ---: | ---: | --- | ---: | ---: |',
    ...data.perUnit.map((u) => {
      const roles = Object.entries(u.roles)
        .map(([r, o]) => `${r}:${o.join('→')}`)
        .join(' ');
      return `| ${u.id} | ${u.status} | ${u.spawns} | ${u.bounce_count} | ${roles || '—'} | ${u.strengths.length} | ${u.weaknesses.length} |`;
    }),
  ];
}

/** A heading plus one rendered entry per item, or nothing at all when empty. */
function listSection(heading, items, render) {
  if (!items.length) return [];
  return ['', heading, '', ...items.flatMap(render)];
}

function learningsSection(data, heading, kinds, verb) {
  const entries = data.learnings.filter((l) => kinds.includes(l.kind));
  if (!entries.length) return ['', heading, '', '_none recorded — this is itself a finding_'];
  return [
    '',
    heading,
    '',
    ...entries.flatMap((l) => [
      `- \`${l.unit}\` (${l.role ?? 'orchestrator'}): ${l.evidence}`,
      `  - **${verb}:** ${l.action}`,
    ]),
  ];
}

function verdictsSection(data) {
  if (!data.verdicts) return [];
  const bounced = data.verdicts.verdicts.filter((v) => v.bounce);
  return [
    '',
    '## Rubric verdicts (FR-A5.5)',
    '',
    `| dimension | ${['pass', 'fail', 'n/a'].join(' | ')} |`,
    '| --- | ---: | ---: | ---: |',
    ...DIMENSION_KEYS.map((key) => {
      const t = data.verdicts.tally[key];
      return `| ${key} | ${t.pass} | ${t.fail} | ${t['n/a']} |`;
    }),
    ...(bounced.length
      ? [
          '',
          ...bounced.map(
            (v) =>
              `- \`${v.unit}\` ${v.role} bounced on **${(v.bounce_dimensions ?? []).join(', ')}**`,
          ),
        ]
      : []),
  ];
}

function doctrineSection(data) {
  if (!data.doctrine) return [];
  const { counts, classifications, twoSided, pruneCandidates: candidates } = data.doctrine;
  const violated = classifications.filter((c) => c.classification === 'violated');
  const fired = classifications.filter((c) => c.classification === 'fired');
  return [
    '',
    '## Doctrine audit (FR-A5.2)',
    '',
    `${counts.fired} fired, ${counts.violated} violated, ${counts.dormant} dormant.`,
    ...(twoSided
      ? []
      : [
          '',
          '**No `doctrine-fired` learnings this run**, so every rule below reads dormant for that ' +
            'reason alone. Fix the capture before drawing a pruning conclusion — a failure-only ' +
            "record marks the doctrine's best rules for removal.",
        ]),
    ...(violated.length
      ? [
          '',
          'Rules that should have fired and did not — these are the bugs:',
          '',
          ...violated.map((c) => `- **${c.id}** ("${c.anchor}") — ${c.evidence}`),
        ]
      : []),
    ...(fired.length ? ['', `Fired: ${fired.map((c) => c.id).join(', ')}.`] : []),
    ...(candidates.length
      ? [
          '',
          `Dormant across ${candidates[0].audits.length} consecutive audits, proposed for removal ` +
            `(FR-A5.3): ${candidates.map((c) => `${c.id} ("${c.anchor}")`).join('; ')}.`,
        ]
      : []),
    '',
    "Append this run's audit with `pnpm agent:doctrine audit --run <id> --append`.",
  ];
}

function failedApproachesSection(data) {
  const failed = join(data.root, '.agent', 'failed-approaches.md');
  if (!existsSync(failed)) return [];
  return [
    '',
    '## Failed approaches recorded this run',
    '',
    '```',
    readFileSync(failed, 'utf8').trim(),
    '```',
  ];
}

function synthesisSection() {
  return [
    '',
    '## For the synthesis pass',
    '',
    'Read the above and write `.agent/run-report.md`: confirm or discard each candidate pattern, ' +
      'name the loop-level strengths worth keeping and the weaknesses worth fixing, and state any ' +
      'observation no single unit could have made. Do not read transcripts — if a claim needs them, ' +
      'say what is missing from this digest instead. For each `violated` rule above, propose one ' +
      'concrete change: a doctrine edit, or better, a mechanisation that makes the rule a command ' +
      'nobody has to remember (FR-A1.4 is the worked example). Say plainly if a `dormant` rule is ' +
      'dormant because nothing exercised it rather than because it is dead.',
  ];
}

// Run as a CLI (but importable by the tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  const data = collect(root);
  if (has('json')) {
    console.log(JSON.stringify(data, null, 2));
  } else {
    console.log(digest(data));
  }
}
