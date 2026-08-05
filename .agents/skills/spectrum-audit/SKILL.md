---
name: 'spectrum-audit'
description: 'Audit a codebase for adherence to the Spectrum design system and React Spectrum S2 best practices. Use when a developer asks to audit, review, lint, or check a project for Spectrum/S2 correctness, configuration, styling, accessibility, or component-usage issues.'
license: 'Apache-2.0'
compatibility: 'Requires a React project using @react-spectrum/s2.'
metadata:
  author: 'Adobe'
  website: 'https://react-spectrum.adobe.com/'
---

# Spectrum Audit

Audit a codebase for adherence to the Spectrum design system and React Spectrum S2 best practices, then produce a scored, prioritized report. This skill is **report-only** — it does not modify any files.

## When to use

Use when a developer asks to audit, review, lint, or check a project for Spectrum / S2 correctness, configuration, styling, accessibility, or component-usage issues.

Requires a project with `@react-spectrum/s2` installed. If S2 is not a dependency, say so and stop.

## How it works

Run these phases in order.

### Phase 0 — Scope

- Identify the project — or, in a monorepo, the specific package — to audit. Audit the package, not the workspace root.
- Detect the package manager from the lockfile, the bundler (Vite / webpack / Next.js / Parcel / Rollup / ESBuild), and read `package.json` dependencies.
- Confirm `@react-spectrum/s2` is installed. Establish the source globs to scan (e.g. `src/**/*.{tsx,jsx,ts,js}`).
- Check whether the `react-spectrum-s2` skill is available (listed among the agent's installed skills, or present under a local skills directory such as `.cursor/skills/` or `.agents/skills/`). Record whether it was found — the report template uses this.

### Phase 1 — Run the checks

Work through each check file in `references/checks/`, in order. For every violation, record a finding: `{file:line, rule, severity, category, fix}`. Cite only line numbers you actually read or grepped — never invent locations. Record **one finding per distinct root cause** at a `file:line` — if multiple check files cover the same issue (e.g. a missing collection `aria-label` or a third-party design system), assign it to the most specific check and do not duplicate it across categories.

- [01 — Setup & configuration](references/checks/01-setup-config.md)
- [02 — Component usage](references/checks/02-component-usage.md)
- [03 — Styling](references/checks/03-styling.md)
- [04 — Accessibility & correctness](references/checks/04-accessibility.md)
- [05 — Versioning & maintenance](references/checks/05-versioning.md)
- [06 — Testing](references/checks/06-testing.md)

The canonical rules behind these checks live in the `react-spectrum-s2` skill — read its `SKILL.md` (implementation guidance) and `references/guides/getting-started.md`, `references/guides/component-decision-tree.md`, and `references/components/` as needed. If that skill is not installed, proceed using the check files alone, but note the limitation in the report (see Phase 3).

### Phase 2 — Score

Apply the [scoring rubric](references/scoring-rubric.md) to the recorded findings to compute per-category scores and the overall Spectrum Adherence Score. The score is arithmetic over counted findings — do not estimate it.

### Phase 3 — Report

Write `SPECTRUM-AUDIT.md` to the audited project following the [report template](references/report-template.md): headline score, grade, and severity counts; a summary; scores by category; findings grouped by severity (each with a clickable `file:line` and the check name that defines its rule); prioritized action items; what looks good; and — if `react-spectrum-s2` was not detected in Phase 0 — a recommendation to install it.

### Phase 4 — Hand off

This skill does not edit code. Recommend:

- The `react-spectrum-s2` skill to implement the fixes. If it is not installed:

  ```bash
  npx skills add https://react-spectrum.adobe.com --skill react-spectrum-s2
  ```

- The `migrate-react-spectrum-v3-to-s2` skill if Spectrum 1 packages (`@adobe/react-spectrum`, `@react-spectrum/*`, `@spectrum-icons/*`) are present.
