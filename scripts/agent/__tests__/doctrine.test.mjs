// Tier 0 for the self-tuning doctrine (FR-A5.1 – FR-A5.3). Zero tokens: the
// ledger is a schema, the audit is a fold over recorded learnings, and pruning
// is a policy over audit history — all three are testable without a model.
//
// The one test that matters most is the last describe block: it runs `check`
// against *this repo's* real doctrine and ledger, so an edit to the agent file
// that skips the ledger fails the suite instead of being noticed a month later.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, makeRepo, run } from './fixture.mjs';
import {
  appendAudit,
  check,
  classifyRules,
  coverageProblems,
  doctrineMetrics,
  extractRules,
  loadLedger,
  parseLedger,
  pruneCandidates,
  renderAuditBlock,
  sizeCheck,
} from '../doctrine.mjs';

const DOCTRINE = `---
name: test-doctrine
model: opus
---

# You are the orchestrator

Preamble prose that states no rule.

## Core loop

**Do not take a turn while a subagent is running.** Every turn re-primes the
context at 12.5x the price of reading it.

1. **IMPLEMENTER** — writes the fix.
2. **VALIDATOR** — mutation-tests the tests.

## Committing

- **One unit, one commit**, with a message that explains the why.
- If the hook is slow, run the commit in the background.

\`\`\`
- this is a code fence, not a rule
\`\`\`
`;

const ledgerFor = (rules, { sizeLog = [], audits = '' } = {}) =>
  [
    '# Ledger',
    '',
    '## Rules',
    '',
    '| id | section | anchor | class | provenance | date | status |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...rules.map(
      (r) =>
        `| ${r.id} | ${r.section} | ${r.anchor} | ${r.class ?? 'normal'} | ${r.provenance ?? 'prior'} | ${r.date ?? '2026-07-25'} | ${r.status ?? 'active'} |`,
    ),
    '',
    '## Size log',
    '',
    '| date | commit | lines | rules | note |',
    '| --- | --- | --- | --- | --- |',
    ...sizeLog.map((s) => `| ${s.date} | ${s.commit ?? 'abc1234'} | ${s.lines} | ${s.rules} | |`),
    '',
    '## Audits',
    '',
    audits,
  ].join('\n');

/** The ledger that exactly covers DOCTRINE, as a starting point to perturb. */
function fullLedger(extra = {}) {
  const rules = extractRules(DOCTRINE).map((r, i) => ({
    id: `D-${String(i + 1).padStart(2, '0')}`,
    section: r.section,
    anchor: r.anchor,
  }));
  return { rules, markdown: ledgerFor(rules, extra) };
}

describe("extractRules — reading the doctrine's own structure", () => {
  const rules = extractRules(DOCTRINE);
  const anchors = rules.map((r) => r.anchor);

  it('takes every ## heading as a section rule, so prose-only sections are covered too', () => {
    expect(rules.filter((r) => r.kind === 'section').map((r) => r.anchor)).toEqual([
      'Core loop',
      'Committing',
    ]);
  });

  it('takes bold-led paragraphs and list items, with the bold lead-in as the anchor', () => {
    expect(anchors).toContain('Do not take a turn while a subagent is running');
    expect(anchors).toContain('IMPLEMENTER');
    expect(anchors).toContain('One unit, one commit');
  });

  it('falls back to the first sentence for a list item with no bold lead-in', () => {
    expect(anchors).toContain('If the hook is slow, run the commit in the background');
  });

  it('ignores frontmatter, code fences, and connective prose', () => {
    expect(anchors.some((a) => a.includes('code fence'))).toBe(false);
    expect(anchors.some((a) => a.includes('test-doctrine'))).toBe(false);
    expect(anchors.some((a) => a.startsWith('Preamble'))).toBe(false);
  });

  it('keeps two identically-named rules apart by section', () => {
    const doubled = extractRules(
      `## A\n\n- **VALIDATOR** — one\n\n## B\n\n- **VALIDATOR** — two\n`,
    );
    expect(doubled.filter((r) => r.anchor === 'VALIDATOR').map((r) => r.section)).toEqual([
      'A',
      'B',
    ]);
  });
});

describe('AC-A5.1 — every rule carries provenance or an explicit prior marker', () => {
  it('passes when the ledger covers the doctrine', () => {
    const { rules, markdown } = fullLedger();
    expect(
      coverageProblems({ rules: extractRules(DOCTRINE), ledger: parseLedger(markdown) }),
    ).toEqual([]);
    expect(rules.length).toBeGreaterThan(5);
  });

  it('fails a doctrine rule with no ledger entry', () => {
    const { rules } = fullLedger();
    const missing = rules.filter((r) => r.anchor !== 'One unit, one commit');
    const problems = coverageProblems({
      rules: extractRules(DOCTRINE),
      ledger: parseLedger(ledgerFor(missing)),
    });
    expect(problems.join()).toMatch(/"One unit, one commit".*has no ledger entry/);
  });

  it('fails provenance that cites nothing openable, and accepts `prior`', () => {
    const { rules } = fullLedger();
    const vague = rules.map((r) =>
      r.anchor === 'IMPLEMENTER' ? { ...r, provenance: 'seemed like a good idea' } : r,
    );
    const problems = coverageProblems({
      rules: extractRules(DOCTRINE),
      ledger: parseLedger(ledgerFor(vague)),
    });
    expect(problems.join()).toMatch(/cites nothing openable/);

    const dated = rules.map((r) =>
      r.anchor === 'IMPLEMENTER'
        ? { ...r, provenance: '2026-07-28 baseline: duplicate validator spawn' }
        : r,
    );
    expect(
      coverageProblems({ rules: extractRules(DOCTRINE), ledger: parseLedger(ledgerFor(dated)) }),
    ).toEqual([]);
  });

  it('fails an entry with no ISO date and a malformed id', () => {
    const { rules } = fullLedger();
    const broken = rules.map((r, i) => (i === 0 ? { ...r, id: 'rule-one', date: 'last week' } : r));
    const problems = coverageProblems({
      rules: extractRules(DOCTRINE),
      ledger: parseLedger(ledgerFor(broken)),
    }).join();
    expect(problems).toMatch(/not of the form D-NN/);
    expect(problems).toMatch(/no ISO date/);
  });

  it('makes removal explicit: a ledger entry absent from the doctrine must be marked pruned', () => {
    const { rules } = fullLedger();
    const orphan = [...rules, { id: 'D-99', section: 'Core loop', anchor: 'A rule since deleted' }];
    expect(
      coverageProblems({
        rules: extractRules(DOCTRINE),
        ledger: parseLedger(ledgerFor(orphan)),
      }).join(),
    ).toMatch(/D-99.*absent from the doctrine — mark it `pruned`/);

    const pruned = [
      ...rules,
      { id: 'D-99', section: 'Core loop', anchor: 'A rule since deleted', status: 'pruned' },
    ];
    expect(
      coverageProblems({ rules: extractRules(DOCTRINE), ledger: parseLedger(ledgerFor(pruned)) }),
    ).toEqual([]);
  });

  it('catches a rule marked pruned that is still in the prompt', () => {
    const { rules } = fullLedger();
    const lying = rules.map((r) =>
      r.anchor === 'One unit, one commit' ? { ...r, status: 'pruned' } : r,
    );
    expect(
      coverageProblems({
        rules: extractRules(DOCTRINE),
        ledger: parseLedger(ledgerFor(lying)),
      }).join(),
    ).toMatch(/marked `pruned` but "One unit, one commit" is still in the doctrine/);
  });
});

describe('AC-A5.3 — no net growth without an incident', () => {
  const metrics = doctrineMetrics(DOCTRINE);

  it('accepts a doctrine that did not grow', () => {
    const { markdown } = fullLedger({
      sizeLog: [{ date: '2026-07-30', lines: metrics.lines, rules: metrics.rules }],
    });
    expect(sizeCheck({ markdown: DOCTRINE, ledger: parseLedger(markdown) }).ok).toBe(true);
  });

  it('rejects growth backed only by priors — an untested belief does not buy context', () => {
    const { rules } = fullLedger();
    const withPrior = rules.map((r) =>
      r.anchor === 'One unit, one commit' ? { ...r, date: '2026-08-01', provenance: 'prior' } : r,
    );
    const markdown = ledgerFor(withPrior, {
      sizeLog: [{ date: '2026-07-30', lines: 10, rules: metrics.rules - 1 }],
    });
    const result = sizeCheck({ markdown: DOCTRINE, ledger: parseLedger(markdown) });
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/net growth without incidents/);
  });

  it('accepts growth backed by an incident dated after the baseline row', () => {
    const { rules } = fullLedger();
    const withIncident = rules.map((r) =>
      r.anchor === 'One unit, one commit'
        ? {
            ...r,
            date: '2026-08-01',
            provenance: '2026-07-31 incident: two units in one commit (FR-A5.1)',
          }
        : r,
    );
    const markdown = ledgerFor(withIncident, {
      sizeLog: [{ date: '2026-07-30', lines: 10, rules: metrics.rules - 1 }],
    });
    expect(sizeCheck({ markdown: DOCTRINE, ledger: parseLedger(markdown) }).ok).toBe(true);
  });

  it('treats a missing baseline as establishing one rather than as a failure', () => {
    const { markdown } = fullLedger();
    expect(sizeCheck({ markdown: DOCTRINE, ledger: parseLedger(markdown) }).ok).toBe(true);
  });
});

describe('FR-A5.2 — the per-run audit classifies every rule', () => {
  const ledger = parseLedger(fullLedger().markdown);
  const ids = ledger.rules.map((r) => r.id);

  it('marks a rule fired when a doctrine-fired learning names it', () => {
    const out = classifyRules({
      ledger,
      learnings: [
        {
          unit: 'unit-1',
          kind: 'doctrine-fired',
          rule: ids[0],
          evidence: 'preflight exit 3 found the orphan',
        },
      ],
    });
    expect(out.find((r) => r.id === ids[0])).toMatchObject({ classification: 'fired' });
    expect(out.filter((r) => r.classification === 'dormant').length).toBe(ids.length - 1);
  });

  it('marks a rule violated when a doctrine-gap names it, and violated beats fired', () => {
    const out = classifyRules({
      ledger,
      learnings: [
        { unit: 'unit-1', kind: 'doctrine-fired', rule: ids[0], evidence: 'fired on unit 1' },
        {
          unit: 'unit-2',
          kind: 'doctrine-gap',
          rule: ids[0],
          evidence: 'should have fired on unit 2',
        },
      ],
    });
    const rule = out.find((r) => r.id === ids[0]);
    expect(rule.classification).toBe('violated');
    expect(rule.evidence).toMatch(/should have fired on unit 2/);
  });

  it('finds a rule quoted by anchor when no id was given — the baseline corpus shape', () => {
    const out = classifyRules({
      ledger,
      learnings: [
        {
          unit: 'unit-1',
          kind: 'doctrine-gap',
          evidence:
            'the rule "Do not take a turn while a subagent is running" did not fire; 4 polling turns',
          action: 'mechanise it',
        },
      ],
    });
    const rule = out.find((r) => r.anchor === 'Do not take a turn while a subagent is running');
    expect(rule.classification).toBe('violated');
  });

  it('ignores strength and weakness entries — only doctrine entries classify rules', () => {
    const out = classifyRules({
      ledger,
      learnings: [
        { unit: 'unit-1', kind: 'strength', evidence: 'the brief named src/core/x.ts:4' },
      ],
    });
    expect(out.every((r) => r.classification === 'dormant')).toBe(true);
  });

  it('renders an audit block the ledger parser can read back', () => {
    const classifications = classifyRules({ ledger, learnings: [] });
    const block = renderAuditBlock({ date: '2026-08-02', run: 'smoke-1', classifications });
    const reparsed = parseLedger(`${fullLedger().markdown}\n${block}`);
    expect(reparsed.audits).toHaveLength(1);
    expect(reparsed.audits[0]).toMatchObject({ date: '2026-08-02', run: 'smoke-1' });
    expect(reparsed.audits[0].rows).toHaveLength(classifications.length);
    expect(block).toMatch(/\d+ fired, \d+ violated, \d+ dormant/);
  });
});

describe('FR-A5.3 — pruning proposals', () => {
  const audit = (date, rows) =>
    [
      `### Audit — ${date} (run: r-${date})`,
      '',
      '| rule | classification | evidence |',
      '| --- | --- | --- |',
      ...Object.entries(rows).map(([id, c]) => `| ${id} | ${c} | — |`),
      '',
    ].join('\n');

  const rules = [
    { id: 'D-01', section: 'S', anchor: 'a normal rule' },
    { id: 'D-02', section: 'S', anchor: 'a safety rule', class: 'safety-critical' },
    { id: 'D-03', section: 'S', anchor: 'a rule that fires' },
  ];

  it('proposes a rule dormant across three consecutive audits', () => {
    const ledger = parseLedger(
      ledgerFor(rules, {
        audits: [
          audit('2026-07-30', { 'D-01': 'dormant', 'D-02': 'dormant', 'D-03': 'fired' }),
          audit('2026-07-31', { 'D-01': 'dormant', 'D-02': 'dormant', 'D-03': 'dormant' }),
          audit('2026-08-01', { 'D-01': 'dormant', 'D-02': 'dormant', 'D-03': 'fired' }),
        ].join('\n'),
      }),
    );
    const candidates = pruneCandidates(ledger);
    expect(candidates.map((c) => c.id)).toEqual(['D-01']);
    expect(candidates[0].audits).toEqual(['2026-07-30', '2026-07-31', '2026-08-01']);
  });

  it('exempts safety-critical rules however long they lie quiet', () => {
    const ledger = parseLedger(
      ledgerFor(rules, {
        audits: [
          audit('2026-07-30', { 'D-02': 'dormant' }),
          audit('2026-07-31', { 'D-02': 'dormant' }),
          audit('2026-08-01', { 'D-02': 'dormant' }),
        ].join('\n'),
      }),
    );
    expect(pruneCandidates(ledger).map((c) => c.id)).not.toContain('D-02');
  });

  it('needs three audits: two dormant runs propose nothing', () => {
    const ledger = parseLedger(
      ledgerFor(rules, {
        audits: [
          audit('2026-07-31', { 'D-01': 'dormant' }),
          audit('2026-08-01', { 'D-01': 'dormant' }),
        ].join('\n'),
      }),
    );
    expect(pruneCandidates(ledger)).toEqual([]);
  });

  it('a single firing resets the streak', () => {
    const ledger = parseLedger(
      ledgerFor(rules, {
        audits: [
          audit('2026-07-30', { 'D-01': 'dormant' }),
          audit('2026-07-31', { 'D-01': 'fired' }),
          audit('2026-08-01', { 'D-01': 'dormant' }),
        ].join('\n'),
      }),
    );
    expect(pruneCandidates(ledger)).toEqual([]);
  });

  it('says nothing about a rule younger than the audit window', () => {
    const ledger = parseLedger(
      ledgerFor(rules, {
        audits: [
          audit('2026-07-30', { 'D-03': 'dormant' }),
          audit('2026-07-31', { 'D-03': 'dormant' }),
          audit('2026-08-01', { 'D-01': 'dormant', 'D-03': 'dormant' }),
        ].join('\n'),
      }),
    );
    expect(pruneCandidates(ledger).map((c) => c.id)).toEqual(['D-03']);
  });
});

describe('CLI against a fixture repo', () => {
  let root;
  const cli = (args) =>
    run('node', [new URL('../doctrine.mjs', import.meta.url).pathname, ...args], root);

  beforeEach(() => {
    root = makeRepo();
    mkdirSync(join(root, '.claude', 'agents'), { recursive: true });
    mkdirSync(join(root, 'docs'), { recursive: true });
    mkdirSync(join(root, '.agent'), { recursive: true });
    writeFileSync(join(root, '.claude', 'agents', 'sequential-fix-orchestrator.md'), DOCTRINE);
    writeFileSync(join(root, 'docs', 'agent-doctrine-ledger.md'), fullLedger().markdown);
  });
  afterEach(() => cleanup(root));

  it('check exits 0 on a covered doctrine and 4 on an uncovered one', () => {
    expect(cli(['check']).status).toBe(0);
    writeFileSync(
      join(root, '.claude', 'agents', 'sequential-fix-orchestrator.md'),
      `${DOCTRINE}\n## A brand new section\n\nWith no ledger entry.\n`,
    );
    const failed = cli(['check']);
    expect(failed.status).toBe(4);
    expect(failed.stderr).toMatch(/A brand new section/);
  });

  it('audit --append writes a block the next parse can read', () => {
    writeFileSync(
      join(root, '.agent', 'learnings.jsonl'),
      `${JSON.stringify({
        unit: 'unit-1',
        kind: 'doctrine-fired',
        rule: 'D-01',
        evidence: 'section rule fired',
        action: 'keep',
      })}\n`,
    );
    const res = cli(['audit', '--run', 'smoke', '--date', '2026-08-02', '--append']);
    expect(res.status).toBe(0);
    const ledger = loadLedger(root);
    expect(ledger.audits).toHaveLength(1);
    expect(ledger.audits[0].rows.find((r) => r.rule === 'D-01').classification).toBe('fired');
  });

  it('warns in the audit when no rule fired, instead of letting the run look conclusive', () => {
    const res = cli(['audit', '--run', 'empty', '--date', '2026-08-02']);
    expect(res.stdout).toMatch(/No `doctrine-fired` learnings this run/);
    expect(res.stdout).toMatch(/Do not prune on this audit/);
  });

  it('prune reports nothing without three audits, and the proposal once they exist', () => {
    expect(cli(['prune']).stdout).toMatch(/no rule has been dormant/);
    for (const date of ['2026-07-30', '2026-07-31', '2026-08-01']) {
      appendAudit(
        root,
        renderAuditBlock({
          date,
          run: date,
          classifications: [
            { id: 'D-01', anchor: 'Core loop', classification: 'dormant', evidence: '—' },
          ],
        }),
      );
    }
    const res = cli(['prune']);
    expect(res.stdout).toMatch(/D-01/);
    expect(res.stdout).toMatch(/restoring it is one edit/);
  });

  it('size --record emits a row for the size log', () => {
    const res = cli(['size', '--record', '--date', '2026-08-02']);
    expect(res.stdout.trim()).toMatch(/^\| 2026-08-02 \| [0-9a-f]+ \| \d+ \| \d+ \|/);
  });
});

// Spec §8: "The audit must reproduce those classifications from the corpus
// before it is trusted on a live run." The corpus is the 2026-07-28 baseline's
// known incidents restated as FR-A3.7 learnings entries — the duplicate
// validator spawn, the two progress stalls, the reviewer finding what a clean
// validation missed. Ground truth exists, so this is a real test, not a fixture
// echo: an audit that cannot find known patterns will not find unknown ones.
describe('FR-A5.2 replayed against the baseline corpus', () => {
  const repo = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
    cwd: new URL('.', import.meta.url).pathname,
  }).trim();
  const learnings = readFileSync(
    new URL('./fixtures/baseline-learnings.jsonl', import.meta.url),
    'utf8',
  )
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  const byId = new Map(
    classifyRules({ ledger: loadLedger(repo), learnings }).map((c) => [c.id, c]),
  );

  it('finds the duplicate-spawn violation the baseline is known for', () => {
    expect(byId.get('D-35').classification).toBe('violated');
    expect(byId.get('D-35').evidence).toMatch(/3\.8M tokens/);
  });

  it('finds both progress stalls against the same rule', () => {
    const stalls = byId.get('D-32');
    expect(stalls.classification).toBe('violated');
    expect(stalls.evidence.match(/unit-[23]:/g)).toHaveLength(2);
  });

  it('finds the rules that fired, so they are not proposed for pruning', () => {
    expect(byId.get('D-54').classification).toBe('fired');
    expect(byId.get('D-55').classification).toBe('fired');
  });

  it('leaves rules the run never exercised dormant rather than guessing', () => {
    expect(byId.get('D-49').classification).toBe('dormant');
    expect([...byId.values()].filter((c) => c.classification === 'dormant').length).toBeGreaterThan(
      50,
    );
  });

  it('does not classify from strength/weakness entries — only doctrine ones', () => {
    // The corpus's cost weakness is real and actionable, but it names no rule.
    expect(byId.get('D-08').classification).toBe('dormant');
  });
});

describe('this repo (AC-A5.1, AC-A5.3)', () => {
  const repo = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
    cwd: new URL('.', import.meta.url).pathname,
  }).trim();

  it('the real doctrine is fully covered by the real ledger', () => {
    const { problems, rules } = check(repo);
    expect(problems).toEqual([]);
    expect(rules.length).toBeGreaterThan(40);
  });

  it('the real doctrine has not grown past its last size-log row without incidents', () => {
    expect(check(repo).size.ok).toBe(true);
  });

  it('the ledger records the size log against the doctrine actually on disk', () => {
    const { size } = check(repo);
    const doctrine = readFileSync(
      join(repo, '.claude', 'agents', 'sequential-fix-orchestrator.md'),
      'utf8',
    );
    // The recorded line count may lag a prose edit, but not by much: a stale row
    // means the growth check is comparing against a doctrine nobody has seen.
    expect(Math.abs(doctrineMetrics(doctrine).lines - size.baseline.lines)).toBeLessThan(20);
  });
});
