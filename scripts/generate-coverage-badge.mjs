#!/usr/bin/env node
// Renders badges/coverage.svg from the merged coverage report's line %
// (coverage/merged/coverage-summary.json, produced by the `json-summary`
// report in scripts/merge-coverage.mjs). CI opens a PR with the updated
// file instead of pushing it directly — see .github/workflows/ci.yml.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { makeBadge } from 'badge-maker';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const summaryPath = join(root, 'coverage/merged/coverage-summary.json');
const badgePath = join(root, 'badges/coverage.svg');

function colorFor(pct) {
  if (pct >= 90) return 'brightgreen';
  if (pct >= 80) return 'green';
  if (pct >= 70) return 'yellowgreen';
  if (pct >= 60) return 'yellow';
  if (pct >= 50) return 'orange';
  return 'red';
}

let label = 'coverage';
let message = 'unknown';
let color = 'lightgrey';

try {
  const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
  const pct = summary.total.lines.pct;
  message = `${pct}%`;
  color = colorFor(pct);
} catch (err) {
  console.error(`Could not read ${summaryPath}, writing a placeholder badge: ${err.message}`);
}

const svg = makeBadge({ label, message, color });

mkdirSync(dirname(badgePath), { recursive: true });
writeFileSync(badgePath, svg);
console.log(`Wrote ${badgePath} (${message})`);
