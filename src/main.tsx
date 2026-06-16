import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './ui/App.tsx';
import { LocalRepository } from './store/localRepository';
import { setRepository } from './store/repository';
import './ui/index.css';

// Stage 2: make IndexedDB (via Dexie) the local source of truth. The store
// hydrates from this repository on boot and writes through on every change.
setRepository(new LocalRepository());

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found');

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
