import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from 'react-aria-components';
import App from './ui/App.tsx';
import { LocalRepository } from './store/localRepository';
import { setRepository } from './store/repository';
import './ui/index.css';

// Stage 2: make IndexedDB (via Dexie) the local source of truth. The store
// hydrates from this repository on boot and writes through on every change.
setRepository(new LocalRepository());

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found');
const root = createRoot(rootEl);

// Stage 19 Unit 3 (FR-19.8): the theme guide is a dev-only reference surface,
// never part of the patient app. Gated on BOTH `import.meta.env.DEV` (false
// in any production build, so the check — and the lazy import below — are
// inert/dead in `pnpm build` output) and an explicit `?themeguide` query
// param, so it never appears by accident even in a dev server. It renders
// standalone (no store hydration, no bottom nav) since it only needs the
// shared primitives, not app state.
const wantsThemeGuide =
  import.meta.env.DEV && new URLSearchParams(window.location.search).has('themeguide');

if (wantsThemeGuide) {
  void import('./ui/ThemeGuide.tsx').then(({ ThemeGuide }) => {
    root.render(
      <StrictMode>
        <ThemeGuide />
      </StrictMode>,
    );
  });
} else {
  // Stage 19 FR-19.1: React Aria Components needs a locale context. This is a
  // single-page, client-only SPA (no SSR), so a fixed `en-US` locale — matching
  // the app's only shipped language — is the minimal correct setup; no portal
  // container override is needed since overlays (Modal, dialogs) render fine
  // against the default document body.
  root.render(
    <StrictMode>
      <I18nProvider locale="en-US">
        <App />
      </I18nProvider>
    </StrictMode>,
  );
}
