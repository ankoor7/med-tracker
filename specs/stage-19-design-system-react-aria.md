# Stage 19 Spec — Design System on React Aria Components

| | |
|---|---|
| **Depends on** | Stage 18 (the UI it rewrites must be behaviourally complete first) |
| **Implements** | FR-19.1 … FR-19.8 |
| **Milestone** | F (UI system rewrite) |
| **Status** | Draft |

## 1. Objective
Replace the hand-rolled component primitives and the Oura-inspired custom theme
with an accessible primitive library built on **React Aria Components**, under a
new **minimalistic, clean theme** that lends itself to legible dashboards and
calendars. This stage is **foundation only**: it establishes the system, migrates
the shared primitives (`src/ui/components/ui.tsx`, `Modal.tsx`, `ConfirmDialog.tsx`,
`StatusBadge.tsx`), and sets the theme — it does **not** rewrite screens (Stage 20)
or the dashboards/calendar (Stage 21).

The hand-rolled primitives carry their own accessibility and interaction logic
(focus management, keyboard handling, ARIA wiring), built and re-built across
stages. React Aria Components provides those as tested, unstyled primitives, so we
keep full control of the look while dropping the bespoke behaviour code.

## 2. Decision record — React Aria Components, not React Spectrum S2
Both were considered (the user asked for a choice; both skills are installed).

**Chosen: React Aria Components** (`react-aria-components`).
- The requirement is a **bespoke** minimalistic theme. React Aria Components are
  **unstyled** primitives — we own 100% of the visual design. React Spectrum S2
  (`@react-spectrum/s2`) ships Adobe's Spectrum 2 **design language**; adopting it
  means adopting that look, which is the opposite of a custom theme.
- **Lower migration risk.** This is a behaviour/accessibility swap *under* the
  existing presentation — the screens keep their structure and their styling layer
  (Tailwind tokens). S2 is a wholesale visual-language adoption with a much larger
  blast radius.
- It ships exactly the primitives this app needs: `Calendar`/`RangeCalendar`
  (Stage 21), `DateField`/`TimeField`/`NumberField` (dose logging), `Dialog`
  (the FR-18.5 confirmations), `Select`/`ComboBox` (the merged editor),
  `Meter`/`ProgressBar` (adherence dashboards), `Tabs`/`ToggleButton` (nav, the
  FR-18.12 view toggle).
- `@react-aria/test-utils` provides ARIA-pattern testers compatible with the
  existing Vitest suite, fitting the project's test-honesty discipline.

**Reconsider S2 only if** the product later wants to *adopt* Adobe's design
language wholesale rather than maintain a bespoke theme. That is not this stage.

## 3. Scope
**In:**
- Add `react-aria-components` and `@react-aria/test-utils`; wrap the app root in
  the necessary providers (`I18nProvider`/locale, portal container).
- A **design-token layer** for the new minimalistic theme — colour, typography,
  spacing, radius, elevation, focus ring, motion — for **light and dark**,
  theme-aware. Decide and document the token home (extend the existing Tailwind
  config, or a CSS custom-property layer) in the spec's §5.
- A **themed primitive set** wrapping React Aria Components, replacing
  `src/ui/components/ui.tsx` (Button, Field, Card, Stat, ColorDot, Tag, etc.),
  `Modal.tsx`, `ConfirmDialog.tsx`, and `StatusBadge.tsx`. Same call sites, new
  internals — the export surface these files present stays source-compatible so
  Stage 20 can migrate screens incrementally.
- **Drop the Oura-style directive** everywhere it appears: the `tailwind.config.ts`
  "Oura-inspired" token comment, the "Oura-style" nav-icon comment in `App.tsx`,
  and any spec references. Replace with the new theme's direction.
- `@react-aria/test-utils` wired into the Vitest setup; a pattern for testing the
  new primitives.
- Accessibility baseline: visible keyboard focus (`useFocusRing`/`FocusRing`),
  `prefers-reduced-motion`, and WCAG-AA contrast on the new tokens.

**Out:**
- Screen rewrites (Stage 20) and the dashboards/calendar (Stage 21).
- Any behaviour change, and any change to `src/core`, `src/store`, or `src/sync` —
  this is presentation only.
- The Oura *integration* (`OuraPanel`, `OuraCorrelationChart`, `core/oura.ts`) —
  that is a data feature, unrelated to the Oura *visual style* being dropped. Do
  not remove it.

## 4. Functional requirements
- **FR-19.1** `react-aria-components` and `@react-aria/test-utils` are added and
  the app is wrapped in the required providers; the build, typecheck and lint stay
  green.
- **FR-19.2** A documented design-token layer defines the minimalistic theme for
  light and dark, theme-aware, meeting WCAG-AA contrast.
- **FR-19.3** The shared primitives in `ui.tsx`, `Modal.tsx`, `ConfirmDialog.tsx`
  and `StatusBadge.tsx` are reimplemented over React Aria Components with a
  source-compatible export surface, so existing screens compile unchanged.
- **FR-19.4** Every reimplemented primitive is keyboard-operable with visible
  focus and correct ARIA, verified with `@react-aria/test-utils` where a pattern
  tester exists.
- **FR-19.5** The Oura-style directive is removed from the token config, the nav
  icons comment, and any spec references, and replaced with the new theme's intent.
- **FR-19.6** Motion respects `prefers-reduced-motion`.
- **FR-19.7** No change to `src/core`, `src/store`, `src/sync`, or any store
  action — presentation only. No Stage 18 behaviour regresses (the existing
  screen/component tests still pass against the new primitives).
- **FR-19.8** A short **theme guide** (a doc or a rendered gallery) shows the
  primitives and tokens, so Stages 20–21 build against a settled reference.

## 5. Decisions (settled 2026-07-23)
1. **Token home → CSS custom properties.** Tokens are defined as CSS variables on
   `:root`, theme-aware via `:root[data-theme="dark"]` (and `prefers-color-scheme`
   as the initial signal), and referenced from `tailwind.config.ts` (`theme.extend`
   reads the variables) so utilities like `bg-[--sd-bg]` resolve. Light/dark is a
   single variable swap. This matches React Aria's `data-*` state styling model.
2. **Icon set → one minimal set.** Replace the hand-drawn "Oura-style" nav SVGs with
   a single consistent, low-weight icon set (Lucide — self-contained, tree-shakeable,
   works under the offline CSP). Uniform stroke weight reads best on a minimalist
   dashboard. Verify the bundle stays self-contained (no runtime CDN fetch).
3. **Styling approach → Tailwind + React Aria `data-*` selectors.** Keep Tailwind as
   the utility layer; drive interaction state from React Aria's `data-*` attributes
   (`data-[hovered]`, `data-[focus-visible]`, `data-[selected]`, …). Lowest-risk
   path — the app already uses Tailwind. Do **not** introduce a parallel CSS-module
   styling paradigm; a single styling path avoids the drift the render-prop route
   would invite.

## 6. Acceptance criteria
- **AC19.1** App builds and runs on React Aria Components with the new theme; every
  existing test passes with no behaviour change.
- **AC19.2** Each migrated primitive: keyboard-operable, visible focus, AA
  contrast, correct ARIA (asserted via a tester or manual keyboard test).
- **AC19.3** No occurrence of an "Oura style/aesthetic" directive remains in
  config, component comments, or specs (the Oura *data* feature is untouched).
- **AC19.4** `src/core`, `src/store`, `src/sync` are byte-unchanged.
- **AC19.5** The theme guide renders every primitive in light and dark.

## 7. Prerequisites
- Stage 18 committed (the behaviour these primitives host is complete).
- The `react-aria` skill (installed) for component APIs, the styling guide, and the
  testing guide; the `spectrum-audit` skill is **not** applicable (that audits S2
  adherence, which we deliberately did not adopt).
