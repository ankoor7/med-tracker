// Run-state core for the agentic loop (spec: specs/agent/agent-stage-3-state-ratchet.md).
//
// Everything the loop knows lives in `.agent/` as machine-readable files, so a
// cold-starting agent reads its situation instead of remembering it. The
// baseline run's worst waste — a validator respawned while its 31-minute
// transcript sat on disk — was a remembered fact that should have been a read one.
//
// This module is the only writer. It is pure enough to unit-test: every
// mutation goes through a ratchet check that rejects backwards movement,
// deletions, and spec-reference edits (FR-A3.1).

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const STATUSES = [
  'pending',
  'implementing',
  'validating',
  'reviewing',
  'bounced',
  'blocked',
  'committed',
];
const ROLES = ['implementer', 'validator', 'reviewer'];

// `no-outcome` and `hung` are the resume-not-respawn cases (FR-A3.4): the role
// ran but delivered nothing, which from the outside looks exactly like never
// having run. Keeping them distinct from `green` is the whole point.
const OUTCOMES = ['green', 'bounced', 'stopped-at-gate', 'hung', 'no-outcome'];
const RESUMABLE_OUTCOMES = ['hung', 'no-outcome'];

export const LEARNING_KINDS = ['strength', 'weakness', 'bounce', 'doctrine-gap', 'doctrine-fired'];

/** Doctrine rule ids, as carried in the ledger (FR-A5.1). */
const DOCTRINE_RULE_ID = /^D-\d{2,}$/;

const UNITS_VERSION = 1;

export const agentDir = (root) => join(root, '.agent');
const unitsPath = (root) => join(agentDir(root), 'units.json');
const learningsPath = (root) => join(agentDir(root), 'learnings.jsonl');
const failedApproachesPath = (root) => join(agentDir(root), 'failed-approaches.md');
const runLogPath = (root) => join(agentDir(root), 'run-log.jsonl');

export class RatchetError extends Error {
  constructor(violations) {
    super(`ratchet violation:\n  - ${violations.join('\n  - ')}`);
    this.name = 'RatchetError';
    this.violations = violations;
  }
}

function ensureAgentDir(root) {
  mkdirSync(agentDir(root), { recursive: true });
}

/** Stable serialisation — same state always produces the same bytes, so a diff means a change. */
function serialise(data) {
  return `${JSON.stringify(data, null, 2)}\n`;
}

export function loadUnits(root) {
  const path = unitsPath(root);
  if (!existsSync(path)) throw new Error(`no units file at ${path} — run \`ratchet init\` first`);
  const data = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(data.units)) throw new Error(`${path}: missing \`units\` array`);
  return data;
}

export function unitById(data, id) {
  const unit = data.units.find((u) => u.id === id);
  if (!unit) throw new Error(`no unit \`${id}\` in units file`);
  return unit;
}

function newUnit({ id, title, spec_ref = [], depends_on = [] }) {
  return {
    id,
    title,
    spec_ref,
    depends_on,
    status: 'pending',
    committed_sha: null,
    bounce_count: 0,
    blocked_reason: null,
    open_question: null,
    // One record per run, appended never replaced: a bounced unit runs the
    // implementer twice and both runs are evidence.
    roles_run: {},
  };
}

export function initUnits(root, { stage, units }) {
  ensureAgentDir(root);
  if (existsSync(unitsPath(root)))
    throw new Error('units file already exists — refusing to overwrite');
  const data = { version: UNITS_VERSION, stage, units: units.map(newUnit) };
  writeFileSync(unitsPath(root), serialise(data));
  return data;
}

// ---------------------------------------------------------------------------
// The ratchet
// ---------------------------------------------------------------------------

/**
 * Compare a proposed state against the current one and report every way it
 * moves backwards. Returns [] when the change is legal.
 *
 * Ratchet rules, in the spec's words: `committed` is terminal, entries are never
 * deleted, and acceptance-criteria references are never edited to make a unit pass.
 */
export function ratchetViolations(prev, next) {
  const v = [];
  if (!prev) return v;

  if (next.version !== prev.version) {
    v.push(`units file version changed ${prev.version} → ${next.version}`);
  }

  const nextById = new Map(next.units.map((u) => [u.id, u]));
  for (const before of prev.units) {
    const after = nextById.get(before.id);
    if (!after) {
      v.push(`unit \`${before.id}\` was deleted — entries are never removed`);
      continue;
    }

    if (JSON.stringify(before.spec_ref) !== JSON.stringify(after.spec_ref)) {
      v.push(
        `unit \`${before.id}\` spec_ref edited ` +
          `${JSON.stringify(before.spec_ref)} → ${JSON.stringify(after.spec_ref)} — ` +
          `acceptance criteria are never edited to make a unit pass`,
      );
    }

    if (!STATUSES.includes(after.status)) {
      v.push(`unit \`${before.id}\` has unknown status \`${after.status}\``);
    }

    if (before.status === 'committed' && after.status !== 'committed') {
      v.push(
        `unit \`${before.id}\` moved out of \`committed\` → \`${after.status}\` — committed is terminal`,
      );
    }

    if (before.committed_sha && before.committed_sha !== after.committed_sha) {
      v.push(
        `unit \`${before.id}\` committed_sha changed ${before.committed_sha} → ${after.committed_sha}`,
      );
    }

    if ((after.bounce_count ?? 0) < (before.bounce_count ?? 0)) {
      v.push(
        `unit \`${before.id}\` bounce_count decreased ${before.bounce_count} → ${after.bounce_count}`,
      );
    }

    for (const [role, runs] of Object.entries(before.roles_run ?? {})) {
      const afterRuns = after.roles_run?.[role] ?? [];
      if (afterRuns.length < runs.length) {
        v.push(
          `unit \`${before.id}\` dropped ${runs.length - afterRuns.length} \`${role}\` run record(s) — role history is append-only`,
        );
      }
    }
  }

  return v;
}

export function saveUnits(root, next, { prev = loadUnitsSafe(root) } = {}) {
  const violations = ratchetViolations(prev, next);
  if (violations.length) throw new RatchetError(violations);
  ensureAgentDir(root);
  writeFileSync(unitsPath(root), serialise(next));
  return next;
}

function loadUnitsSafe(root) {
  try {
    return loadUnits(root);
  } catch {
    return null;
  }
}

/** Read → mutate → ratchet-check → write, so callers cannot skip the check. */
function updateUnits(root, mutate) {
  const prev = loadUnits(root);
  const next = JSON.parse(JSON.stringify(prev));
  mutate(next);
  return saveUnits(root, next, { prev });
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

export function setStatus(root, id, status, { reason = null, sha = null } = {}) {
  if (!STATUSES.includes(status)) throw new Error(`unknown status \`${status}\``);
  return updateUnits(root, (data) => {
    const unit = unitById(data, id);
    if (status === 'committed') {
      if (!sha) throw new Error('committing a unit requires --sha');
      // The spec is explicit: `committed` is set only after git confirms the SHA.
      // A ratchet whose terminal state can be claimed without proof is decoration.
      assertCommitExists(root, sha);
      unit.committed_sha = sha;
    }
    if (status === 'blocked') unit.blocked_reason = reason;
    if (status === 'bounced') unit.bounce_count = (unit.bounce_count ?? 0) + 1;
    unit.status = status;
  });
}

function assertCommitExists(root, sha) {
  try {
    execFileSync('git', ['-C', root, 'cat-file', '-e', `${sha}^{commit}`], { stdio: 'ignore' });
  } catch {
    throw new Error(`commit \`${sha}\` does not exist in ${root} — cannot mark a unit committed`);
  }
}

/**
 * Record that a role ran. This is the only mutation a role agent may make
 * (FR-A3.5): it cannot touch `status` or `committed_sha`, because the agent that
 * did the work never marks the work done.
 */
export function recordRole(root, id, role, { outcome, note = '', transcript = null, ts }) {
  if (!ROLES.includes(role)) throw new Error(`unknown role \`${role}\``);
  if (!OUTCOMES.includes(outcome)) throw new Error(`unknown outcome \`${outcome}\``);
  return updateUnits(root, (data) => {
    const unit = unitById(data, id);
    unit.roles_run[role] ??= [];
    unit.roles_run[role].push({ outcome, note, transcript, ts: ts ?? isoNow() });
  });
}

export function latestRun(unit, role) {
  const runs = unit.roles_run?.[role] ?? [];
  return runs.length ? runs[runs.length - 1] : null;
}

/** First unit whose dependencies are all committed and which is neither committed nor blocked. */
export function nextEligibleUnit(data) {
  const committed = new Set(data.units.filter((u) => u.status === 'committed').map((u) => u.id));
  return (
    data.units.find(
      (u) =>
        u.status !== 'committed' &&
        u.status !== 'blocked' &&
        (u.depends_on ?? []).every((dep) => committed.has(dep)),
    ) ?? null
  );
}

/**
 * What should happen next for this unit: which role to spawn, and whether it is
 * a fresh spawn or a resume of one that ran without delivering.
 *
 * This is the decision the orchestrator used to make from memory. Making it a
 * function of recorded state is what makes AC-A3.2 (no duplicate spawns)
 * mechanical rather than aspirational.
 */
export function nextAction(unit) {
  const stage = {
    pending: 'implementer',
    bounced: 'implementer',
    implementing: 'implementer',
    validating: 'validator',
    reviewing: 'reviewer',
  }[unit.status];

  if (unit.status === 'committed') return { kind: 'done', unit: unit.id };
  if (unit.status === 'blocked') {
    return { kind: 'blocked', unit: unit.id, reason: unit.blocked_reason };
  }

  const run = latestRun(unit, stage);
  const ranThisStage =
    unit.status === 'implementing' || unit.status === 'validating' || unit.status === 'reviewing';

  if (ranThisStage && run) {
    if (RESUMABLE_OUTCOMES.includes(run.outcome)) {
      return {
        kind: 'resume',
        role: stage,
        unit: unit.id,
        why: `previous run ended \`${run.outcome}\``,
      };
    }
    if (run.outcome === 'green') {
      const advance = { implementer: 'validator', validator: 'reviewer', reviewer: 'commit' }[
        stage
      ];
      if (advance === 'commit') return { kind: 'commit', unit: unit.id };
      return { kind: 'spawn', role: advance, unit: unit.id, why: `${stage} returned green` };
    }
    if (run.outcome === 'bounced' || run.outcome === 'stopped-at-gate') {
      return {
        kind: 'resume',
        role: 'implementer',
        unit: unit.id,
        why: `${stage} sent work back (\`${run.outcome}\`)`,
      };
    }
  }

  // A bounced unit resumes the implementer that built the thing — it already
  // holds the design (doctrine: "Continuing an agent vs. starting fresh").
  if (unit.status === 'bounced' && latestRun(unit, 'implementer')) {
    return { kind: 'resume', role: 'implementer', unit: unit.id, why: 'unit bounced' };
  }

  return { kind: 'spawn', role: stage, unit: unit.id, why: `unit is \`${unit.status}\`` };
}

// ---------------------------------------------------------------------------
// Learnings (FR-A3.7) — two-sided and parseable
// ---------------------------------------------------------------------------

const VACUOUS = [
  /\bwent well\b/i,
  /\bwas thorough\b/i,
  /\bworked (fine|well)\b/i,
  /\bno (issues|problems)\b/i,
  /\bgood job\b/i,
  /\bas expected\b/i,
  /\ball green\b/i,
  /\bnothing (to report|of note)\b/i,
];

// Evidence has to point at something a later reader can open: a file:line, a
// quoted directive, a transcript, a commit. The doctrine's test — "if a later
// unit's directive cannot be changed because of what you wrote, it was too
// vague" — needs a mechanical proxy, and this is it.
const SPECIFIC = [
  /[\w./-]+\.(ts|tsx|mjs|js|sql|md|sh|json):\d+/, // file:line
  /["'`][^"'`]{12,}["'`]/, // a quoted directive or message
  /\btranscript\b/i,
  /\b[0-9a-f]{7,40}\b/, // commit sha
  /\b(FR|AC)-[A-Z0-9.]+/, // spec reference
  /[\w./-]+\/[\w./-]+\.(ts|tsx|mjs|js|sql|md|sh)/, // a path
];

export function validateLearning(entry, { strict = true } = {}) {
  const errs = [];
  for (const field of ['unit', 'kind', 'evidence', 'action']) {
    if (!entry[field] || String(entry[field]).trim() === '') errs.push(`missing \`${field}\``);
  }
  if (entry.kind && !LEARNING_KINDS.includes(entry.kind)) {
    errs.push(`unknown kind \`${entry.kind}\` (expected one of ${LEARNING_KINDS.join(', ')})`);
  }
  if (entry.role && !ROLES.includes(entry.role) && entry.role !== 'orchestrator') {
    errs.push(`unknown role \`${entry.role}\``);
  }
  // A doctrine entry that does not name its rule cannot be counted by the
  // per-run audit (FR-A5.2), so it would silently leave that rule looking
  // dormant — the one failure mode that gets good rules pruned.
  if (
    ['doctrine-fired', 'doctrine-gap'].includes(entry.kind) &&
    !DOCTRINE_RULE_ID.test(entry.rule ?? '')
  ) {
    errs.push(
      `a \`${entry.kind}\` entry must name the rule it is about with \`--rule D-NN\` ` +
        '(ids are in docs/agent-doctrine-ledger.md)',
    );
  }
  if (strict && entry.evidence) {
    const evidence = String(entry.evidence);
    if (evidence.trim().length < 20) errs.push('evidence is too short to act on');
    if (VACUOUS.some((re) => re.test(evidence))) {
      errs.push(
        `evidence is vacuous ("${evidence.trim().slice(0, 40)}…") — cite what happened, not how it felt`,
      );
    }
    if (!SPECIFIC.some((re) => re.test(evidence))) {
      errs.push(
        'evidence cites nothing openable — needs a file:line, a quoted directive, a spec ref, a sha, or a transcript',
      );
    }
  }
  return errs;
}

export function appendLearning(root, entry, { strict = true } = {}) {
  const record = { ts: entry.ts ?? isoNow(), ...entry };
  const errs = validateLearning(record, { strict });
  if (errs.length) throw new Error(`invalid learning entry:\n  - ${errs.join('\n  - ')}`);
  ensureAgentDir(root);
  appendFileSync(learningsPath(root), `${JSON.stringify(record)}\n`);
  return record;
}

export function readLearnings(root) {
  return readJsonl(learningsPath(root));
}

/** Did this unit record both sides of the story? (AC-A3.6) */
export function learningsCoverage(root) {
  const entries = readLearnings(root).filter((e) => !e.__parseError);
  const byUnit = new Map();
  for (const e of entries) {
    const seen = byUnit.get(e.unit) ?? { strength: 0, weakness: 0, other: 0 };
    // `bounce` and `doctrine-gap` are weakness-class: they record something to fix.
    if (e.kind === 'strength' || e.kind === 'doctrine-fired') seen.strength += 1;
    else if (['weakness', 'bounce', 'doctrine-gap'].includes(e.kind)) seen.weakness += 1;
    else seen.other += 1;
    byUnit.set(e.unit, seen);
  }
  return byUnit;
}

// ---------------------------------------------------------------------------
// Failed approaches (FR-A3.2) and the run log (FR-A4.4)
// ---------------------------------------------------------------------------

export function appendFailedApproach(root, { unit, role, approach, why, doNotRetry, ts }) {
  for (const [field, value] of Object.entries({ unit, approach, why, doNotRetry })) {
    if (!value || String(value).trim() === '')
      throw new Error(`failed-approach entry missing \`${field}\``);
  }
  ensureAgentDir(root);
  const path = failedApproachesPath(root);
  if (!existsSync(path)) {
    writeFileSync(
      path,
      '# Failed approaches\n\n' +
        'Append-only. Dead ends recorded so no later context re-attempts them —\n' +
        'without this, successive sessions re-try the same dead ends.\n',
    );
  }
  const block = [
    '',
    `## ${unit} — ${role ?? 'unknown role'} — ${ts ?? isoNow()}`,
    '',
    `- **Approach:** ${approach}`,
    `- **Why it failed:** ${why}`,
    `- **Do not retry:** ${doNotRetry}`,
    '',
  ].join('\n');
  appendFileSync(path, block);
  return block;
}

export function appendRunEvent(root, event) {
  ensureAgentDir(root);
  const record = { ts: event.ts ?? isoNow(), ...event };
  appendFileSync(runLogPath(root), `${JSON.stringify(record)}\n`);
  return record;
}

export function readRunLog(root) {
  return readJsonl(runLogPath(root));
}

/**
 * Read a JSONL run-state file, tolerating malformed lines.
 *
 * A bad line becomes a `__parseError` record rather than an exception, because
 * these files are appended to by agents mid-run: a half-written line must not
 * make the whole run unreadable to the report that is supposed to explain it.
 * Callers that want only good records filter on `__parseError`; the run report
 * deliberately does not, and surfaces them as observability defects.
 */
export function readJsonl(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((line, i) => {
      try {
        return JSON.parse(line);
      } catch {
        return { __parseError: true, line: i + 1, raw: line };
      }
    });
}

export function isoNow() {
  return new Date().toISOString();
}
