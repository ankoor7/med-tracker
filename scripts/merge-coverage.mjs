#!/usr/bin/env node
// Merges the `raw` V8 coverage exported by each suite's coverage run — vitest
// unit tests (`pnpm test:coverage`, via vitest-monocart-coverage), the real
// e2e/ suite (`pnpm test:e2e:coverage`, needs the local Supabase stack), and
// the e2e-mocked/ configured-backend suite (`pnpm test:e2e:mocked:coverage`)
// — into one combined report covering whichever of them were actually run.
//
//   pnpm coverage      # unit + e2e (Docker) + e2e-mocked, then this script
//   pnpm coverage:ci   # unit + e2e-mocked only (no Docker) — what CI runs
//   pnpm coverage:merge  # just the merge, if raw data already exists
//
// See https://github.com/cenfun/monocart-coverage-reports#merge-coverage-reports

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CoverageReport } from 'monocart-coverage-reports';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const candidateDirs = ['coverage/unit/raw', 'coverage/e2e/raw', 'coverage/e2e-mocked/raw'];
const inputDir = candidateDirs.map((dir) => join(root, dir)).filter((dir) => existsSync(dir));

if (inputDir.length === 0) {
  console.error(
    `No raw coverage found in any of: ${candidateDirs.join(', ')}.\n` +
      'Run `pnpm coverage` (or `pnpm coverage:ci`), or an individual `pnpm test:*:coverage` script first.',
  );
  process.exit(1);
}

const coverageOptions = {
  name: 'SteadyDose Combined Coverage',
  inputDir,
  outputDir: join(root, 'coverage/merged'),

  entryFilter: {
    '**/node_modules/**': false,
    '**/*': true,
  },
  sourceFilter: {
    '**/node_modules/**': false,
    '**/src/**': true,
  },

  reports: [['v8'], ['console-details'], ['lcovonly'], ['markdown-summary'], ['json-summary']],
};

await new CoverageReport(coverageOptions).generate();
