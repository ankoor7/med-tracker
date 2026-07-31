import { defineConfig } from 'vitest/config';

// Tests for the agent-loop tooling under `scripts/agent/` (specs/agent/*).
//
// Deliberately separate from the app suite: these run in node (they shell out to
// git and spawn scripts), they are not part of the app's merged coverage report,
// and they must stay runnable without the Supabase stack or a browser.
//
//   pnpm agent:test
export default defineConfig({
  test: {
    include: ['scripts/agent/__tests__/**/*.test.mjs'],
    environment: 'node',
    globals: true,
    // Each test builds a real temp git repo and spawns child processes; the
    // default parallelism makes the git operations flaky on a cold FS cache.
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
