# Stage 5 Spec — Sync Engine

| | |
|---|---|
| **Depends on** | Stage 3, Stage 4 |
| **Implements** | FR-SYNC-2, FR-SYNC-3; architecture §8; timezone occurrence-match refinement |
| **Milestone** | B |
| **Status** | Ready after Stages 3 & 4 |

## 1. Objective
Implement **bidirectional, end-to-end-encrypted sync** between the local store and the per-user cloud backend, with deterministic conflict resolution, an offline queue, and idempotent, resumable transfer. Result: the same user's data is consistent across devices.

## 2. Scope
**In:** sync client (pull/push); change tracking + tokens; offline queue + replay; last-write-wins conflict resolution; tombstone propagation; idempotency; background/triggered sync; the timezone occurrence-matching refinement.
**Out:** real-time collaboration / multi-user; CRDTs (note as future).

## 3. Prerequisites
Stage 3 `/sync/*` API + auth; Stage 4 encryption (records sync as ciphertext envelopes).

## 4. Functional requirements
- FR-5.1. Push local changes (encrypted envelopes) since `lastSyncToken`; pull remote changes; advance token.
- FR-5.2. Edits made offline queue and replay on reconnect; sync is resumable after interruption.
- FR-5.3. Conflicts resolve by **last-write-wins on `updatedAt`** per record; deletions handled via tombstones.
- FR-5.4. Sync is idempotent on `(id, version)`; re-running causes no duplication or loss.
- FR-5.5. Two devices converge to the same dataset after syncing.
- FR-5.6. Dose-to-slot occurrence matching is robust across a mid-day zone change (tolerance/occurrence key), correcting the Stage 1 approximation.

## 5. Technical approach
- **Client loop:** `push(changesSince token)` → `pull(since token)` → merge → persist → update token. Trigger on app focus, on mutation (debounced), and manually.
- **Change set:** records where `updatedAt > lastSyncToken` (and queued offline mutations).
- **Merge rule:** for each incoming record, apply if its `updatedAt` ≥ local; tombstones delete if newer. Encrypted payload is opaque to the server; client decrypts after merge.
- **Offline queue:** durable queue in `meta`/a Dexie table; replay in order; dedupe by `(id, version)`.
- **Occurrence matching:** define an occurrence key `(slotId, medId, localDate)` plus a ±tolerance on `scheduledInstant`, so a logged dose maps to the right slot even if the zone changed; migrate matching logic in Today/History to use it.
- **Server (from Stage 3):** unchanged contract; ensure GSI-by-`updatedAt` pagination and `version` guards.

## 6. Tasks
1. Implement the sync client (pull/push, token handling) against the Stage 3 API.
2. Implement the durable offline queue and replay with idempotency.
3. Implement merge + LWW + tombstone resolution; integrate with the encrypted repository.
4. Add sync triggers (focus/mutation/manual) and a lightweight status indicator.
5. Refine occurrence matching and update Today/History consumers.
6. Write convergence, conflict, offline, and idempotency tests (incl. a two-virtual-device harness).

## 7. Acceptance criteria
- AC1. Given device A edits offline, when it reconnects, the change appears on device B after sync.
- AC2. Given A and B edit the same record, when both sync, the later `updatedAt` wins on both devices.
- AC3. Given a record deleted on A, when B syncs, the record is gone on B (tombstone propagated).
- AC4. Given a sync interrupted mid-transfer, when retried, no duplicates or lost records result.
- AC5. Given the same push replayed, when processed again, the dataset is unchanged (idempotent).
- AC6. Given a dose logged before a mid-day zone change, when viewed after the change, it still maps to the correct slot occurrence.
- AC7. Given only ciphertext on the server, when inspected, no plaintext is derivable (re-verify E2E end-to-end).

## 8. Test plan
- Two-virtual-device harness: offline edit → converge; concurrent edit → LWW; delete propagation.
- Idempotency: duplicate push; interrupted-then-resumed sync.
- Occurrence-matching across simulated zone change (incl. BST/GMT).

## 9. Risks / decisions
- **Decision:** LWW per record (single user, rare conflicts) over CRDTs; HLC/CRDT noted as future if multi-writer needs emerge.
- Guard against clock skew by using server-assigned ordering for the pull token while keeping client `updatedAt` for merge.

## 10. Definition of done
All ACs pass; two devices converge; offline edits replay; sync idempotent and resumable; E2E preserved; occurrence-matching robust across zone changes.
