import { defineConfig } from 'vitest/config';
import type { CoverageOptions } from 'vitest/node';

// Tests for the agent-loop tooling under `scripts/agent/` (specs/agent/*).
//
// Deliberately separate from the app suite: these run in node (they shell out to
// git and spawn scripts), they are not part of the app's merged coverage report,
// and they must stay runnable without the Supabase stack or a browser.
//
//   pnpm agent:test
//   pnpm agent:test:coverage
export default defineConfig({
  test: {
    include: ['scripts/agent/__tests__/**/*.test.mjs'],
    environment: 'node',
    globals: true,
    // Each test builds a real temp git repo and spawns child processes; the
    // default parallelism makes the git operations flaky on a cold FS cache.
    fileParallelism: false,
    testTimeout: 30_000,
    // Separate from the app's merged report (different tools, different
    // audience), but written in Istanbul shape because that is what
    // `fallow`'s `health.coverage` reads to compute real CRAP scores for
    // these files. Without it fallow assumes zero coverage and every
    // branchy CLI function scores as a critical risk. See `.fallowrc.json`.
    coverage: {
      provider: 'custom',
      customProviderModule: 'vitest-monocart-coverage',
      // `include`/`coverageReportOptions` are read by vitest-monocart-coverage,
      // not by vitest's own `CoverageOptions` type — hence the cast.
      include: ['scripts/agent/**'],
      exclude: ['scripts/agent/__tests__/**'],
      reportOnFailure: true,
      coverageReportOptions: {
        name: 'SteadyDose Agent Tooling Coverage',
        outputDir: 'coverage/agent',
        reports: [['console-summary'], ['json', { file: 'coverage-final.json' }]],
      },
    } as CoverageOptions,
  },
});
