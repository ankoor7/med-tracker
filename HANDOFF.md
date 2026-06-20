# Handoff — morning pickup

_Written 2026-06-20. Branch: `feat/evening-tasks`. Tree is clean; typecheck + all 237 unit tests green._

## Current feature

**Stage 16 — Regimen Change Markers** (`specs/stage-16-regimen-change-markers.md`).

Record _when_ and _what_ changed in a medication regimen (prescription edits,
schedule edits) as a new syncable `RegimenChange` entity, then surface those as
**tappable, same-day-grouped markers** on the timeline charts and calendar.
Changes are **derived** by diffing the previous vs next entity inside store
actions — the app never authors a change by hand.

Stage 17 (GP adherence summary, `specs/stage-17-gp-adherence-summary.md`) is
specced but not started; it depends on Stage 16.

## Current state — what's done

The **spine** (Tasks 1–2 of the spec's §7) is committed:

- `f12156a feat(core): Stage 16 spine — RegimenChange types + pure diff helpers`
  - `core/types.ts` — `RegimenChange`, `RegimenChangeKind`, `RegimenFieldChange`
    (+ `Dataset.regimenChanges`).
  - `core/regimenChanges.ts` (+ `.test.ts`) — pure helpers `diffMedication`,
    `diffSlot`, `buildRegimenChange`, `groupChangesByDay`.
  - `core/index.ts` re-export; minor `ui/components/DoseLogger.tsx` touch.

Also landed earlier on this branch (context, not Stage 16):

- `074a6f2` assume doses taken on time unless logged/edited (default on)
- `7d95ae5` dead-code cleanup; ignore vendored skills in eslint
- `d972a9a` pin local Postgres to major_version 17

Tooling commit just now (`1abc953`, **not feature work**): vendored skills moved
`.agents/skills/` → `.claude/skills/`; added `.claude/hooks/fallow-gate.sh`
(PreToolUse Bash hook that blocks commit/push on a fallow `fail` verdict, fails
open without jq/fallow).

## Next steps — Tasks 3–10 (§7 of the spec)

Pure core (1–2) is done. Remaining, in dependency order:

3. `core/cloudRecord.ts` — add `RecordType` + `RECORD_TYPES` entry +
   `validateRegimenChange` (mirror an existing entity's validator).
4. `sync/recordMapping.ts` + `store/repository.ts` — table/type maps + `TableName`.
5. `store/localRepository.ts` — new Dexie store; wire into
   `loadAll` / `persistDataset` / `TABLES` / first-run check.
6. `store/transfer.ts` — validate/merge changes; default `[]` for old export files.
7. `store/store.ts` — **emit derived changes** from medication + slot actions
   (the diff-at-edit-site is the heart of the feature); hydrate/reload/import
   wiring; `addChangeNote` / `deleteChange` actions.
8. `store/seed.ts` — seed one example change.
9. `ui/components/ChangeMarkers.tsx` (+ `ChangeDetail`) — wire into
   `AdherenceChart`, `BloodLevelChart`, the calendar, and a Changes list in
   `HistoryScreen`.
10. **Supabase** — migration extending the `record_type` enum
    (`alter type … add value if not exists`) + re-defined `validate_record`;
    pgTAP parity + push/LWW test (`supabase/tests/regimen_change_test.sql`).

### Watch-outs

- **TS ↔ SQL validator lock-step** — keep `validateRegimenChange` and the SQL
  `validate_record` identical; the pgTAP parity test guards it (Stages 8/12/15 pattern).
- **Derive, don't author** — capture the diff in the store action with the
  pre-edit entity in hand; a no-op save must record nothing (AC1).
- **Formatted-at-capture** — `from`/`to` are display strings (e.g. `"100mg"`,
  `"08:00"`, `null` = added/cleared), so markers stay readable after later renames.
- **Time** — store the change as a UTC `Instant` + the active zone for stable
  date placement on charts.

### Verify as you go

- `pnpm typecheck && pnpm test` after each task.
- DB work needs the local stack: `pnpm local:up && pnpm local:env`, then
  `pnpm db:test` for pgTAP.
- Acceptance criteria AC1–AC7 and the test plan are in §8–§9 of the spec.
