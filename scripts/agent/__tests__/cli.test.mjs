// Tier 0: the CLI contract the bash callers and the agents depend on —
// exit codes especially, since `agent-run.sh` branches on them.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  THREE_UNITS,
  cleanup,
  cli,
  commitAll,
  makeRepo,
  readJsonl,
  readUnits,
  writeUnitsFixture,
} from './fixture.mjs';

let root;
beforeEach(() => {
  root = makeRepo();
  writeUnitsFixture(root, THREE_UNITS);
});
afterEach(() => cleanup(root));

describe('ratchet CLI', () => {
  it('refuses to overwrite an existing units file', () => {
    const spec = join(root, 'units-spec.json');
    writeFileSync(spec, JSON.stringify(THREE_UNITS));
    const res = cli(root, ['init', '--stage', 'again', '--units', spec]);
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/already exists/);
  });

  it('prints status and machine-readable next actions', () => {
    const status = cli(root, ['status']);
    expect(status.status).toBe(0);
    expect(status.stdout).toMatch(/unit-1\s+\[pending\]/);

    const next = cli(root, ['next', '--json']);
    expect(JSON.parse(next.stdout)).toMatchObject({
      kind: 'spawn',
      role: 'implementer',
      unit: 'unit-1',
    });
  });

  it('exits 5 on a ratchet violation, so callers cannot mistake it for success', () => {
    const sha = commitAll(root, 'unit-1');
    cli(root, ['record-role', 'unit-1', 'reviewer', '--outcome', 'green']);
    expect(cli(root, ['set-status', 'unit-1', 'committed', '--sha', sha]).status).toBe(0);
    const res = cli(root, ['set-status', 'unit-1', 'implementing']);
    expect(res.status).toBe(5);
    expect(res.stderr).toMatch(/committed is terminal/);
  });

  it('exits 6 when every remaining unit is blocked', () => {
    cli(root, ['set-status', 'unit-1', 'blocked', '--reason', 'needs a product call']);
    cli(root, ['set-status', 'unit-3', 'blocked', '--reason', 'depends on an outage']);
    const res = cli(root, ['next']);
    expect(res.status).toBe(6);
    expect(res.stdout).toMatch(/NONE/);
  });

  it('records role runs with an outcome and a note', () => {
    const res = cli(root, [
      'record-role',
      'unit-1',
      'validator',
      '--outcome',
      'hung',
      '--note',
      'MCP call never returned',
    ]);
    expect(res.status).toBe(0);
    const run = readUnits(root).units[0].roles_run.validator[0];
    expect(run).toMatchObject({ outcome: 'hung', note: 'MCP call never returned' });
  });

  it('rejects unknown roles, outcomes, and statuses', () => {
    expect(cli(root, ['record-role', 'unit-1', 'janitor', '--outcome', 'green']).status).toBe(1);
    expect(cli(root, ['record-role', 'unit-1', 'validator', '--outcome', 'vibes']).status).toBe(1);
    expect(cli(root, ['set-status', 'unit-1', 'nearly-done']).status).toBe(1);
  });

  it('increments bounce_count via `bounce`', () => {
    cli(root, ['bounce', 'unit-1', '--reason', 'reviewer found a regression']);
    cli(root, ['bounce', 'unit-1', '--reason', 'again']);
    expect(readUnits(root).units[0].bounce_count).toBe(2);
  });

  it('appends learnings and rejects vacuous ones unless --loose', () => {
    const ok = cli(root, [
      'learn',
      '--unit',
      'unit-1',
      '--kind',
      'strength',
      '--evidence',
      'Directive named src/core/guardrails.ts:88 and AC-25.3; implementer landed it first try',
      '--action',
      'Keep naming the seam file:line in implementer directives',
    ]);
    expect(ok.status).toBe(0);

    const vacuous = [
      'learn',
      '--unit',
      'unit-1',
      '--kind',
      'strength',
      '--evidence',
      'went well',
      '--action',
      'nothing',
    ];
    expect(cli(root, vacuous).status).toBe(1);
    expect(cli(root, [...vacuous, '--loose']).status).toBe(0);
  });

  it('writes run-log events as one JSON object per line', () => {
    cli(root, ['event', '--kind', 'spawned', '--unit', 'unit-1']);
    cli(root, ['event', '--kind', 'exited', '--unit', 'unit-1', '--extra', '{"status":0}']);
    const log = readJsonl(root, 'run-log.jsonl');
    expect(log).toHaveLength(2);
    expect(log[1]).toMatchObject({ kind: 'exited', unit: 'unit-1', status: 0 });
    expect(log[0].ts).toBeTruthy();
  });

  it('reports role-state as JSON, including never-ran', () => {
    expect(JSON.parse(cli(root, ['role-state', 'unit-1', 'validator']).stdout)).toEqual({
      outcome: 'never-ran',
    });
    cli(root, ['record-role', 'unit-1', 'validator', '--outcome', 'green']);
    expect(JSON.parse(cli(root, ['role-state', 'unit-1', 'validator']).stdout).outcome).toBe(
      'green',
    );
  });
});

describe('validate (the run-end audit, AC-A3.5/AC-A3.6)', () => {
  const learn = (kind, unit = 'unit-1') => [
    'learn',
    '--unit',
    unit,
    '--kind',
    kind,
    '--evidence',
    `Observed in src/core/schedule.ts:120 while working ${unit}`,
    '--action',
    'Adjust the next directive to name that file',
  ];

  it('passes a clean run', () => {
    const res = cli(root, ['validate']);
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/OK/);
  });

  it('fails a committed unit whose learnings are one-sided', () => {
    const sha = commitAll(root, 'unit-1');
    cli(root, ['set-status', 'unit-1', 'committed', '--sha', sha]);
    cli(root, learn('strength'));
    const res = cli(root, ['validate']);
    expect(res.status).toBe(4);
    expect(res.stderr).toMatch(/one-sided/);

    cli(root, learn('weakness'));
    expect(cli(root, ['validate']).status).toBe(0);
  });

  it('fails on an unparseable learnings line', () => {
    writeFileSync(join(root, '.agent', 'learnings.jsonl'), '{oops\n');
    const res = cli(root, ['validate']);
    expect(res.status).toBe(4);
    expect(res.stderr).toMatch(/not valid JSON/);
  });

  it('fails on a committed_sha that is not a commit in this repo', () => {
    // Hand-edit past the ratchet to simulate a corrupted or hand-written file.
    const data = readUnits(root);
    data.units[0].status = 'committed';
    data.units[0].committed_sha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    writeFileSync(join(root, '.agent', 'units.json'), `${JSON.stringify(data, null, 2)}\n`);
    const res = cli(root, ['validate']);
    expect(res.status).toBe(4);
    expect(res.stderr).toMatch(/is not a commit/);
  });

  it('detects a ratchet violation against the committed predecessor', () => {
    const sha = commitAll(root, 'unit-1 work');
    cli(root, ['set-status', 'unit-1', 'committed', '--sha', sha]);
    commitAll(root, 'record ratchet state');

    // Someone edits the file directly and re-commits nothing: validate compares
    // the working copy against HEAD's version, which is what makes the ratchet
    // auditable after the fact rather than only at write time.
    const data = readUnits(root);
    data.units = data.units.filter((u) => u.id !== 'unit-2');
    writeFileSync(join(root, '.agent', 'units.json'), `${JSON.stringify(data, null, 2)}\n`);
    const res = cli(root, ['validate']);
    expect(res.status).toBe(4);
    expect(res.stderr).toMatch(/unit-2` was deleted/);
  });

  it('flags an unknown dependency', () => {
    const data = readUnits(root);
    data.units[0].depends_on = ['unit-99'];
    writeFileSync(join(root, '.agent', 'units.json'), `${JSON.stringify(data, null, 2)}\n`);
    expect(cli(root, ['validate']).stderr).toMatch(/unknown dependency/);
  });
});
