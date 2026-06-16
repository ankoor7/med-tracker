import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Stage 1 AC9: src/core/ must remain framework-agnostic — no React imports.
// This is a backstop to the ESLint no-restricted-imports boundary rule.

const coreDir = dirname(fileURLToPath(import.meta.url));

function coreSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...coreSourceFiles(full));
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe('core boundary', () => {
  it('no file in src/core imports React, the store, or the UI', () => {
    const offenders: string[] = [];
    for (const file of coreSourceFiles(coreDir)) {
      const src = readFileSync(file, 'utf8');
      if (/from\s+['"](react|react-dom|zustand)['"]/.test(src)) offenders.push(file);
      if (/from\s+['"]\.\.\/(ui|store)\//.test(src)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
