// Tier 0: the two scripts every cold-starting agent runs.
//
// Bootstrap must be byte-identical across runs (a harness that answers "where am
// I?" differently each time is not a harness), and preflight must classify every
// prior-work case from the ratchet rather than from a heuristic.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  THREE_UNITS,
  bootstrapSh,
  cleanup,
  cli,
  commitAll,
  makeRepo,
  preflightSh,
  run,
  writeUnitsFixture,
} from './fixture.mjs';

let root;
beforeEach(() => {
  root = makeRepo();
  writeUnitsFixture(root, THREE_UNITS);
});
afterEach(() => cleanup(root));

const bootstrap = (unit) =>
  run('bash', [bootstrapSh, ...(unit ? [unit] : [])], root, { AGENT_SKIP_ENV: '1' });

// Preflight shells out to `git rev-parse --show-toplevel`, so it must run with
// cwd inside the fixture repo — AGENT_ROOT alone would not redirect git.
const preflight = (role, unit) =>
  run('bash', [preflightSh, role, unit], root, {
    AGENT_SKIP_ENV: '1',
    HOME: root, // no real transcripts under a fixture HOME
  });

describe('bootstrap determinism (FR-A3.3)', () => {
  it('produces byte-identical output on two runs against an unchanged tree', () => {
    const first = bootstrap();
    const second = bootstrap();
    expect(first.status).toBe(0);
    expect(first.stdout).toBe(second.stdout);
    // Guard the reason it can drift: no wall-clock in the output.
    expect(first.stdout).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
  });

  it('prints the fixed section order', () => {
    const { stdout } = bootstrap();
    const order = [...stdout.matchAll(/--- \d+\. (.+?) ---/g)].map((m) => m[1].trim());
    expect(order).toEqual([
      'Repo',
      'Run state',
      'Recent commits',
      'Working tree',
      'Environment',
      'Failed approaches (do not retry these)',
      'Recent learnings',
    ]);
  });

  it('carries the next action, so the agent does not have to derive it', () => {
    expect(bootstrap().stdout).toMatch(/SPAWN implementer for unit-1/);
  });

  it('shows per-role state for a named unit', () => {
    cli(root, ['record-role', 'unit-1', 'implementer', '--outcome', 'green']);
    const { stdout } = bootstrap('unit-1');
    expect(stdout).toMatch(/implementer: \{"outcome":"green"/);
    expect(stdout).toMatch(/validator: \{"outcome":"never-ran"\}/);
  });

  it('surfaces failed approaches so a fresh context cannot retry them', () => {
    cli(root, [
      'failed',
      '--unit',
      'unit-1',
      '--role',
      'implementer',
      '--approach',
      'Patching the schedule in the store layer',
      '--why',
      'Violates the core/store boundary; ESLint blocks the import',
      '--do-not-retry',
      'Do not put schedule math in src/store — it belongs in src/core',
    ]);
    expect(bootstrap().stdout).toMatch(/Do not put schedule math in src\/store/);
  });

  it('works before any ratchet exists', () => {
    const bare = makeRepo();
    try {
      const res = run('bash', [bootstrapSh], bare, { AGENT_SKIP_ENV: '1' });
      expect(res.status).toBe(0);
      expect(res.stdout).toMatch(/no \.agent\/units\.json/);
    } finally {
      cleanup(bare);
    }
  });
});

describe('preflight matrix (FR-A3.4, AC-A3.2)', () => {
  it('clears a role that never ran', () => {
    const res = preflight('implementer', 'unit-1');
    expect(res.stdout).toMatch(/recorded outcome: never-ran/);
    expect(res.stdout).toMatch(/RESULT: clear to spawn/);
    expect(res.status).toBe(0);
  });

  it('blocks a respawn when the role already returned green', () => {
    cli(root, ['record-role', 'unit-1', 'validator', '--outcome', 'green']);
    const res = preflight('validator', 'unit-1');
    expect(res.status).toBe(3);
    expect(res.stdout).toMatch(/ALREADY COMPLETED/);
    expect(res.stdout).toMatch(/already complete/);
  });

  it('demands a RESUME when the role ran but delivered nothing', () => {
    // The baseline failure: a 31-minute transcript on disk, reported as "hasn't run".
    cli(root, ['record-role', 'unit-1', 'validator', '--outcome', 'no-outcome']);
    const res = preflight('validator', 'unit-1');
    expect(res.status).toBe(3);
    expect(res.stdout).toMatch(/RAN BUT DELIVERED NOTHING/);
  });

  it('treats a hung role the same way', () => {
    cli(root, ['record-role', 'unit-2', 'validator', '--outcome', 'hung']);
    expect(preflight('validator', 'unit-2').status).toBe(3);
  });

  it('routes a sent-back role to a resume rather than a duplicate', () => {
    cli(root, ['record-role', 'unit-1', 'reviewer', '--outcome', 'bounced']);
    const res = preflight('reviewer', 'unit-1');
    expect(res.status).toBe(3);
    expect(res.stdout).toMatch(/do not spawn a duplicate/i);
  });

  it('flags a dirty tree and stashed work even when the ratchet is clean', () => {
    writeFileSync(join(root, 'stray.ts'), 'export const x = 1;\n');
    const res = preflight('implementer', 'unit-3');
    expect(res.status).toBe(3);
    expect(res.stdout).toMatch(/Uncommitted changes present/);
  });

  it('still works with no ratchet at all (pre-A3 repos)', () => {
    const bare = makeRepo();
    try {
      const res = run('bash', [preflightSh, 'implementer', 'unit-1'], bare, { HOME: bare });
      expect(res.stdout).toMatch(/falling back to transcript heuristics/);
      expect(res.status).toBe(0);
    } finally {
      cleanup(bare);
    }
  });

  it('treats mid-unit ratchet churn as run state, not abandoned work', () => {
    const sha = commitAll(root, 'unit-3 work');
    cli(root, ['set-status', 'unit-3', 'committed', '--sha', sha]);
    // The ratchet write leaves `.agent/` dirty by design. If that counted as
    // abandoned work, this alarm would fire before every spawn and stop meaning
    // anything — so it is reported separately and does not block.
    const res = preflight('implementer', 'unit-1');
    expect(res.stdout).toMatch(/run state modified \(expected mid-unit\)/);
    expect(res.status).toBe(0);
  });
});
