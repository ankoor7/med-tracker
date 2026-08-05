// Tier 0 for the calibrated bounce rubric (FR-A5.5).
//
// Two things are being protected here and they pull against each other. Scored
// verdicts exist so a re-run's findings can be compared dimension-by-dimension
// without re-reading full reports (AC-A5.5). The revert condition is scored
// verdicts making reports *less* honest — a tidy all-pass scorecard replacing
// the prose reservations. So the honesty guard gets as many tests as the parser.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, makeRepo, run } from './fixture.mjs';
import {
  DIMENSION_KEYS,
  appendVerdict,
  checkReport,
  couldNotVerifySection,
  dimensionsMarkdown,
  parseVerdict,
  readVerdicts,
  tallyVerdicts,
} from '../rubric.mjs';

const report = ({
  verdict = [
    '- correctness: pass — drove AC-25.3 and AC-25.4 live in the running app',
    '- test-honesty: pass — reverted src/core/schedule.ts, the three new tests failed, restored',
    '- fit: pass — logic stayed in src/core/, no store import',
    '- ux-clarity: n/a — this unit touches no UI',
    '- bounce: no',
  ].join('\n'),
  limits = 'Everything was verifiable: the DB assertion ran against the local stack.',
} = {}) => `# Report

## 3. Could not verify

${limits}

## 5. Directive feedback

- The brief naming src/core/schedule.ts:42 saved a search.

## Verdict

${verdict}
`;

describe('parsing a verdict block', () => {
  it('reads every dimension, its reason, and the bounce line', () => {
    const v = parseVerdict(report());
    expect(v.found).toBe(true);
    expect(v.scores).toEqual({
      correctness: 'pass',
      'test-honesty': 'pass',
      fit: 'pass',
      'ux-clarity': 'n/a',
    });
    expect(v.reasons.correctness).toMatch(/AC-25.3/);
    expect(v.bounce).toBe(false);
  });

  it('reads the dimensions a bounce cites', () => {
    const v = parseVerdict('- bounce: yes (test-honesty, correctness)');
    expect(v.bounce).toBe(true);
    expect(v.bounceDimensions).toEqual(['test-honesty', 'correctness']);
  });

  it('finds the honest-limits section under any of its usual headings', () => {
    expect(couldNotVerifySection('## Could not verify\n\nThe sync path.\n')).toBe('The sync path.');
    expect(couldNotVerifySection('3. **Could not verify** — the sync path.\n')).toMatch(
      /sync path/,
    );
    expect(couldNotVerifySection('# Report\n\nno such section\n')).toBe(null);
  });
});

describe('the shape gate', () => {
  it('accepts a complete, honest report', () => {
    expect(checkReport(report())).toMatchObject({ ok: true, problems: [] });
  });

  it('rejects a report with no verdict block at all', () => {
    const res = checkReport('# Report\n\nIt all went fine.\n');
    expect(res.ok).toBe(false);
    expect(res.problems.join()).toMatch(/no verdict block/);
  });

  it('rejects a missing dimension rather than scoring it silently', () => {
    const res = checkReport(
      report({
        verdict: [
          '- correctness: pass — drove every AC live in the running app',
          '- test-honesty: pass — mutation killed the three new tests',
          '- fit: pass — no boundary crossed, helper reused',
          '- bounce: no',
        ].join('\n'),
      }),
    );
    expect(res.problems.join()).toMatch(/missing dimension `ux-clarity`/);
  });

  it('rejects a bare score — a label without evidence is a vibe', () => {
    const res = checkReport(report({ verdict: '- correctness: pass\n- bounce: no' }));
    expect(res.problems.join()).toMatch(/carries no evidence/);
  });

  it('rejects a bounce that names no failing dimension', () => {
    const res = checkReport(
      report({
        verdict: [
          '- correctness: fail — the guardrail never fired for the 2-dose case',
          '- test-honesty: pass — mutation killed the new tests as expected',
          '- fit: pass — stayed inside src/core/ as the unit asked',
          '- ux-clarity: n/a — no UI in this unit at all',
          '- bounce: yes',
        ].join('\n'),
      }),
    );
    expect(res.problems.join()).toMatch(/a send-back cites the dimension that failed/);
  });

  it('rejects a verdict that contradicts its own scores', () => {
    const failing = [
      '- correctness: fail — the guardrail never fired for the 2-dose case',
      '- test-honesty: pass — mutation killed the new tests as expected',
      '- fit: pass — stayed inside src/core/ as the unit asked',
      '- ux-clarity: n/a — no UI in this unit at all',
    ];
    expect(
      checkReport(report({ verdict: [...failing, '- bounce: no'].join('\n') })).problems.join(),
    ).toMatch(/bounce: no while `correctness` scored fail/);
    expect(
      checkReport(
        report({ verdict: [...failing, '- bounce: yes (fit)'].join('\n') }),
      ).problems.join(),
    ).toMatch(/bounce cites `fit` but scored it `pass`/);
  });
});

describe('the honesty guard (FR-A5.5 revert condition)', () => {
  it('rejects an all-pass scorecard whose "could not verify" section is empty', () => {
    const res = checkReport(report({ limits: '' }));
    expect(res.ok).toBe(false);
    expect(res.problems.join()).toMatch(/A clean scorecard may not replace the reservations/);
  });

  it('rejects a report with no honest-limits section at all', () => {
    const res = checkReport(`## Verdict\n\n${parseVerdictFixture()}`);
    expect(res.problems.join()).toMatch(/silence there is a failure/);
  });

  it('accepts an all-pass report that says positively what it could verify and how', () => {
    expect(checkReport(report()).ok).toBe(true);
  });
});

function parseVerdictFixture() {
  return [
    '- correctness: pass — drove AC-25.3 live in the running app',
    '- test-honesty: pass — reverted the fix, the new tests failed, restored',
    '- fit: pass — logic stayed in src/core/, no store import',
    '- ux-clarity: n/a — this unit touches no UI',
    '- bounce: no',
  ].join('\n');
}

describe('recording verdicts for cross-run comparison (AC-A5.5)', () => {
  let root;
  const cli = (args) =>
    run('node', [new URL('../rubric.mjs', import.meta.url).pathname, ...args], root);

  beforeEach(() => {
    root = makeRepo();
    mkdirSync(join(root, '.agent'), { recursive: true });
  });
  afterEach(() => cleanup(root));

  it('tallies scores per dimension so two runs compare without re-reading reports', () => {
    appendVerdict(root, {
      unit: 'unit-1',
      role: 'validator',
      scores: { correctness: 'pass', fit: 'fail' },
    });
    appendVerdict(root, {
      unit: 'unit-2',
      role: 'reviewer',
      scores: { correctness: 'fail', fit: 'fail' },
    });
    const tally = tallyVerdicts(readVerdicts(root));
    expect(tally.correctness).toEqual({ pass: 1, fail: 1, 'n/a': 0 });
    expect(tally.fit).toEqual({ pass: 0, fail: 2, 'n/a': 0 });
    expect(DIMENSION_KEYS).toContain('ux-clarity');
  });

  it('check exits 4 on a bad report and 0 on a good one', () => {
    const path = join(root, 'report.md');
    writeFileSync(path, '# Report\n\nAll good.\n');
    expect(cli(['check', path]).status).toBe(4);
    writeFileSync(path, report());
    expect(cli(['check', path]).status).toBe(0);
  });

  it('record appends the parsed verdict, refusing a report that would not pass check', () => {
    const path = join(root, 'report.md');
    writeFileSync(path, report({ limits: '' }));
    expect(cli(['record', path, '--unit', 'unit-1', '--role', 'validator']).status).toBe(4);

    writeFileSync(path, report());
    expect(cli(['record', path, '--unit', 'unit-1', '--role', 'validator']).status).toBe(0);
    const [recorded] = readVerdicts(root);
    expect(recorded).toMatchObject({ unit: 'unit-1', role: 'validator', bounce: false });
    expect(recorded.scores['test-honesty']).toBe('pass');
  });

  it('prints the anchor table, so a spawn prompt can carry it verbatim', () => {
    const md = dimensionsMarkdown();
    for (const key of DIMENSION_KEYS) expect(md).toContain(key);
    expect(md).toMatch(/byte-identical/);
    expect(cli(['dimensions']).status).toBe(0);
  });
});
