import { defineConfig } from 'vitest/config';
import type { CoverageOptions } from 'vitest/node';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // injectManifest (Stage 6 follow-up): a custom service worker (src/sw.ts)
      // adds `push` + `notificationclick` handlers for background Web Push while
      // still precaching the app shell via the injected manifest.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectRegister: 'auto',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
      },
      manifest: {
        name: 'SteadyDose',
        short_name: 'SteadyDose',
        description: 'Local-first medication adjusted-dose tracker.',
        theme_color: '#0f766e',
        background_color: '#0f172a',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: 'icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
      devOptions: {
        // Keep the SW out of the way during `pnpm dev`.
        enabled: false,
      },
    }),
  ],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'custom',
      customProviderModule: 'vitest-monocart-coverage',
      exclude: ['src/**/*.{test,spec}.{ts,tsx}', 'src/test/**'],
      // A report is still useful when a handful of tests fail.
      reportOnFailure: true,
      // `include` and `coverageReportOptions` are read by vitest-monocart-coverage
      // (github.com/cenfun/vitest-monocart-coverage) but aren't part of vitest's
      // own `CustomProviderOptions` type, hence the cast.
      include: ['src/**'],
      // Combined with the e2e coverage via `pnpm coverage:merge` (monocart) —
      // the `raw` report is the merge input, the rest are for standalone runs.
      coverageReportOptions: {
        name: 'SteadyDose Unit Coverage',
        outputDir: 'coverage/unit',
        reports: [['v8'], ['console-summary'], ['raw', { outputDir: 'raw' }]],
      },
    } as CoverageOptions,
  },
});
