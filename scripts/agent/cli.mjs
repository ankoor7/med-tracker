// Shared preamble for the agent-tooling entry points (`ratchet.mjs`,
// `doctrine.mjs`, `run-report.mjs`).
//
// Each of them needs the same two things before it can do anything: which repo
// the run state belongs to, and what the caller typed. Both were copied into all
// three, which meant a fix to the `AGENT_ROOT` escape hatch had to land three
// times to be true.

import { execFileSync } from 'node:child_process';

/**
 * The repo whose `.agent/` run state we are reading or writing.
 *
 * `AGENT_ROOT` wins over git so the tests can point the CLIs at a throwaway
 * fixture repo, and so the `.sh` wrappers can drive a repo other than the one
 * the script happens to live in. Falling back to `cwd` rather than throwing
 * keeps the CLIs usable outside a git checkout.
 */
export function repoRoot() {
  if (process.env.AGENT_ROOT) return process.env.AGENT_ROOT;
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  } catch {
    return process.cwd();
  }
}

/**
 * `--name value` and `--name` readers bound to one argv, so the parsing rules
 * (notably: a flag's value is simply the next token) live in one place.
 */
export function argvReader(argv) {
  return {
    flag(name, fallback = null) {
      const i = argv.indexOf(`--${name}`);
      return i === -1 ? fallback : argv[i + 1];
    },
    has: (name) => argv.includes(`--${name}`),
  };
}
