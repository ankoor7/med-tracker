import { describe, expect, it, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Stage 19 FR-19.2: a lightweight check that the design-token layer exists
// and is theme-aware — i.e. `data-theme="dark"` actually flips the resolved
// CSS custom properties, not just that the source file has two blocks of
// text. Vitest runs with `css: false` (see vite.config.ts) so component
// tests never load real stylesheets; this test instead injects the actual
// `tokens.css` source into jsdom's document and reads back
// `getComputedStyle`, which does apply matched custom-property declarations.
const tokensCssPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'tokens.css');
const tokensCss = readFileSync(tokensCssPath, 'utf-8');

function installTokens() {
  const style = document.createElement('style');
  style.textContent = tokensCss;
  document.head.appendChild(style);
  return style;
}

function readVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

describe('design-token layer (FR-19.2)', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('data-theme');
    document.querySelectorAll('style').forEach((s) => s.remove());
  });

  it('defines the full semantic token set on :root (light, default)', () => {
    installTokens();
    const required = [
      '--sd-slate-50-rgb',
      '--sd-slate-500-rgb',
      '--sd-slate-950-rgb',
      '--sd-accent-rgb',
      '--sd-accent-fg-rgb',
      '--sd-accent-muted-rgb',
      '--sd-status-taken-rgb',
      '--sd-status-due-rgb',
      '--sd-status-missed-rgb',
      '--sd-status-upcoming-rgb',
      '--sd-radius-lg',
      '--sd-shadow-soft',
      '--sd-duration-normal',
    ];
    for (const name of required) {
      expect(readVar(name), `${name} should resolve on :root`).not.toBe('');
    }
  });

  it('stores colour tokens as "R G B" triples, not hex — required for Tailwind opacity modifiers', () => {
    // This is the exact shape `withOpacityValue` in tailwind.config.ts needs
    // to build `rgb(var(--x) / <alpha-value>)`. A hex string here would make
    // every `bg-accent/15`-style utility across the app silently vanish from
    // the compiled CSS (Tailwind drops utilities it can't apply an opacity
    // modifier to) rather than fail loudly.
    installTokens();
    const rgbTriple = /^\d{1,3} \d{1,3} \d{1,3}$/;
    for (const name of ['--sd-slate-950-rgb', '--sd-accent-rgb', '--sd-status-taken-rgb']) {
      expect(readVar(name)).toMatch(rgbTriple);
    }
  });

  it('flips every themed token when data-theme="dark" is set on the root', () => {
    installTokens();
    const lightValues = {
      bg: readVar('--sd-slate-950-rgb'),
      text: readVar('--sd-slate-100-rgb'),
      accent: readVar('--sd-accent-rgb'),
      taken: readVar('--sd-status-taken-rgb'),
    };

    document.documentElement.setAttribute('data-theme', 'dark');

    const darkValues = {
      bg: readVar('--sd-slate-950-rgb'),
      text: readVar('--sd-slate-100-rgb'),
      accent: readVar('--sd-accent-rgb'),
      taken: readVar('--sd-status-taken-rgb'),
    };

    // Every one of these must actually change — a stale/no-op override would
    // leave the app looking identical regardless of theme.
    expect(darkValues.bg).not.toBe(lightValues.bg);
    expect(darkValues.text).not.toBe(lightValues.text);
    expect(darkValues.accent).not.toBe(lightValues.accent);
    expect(darkValues.taken).not.toBe(lightValues.taken);

    // Sanity: the known concrete values from tokens.css, not just "changed".
    expect(lightValues.bg).toBe('246 247 249'); // #f6f7f9
    expect(darkValues.bg).toBe('10 14 22'); // #0a0e16
  });

  it('reverts to the light tokens when data-theme is removed', () => {
    installTokens();
    const before = readVar('--sd-slate-950-rgb');
    document.documentElement.setAttribute('data-theme', 'dark');
    expect(readVar('--sd-slate-950-rgb')).not.toBe(before);
    document.documentElement.removeAttribute('data-theme');
    expect(readVar('--sd-slate-950-rgb')).toBe(before);
  });

  it('zeroes the motion tokens under prefers-reduced-motion (FR-19.6)', () => {
    // jsdom's CSS engine doesn't evaluate the `prefers-reduced-motion`
    // media feature (it only supports viewport-based features), so this
    // can't be driven through getComputedStyle the way the theme-flip
    // tests above are. Assert the source directly instead of faking a
    // browser behaviour jsdom doesn't actually have.
    const reducedMotionBlock = tokensCss.match(
      /@media \(prefers-reduced-motion: reduce\)\s*{\s*:root\s*{([^}]*)}/,
    );
    expect(reducedMotionBlock, 'expected a prefers-reduced-motion block in tokens.css').not.toBe(
      null,
    );
    const body = reducedMotionBlock![1];
    for (const name of ['--sd-duration-fast', '--sd-duration-normal', '--sd-duration-slow']) {
      expect(body).toMatch(new RegExp(`${name}:\\s*0\\.01ms`));
    }
  });
});
