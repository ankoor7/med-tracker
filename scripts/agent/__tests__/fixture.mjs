// Throwaway git repos for the agent-tooling tests. Every test gets its own, so
// the ratchet's git-verified transitions can be exercised for real rather than
// mocked — `committed` is only legal with a SHA git confirms, and a fake git
// would let that check pass vacuously.

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const scriptsDir = join(fileURLToPath(new URL('../../', import.meta.url)));
export const ratchetCli = join(scriptsDir, 'agent', 'ratchet.mjs');
export const bootstrapSh = join(scriptsDir, 'agent-bootstrap.sh');
export const preflightSh = join(scriptsDir, 'agent-preflight.sh');
export const runSh = join(scriptsDir, 'agent-run.sh');
export const stubAgent = join(scriptsDir, 'agent', '__tests__', 'stub-agent.sh');

export function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
}

export function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'agent-fixture-'));
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'Test');
  git(root, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(root, 'README.md'), '# fixture\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'initial');
  return root;
}

export function cleanup(root) {
  rmSync(root, { recursive: true, force: true });
}

/** Commit whatever is staged and return the SHA. Empty is allowed: several tests
 * only need a real commit to point `committed_sha` at. */
export function commitAll(root, message) {
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '--allow-empty', '-m', message);
  return git(root, 'rev-parse', 'HEAD');
}

/**
 * Run the ratchet CLI against a fixture repo. Returns status/stdout/stderr
 * rather than throwing, because exit codes are part of the contract the bash
 * callers depend on.
 */
export function cli(root, args, env = {}) {
  return run('node', [ratchetCli, ...args], root, env);
}

export function run(cmd, args, root, env = {}) {
  const res = spawnSync(cmd, args, {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, AGENT_ROOT: root, ...env },
  });
  return { status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

/**
 * Initialise a ratchet and commit it, leaving the tree clean.
 *
 * Both details matter: the spec file is written outside the repo and `.agent/` is
 * committed, because preflight treats any untracked file as possible abandoned
 * agent work. A fixture that left litter behind would make every preflight test
 * fail for the wrong reason.
 */
export function writeUnitsFixture(root, units, stage = 'stage-test') {
  const spec = join(mkdtempSync(join(tmpdir(), 'agent-spec-')), 'units.json');
  writeFileSync(spec, JSON.stringify(units, null, 2));
  const res = cli(root, ['init', '--stage', stage, '--units', spec]);
  if (res.status !== 0) throw new Error(`init failed: ${res.stderr}`);
  commitAll(root, 'chore: initialise run ratchet');
  return res;
}

export function readUnits(root) {
  return JSON.parse(readFileSync(join(root, '.agent', 'units.json'), 'utf8'));
}

export function readJsonl(root, name) {
  const path = join(root, '.agent', name);
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

export const THREE_UNITS = [
  { id: 'unit-1', title: 'First thing', spec_ref: ['FR-25.3'], depends_on: [] },
  { id: 'unit-2', title: 'Second thing', spec_ref: ['FR-25.7'], depends_on: ['unit-1'] },
  { id: 'unit-3', title: 'Third thing', spec_ref: ['FR-25.4'], depends_on: [] },
];
