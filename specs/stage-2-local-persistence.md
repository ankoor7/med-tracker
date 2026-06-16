# Stage 2 Spec — Local-First Persistence

| | |
|---|---|
| **Depends on** | Stage 1 |
| **Implements** | FR-SYNC-1 (offline source of truth); persistence for all entities |
| **Milestone** | A |
| **Status** | Ready after Stage 1 |

## 1. Objective
Persist all app state on-device so SteadyDose is a fully usable **offline single-device app** that survives reloads. Introduce a repository abstraction and sync-ready record metadata, without any cloud.

## 2. Scope
**In:** IndexedDB (Dexie) store; repository interface; load on boot; save on change; schema versioning + migrations; per-record `updatedAt`, `version`, soft-delete `deleted`; seed-on-first-run.
**Out:** encryption (Stage 4 wraps this), cloud/sync (Stages 3/5).

## 3. Prerequisites
Stage 1 domain core and store actions exist.

## 4. Functional requirements
- FR-2.1. All entities (medications, slots, dose log, settings) persist locally.
- FR-2.2. Every mutation updates `updatedAt`; deletions are tombstones (`deleted=true`), not hard removes (hard purge optional, post-sync).
- FR-2.3. App boots from the local store; first run seeds sample/empty data.
- FR-2.4. Schema migrations run forward safely on version bump.
- FR-2.5. All Stage 1 flows continue to work offline and across reloads.

## 5. Technical approach
- **Dexie schema:** tables `medications`, `slots`, `doseLog`, `settings`, plus `meta` (e.g. `lastSyncToken`, `schemaVersion`).
- **Repository interface** (so encryption/sync can wrap it later):
```ts
interface Repository {
  loadAll(): Promise<Dataset>;
  upsert<T extends { id: string }>(table: Table, record: T): Promise<void>;
  remove(table: Table, id: string): Promise<void>; // sets deleted=true
  getMeta(key: string): Promise<string | null>;
  setMeta(key: string, value: string): Promise<void>;
}
```
- **Write-through:** store actions call the repository; UI stays optimistic.
- **Migrations:** Dexie versioned stores; pure transform functions, tested.

## 6. Tasks
1. Add Dexie and define schema + `meta` table.
2. Implement `LocalRepository` behind the `Repository` interface.
3. Wire store actions to write-through; hydrate store from `loadAll()` on boot.
4. Add `updatedAt`/`version`/`deleted` handling centrally.
5. Implement first-run seeding and a migration scaffold (+ one no-op migration test).
6. Verify all Stage 1 ACs offline and after reload.

## 7. Acceptance criteria
- AC1. Given data is entered, when the app reloads, all data is restored from IndexedDB.
- AC2. Given network is fully offline, when using any Stage 1 flow, it works unchanged.
- AC3. Given a record is edited, when inspected, `updatedAt` advanced and `version` incremented.
- AC4. Given a record is deleted, when inspected in the store, it is a tombstone (not present in UI, present as `deleted` in DB).
- AC5. Given a schema version bump, when the app boots on old data, the migration runs and data is intact.

## 8. Test plan
- Repository round-trip per table; tombstone behaviour; meta get/set.
- Boot hydration; first-run seeding.
- Migration transform unit tests.
- Manual offline smoke (DevTools offline).

## 9. Risks / decisions
- Keep the repository interface stable — Stages 4 and 5 wrap it; avoid leaking Dexie types upward.
- No hard deletes pre-sync to keep tombstones for later propagation.

## 10. Definition of done
All ACs pass; app fully offline-capable and reload-safe; repository abstraction in place; Stage 1 unaffected.
