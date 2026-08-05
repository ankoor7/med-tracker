#!/usr/bin/env node
// The doctrine ledger and its audit (spec: specs/agent/agent-stage-5-self-tuning-doctrine.md).
//
//   pnpm agent:doctrine check            # AC-A5.1 + AC-A5.3: coverage, provenance, no silent growth
//   pnpm agent:doctrine audit [--append] # FR-A5.2: classify every rule fired/violated/dormant
//   pnpm agent:doctrine prune            # FR-A5.3: rules dormant across 3 consecutive audits
//   pnpm agent:doctrine size [--record]  # the size log AC-A5.3 compares against
//
// Why this exists: the agent file is a long-running system with the same failure
// mode as the runs it governs — it only ever grows. Every incident adds a rule,
// no rule is ever removed, and each one is context every future orchestrator pays
// for on every turn. So rules get provenance (what incident bought them), runs
// classify them (did this rule observably do anything?), and rules that stopped
// earning their context cost get proposed for removal — recoverably, because the
// ledger keeps the text and the incident.
//
// Everything here is deterministic and reads only committed files plus `.agent/`.
// A model is needed to *judge* a rule, never to *find* one.

import { existsSync, readFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { readLearnings } from './state.mjs';
import { repoRoot } from './cli.mjs';

export const doctrinePath = (root) =>
  join(root, '.claude', 'agents', 'sequential-fix-orchestrator.md');
export const ledgerPath = (root) => join(root, 'docs', 'agent-doctrine-ledger.md');

export const CLASSIFICATIONS = ['fired', 'violated', 'dormant'];
export const RULE_ID = /^D-\d{2,}$/;
/** Dormant this many consecutive audits ⇒ proposed for removal (FR-A5.3). */
export const DORMANT_WINDOW = 3;

// ---------------------------------------------------------------------------
// Reading the doctrine
// ---------------------------------------------------------------------------

/**
 * Every rule in the doctrine, derived from its own structure rather than from a
 * hand-maintained list — a list would drift the moment someone edits the prompt,
 * which is precisely the drift AC-A5.1 exists to catch.
 *
 * Three shapes count as a rule:
 *   - `section` — a `##` heading. Covers the prose a section carries even when it
 *     states no listed rule (the model-selection section is all prose).
 *   - `rule` — a list item or numbered step. That is how this doctrine writes
 *     nearly every instruction.
 *   - `rule` — a paragraph that opens with a bold span, which is the doctrine's
 *     other way of stating one. Mid-sentence bold is emphasis, not a rule.
 *
 * The anchor is the item's bold lead-in where it has one, else its first
 * sentence. Rewording a rule therefore breaks the ledger link — deliberately:
 * a rule whose text changed enough to lose its anchor is a rule whose provenance
 * is worth restating.
 */
export function extractRules(markdown) {
  const rules = [];
  const lines = markdown.split('\n');
  let section = null;
  let inFrontmatter = false;
  let inFence = false;
  let item = null; // the list item / bold paragraph being accumulated

  const flush = () => {
    if (!item) return;
    const anchor = anchorFor(item.text);
    if (anchor) rules.push({ kind: 'rule', section: item.section, anchor, line: item.line });
    item = null;
  };

  // Named rather than inline so the complexity budget for it in `.fallowrc.jsonc`
  // can name it too — `<arrow>` matches every anonymous function in the file.
  const classifyLine = (line, i) => {
    if (i === 0 && line.trim() === '---') {
      inFrontmatter = true;
      return;
    }
    if (inFrontmatter) {
      if (line.trim() === '---') inFrontmatter = false;
      return;
    }
    if (/^\s*```/.test(line)) {
      flush();
      inFence = !inFence;
      return;
    }
    if (inFence) return;

    const heading = /^(#{1,6})\s+(.*\S)\s*$/.exec(line);
    if (heading) {
      flush();
      if (heading[1].length === 2) {
        section = heading[2];
        rules.push({ kind: 'section', section, anchor: section, line: i + 1 });
      }
      return;
    }

    if (!line.trim()) {
      flush();
      return;
    }

    const marker = /^(\s*)(?:[-*+]\s+|\d+\.\s+)(.*)$/.exec(line);
    if (marker) {
      // An indented sub-bullet elaborates the rule above it rather than stating a
      // new one — the doctrine uses them for the parts of a single instruction.
      if (item && marker[1].length >= 2) {
        item.text += ` ${marker[2].trim()}`;
        return;
      }
      flush();
      item = { section: section ?? '(preamble)', line: i + 1, text: marker[2] };
      return;
    }

    if (item) {
      // A continuation line of the item above.
      item.text += ` ${line.trim()}`;
      return;
    }

    // A paragraph that opens with a bold span states a rule; one that does not is
    // connective prose, covered by its section's entry.
    if (/^\s*\*\*/.test(line)) {
      item = { section: section ?? '(preamble)', line: i + 1, text: line.trim() };
    }
  };

  lines.forEach(classifyLine);
  flush();

  return rules;
}

/** The bold lead-in if there is one, else the first sentence. */
export function anchorFor(text) {
  const bold = /^\s*\*\*(.+?)\*\*/s.exec(text);
  if (bold) return normaliseAnchor(bold[1]);
  const sentence = /^(.{10,}?)(?:\.\s|\.$|$)/s.exec(text.trim());
  if (!sentence) return null;
  const anchor = normaliseAnchor(sentence[1]);
  // Cap long anchors at a word boundary: a ledger row should be readable, and a
  // half-word anchor invites someone to "fix" it and silently break the link.
  return anchor.length <= 70 ? anchor : normaliseAnchor(anchor.slice(0, 70).replace(/\s+\S*$/, ''));
}

/** Anchors are compared as text, so trailing punctuation must not make two of one. */
export function normaliseAnchor(text) {
  return text
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[.:,;—-]+$/, '')
    .trim();
}

export function doctrineMetrics(markdown) {
  const rules = extractRules(markdown);
  return {
    lines: markdown.split('\n').length,
    words: markdown.split(/\s+/).filter(Boolean).length,
    rules: rules.length,
  };
}

// ---------------------------------------------------------------------------
// Reading the ledger
// ---------------------------------------------------------------------------

/** Minimal GitHub-flavoured-markdown table reader: rows of trimmed cells. */
export function parseTable(lines) {
  const rows = [];
  for (const line of lines) {
    if (!/^\s*\|/.test(line)) continue;
    const cells = line
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((c) => c.trim());
    if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue; // separator row
    rows.push(cells);
  }
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.toLowerCase());
  return rows
    .slice(1)
    .map((cells) => Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ''])));
}

/**
 * Split a markdown document into `{heading, level, lines}` blocks so each table
 * can be found by the heading above it rather than by position.
 */
function sections(markdown) {
  const out = [];
  let current = { heading: '', level: 0, lines: [] };
  for (const line of markdown.split('\n')) {
    const h = /^(#{1,6})\s+(.*\S)\s*$/.exec(line);
    if (h) {
      out.push(current);
      current = { heading: h[2], level: h[1].length, lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  out.push(current);
  return out;
}

export function parseLedger(markdown) {
  const blocks = sections(markdown);
  const under = (name) => blocks.find((b) => b.heading.toLowerCase() === name)?.lines ?? [];

  const rules = parseTable(under('rules')).map((r) => ({
    id: r.id,
    section: r.section,
    anchor: normaliseAnchor(r.anchor ?? ''),
    class: (r.class || 'normal').toLowerCase(),
    provenance: r.provenance ?? '',
    date: r.date ?? '',
    status: (r.status || 'active').toLowerCase(),
  }));

  const sizeLog = parseTable(under('size log')).map((r) => ({
    date: r.date,
    commit: r.commit,
    lines: Number(r.lines),
    rules: Number(r.rules),
    note: r.note ?? '',
  }));

  // Audits are `### Audit — <date> (run: <id>)`, newest appended last.
  const audits = blocks
    .filter((b) => /^audit\b/i.test(b.heading))
    .map((b) => {
      const m = /^audit\s*[—-]\s*(\S+)\s*(?:\(run:\s*([^)]*)\))?/i.exec(b.heading);
      return {
        date: m?.[1] ?? '',
        run: (m?.[2] ?? '').trim(),
        rows: parseTable(b.lines).map((r) => ({
          rule: r.rule,
          classification: (r.classification ?? '').toLowerCase(),
          evidence: r.evidence ?? '',
        })),
      };
    });

  return { rules, sizeLog, audits };
}

export function loadLedger(root) {
  const path = ledgerPath(root);
  if (!existsSync(path)) throw new Error(`no doctrine ledger at ${path}`);
  return parseLedger(readFileSync(path, 'utf8'));
}

// ---------------------------------------------------------------------------
// FR-A5.1 / AC-A5.1 — coverage and provenance
// ---------------------------------------------------------------------------

// Provenance has to point at something a later reader can open — the same bar
// FR-A3.7 sets for learnings evidence. `prior` is the honest escape hatch: an
// untested belief, marked as one, so nobody mistakes it for a lesson.
const PROVENANCE_CITES = [
  /\d{4}-\d{2}-\d{2}/, // a dated incident
  /\b(FR|AC)-[A-Z0-9.]+/, // a spec requirement
  /[\w./-]+\/[\w./-]+\.(md|ts|tsx|mjs|js|sql|sh|py)/, // a file
  /\b[0-9a-f]{7,40}\b/, // a commit
];

/** Two sections legitimately use the same anchor (`IMPLEMENTER` appears twice), so a rule is keyed by both. */
const key = (rule) => `${rule.section} :: ${rule.anchor}`;

export function coverageProblems({ rules, ledger }) {
  const problems = [];
  const byAnchor = new Map();
  for (const entry of ledger.rules) {
    if (!RULE_ID.test(entry.id ?? ''))
      problems.push(`ledger id \`${entry.id}\` is not of the form D-NN`);
    if (byAnchor.has(key(entry))) problems.push(`ledger has two entries for "${key(entry)}"`);
    byAnchor.set(key(entry), entry);
  }

  const seenIds = new Set();
  for (const entry of ledger.rules) {
    if (seenIds.has(entry.id)) problems.push(`ledger id \`${entry.id}\` is used twice`);
    seenIds.add(entry.id);

    const prior = /^prior\b/i.test(entry.provenance.trim());
    if (!entry.provenance.trim()) {
      problems.push(`${entry.id} has no provenance and is not marked \`prior\``);
    } else if (!prior && !PROVENANCE_CITES.some((re) => re.test(entry.provenance))) {
      problems.push(
        `${entry.id} provenance cites nothing openable ("${truncate(entry.provenance, 50)}") — ` +
          'give a dated incident, a spec ref, a file, or a sha, or mark it `prior`',
      );
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) {
      problems.push(`${entry.id} has no ISO date (got "${entry.date}")`);
    }
  }

  const doctrineKeys = new Set(rules.map(key));
  for (const rule of rules) {
    const entry = byAnchor.get(key(rule));
    if (!entry) {
      problems.push(
        `doctrine ${rule.kind} "${rule.anchor}" (${rule.section}, line ${rule.line}) has no ledger ` +
          'entry — every rule carries its provenance or an explicit `prior` marker (AC-A5.1)',
      );
    } else if (entry.status === 'pruned') {
      problems.push(
        `${entry.id} is marked \`pruned\` but "${rule.anchor}" is still in the doctrine`,
      );
    }
  }
  for (const entry of ledger.rules) {
    if (entry.status !== 'pruned' && !doctrineKeys.has(key(entry))) {
      problems.push(
        `${entry.id} ("${entry.anchor}") is \`${entry.status}\` in the ledger but absent from the ` +
          'doctrine — mark it `pruned` (with the audit that retired it) rather than deleting the row',
      );
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// AC-A5.3 — the doctrine does not grow without an incident
// ---------------------------------------------------------------------------

/**
 * Net growth is allowed only when the ledger shows a new incident-backed rule per
 * added rule. Priors do not buy growth: an untested belief is exactly the thing
 * this criterion is there to keep out of a prompt every future run pays for.
 */
export function sizeCheck({ markdown, ledger, metrics = doctrineMetrics(markdown) }) {
  const last = ledger.sizeLog[ledger.sizeLog.length - 1];
  if (!last) {
    return {
      ok: true,
      metrics,
      baseline: null,
      detail: 'no size-log baseline yet — recording this one establishes it',
    };
  }
  const grewBy = metrics.rules - last.rules;
  if (grewBy <= 0) {
    return {
      ok: true,
      metrics,
      baseline: last,
      detail: `${metrics.rules} rules vs ${last.rules} at ${last.date} (${grewBy === 0 ? 'no change' : `${-grewBy} fewer`})`,
    };
  }
  const backed = ledger.rules.filter(
    (r) => r.status !== 'pruned' && r.date > last.date && !/^prior\b/i.test(r.provenance.trim()),
  );
  const ok = backed.length >= grewBy;
  return {
    ok,
    metrics,
    baseline: last,
    grewBy,
    backed: backed.map((r) => r.id),
    detail: ok
      ? `${grewBy} new rule(s) since ${last.date}, each backed by an incident (${backed.map((r) => r.id).join(', ')})`
      : `${grewBy} new rule(s) since ${last.date} but only ${backed.length} incident-backed ledger entr(y/ies) ` +
        'newer than that baseline — net growth without incidents fails AC-A5.3',
  };
}

export function sizeLogRow({ date, commit, metrics, note = '' }) {
  return `| ${date} | ${commit} | ${metrics.lines} | ${metrics.rules} | ${note} |`;
}

// ---------------------------------------------------------------------------
// FR-A5.2 — the per-run audit
// ---------------------------------------------------------------------------

/**
 * Classify every ledger rule against one run's learnings.
 *
 * `fired` and `violated` both come from the two-sided learnings record: a
 * `doctrine-fired` entry naming a rule is the only evidence that a rule
 * observably changed behaviour, and a `doctrine-gap` entry is a rule that should
 * have fired and didn't. Everything else is `dormant` — which is why a
 * failure-only learnings file would mark the doctrine's best rules for pruning,
 * and why FR-A3.7's two-sided capture is a hard input to this stage.
 */
export function classifyRules({ ledger, learnings }) {
  const rules = ledger.rules.filter((r) => r.status !== 'pruned');
  const byId = new Map(rules.map((r) => [r.id, r]));

  const hits = new Map(); // id → {fired: [], violated: []}
  for (const entry of learnings) {
    if (!['doctrine-fired', 'doctrine-gap'].includes(entry.kind)) continue;
    const bucket = entry.kind === 'doctrine-fired' ? 'fired' : 'violated';
    for (const id of rulesNamedBy(entry, rules)) {
      if (!byId.has(id)) continue;
      const seen = hits.get(id) ?? { fired: [], violated: [] };
      seen[bucket].push(entry);
      hits.set(id, seen);
    }
  }

  return rules.map((rule) => {
    const seen = hits.get(rule.id) ?? { fired: [], violated: [] };
    // A rule that both fired and was missed is reported as `violated`: the miss is
    // the bug, and a rule that half-works is not a candidate for quiet removal.
    const classification = seen.violated.length
      ? 'violated'
      : seen.fired.length
        ? 'fired'
        : 'dormant';
    const source = seen.violated.length ? seen.violated : seen.fired;
    return {
      id: rule.id,
      anchor: rule.anchor,
      class: rule.class,
      classification,
      evidence: source.map((e) => `${e.unit}: ${e.evidence}`).join(' · ') || '—',
    };
  });
}

/** A learning names a rule by id (`rule` field) or by quoting its anchor. */
function rulesNamedBy(entry, rules) {
  if (entry.rule && RULE_ID.test(entry.rule)) return [entry.rule];
  const haystack = `${entry.evidence ?? ''} ${entry.action ?? ''}`.toLowerCase();
  const ids = new Set();
  for (const m of haystack.matchAll(/\bd-\d{2,}\b/g)) ids.add(m[0].toUpperCase());
  for (const rule of rules) {
    if (rule.anchor.length >= 12 && haystack.includes(rule.anchor.toLowerCase())) ids.add(rule.id);
  }
  return [...ids];
}

export function renderAuditBlock({ date, run, classifications, notes = [] }) {
  const L = [];
  L.push('');
  L.push(`### Audit — ${date} (run: ${run})`);
  L.push('');
  const counts = CLASSIFICATIONS.map(
    (c) => `${classifications.filter((r) => r.classification === c).length} ${c}`,
  ).join(', ');
  L.push(`${classifications.length} rules: ${counts}.`);
  for (const note of notes) L.push(`${note}`);
  L.push('');
  L.push('| rule | classification | evidence |');
  L.push('| --- | --- | --- |');
  for (const r of classifications) {
    L.push(`| ${r.id} | ${r.classification} | ${escapeCell(r.evidence)} |`);
  }
  L.push('');
  return L.join('\n');
}

export function appendAudit(root, block) {
  appendFileSync(ledgerPath(root), block);
  return block;
}

// ---------------------------------------------------------------------------
// FR-A5.3 — pruning
// ---------------------------------------------------------------------------

/**
 * Rules dormant across the last `window` audits, excluding safety-critical ones.
 *
 * Only audits that mention the rule count: an audit that predates a rule says
 * nothing about it, and treating that silence as dormancy would propose new rules
 * for removal before they had a chance to fire.
 */
export function pruneCandidates(ledger, { window = DORMANT_WINDOW } = {}) {
  const audits = ledger.audits.slice(-window);
  const candidates = [];
  for (const rule of ledger.rules) {
    if (rule.status === 'pruned') continue;
    if (rule.class === 'safety-critical') continue;
    const seen = audits
      .map((a) => a.rows.find((r) => r.rule === rule.id))
      .filter(Boolean)
      .map((r) => r.classification);
    if (seen.length < window) continue;
    if (seen.every((c) => c === 'dormant')) {
      candidates.push({ id: rule.id, anchor: rule.anchor, audits: audits.map((a) => a.date) });
    }
  }
  return candidates;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const truncate = (s, n) => (String(s).length > n ? `${String(s).slice(0, n)}…` : String(s));
const escapeCell = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function readDoctrine(root) {
  const path = doctrinePath(root);
  if (!existsSync(path)) throw new Error(`no doctrine at ${path}`);
  return readFileSync(path, 'utf8');
}

/** Everything `check` asserts, as data — so the repo test and the CLI agree by construction. */
export function check(root) {
  const markdown = readDoctrine(root);
  const ledger = loadLedger(root);
  const rules = extractRules(markdown);
  const problems = coverageProblems({ rules, ledger });
  const size = sizeCheck({ markdown, ledger });
  if (!size.ok) problems.push(`AC-A5.3: ${size.detail}`);
  return { problems, size, rules, ledger };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const command = argv[0] ?? 'check';
  const flag = (name, fallback = null) => {
    const i = argv.indexOf(`--${name}`);
    return i === -1 ? fallback : argv[i + 1];
  };
  const has = (name) => argv.includes(`--${name}`);
  const root = repoRoot();

  try {
    switch (command) {
      case 'check': {
        const { problems, size, rules } = check(root);
        if (problems.length) {
          console.error(`FAIL (${problems.length})`);
          for (const p of problems) console.error(`  - ${p}`);
          process.exit(4);
        }
        console.log(`OK — ${rules.length} doctrine rule(s) all carry provenance; ${size.detail}`);
        break;
      }

      case 'audit': {
        const ledger = loadLedger(root);
        const learnings = readLearnings(root).filter((e) => !e.__parseError);
        const classifications = classifyRules({ ledger, learnings });
        const date = flag('date', new Date().toISOString().slice(0, 10));
        const run = flag('run', 'unnamed');
        const candidates = pruneCandidates(ledger);
        const notes = candidates.length
          ? [
              `Pruning candidates carried in from earlier audits: ${candidates.map((c) => c.id).join(', ')}.`,
            ]
          : [];
        if (!learnings.some((l) => l.kind === 'doctrine-fired')) {
          notes.push(
            '_No `doctrine-fired` learnings this run — every rule below reads as dormant for ' +
              'that reason alone. Do not prune on this audit (FR-A5.2)._',
          );
        }
        const block = renderAuditBlock({ date, run, classifications, notes });
        if (has('append')) {
          appendAudit(root, block);
          console.error(`appended audit to ${ledgerPath(root)}`);
        }
        console.log(has('json') ? JSON.stringify(classifications, null, 2) : block);
        break;
      }

      case 'prune': {
        const ledger = loadLedger(root);
        const candidates = pruneCandidates(ledger);
        if (!candidates.length) {
          console.log(`no rule has been dormant across ${DORMANT_WINDOW} consecutive audits`);
          break;
        }
        console.log(`Proposed for removal (dormant across ${DORMANT_WINDOW} audits):`);
        for (const c of candidates) {
          console.log(`  ${c.id}  "${c.anchor}"  (audits: ${c.audits.join(', ')})`);
        }
        console.log(
          '\nRemove the rule from the doctrine, set its ledger status to `pruned`, and watch the ' +
            'parity criteria. The ledger keeps the text: restoring it is one edit.',
        );
        break;
      }

      case 'size': {
        const markdown = readDoctrine(root);
        const metrics = doctrineMetrics(markdown);
        const ledger = loadLedger(root);
        const result = sizeCheck({ markdown, ledger, metrics });
        if (has('record')) {
          const commit = (() => {
            try {
              return execFileSync('git', ['-C', root, 'rev-parse', '--short', 'HEAD'], {
                encoding: 'utf8',
              }).trim();
            } catch {
              return 'unknown';
            }
          })();
          console.log(
            sizeLogRow({
              date: flag('date', new Date().toISOString().slice(0, 10)),
              commit,
              metrics,
              note: flag('note', ''),
            }),
          );
          console.error("paste that row into the ledger's Size log table");
          break;
        }
        console.log(`${metrics.lines} lines, ${metrics.words} words, ${metrics.rules} rules`);
        console.log(result.detail);
        if (!result.ok) process.exit(4);
        break;
      }

      case 'rules': {
        for (const rule of extractRules(readDoctrine(root))) {
          console.log(`${String(rule.line).padStart(4)}  ${rule.kind.padEnd(7)}  ${rule.anchor}`);
        }
        break;
      }

      default:
        console.error('commands: check audit prune size rules');
        process.exit(1);
    }
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
