// Tier 0/1 for the run report (FR-A4.7).
//
// The deterministic half of the synthesis is tested here against a corpus shaped
// like the 2026-07-28 baseline — whose known cross-unit patterns (a validator
// that ran without delivering and was then duplicated, a lesson recorded twice
// and never applied) are exactly what the digest must surface *before* a model
// looks at it. A synthesis pass that cannot find known patterns in recorded data
// will not find unknown ones live.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  THREE_UNITS,
  cleanup,
  cli,
  commitAll,
  makeRepo,
  run,
  writeUnitsFixture,
} from './fixture.mjs';
import { collect, detectPatterns, digest, integrityFlags } from '../run-report.mjs';
import { appendVerdict } from '../rubric.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

let root;
beforeEach(() => {
  root = makeRepo();
  writeUnitsFixture(root, THREE_UNITS);
});
afterEach(() => cleanup(root));

const learn = (unit, kind, evidence, action, role = 'orchestrator') =>
  cli(root, [
    'learn',
    '--unit',
    unit,
    '--role',
    role,
    '--kind',
    kind,
    '--evidence',
    evidence,
    '--action',
    action,
  ]);

function commitUnit(unit) {
  const sha = commitAll(root, `${unit} work`);
  cli(root, ['set-status', unit, 'committed', '--sha', sha]);
  return sha;
}

describe('digest facts', () => {
  it('summarises units, roles, and totals', () => {
    cli(root, ['event', '--kind', 'run-started']);
    cli(root, ['event', '--kind', 'spawned', '--unit', 'unit-1']);
    cli(root, ['record-role', 'unit-1', 'implementer', '--outcome', 'green']);
    cli(root, [
      'event',
      '--kind',
      'exited',
      '--unit',
      'unit-1',
      '--extra',
      '{"elapsed_seconds":420}',
    ]);
    commitUnit('unit-1');
    learn('unit-1', 'strength', 'Directive named src/core/schedule.ts:42', 'Reuse that shape');
    learn(
      'unit-1',
      'weakness',
      'Validator re-read src/core/guardrails.ts:88',
      'Summarise in brief',
    );
    cli(root, ['event', '--kind', 'run-finished']);

    const data = collect(root);
    expect(data.totals).toMatchObject({ units: 3, committed: 1, spawns: 1 });
    const u1 = data.perUnit.find((u) => u.id === 'unit-1');
    expect(u1).toMatchObject({ status: 'committed', spawns: 1, wall_clock_seconds: 420 });
    expect(u1.roles.implementer).toEqual(['green']);
    expect(u1.strengths).toHaveLength(1);
    expect(u1.weaknesses).toHaveLength(1);

    const md = digest(data);
    expect(md).toMatch(/# Run digest — stage-test/);
    expect(md).toMatch(/\| unit-1 \| committed \|/);
    expect(md).toMatch(/## What worked/);
    expect(md).toMatch(/## What did not/);
  });

  it('names the absence of learnings as a finding rather than staying silent', () => {
    const md = digest(collect(root));
    expect(md).toMatch(/none recorded — this is itself a finding/);
  });

  it('includes failed approaches so the synthesis sees the dead ends', () => {
    cli(root, [
      'failed',
      '--unit',
      'unit-1',
      '--role',
      'implementer',
      '--approach',
      'Storing the adjusted dose as a ratio',
      '--why',
      'Loses the prescribed value the audit view needs',
      '--do-not-retry',
      'Do not model dose adjustment as a ratio',
    ]);
    expect(digest(collect(root))).toMatch(/Do not model dose adjustment as a ratio/);
  });
});

describe('cross-unit pattern detection (the observer the loop deleted)', () => {
  it('spots a role that sends work back on more than one unit', () => {
    const perUnit = [
      {
        id: 'unit-1',
        roles: { validator: ['bounced'] },
        spawns: 1,
        bounce_count: 1,
        strengths: [],
        weaknesses: [],
      },
      {
        id: 'unit-2',
        roles: { validator: ['bounced'] },
        spawns: 1,
        bounce_count: 1,
        strengths: [],
        weaknesses: [],
      },
    ];
    const patterns = detectPatterns(perUnit, [], []);
    expect(patterns.find((p) => p.kind === 'repeated-bounce-role').detail).toMatch(
      /validator sent work back on 2 units/,
    );
  });

  it('spots repeated non-delivery — the baseline hang, generalised', () => {
    const perUnit = [
      {
        id: 'unit-1',
        roles: { validator: ['no-outcome', 'green'] },
        spawns: 1,
        strengths: [],
        weaknesses: [],
      },
      { id: 'unit-2', roles: { validator: ['hung'] }, spawns: 1, strengths: [], weaknesses: [] },
    ];
    const p = detectPatterns(perUnit, [], []).find((x) => x.kind === 'repeated-non-delivery');
    expect(p.detail).toMatch(/ran without delivering 2 times/);
    expect(p.detail).toMatch(/environment\/tooling fault/);
    expect(p.units).toEqual(['unit-1', 'unit-2']);
  });

  it('spots a lesson recorded on several units — written down and never applied', () => {
    const learnings = [
      { unit: 'unit-1', kind: 'weakness', action: 'Name the file:line in the brief' },
      { unit: 'unit-2', kind: 'weakness', action: 'name the file:line in the brief.' },
    ];
    const p = detectPatterns([], [], learnings).find((x) => x.kind === 'unapplied-learning');
    expect(p.detail).toMatch(/recorded on 2 units/);
    expect(p.detail).toMatch(/written down and not applied/);
  });

  it('spots repeated ceiling breaches and units needing many spawns', () => {
    const events = [
      { kind: 'ceiling-breach', unit: 'unit-1' },
      { kind: 'ceiling-breach', unit: 'unit-2' },
    ];
    const perUnit = [{ id: 'unit-3', roles: {}, spawns: 4, strengths: [], weaknesses: [] }];
    const patterns = detectPatterns(perUnit, events, []);
    expect(patterns.map((p) => p.kind)).toContain('repeated-ceiling-breach');
    expect(patterns.find((p) => p.kind === 'unit-needed-many-spawns').detail).toMatch(
      /took 4 orchestrator spawns/,
    );
  });

  it('stays quiet when a single unit had a single problem', () => {
    const perUnit = [
      { id: 'unit-1', roles: { validator: ['bounced'] }, spawns: 1, strengths: [], weaknesses: [] },
    ];
    expect(detectPatterns(perUnit, [], [])).toEqual([]);
  });
});

describe('observability defects (AC-A4.7 gate)', () => {
  it('flags a committed unit with one-sided learnings', () => {
    const flags = integrityFlags(
      [{ id: 'unit-1', status: 'committed', strengths: [{}], weaknesses: [] }],
      [{ kind: 'run-finished' }],
      [],
    );
    expect(flags.join()).toMatch(/one-sided/);
  });

  it('flags an incomplete run log', () => {
    const flags = integrityFlags(
      [],
      [{ kind: 'spawned' }, { kind: 'spawned' }, { kind: 'exited' }, { kind: 'run-finished' }],
      [],
    );
    expect(flags.join()).toMatch(/2 spawn\(s\) but 1 settled/);
  });

  it('flags an interrupted run and unparseable learnings', () => {
    const flags = integrityFlags([], [{ kind: 'spawned' }, { kind: 'exited' }], [{ line: 4 }]);
    expect(flags.join()).toMatch(/no run-finished event/);
    expect(flags.join()).toMatch(/learnings.jsonl:4 is not valid JSON/);
  });

  it('surfaces defects in the digest itself, not just in data', () => {
    commitUnit('unit-1');
    learn('unit-1', 'strength', 'Named src/core/schedule.ts:42 in the brief', 'Reuse it');
    const md = digest(collect(root));
    expect(md).toMatch(/## Observability defects/);
    expect(md).toMatch(/unit-1 is committed but its learnings are one-sided/);
  });
});

describe('doctrine audit and rubric verdicts in the digest (FR-A5.2, FR-A5.5)', () => {
  const ledger = [
    '# Ledger',
    '',
    '## Rules',
    '',
    '| id | section | anchor | class | provenance | date | status |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    '| D-01 | Core loop | Run the pre-spawn check | safety-critical | 2026-07-28 baseline | 2026-07-29 | active |',
    '| D-02 | Core loop | Delegate reading | normal | prior | 2026-07-25 | active |',
    '',
    '## Audits',
    '',
  ].join('\n');

  const writeLedger = () => {
    mkdirSync(join(root, 'docs'), { recursive: true });
    writeFileSync(join(root, 'docs', 'agent-doctrine-ledger.md'), ledger);
  };

  it("classifies rules from this run's learnings and names the violated ones", () => {
    writeLedger();
    cli(root, [
      'learn',
      '--unit',
      'unit-1',
      '--kind',
      'doctrine-gap',
      '--rule',
      'D-01',
      '--evidence',
      'Spawned a second validator for unit-1 while agent-af527349 sat on disk',
      '--action',
      'Run scripts/agent-preflight.sh before every spawn',
    ]);
    const data = collect(root);
    expect(data.doctrine.counts).toMatchObject({ violated: 1, dormant: 1, fired: 0 });

    const md = digest(data);
    expect(md).toMatch(/## Doctrine audit/);
    expect(md).toMatch(/\*\*D-01\*\* \("Run the pre-spawn check"\)/);
  });

  it('warns when nothing fired, because that alone makes every rule look prunable', () => {
    writeLedger();
    const md = digest(collect(root));
    expect(md).toMatch(/No `doctrine-fired` learnings this run/);
    expect(md).toMatch(/failure-only record marks the doctrine's best rules for removal/);
  });

  it('stays silent about doctrine in a repo with no ledger', () => {
    const data = collect(root);
    expect(data.doctrine).toBe(null);
    expect(digest(data)).not.toMatch(/## Doctrine audit/);
  });

  it('tallies rubric verdicts per dimension and names what bounced', () => {
    appendVerdict(root, {
      unit: 'unit-1',
      role: 'validator',
      scores: { correctness: 'pass', 'test-honesty': 'fail', fit: 'pass', 'ux-clarity': 'n/a' },
      bounce: true,
      bounce_dimensions: ['test-honesty'],
    });
    const md = digest(collect(root));
    expect(md).toMatch(/## Rubric verdicts/);
    expect(md).toMatch(/\| test-honesty \| 0 \| 1 \| 0 \|/);
    expect(md).toMatch(/`unit-1` validator bounced on \*\*test-honesty\*\*/);
  });
});

describe('CLI', () => {
  it('emits markdown by default and JSON on request', () => {
    const md = run('node', ['scripts/agent/run-report.mjs'], root, {
      AGENT_ROOT: root,
    });
    // Run from the repo that holds the script, targeting the fixture via AGENT_ROOT.
    const fromRepo = run('node', [new URL('../run-report.mjs', import.meta.url).pathname], root, {
      AGENT_ROOT: root,
    });
    expect(fromRepo.status).toBe(0);
    expect(fromRepo.stdout).toMatch(/# Run digest/);
    expect(md.status === 0 || fromRepo.status === 0).toBe(true);

    const asJson = run(
      'node',
      [new URL('../run-report.mjs', import.meta.url).pathname, '--json'],
      root,
      { AGENT_ROOT: root },
    );
    expect(JSON.parse(asJson.stdout)).toHaveProperty('perUnit');
  });
});
