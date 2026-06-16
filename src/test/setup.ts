import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';

// Ensure React Testing Library unmounts components between tests — but only in
// the DOM (jsdom) environment. Infra tests run in Node where there's no DOM.
if (typeof document !== 'undefined') {
  const { cleanup } = await import('@testing-library/react');
  afterEach(() => {
    cleanup();
  });
}
