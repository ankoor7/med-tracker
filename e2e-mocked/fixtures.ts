// Wraps @playwright/test so specs can opt into V8 coverage collection without
// each one touching page.coverage directly. Only active under COVERAGE=true
// (see playwright.mocked.config.ts + `pnpm test:e2e:mocked:coverage`) — a plain
// mocked-suite run pays no instrumentation cost. Coverage is reported per test
// via monocart-reporter's `addCoverageReport`, merged into the run's global
// coverage report. Mirrors e2e/fixtures.ts for the real-backend suite.

import { test as base, expect } from '@playwright/test';
import { addCoverageReport } from 'monocart-reporter';

const collectCoverage = process.env.COVERAGE === 'true';

export const test = base.extend({
  autoCoverage: [
    async ({ page }, use, testInfo) => {
      if (!collectCoverage) {
        await use();
        return;
      }

      await Promise.all([
        page.coverage.startJSCoverage({ resetOnNavigation: false }),
        page.coverage.startCSSCoverage({ resetOnNavigation: false }),
      ]);

      await use();

      const [jsCoverage, cssCoverage] = await Promise.all([
        page.coverage.stopJSCoverage(),
        page.coverage.stopCSSCoverage(),
      ]);
      await addCoverageReport([...jsCoverage, ...cssCoverage], testInfo);
    },
    { scope: 'test', auto: true },
  ],
});

export { expect };
