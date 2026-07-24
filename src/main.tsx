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

// Stage 19 FR-19.1: React Aria Components needs a locale context. This is a
// single-page, client-only SPA (no SSR), so a fixed `en-US` locale — matching
// the app's only shipped language — is the minimal correct setup; no portal
// container override is needed since overlays (Modal, dialogs) render fine
// against the default document body.
createRoot(rootEl).render(
  <StrictMode>
    <I18nProvider locale="en-US">
      <App />
    </I18nProvider>
  </StrictMode>,
);
