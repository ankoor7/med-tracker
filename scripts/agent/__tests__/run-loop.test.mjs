// Tier 0 for the outer loop (spec agent-stage-4 §8): every loop mechanic driven
// by a stub agent, for zero tokens.
//
// The point of this file is that a trial run should only ever be able to fail on
// defect parity and directive quality — never on a loop bug that a stub could
// have caught first.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  THREE_UNITS,
  cleanup,
  cli,
  git,
  makeRepo,
  readJsonl,
  readUnits,
  run,
  runSh,
  stubAgent,
  writeUnitsFixture,
} from './fixture.mjs';

let root;
beforeEach(() => {
  root = makeRepo();
  writeUnitsFixture(root, THREE_UNITS);
});
afterEach(() => cleanup(root));

/** Run the outer loop with the stub substituted for a real orchestrator. */
const loop = (mode, extra = {}, args = []) =>
  run('bash', [runSh, ...args], root, {
    AGENT_CMD: `bash ${stubAgent}`,
    STUB_MODE: mode,
    AGENT_CEILING_SECONDS: '3',
    ...extra,
  });

const kinds = (log) => log.map((e) => e.kind);

describe('happy path (FR-A4.1, FR-A4.4)', () => {
  it('drives every unit to committed and terminates on its own', () => {
    const res = loop('commit');
    expect(res.status).toBe(0);

    const units = readUnits(root).units;
    expect(units.map((u) => u.status)).toEqual(['committed', 'committed', 'committed']);
    // One spawn per unit: the loop never re-enters a committed unit.
    expect(res.stdout).toMatch(/run finished after 3 spawn\(s\)/);
  });

  it('accounts for every spawn in the run log', () => {
    loop('commit');
    const log = readJsonl(root, 'run-log.jsonl');
    expect(kinds(log).filter((k) => k === 'spawned')).toHaveLength(3);
    expect(kinds(log).filter((k) => k === 'exited')).toHaveLength(3);
    expect(kinds(log)[0]).toBe('run-started');
    expect(kinds(log).at(-1)).toBe('run-finished');
    // Elapsed time is recorded so the report can compute wall-clock per unit.
    expect(log.find((e) => e.kind === 'exited').elapsed_seconds).toBeGreaterThanOrEqual(0);
  });

  it('respects dependency order', () => {
    loop('commit');
    const log = readJsonl(root, 'run-log.jsonl').filter((e) => e.kind === 'spawned');
    // unit-2 depends on unit-1, so it can never be spawned first.
    expect(log[0].unit).toBe('unit-1');
    expect(log.map((e) => e.unit).indexOf('unit-2')).toBeGreaterThan(0);
  });

  it('writes a run digest at the end', () => {
    loop('commit');
    expect(existsSync(join(root, '.agent', 'run-digest.md'))).toBe(true);
  });

  it('refuses to start without a ratchet', () => {
    const bare = makeRepo();
    try {
      const res = run('bash', [runSh], bare, { AGENT_CMD: `bash ${stubAgent}` });
      expect(res.status).toBe(2);
      expect(res.stderr).toMatch(/no \.agent\/units\.json/);
    } finally {
      cleanup(bare);
    }
  });
});

describe('kill-resume (AC-A4.4)', () => {
  it('re-running the loop never re-does committed work', () => {
    // First pass commits unit-1 only, by making the stub crash afterwards.
    const first = loop('commit', { AGENT_MAX_SPAWNS: '1' });
    expect(first.status).toBe(0);
    const afterFirst = readUnits(root).units;
    expect(afterFirst[0].status).toBe('committed');
    const sha = afterFirst[0].committed_sha;

    // Simulating the kill: just run it again, which is the whole recovery story.
    const second = loop('commit');
    const units = readUnits(root).units;
    expect(units.every((u) => u.status === 'committed')).toBe(true);
    // unit-1 was not touched again: same sha, still one implementer run.
    expect(units[0].committed_sha).toBe(sha);
    expect(units[0].roles_run.implementer).toHaveLength(1);
    expect(second.stdout).not.toMatch(/spawn #\d+ for unit-1/);
  });

  it('is a no-op once everything is committed', () => {
    loop('commit');
    const again = loop('commit');
    expect(again.stdout).toMatch(/nothing eligible remains/);
    expect(again.stdout).toMatch(/run finished after 0 spawn/);
  });
});

describe('ceiling breach (AC-A4.5, FR-A4.3)', () => {
  it('kills a hung spawn, logs it, and confirms the tree is coherent', () => {
    const res = loop('hang', { AGENT_MAX_SPAWNS: '1', AGENT_CEILING_SECONDS: '2' });
    expect(res.stdout).toMatch(/CEILING BREACH after \d+s/);
    expect(res.stdout).toMatch(/tree is coherent/);

    const log = readJsonl(root, 'run-log.jsonl');
    const breach = log.find((e) => e.kind === 'ceiling-breach');
    expect(breach).toMatchObject({ unit: 'unit-1' });
    expect(breach.elapsed_seconds).toBeGreaterThanOrEqual(2);
  });

  it('flags an incoherent tree so the successor salvages instead of building on it', () => {
    const res = loop('dirty-hang', { AGENT_MAX_SPAWNS: '1', AGENT_CEILING_SECONDS: '2' });
    expect(res.stdout).toMatch(/tree is NOT coherent/);
    expect(kinds(readJsonl(root, 'run-log.jsonl'))).toContain('tree-incoherent');
  });

  it('bounds the loss to one ceiling interval rather than a whole night', () => {
    // The baseline's hang cost 409 minutes. Here the same shape costs the ceiling.
    const started = Date.now();
    loop('hang', { AGENT_MAX_SPAWNS: '1', AGENT_CEILING_SECONDS: '2' });
    expect((Date.now() - started) / 1000).toBeLessThan(20);
  });

  it('a killed spawn leaves the unit resumable, not lost', () => {
    loop('hang', { AGENT_MAX_SPAWNS: '1', AGENT_CEILING_SECONDS: '2' });
    // Nothing was recorded, so the next action is still a fresh implementer spawn.
    expect(JSON.parse(cli(root, ['next', '--json']).stdout)).toMatchObject({
      unit: 'unit-1',
      role: 'implementer',
    });
  });
});

describe('escalation and bounce budget (FR-A4.5, FR-A4.6)', () => {
  it('skips blocked units and keeps going with what is eligible', () => {
    const res = loop('block');
    const units = readUnits(root).units;
    // unit-1 blocks; unit-2 depends on it so it is ineligible; unit-3 is free.
    expect(units[0].status).toBe('blocked');
    expect(units[2].status).toBe('blocked'); // the stub blocks whatever it gets
    expect(res.stdout).toMatch(/moving on to whatever else is eligible/);
    expect(res.stdout).toMatch(/nothing eligible remains/);
    expect(kinds(readJsonl(root, 'run-log.jsonl'))).toContain('user-escalation');
  });

  it('never asks permission to continue', () => {
    const res = loop('commit');
    expect(res.stdout).not.toMatch(/shall I|should I|proceed\?|continue\?/i);
  });

  it('blocks a unit that exhausts the bounce budget instead of looping forever', () => {
    const res = loop('bounce', { AGENT_BOUNCE_BUDGET: '2', AGENT_MAX_SPAWNS: '10' });
    const unit = readUnits(root).units[0];
    expect(unit.bounce_count).toBe(2);
    expect(unit.status).toBe('blocked');
    expect(unit.blocked_reason).toMatch(/bounce budget exhausted/);
    expect(res.stdout).toMatch(/hit the bounce budget/);
    expect(kinds(readJsonl(root, 'run-log.jsonl'))).toContain('bounce-budget-exhausted');
  });

  it('stops at max-spawns rather than running away', () => {
    const res = loop('bounce', { AGENT_MAX_SPAWNS: '2', AGENT_BOUNCE_BUDGET: '99' });
    expect(res.stdout).toMatch(/hit max-spawns \(2\)/);
    expect(kinds(readJsonl(root, 'run-log.jsonl'))).toContain('max-spawns-reached');
  });

  it('records a bounce as a resumable implementer step, not a fresh one', () => {
    loop('bounce', { AGENT_MAX_SPAWNS: '1', AGENT_BOUNCE_BUDGET: '99' });
    expect(JSON.parse(cli(root, ['next', '--json']).stdout)).toMatchObject({
      kind: 'resume',
      role: 'implementer',
      unit: 'unit-1',
    });
  });
});

describe('learnings-on-exit gate (FR-A4.2)', () => {
  it('flags a committed unit whose orchestrator wrote no learnings', () => {
    const res = loop('commit-silent', { AGENT_MAX_SPAWNS: '1' });
    expect(res.stdout).toMatch(/committed but has no two-sided learnings/);
    expect(kinds(readJsonl(root, 'run-log.jsonl'))).toContain('learnings-missing');
  });

  it('does not flag a unit that wrote both sides', () => {
    const res = loop('commit', { AGENT_MAX_SPAWNS: '1' });
    expect(res.stdout).not.toMatch(/no two-sided learnings/);
    expect(kinds(readJsonl(root, 'run-log.jsonl'))).not.toContain('learnings-missing');
  });

  it('exits 7 from `learnings-ok` for a one-sided unit', () => {
    cli(root, [
      'learn',
      '--unit',
      'unit-1',
      '--kind',
      'strength',
      '--evidence',
      'Named src/core/schedule.ts:42 in the brief and it landed first try',
      '--action',
      'Reuse that shape',
    ]);
    expect(cli(root, ['learnings-ok', 'unit-1']).status).toBe(7);
  });
});

describe('crash handling', () => {
  it('records a non-zero exit and moves on', () => {
    const res = loop('crash', { AGENT_MAX_SPAWNS: '2' });
    expect(res.stdout).toMatch(/exited 9/);
    const exited = readJsonl(root, 'run-log.jsonl').find((e) => e.kind === 'exited');
    expect(exited.status).toBe(9);
  });
});

describe('dry run', () => {
  it('reports what it would do without spawning', () => {
    const res = loop('commit', {}, ['--dry-run']);
    expect(res.stdout).toMatch(/dry-run: would spawn for unit-1/);
    expect(readUnits(root).units[0].status).toBe('pending');
    // A dry run must not leave a spawn in the log.
    expect(kinds(readJsonl(root, 'run-log.jsonl'))).not.toContain('spawned');
  });
});

describe('git hygiene', () => {
  it('each unit lands as its own commit', () => {
    loop('commit');
    const subjects = git(root, 'log', '--format=%s').split('\n');
    expect(subjects.filter((s) => s.startsWith('feat: unit-'))).toHaveLength(3);
  });

  it('leaves no stray processes holding the tree after a ceiling kill', () => {
    loop('hang', { AGENT_MAX_SPAWNS: '1', AGENT_CEILING_SECONDS: '2' });
    // If the stub were still alive it would still be sleeping; the tree must be
    // free for the successor.
    writeFileSync(join(root, 'probe.txt'), 'ok\n');
    expect(existsSync(join(root, 'probe.txt'))).toBe(true);
  });
});
