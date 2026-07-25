#!/usr/bin/env node
// Merges the `raw` V8 coverage exported by `pnpm test:coverage` (vitest, via
// vitest-monocart-coverage) and `pnpm test:e2e:coverage` (Playwright, via
// monocart-reporter) into one combined report covering both suites.
//
//   pnpm coverage        # runs both suites with coverage, then this script
//   pnpm coverage:merge  # just the merge, if raw data already exists
//
// See https://github.com/cenfun/monocart-coverage-reports#merge-coverage-reports

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CoverageReport } from 'monocart-coverage-reports';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const inputDir = [join(root, 'coverage/unit/raw'), join(root, 'coverage/e2e/raw')].filter((dir) =>
  existsSync(dir),
);

if (inputDir.length === 0) {
  console.error(
    'No raw coverage found in coverage/unit/raw or coverage/e2e/raw.\n' +
      'Run `pnpm test:coverage` and/or `pnpm test:e2e:coverage` first, or just `pnpm coverage`.',
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

  reports: [['v8'], ['console-details'], ['lcovonly']],
};

await new CoverageReport(coverageOptions).generate();
