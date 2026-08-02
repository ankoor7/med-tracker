#!/usr/bin/env node
// The calibrated bounce rubric (FR-A5.5, spec: specs/agent/agent-stage-5-self-tuning-doctrine.md).
//
//   pnpm agent:rubric check <report.md>                     # shape + honesty gate
//   pnpm agent:rubric record <report.md> --unit U --role R  # append to .agent/verdicts.jsonl
//   pnpm agent:rubric dimensions                            # the anchors, for a spawn prompt
//
// Validator and reviewer reports used to end in prose, which made "did this run
// find less than baseline?" a question of re-reading two full reports. A scored
// verdict against fixed dimensions makes AC-parity comparisons mechanical — and
// gives FR-A5.2's doctrine audit something to read when it asks whether the
// review rules fired.
//
// The honesty guard is the point of tension and it is deliberate: the revert
// condition on this FR is scored verdicts making reports *less* honest. So a
// verdict that passes everything while the "Could not verify" section is silent
// or empty is rejected here, at the gate, rather than being counted as a clean
// pass. Honest-limits reporting (FR-A2.7) outranks comparability.

import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { agentDir, isoNow } from './state.mjs';

export const SCORES = ['pass', 'fail', 'n/a'];

/**
 * Four dimensions, each with a pass and a fail anchor drawn from real runs —
 * calibration by example, because "correctness: pass" means nothing without one.
 */
export const DIMENSIONS = [
  {
    key: 'correctness',
    asks: 'Does it do what the unit says, for the reasons it claims?',
    pass: 'Every acceptance criterion was exercised live and observed to hold; claims made in comments were opened and confirmed.',
    fail: 'A comment asserted "validated upstream" and the named file contained no such validation — a false claim is a defect even where the code is right.',
  },
  {
    key: 'test-honesty',
    asks: 'Can the new tests actually fail, and do they test the real logic?',
    pass: 'The fix was reverted, the named new tests failed, and the revert was restored byte-identical.',
    fail: 'Tests assert a ratio rather than the value, or mock so heavily the changed code never runs — green against the old code too.',
  },
  {
    key: 'fit',
    asks: 'Does it belong in this codebase — boundaries, duplication, scope?',
    pass: 'Domain logic landed in src/core/ with no store or UI import, and reused the existing guardrail helper.',
    fail: 'The unit also refactored an adjacent screen, so the reviewer cannot separate the fix from the improvement.',
  },
  {
    key: 'ux-clarity',
    asks: 'Would a person understand the screen? (`n/a` only when the unit touches no UI.)',
    pass: 'Drove the flow as a user and the adjusted-dose row read unambiguously without the tooltip.',
    fail: 'Every test passed and the label still says "Adj." — green checks were never the bar for a UX fix.',
  },
];

export const DIMENSION_KEYS = DIMENSIONS.map((d) => d.key);
export const verdictsPath = (root) => join(agentDir(root), 'verdicts.jsonl');

/**
 * Parse the verdict block a role report ends with:
 *
 *   ## Verdict
 *   - correctness: pass — every AC exercised live, see …
 *   - test-honesty: fail — the mutation left tests green
 *   - fit: pass — …
 *   - ux-clarity: n/a — no UI in this unit
 *   - bounce: yes (test-honesty)
 */
export function parseVerdict(markdown) {
  const scores = {};
  const reasons = {};
  let bounce = null;
  let bounceDimensions = [];
  let found = false;

  for (const line of markdown.split('\n')) {
    const row =
      /^\s*[-*+]?\s*([a-z-]+)\s*:\s*(pass|fail|n\/a|na|yes|no)\b\s*(?:[—:-]\s*)?(.*)$/i.exec(line);
    if (!row) continue;
    const key = row[1].toLowerCase();
    const value = row[2].toLowerCase().replace(/^na$/, 'n/a');
    const rest = row[3].trim();

    if (key === 'bounce') {
      bounce = value === 'yes';
      bounceDimensions = [...rest.matchAll(/[a-z-]+/gi)]
        .map((m) => m[0].toLowerCase())
        .filter((k) => DIMENSION_KEYS.includes(k));
      found = true;
      continue;
    }
    if (!DIMENSION_KEYS.includes(key)) continue;
    scores[key] = value;
    reasons[key] = rest;
    found = true;
  }

  return { found, scores, reasons, bounce, bounceDimensions };
}

/** The report's honest-limits section — FR-A2.7's bar, which this rubric may not erode. */
export function couldNotVerifySection(markdown) {
  // The heading takes several shapes across reports — `## Could not verify`, a
  // numbered `3. **Could not verify** — …` with its content on the same line.
  // Both count; only its absence is a failure.
  const m =
    /^[ \t]*(?:#{1,6}[ \t]*)?(?:\d+\.[ \t]*)?\**could not verify\**[ \t]*[—:-]?([^\n]*)$/im.exec(
      markdown,
    );
  if (!m) return null;
  const after = markdown.slice(m.index + m[0].length);
  const end = after.search(/\n[ \t]*(?:#{1,6}[ \t]|\d+\.[ \t]+\*\*)/);
  return `${m[1]}\n${end === -1 ? after : after.slice(0, end)}`.trim();
}

export function checkReport(markdown) {
  const verdict = parseVerdict(markdown);
  const problems = [];

  if (!verdict.found) {
    return {
      ok: false,
      verdict,
      problems: [
        'no verdict block — end the report with one scored line per dimension ' +
          `(${DIMENSION_KEYS.join(', ')}) and a \`bounce: yes|no\` line (FR-A5.5)`,
      ],
    };
  }

  for (const key of DIMENSION_KEYS) {
    const score = verdict.scores[key];
    if (!score) {
      problems.push(
        `missing dimension \`${key}\` — score every dimension, \`n/a\` with a reason if it does not apply`,
      );
      continue;
    }
    if (!SCORES.includes(score))
      problems.push(`\`${key}\` scored \`${score}\` (expected pass, fail, or n/a)`);
    if (!verdict.reasons[key] || verdict.reasons[key].length < 15) {
      problems.push(
        `\`${key}: ${score}\` carries no evidence — a bare score is a vibe with a label`,
      );
    }
  }

  if (verdict.bounce === null) {
    problems.push('no `bounce: yes|no` line — the verdict has to state whether work was sent back');
  }
  if (verdict.bounce === true && !verdict.bounceDimensions.length) {
    problems.push(
      'bounce: yes without a dimension — a send-back cites the dimension that failed (FR-A5.5)',
    );
  }
  const failed = DIMENSION_KEYS.filter((k) => verdict.scores[k] === 'fail');
  if (verdict.bounce === false && failed.length) {
    problems.push(
      `bounce: no while \`${failed.join(', ')}\` scored fail — reconcile the verdict with the scores`,
    );
  }
  for (const dim of verdict.bounceDimensions) {
    if (verdict.scores[dim] !== 'fail') {
      problems.push(
        `bounce cites \`${dim}\` but scored it \`${verdict.scores[dim] ?? 'nothing'}\``,
      );
    }
  }

  // The honesty guard (revert condition on FR-A5.5).
  const limits = couldNotVerifySection(markdown);
  const allPass = DIMENSION_KEYS.every((k) => ['pass', 'n/a'].includes(verdict.scores[k]));
  if (limits === null) {
    problems.push(
      'no "Could not verify" section — silence there is a failure, scored verdict or not (FR-A2.7)',
    );
  } else if (allPass && limits.length < 20) {
    problems.push(
      'every dimension passed and "Could not verify" is empty — say positively that everything was ' +
        'verifiable and how, or say what was not. A clean scorecard may not replace the reservations.',
    );
  }

  return { ok: problems.length === 0, verdict, problems, limits };
}

export function appendVerdict(root, entry) {
  const record = { ts: entry.ts ?? isoNow(), ...entry };
  appendFileSync(verdictsPath(root), `${JSON.stringify(record)}\n`);
  return record;
}

export function readVerdicts(root) {
  const path = verdictsPath(root);
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

/** Dimension-by-dimension tallies — what makes AC-A5.5's cross-run comparison a table lookup. */
export function tallyVerdicts(verdicts) {
  const tally = Object.fromEntries(DIMENSION_KEYS.map((k) => [k, { pass: 0, fail: 0, 'n/a': 0 }]));
  for (const v of verdicts) {
    if (v.__parseError) continue;
    for (const [key, score] of Object.entries(v.scores ?? {})) {
      if (tally[key] && tally[key][score] !== undefined) tally[key][score] += 1;
    }
  }
  return tally;
}

export function dimensionsMarkdown() {
  const L = ['| dimension | asks | pass anchor | fail anchor |', '| --- | --- | --- | --- |'];
  for (const d of DIMENSIONS) {
    L.push(`| \`${d.key}\` | ${d.asks} | ${d.pass} | ${d.fail} |`);
  }
  return L.join('\n');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const command = argv[0];
  const flag = (name, fallback = null) => {
    const i = argv.indexOf(`--${name}`);
    return i === -1 ? fallback : argv[i + 1];
  };
  const root =
    process.env.AGENT_ROOT ??
    (() => {
      try {
        return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
      } catch {
        return process.cwd();
      }
    })();

  try {
    switch (command) {
      case 'dimensions':
        console.log(dimensionsMarkdown());
        break;

      case 'check':
      case 'record': {
        const file = argv[1];
        if (!file || file.startsWith('--'))
          throw new Error(`usage: ${command} <report.md> [--unit U --role R]`);
        const markdown = readFileSync(file, 'utf8');
        const result = checkReport(markdown);
        if (!result.ok) {
          console.error(`FAIL (${result.problems.length})`);
          for (const p of result.problems) console.error(`  - ${p}`);
          process.exit(4);
        }
        const summary = DIMENSION_KEYS.map((k) => `${k}=${result.verdict.scores[k]}`).join(' ');
        if (command === 'record') {
          const unit = flag('unit');
          const role = flag('role');
          if (!unit || !role) throw new Error('record needs --unit and --role');
          appendVerdict(root, {
            unit,
            role,
            scores: result.verdict.scores,
            reasons: result.verdict.reasons,
            bounce: result.verdict.bounce,
            bounce_dimensions: result.verdict.bounceDimensions,
            report: file,
          });
          console.log(`recorded ${role} verdict for ${unit}: ${summary}`);
        } else {
          console.log(`OK — ${summary} bounce=${result.verdict.bounce ? 'yes' : 'no'}`);
        }
        break;
      }

      default:
        console.error('commands: check record dimensions');
        process.exit(1);
    }
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
