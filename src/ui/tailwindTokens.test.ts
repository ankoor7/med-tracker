import { describe, expect, it } from 'vitest';
import config from '../../tailwind.config';

// Regression test for a real bug caught in Stage 19: when a token colour is
// wired up as a bare `var(--x)` (holding a hex string), Tailwind's opacity
// modifiers (`bg-accent/15`, `bg-slate-900/80`, `text-status-taken/90`, …)
// silently produce NO CSS rule at all — the utility is dropped, not
// degraded — because Tailwind can't inject an alpha channel into an opaque
// CSS variable. Those exact modifiers are used throughout the existing
// screens (nav bar, active-tab pill, danger button, badges), so this must
// keep working. `withOpacityValue` in tailwind.config.ts fixes it by
// resolving to `rgb(var(--x-rgb) / <alpha>)`; this test locks that shape in
// place so a future edit can't silently reintroduce the bare-var() bug.
type ColorFn = (args: { opacityValue?: string }) => string;

function colorAt(path: string[]): ColorFn {
  // theme.extend.colors is a plain nested object of functions in this config.
  let node: unknown = (config.theme as { extend: { colors: Record<string, unknown> } }).extend
    .colors;
  for (const key of path) {
    node = (node as Record<string, unknown>)[key];
  }
  if (typeof node !== 'function') {
    throw new Error(`Expected a function color at colors.${path.join('.')}`);
  }
  return node as ColorFn;
}

describe('tailwind.config.ts colour tokens (FR-19.2)', () => {
  it('every remapped colour is a function (opacity-aware), not a bare var() string', () => {
    for (const path of [
      ['slate', '950'],
      ['slate', '100'],
      ['accent', 'DEFAULT'],
      ['accent', 'fg'],
      ['accent', 'muted'],
      ['status', 'taken'],
      ['status', 'due'],
      ['status', 'missed'],
      ['status', 'upcoming'],
    ]) {
      expect(typeof colorAt(path)).toBe('function');
    }
  });

  it('resolves to a plain rgb() with no opacity modifier (the `bg-accent` case)', () => {
    expect(colorAt(['accent', 'DEFAULT'])({})).toBe('rgb(var(--sd-accent-rgb))');
  });

  it('resolves to rgb(... / alpha) when Tailwind supplies an opacityValue (the `bg-accent/15` case)', () => {
    expect(colorAt(['accent', 'DEFAULT'])({ opacityValue: '0.15' })).toBe(
      'rgb(var(--sd-accent-rgb) / 0.15)',
    );
    expect(colorAt(['slate', '900'])({ opacityValue: '0.8' })).toBe(
      'rgb(var(--sd-slate-900-rgb) / 0.8)',
    );
    expect(colorAt(['status', 'missed'])({ opacityValue: '0.9' })).toBe(
      'rgb(var(--sd-status-missed-rgb) / 0.9)',
    );
  });
});
