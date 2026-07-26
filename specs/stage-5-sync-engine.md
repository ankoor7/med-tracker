# Stage 5 Spec — Sync Engine

> **API tier superseded by Stage 8.** The bidirectional sync **engine** and its
> conflict-resolution contract described here are unchanged; Stage 8
> (`specs/stage-8-supabase-migration.md`) replaced the custom AWS API tier this
> spec targeted with Supabase (PostgREST + `push_records`) as the transport.
> Implemented in `src/sync/syncEngine.ts` (pull→push→merge→token loop, LWW via
> `isNewerRecord`/`applyRemote`, offline outbox) and `src/sync/supabaseBackend.ts`.

| | |
|---|---|
| **Depends on** | Stage 3, Stage 4 |
| **Implements** | FR-SYNC-2, FR-SYNC-3; architecture §8; timezone occurrence-match refinement |
| **Milestone** | B |
| **Status** | Done |

## 1. Objective
Implement **bidirectional, multi-device sync** of **structured (readable)
records** between the offline-first local store and the per-user DynamoDB backend,
with deterministic conflict resolution, an offline queue, idempotent and resumable
transfer, and **server-side validation** of every pushed record. The app stays
fully usable offline; the cloud holds a readable, server-usable copy that
converges across the same user's devices.

## 2. Scope
**In:** sync client (pull/push); change tracking + tokens; offline queue + replay;
last-write-wins conflict resolution; tombstone propagation; idempotency;
background/triggered sync; server-side schema/ownership validation on push; the
timezone occurrence-matching refinement.
**Out:** real-time collaboration / multi-user; CRDTs (note as future); server-side
**derived/computed** data and clinician sharing (future — now *unblocked* because
records are readable, but not built here).

## 3. Prerequisites
Stage 3 `/sync/*` API + auth; Stage 4 readable record model + server-side
validation (records sync as structured `payload`, not ciphertext).

## 4. Functional requirements
- FR-5.1. Push local changes (readable records) since `lastSyncToken`; pull remote
  changes; advance the token.
- FR-5.2. Edits made offline queue and replay on reconnect; sync is resumable
  after interruption.
- FR-5.3. Conflicts resolve by **last-write-wins on `updatedAt`** per record;
  deletions handled via tombstones.
- FR-5.4. Sync is idempotent on `(id, version)`; re-running causes no duplication
  or loss.
- FR-5.5. Two devices converge to the same dataset after syncing.
- FR-5.6. Dose-to-slot occurrence matching is robust across a mid-day zone change
  (tolerance/occurrence key), correcting the Stage 1 approximation.
- FR-5.7. The server **validates each pushed record** (`type` + payload schema +
  ownership); invalid records are rejected with a reason **without** affecting the
  valid records in the same batch.

## 5. Technical approach
- **Client loop:** `push(changesSince token)` → `pull(since token)` → merge →
  persist → update token. Trigger on app focus, on mutation (debounced), and
  manually.
- **Change set:** records where `updatedAt > lastSyncToken` (and queued offline
  mutations).
- **Merge rule:** for each incoming record, apply if its `updatedAt` ≥ local;
  tombstones delete if newer. Payloads are **readable**, so the server can also
  validate them; the client merges accepted records directly (no decrypt step).
- **Offline queue:** durable queue in `meta`/a Dexie table; replay in order;
  dedupe by `(id, version)`.
- **Occurrence matching:** define an occurrence key `(slotId, medId, localDate)`
  plus a ±tolerance on `scheduledInstant`, so a logged dose maps to the right slot
  even if the zone changed; migrate matching logic in Today/History to use it.
- **Server (from Stages 3–4):** push now **parses and validates** each record
  (Stage 4 schema + ownership) and returns per-id accept/reject; pull paginates the
  `byUpdatedAt` GSI; `version` guards stale writes. Readable records make
  server-side derived data possible later (out of scope here).

## 6. Tasks
1. Implement the sync client (pull/push, token handling) against the Stage 3 API.
2. Implement the durable offline queue and replay with idempotency.
3. Implement merge + LWW + tombstone resolution over the readable record store.
4. Integrate Stage 4 server-side validation into push; surface per-id rejections.
5. Add sync triggers (focus/mutation/manual) and a lightweight status indicator.
6. Refine occurrence matching and update Today/History consumers.
7. Write convergence, conflict, offline, idempotency, and validation tests (incl. a
   two-virtual-device harness).

## 7. Acceptance criteria
- AC1. Given device A edits offline, when it reconnects, the change appears on
  device B after sync.
- AC2. Given A and B edit the same record, when both sync, the later `updatedAt`
  wins on both devices.
- AC3. Given a record deleted on A, when B syncs, the record is gone on B
  (tombstone propagated).
- AC4. Given a sync interrupted mid-transfer, when retried, no duplicates or lost
  records result.
- AC5. Given the same push replayed, when processed again, the dataset is unchanged
  (idempotent).
- AC6. Given a dose logged before a mid-day zone change, when viewed after the
  change, it still maps to the correct slot occurrence.
- AC7. Given a batch with one invalid record, when pushed, the invalid record is
  rejected with a reason and the valid records still apply (and stored items are
  readable, per Stage 4).

## 8. Test plan
- Two-virtual-device harness: offline edit → converge; concurrent edit → LWW;
  delete propagation.
- Idempotency: duplicate push; interrupted-then-resumed sync.
- Server-side validation: invalid record in a batch rejected, siblings accepted.
- Occurrence-matching across simulated zone change (incl. BST/GMT).

## 9. Risks / decisions
- **Decision:** LWW per record (single user, rare conflicts) over CRDTs; HLC/CRDT
  noted as future if multi-writer needs emerge.
- Guard against clock skew by using server-assigned ordering for the pull token
  while keeping client `updatedAt` for merge.
- Readable payloads mean a malformed client could push bad data; the Stage 4
  server-side schema validation is the backstop.

## 10. Definition of done
All ACs pass; two devices converge; offline edits replay; sync idempotent and
resumable; server validates pushed records; occurrence-matching robust across zone
changes.
