// Tier 0 tests for the ratchet core (spec §8: deterministic, zero tokens).
//
// These assert the properties AC-A3.5 audits at run end — but here, before any
// run spends a token on them.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  RatchetError,
  appendFailedApproach,
  appendLearning,
  latestRun,
  learningsCoverage,
  loadUnits,
  nextAction,
  nextEligibleUnit,
  ratchetViolations,
  readLearnings,
  recordRole,
  saveUnits,
  setStatus,
  validateLearning,
} from '../state.mjs';
import { THREE_UNITS, cleanup, commitAll, makeRepo, writeUnitsFixture } from './fixture.mjs';

let root;
beforeEach(() => {
  root = makeRepo();
  writeUnitsFixture(root, THREE_UNITS);
});
afterEach(() => cleanup(root));

describe('ratchet semantics (AC-A3.5)', () => {
  it('rejects moving a unit out of committed', () => {
    const sha = commitAll(root, 'unit-1 work');
    setStatus(root, 'unit-1', 'committed', { sha });

    const data = loadUnits(root);
    data.units[0].status = 'implementing';
    expect(() => saveUnits(root, data)).toThrow(RatchetError);
    expect(() => saveUnits(root, data)).toThrow(/committed is terminal/);
  });

  it('rejects deleting a unit entry', () => {
    const data = loadUnits(root);
    data.units = data.units.filter((u) => u.id !== 'unit-2');
    expect(() => saveUnits(root, data)).toThrow(/was deleted/);
  });

  it('rejects editing spec_ref — the "make it pass by moving the goalposts" failure', () => {
    const data = loadUnits(root);
    data.units[0].spec_ref = ['FR-25.3-but-easier'];
    expect(() => saveUnits(root, data)).toThrow(/acceptance criteria are never edited/);
  });

  it('rejects decrementing bounce_count and rewriting a committed sha', () => {
    setStatus(root, 'unit-1', 'bounced', { reason: 'validator found a bug' });
    const bounced = loadUnits(root);
    expect(bounced.units[0].bounce_count).toBe(1);
    bounced.units[0].bounce_count = 0;
    expect(() => saveUnits(root, bounced)).toThrow(/bounce_count decreased/);

    const sha = commitAll(root, 'unit-3 work');
    setStatus(root, 'unit-3', 'committed', { sha });
    const data = loadUnits(root);
    data.units[2].committed_sha = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
    expect(() => saveUnits(root, data)).toThrow(/committed_sha changed/);
  });

  it('rejects dropping role-run history', () => {
    recordRole(root, 'unit-1', 'implementer', { outcome: 'green' });
    const data = loadUnits(root);
    data.units[0].roles_run.implementer = [];
    expect(() => saveUnits(root, data)).toThrow(/append-only/);
  });

  it('refuses to mark a unit committed without a git-verified sha', () => {
    expect(() => setStatus(root, 'unit-1', 'committed', { sha: 'f00df00df00d' })).toThrow(
      /does not exist/,
    );
    expect(() => setStatus(root, 'unit-1', 'committed', {})).toThrow(/requires --sha/);
  });

  it('accepts legal forward movement', () => {
    recordRole(root, 'unit-1', 'implementer', { outcome: 'green' });
    setStatus(root, 'unit-1', 'validating');
    const sha = commitAll(root, 'unit-1 work');
    setStatus(root, 'unit-1', 'committed', { sha });
    expect(loadUnits(root).units[0].status).toBe('committed');
    expect(ratchetViolations(loadUnits(root), loadUnits(root))).toEqual([]);
  });
});

describe('spawn-vs-resume decisions (FR-A3.4, AC-A3.2)', () => {
  it('sends a fresh unit to the implementer', () => {
    const unit = nextEligibleUnit(loadUnits(root));
    expect(unit.id).toBe('unit-1');
    expect(nextAction(unit)).toMatchObject({ kind: 'spawn', role: 'implementer' });
  });

  it('treats a role that ran without delivering as RESUME, not respawn', () => {
    setStatus(root, 'unit-1', 'validating');
    recordRole(root, 'unit-1', 'validator', { outcome: 'no-outcome', note: 'hung on MCP call' });
    const action = nextAction(loadUnits(root).units[0]);
    // This is the exact confusion that cost 3.15M tokens in the baseline run.
    expect(action).toMatchObject({ kind: 'resume', role: 'validator' });
  });

  it('advances to the next role when one returns green', () => {
    setStatus(root, 'unit-1', 'implementing');
    recordRole(root, 'unit-1', 'implementer', { outcome: 'green' });
    expect(nextAction(loadUnits(root).units[0])).toMatchObject({
      kind: 'spawn',
      role: 'validator',
    });
  });

  it('routes a bounce back to the implementer that built the thing', () => {
    setStatus(root, 'unit-1', 'implementing');
    recordRole(root, 'unit-1', 'implementer', { outcome: 'green' });
    setStatus(root, 'unit-1', 'validating');
    recordRole(root, 'unit-1', 'validator', { outcome: 'bounced', note: 'test cannot fail' });
    expect(nextAction(loadUnits(root).units[0])).toMatchObject({
      kind: 'resume',
      role: 'implementer',
    });
  });

  it('commits once the reviewer is green', () => {
    setStatus(root, 'unit-1', 'reviewing');
    recordRole(root, 'unit-1', 'reviewer', { outcome: 'green' });
    expect(nextAction(loadUnits(root).units[0])).toMatchObject({ kind: 'commit' });
  });

  it('respects dependency order and skips blocked units', () => {
    // unit-2 depends on unit-1, so unit-1 comes first even though both are pending.
    expect(nextEligibleUnit(loadUnits(root)).id).toBe('unit-1');

    setStatus(root, 'unit-1', 'blocked', { reason: 'needs a product decision' });
    // unit-2 is still gated on unit-1 being committed; unit-3 has no deps.
    expect(nextEligibleUnit(loadUnits(root)).id).toBe('unit-3');

    const sha = commitAll(root, 'unit-3');
    setStatus(root, 'unit-3', 'committed', { sha });
    expect(nextEligibleUnit(loadUnits(root))).toBeNull();
  });

  it('keeps every run in history so a resumed agent sees prior attempts', () => {
    recordRole(root, 'unit-1', 'implementer', { outcome: 'bounced' });
    recordRole(root, 'unit-1', 'implementer', { outcome: 'green' });
    const unit = loadUnits(root).units[0];
    expect(unit.roles_run.implementer).toHaveLength(2);
    expect(latestRun(unit, 'implementer').outcome).toBe('green');
  });
});

describe('learnings are two-sided and parseable (FR-A3.7, AC-A3.6)', () => {
  const good = {
    unit: 'unit-1',
    role: 'orchestrator',
    kind: 'strength',
    evidence: 'The directive quoted AC-25.3 verbatim and named src/core/schedule.ts:42 as the seam',
    action: 'Reuse the "name the file:line and the AC" directive shape for UI units',
  };

  it('accepts a specific entry of either polarity', () => {
    expect(validateLearning(good)).toEqual([]);
    expect(validateLearning({ ...good, kind: 'weakness' })).toEqual([]);
    appendLearning(root, good);
    expect(readLearnings(root)).toHaveLength(1);
  });

  it('rejects missing fields and unknown kinds', () => {
    expect(validateLearning({ ...good, action: '' })).toContain('missing `action`');
    expect(validateLearning({ ...good, kind: 'vibes' }).join()).toMatch(/unknown kind/);
  });

  it('rejects vacuous evidence — the "review went well" entry the doctrine bans', () => {
    const errs = validateLearning({
      ...good,
      evidence: 'Review went well and validation was thorough, no issues',
    });
    expect(errs.join()).toMatch(/vacuous/);
  });

  it('rejects evidence that cites nothing openable', () => {
    const errs = validateLearning({
      ...good,
      evidence: 'the implementer misunderstood the requirement somewhat',
    });
    expect(errs.join()).toMatch(/nothing openable/);
  });

  it('accepts a quoted directive, a spec ref, or a sha as evidence', () => {
    for (const evidence of [
      'Directive said "fix the timezone handling" with no file named, so the agent guessed',
      'Unit failed AC-A2.3 because the turn count was never measured',
      'Regression introduced in 6d371ea and caught only by the reviewer, not the validator',
    ]) {
      expect(validateLearning({ ...good, evidence })).toEqual([]);
    }
  });

  it('reports per-unit coverage so one-sided records are visible', () => {
    appendLearning(root, good);
    appendLearning(root, { ...good, kind: 'weakness' });
    appendLearning(root, { ...good, unit: 'unit-2', kind: 'strength' });
    const coverage = learningsCoverage(root);
    expect(coverage.get('unit-1')).toMatchObject({ strength: 1, weakness: 1 });
    expect(coverage.get('unit-2')).toMatchObject({ strength: 1, weakness: 0 });
  });

  it('counts bounce and doctrine-gap as weakness-class, doctrine-fired as strength-class', () => {
    appendLearning(root, { ...good, kind: 'bounce' });
    appendLearning(root, { ...good, kind: 'doctrine-fired', rule: 'D-12' });
    expect(learningsCoverage(root).get('unit-1')).toMatchObject({ strength: 1, weakness: 1 });
  });

  // FR-A5.2: an anonymous doctrine entry cannot be counted by the run audit, so
  // the rule it is about reads dormant — and dormant rules get proposed for
  // removal. Rejecting it here is cheaper than pruning a rule that works.
  it('requires a doctrine entry to name its ledger rule', () => {
    expect(validateLearning({ ...good, kind: 'doctrine-gap' }).join()).toMatch(
      /must name the rule it is about with `--rule D-NN`/,
    );
    expect(
      validateLearning({ ...good, kind: 'doctrine-gap', rule: 'the preflight one' }).join(),
    ).toMatch(/--rule D-NN/);
    expect(validateLearning({ ...good, kind: 'doctrine-gap', rule: 'D-12' })).toEqual([]);
    // Other kinds are unaffected — most learnings are not about a doctrine rule.
    expect(validateLearning({ ...good, kind: 'weakness' })).toEqual([]);
  });

  it('survives a malformed line without losing the rest of the file', () => {
    appendLearning(root, good);
    writeFileSync(join(root, '.agent', 'learnings.jsonl'), `{not json\n${JSON.stringify(good)}\n`);
    const entries = readLearnings(root);
    expect(entries[0].__parseError).toBe(true);
    expect(entries[1].kind).toBe('strength');
  });
});

describe('failed approaches (FR-A3.2)', () => {
  it('records what not to retry and refuses empty entries', () => {
    appendFailedApproach(root, {
      unit: 'unit-1',
      role: 'implementer',
      approach: 'Storing the adjusted dose as a ratio on the record',
      why: 'Loses the original prescribed value, which the audit view needs',
      doNotRetry: 'Do not model dose adjustment as a ratio; store both values',
    });
    const text = readFileSync(join(root, '.agent', 'failed-approaches.md'), 'utf8');
    expect(text).toMatch(/Do not model dose adjustment as a ratio/);
    expect(text).toMatch(/## unit-1 — implementer/);

    expect(() =>
      appendFailedApproach(root, { unit: 'unit-1', approach: 'x', why: '', doNotRetry: 'y' }),
    ).toThrow(/missing `why`/);
  });
});
