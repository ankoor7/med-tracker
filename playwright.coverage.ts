// Shared monocart-reporter coverage config for the two Playwright suites
// (playwright.config.ts, playwright.mocked.config.ts). Both write a `raw`
// report that `pnpm coverage:merge` (scripts/merge-coverage.mjs) combines
// with the vitest unit coverage and each other into one report.

export function coverageReporter(
  outputDir: string,
  name: string,
): [string, Record<string, unknown>] {
  return [
    'monocart-reporter',
    {
      name,
      outputFile: `./${outputDir}/mcr-report/index.html`,
      coverage: {
        outputDir,
        entryFilter: (entry: { url: string }) => entry.url.search(/\/src\/.+/) !== -1,
        sourceFilter: (sourcePath: string) => sourcePath.search(/^src\//) !== -1,
        reports: [['v8'], ['console-summary'], ['raw', { outputDir: 'raw' }]],
      },
    },
  ];
}
