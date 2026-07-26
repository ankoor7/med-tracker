# Stage 4 Spec — Cloud Data Model & Security Hardening

> **Re-platformed by Stage 8.** The AWS implementation (DynamoDB, Lambda
> validation, Cognito/KMS hardening) was replaced with **Supabase** in Stage 8
> (`specs/stage-8-supabase-migration.md`): the readable, typed record model and
> server-side validation now live in Postgres (RLS + `validate_record` +
> `push_records`). The deliberate **"server-readable, not zero-knowledge"**
> decision documented here still holds — Postgres rows are server-readable by design.

| | |
|---|---|
| **Depends on** | Stage 3 |
| **Implements** | FR-SEC-1..5; architecture §7, §10 |
| **Milestone** | B |
| **Status** | Superseded by Stage 8 (Supabase) |

## 1. Objective
Make the cloud a **readable, server-usable copy** of the user's data — **not**
zero-knowledge — and secure it properly. The backend stores structured, typed
records it can parse, validate, and (in future) use to power server-side features
(reporting, reminders, sharing, backup). The dose/blood-level math stays
on-device. Security comes from
**transport encryption, strong authentication, per-user authorization,
server-managed encryption at rest, and server-side validation**, all inside the
user's own AWS account. This stage redefines the former "End-to-End Encryption"
stage: client-held-only keys are removed; the server can read the data by design.

## 2. Scope
**In:** the structured cloud record schema (readable `payload`, typed by record
`type`); server-side schema + ownership validation; encryption in transit (TLS)
and at rest (KMS); Cognito auth hardening (password policy, optional MFA, token
TTLs); per-user data isolation enforced server-side; an **optional** on-device
lock for the local cache; updated threat model.
**Out:** the sync protocol itself (Stage 5 transports these records); server-side
derived/computed data and sharing (future — now *unblocked* by readable data).

## 3. Prerequisites
Stage 3 backend (Cognito, JWT `/sync/*` API over DynamoDB, S3+CloudFront) and the
Stage 2 repository + record metadata.

## 4. Functional requirements
- FR-4.1. Cloud records are stored as **readable, typed structured items** the
  backend can parse and operate on. There is **no** client-side-only encryption
  requirement; the cloud is explicitly **not zero-knowledge**.
- FR-4.2. All data is **encrypted in transit** (HTTPS/TLS) and **at rest**
  (DynamoDB SSE with a KMS customer-managed key); key custody is the user's AWS
  account.
- FR-4.3. Authentication (Cognito) and **per-user authorization** isolate each
  user's data; isolation is enforced **server-side** on every read and write via
  the `userId` JWT claim — never trusted from the client body.
- FR-4.4. The server **validates** each record's `type` and `payload` against a
  schema and rejects malformed, oversized, or unknown-type writes with a reason.
- FR-4.5. An **optional on-device lock** protects the local cache at rest;
  **account recovery** is via the identity provider (email reset), not a
  cryptographic recovery code.

## 5. Technical approach
- **Record envelope (readable):** the Stage 3 envelope already carries a `payload`
  field (an opaque pass-through **string**). Stage 4 widens it to a readable, typed
  **object** and adds a `type` discriminator:
  ```ts
  type RecordType = 'medication' | 'slot' | 'doseLog' | 'settings';

  interface SyncRecord {
    id: string;
    type: RecordType;     // discriminates payload; indexable server-side
    updatedAt: number;    // epoch ms; pull cursor + LWW key
    version: number;      // monotonic per record; idempotency + version guard
    deleted?: boolean;    // tombstone
    payload: object;      // readable entity fields, typed by `type`
  }
  ```
- **DynamoDB:** keep `PK=userId`, `SK=id`, the `byUpdatedAt` GSI (incremental
  pulls), on-demand billing, PITR, and SSE-KMS. Promote `type` to an attribute;
  optionally add a `byType` GSI (`PK=userId`, `SK=type#updatedAt`) so the server
  can answer type-scoped queries later. `payload` is a native DynamoDB map.
- **Shared validation:** one schema module per `type` (e.g. Zod), reused by the
  client before write **and** by the Lambda before persist — single source of
  truth, mirroring the `core/guardrails.ts` pattern.
- **Server-side authorization:** the Lambda derives `userId` from validated JWT
  claims and scopes every operation to that partition; a record's claimed owner is
  never read from the request body.
- **Transport:** HTTPS only; HSTS on the CloudFront distribution; JWT on every
  `/sync/*` call (already from Stage 3).
- **Auth hardening (Cognito):** strong password policy; optional TOTP **MFA**;
  short access-token TTL with refresh; sign-out clears tokens from storage.
- **At rest:** DynamoDB SSE-KMS (CMK) + PITR; document that AWS/operator can
  technically read the data (the deliberate non-zero-knowledge trade-off).
- **Optional on-device lock:** a passphrase- or WebAuthn-gated key that encrypts
  the local IndexedDB cache at rest (Web Crypto AES-GCM). This is a convenience
  defense for a shared/lost device — **not** the security backbone and **not**
  zero-knowledge. Auto-lock on idle/sign-out. The repurposed `src/crypto/` module
  hosts this; it is optional and can ship disabled by default.

## 6. Tasks
1. Widen the envelope's opaque `payload` (string) to a readable, typed object and
   add a `type` discriminator; update `infra/sync/types.ts`, `handlerCore.ts`,
   `dynamoStore.ts`, `src/sync/apiClient.ts`, and tests.
2. Add per-`type` payload schemas in a shared module (client + Lambda).
3. Add server-side validation + ownership enforcement to `handlerCore` push.
4. Confirm/strengthen at-rest KMS, PITR, and TLS/HSTS in the CDK stack; document
   key custody.
5. Cognito hardening: password policy, optional MFA, token TTLs, clear-on-signout.
6. (Optional) implement the on-device cache lock with idle auto-lock.
7. Update the threat model and `SECURITY.md` notes for the non-zero-knowledge
   posture.

## 7. Acceptance criteria
- AC1. Given data is written, when the DynamoDB item is inspected, it is a
  **readable, typed record** (a structured `payload`, not ciphertext) that the
  server can parse.
- AC2. Given a request without a valid JWT, when it hits `/sync/*`, it is rejected;
  given user A's token, A can never read or write user B's records.
- AC3. Given a malformed, oversized, or unknown-`type` record, when pushed, the
  server rejects it with a clear reason.
- AC4. Given data in transit and at rest, when inspected, it is TLS-encrypted on
  the wire and KMS-encrypted in DynamoDB.
- AC5. Given the configured Cognito policy, when a user signs up/in, the password
  policy (and MFA, if enabled) is enforced; sign-out clears tokens.
- AC6. (If implemented) Given the device lock is enabled, when the device is
  locked, the local cache is unreadable until unlock and auto-locks on idle.

## 8. Test plan
- Round-trip a record through the API and assert the stored item is structured and
  schema-valid.
- Authz tests: missing/invalid JWT rejected; cross-user access denied (re-verify
  Stage 3 AC3 holds with readable payloads).
- Validation tests: malformed/oversized/unknown-type rejected; valid accepted.
- Cognito policy/MFA + sign-out token-clear tests.
- (If implemented) device-lock: cache unreadable when locked; idle auto-lock.

## 9. Risks / decisions
- **Decision:** **non-zero-knowledge, server-readable data**, chosen so the
  backend can validate, query, and later support server-side features
  (analytics/reporting, server-driven reminders, clinician sharing, backup) and so
  recovery is simple (identity provider, no lost-key data loss). **Pharmacology /
  blood-level calculation stays on-device** — it is simple and runs in the
  extension. **Trade-off:** a cloud/DB compromise *within the user's account*
  exposes plaintext medication data.
- **Mitigations:** single-user **bring-your-own-account** (blast radius = your own
  data, in your own account), SSE-KMS at rest, least-privilege IAM, CloudTrail
  audit, optional MFA, optional on-device lock for the local cache.
- **Decision:** keep **DynamoDB (NoSQL)** — reuse the Stage 3 infra, stay
  serverless and idle ≈ \$0; structured items + GSIs cover query needs for a tiny
  single-user dataset (relational considered; rejected on cost/infra-churn).

## 10. Definition of done
All ACs pass; cloud items are readable, typed, and server-validated; per-user
isolation enforced server-side; TLS + KMS confirmed; Cognito hardened; threat
model/docs updated to the non-zero-knowledge posture; app fully functional.
