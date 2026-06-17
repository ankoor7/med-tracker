# Stage 3 Spec — AWS Backend & Auth

> **Re-platformed by Stage 8.** The AWS surface described here (Cognito, API
> Gateway, Lambda, DynamoDB, S3/CloudFront, CDK) was replaced with **Supabase** in
> Stage 8 (`specs/stage-8-supabase-migration.md`). This spec is retained for the
> rationale and the auth/sync-API contract it established — the **functional**
> requirements it implements still hold, now on Supabase.

| | |
|---|---|
| **Depends on** | Stage 2 |
| **Implements** | FR-OSS-1..3; sync API surface (FR-SYNC-2 endpoints); architecture §8–§9 |
| **Milestone** | B |
| **Status** | Ready after Stage 2 |

## 1. Objective
Provision the **per-user AWS backend** as infrastructure-as-code and add client authentication. Deliver deployable Cognito auth, a JWT-protected `/sync/*` API over DynamoDB, and static hosting — all in the user's own account. Handlers treat record payloads as opaque pass-through blobs at this stage; Stage 4 introduces the **readable, server-validated record model** and Stage 5 the full sync logic.

## 2. Scope
**In:** AWS CDK app (TypeScript); Cognito user pool + app client; API Gateway HTTP API; Lambda sync handler (pass-through envelopes); DynamoDB table; S3 + CloudFront hosting; client auth flow; generated app config.
**Out:** the readable record model + server-side validation (Stage 4); conflict resolution/offline queue (Stage 5).

## 3. Prerequisites
Stage 2 repository + sync-ready metadata.

## 4. Functional requirements
- FR-3.1. One CDK stack provisions all resources to a fresh account via `cdk deploy`.
- FR-3.2. Per-user auth (Cognito); client can sign up / sign in / sign out; tokens refreshed.
- FR-3.3. `/sync/pull` and `/sync/push` exist, JWT-authorised, isolating data by `userId` claim.
- FR-3.4. DynamoDB stores envelopes `{ userId, id, updatedAt, version, deleted, payload }` (the `payload` is an opaque pass-through blob at this stage; Stage 4 makes it a readable, typed record); on-demand billing; PITR + SSE-KMS on.
- FR-3.5. No secrets in code; deploy uses the operator's local credential chain.

## 5. Technical approach
- **CDK app:** `infra/` with one stack; outputs Cognito IDs, API URL, CloudFront domain to a generated `app-config.json`.
- **DynamoDB:** `PK=userId`, `SK=id`; GSI `byUpdatedAt` (`PK=userId`, `SK=updatedAt`) for incremental pulls.
- **Lambda (Node/TS):** handlers for pull (query GSI since token) and push (batch put with `version` guard). At this stage payload is opaque bytes/base64.
- **Authorizer:** HTTP API JWT authorizer bound to the Cognito pool; Lambda reads `userId` from the validated claims.
- **Hosting:** private S3 + CloudFront (OAC); build → upload → invalidate scripts.
- **Client auth:** Cognito SDK (or Amplify Auth category standalone); session stored per platform norms; API client attaches the JWT.

## 6. Tasks
1. Create CDK app + stack; define DynamoDB, Cognito, API, Lambda, S3, CloudFront, KMS.
2. Implement Lambda pull/push (opaque envelopes) with `userId` isolation and `version` checks.
3. Add JWT authorizer; enforce per-user access.
4. Add client auth (sign up/in/out, refresh) and an authorised API client.
5. Generate `app-config.json` from stack outputs; wire the client to it.
6. Add deploy scripts (bootstrap/deploy/host-sync/invalidate) and a teardown (`cdk destroy`).
7. Smoke-test against a sandbox account.

## 7. Acceptance criteria
- AC1. Given a fresh AWS account, when `cdk deploy` runs, all resources provision and outputs are produced.
- AC2. Given valid credentials, when a user signs in, the client obtains a usable JWT.
- AC3. Given two users, when each calls `/sync/pull`, neither can read the other's records (verified).
- AC4. Given an envelope pushed by user A, when A pulls since an earlier token, that envelope returns.
- AC5. Given an unauthenticated request, when it hits `/sync/*`, it is rejected (401/403).
- AC6. Given the repo, when scanned, no AWS secrets are present; deploy relies on the local credential chain.

## 8. Test plan
- Infra: CDK synth snapshot; deploy to sandbox; resource smoke checks.
- Lambda: unit tests for pull/push with mocked DynamoDB; user-isolation tests.
- Auth: sign-in/refresh integration against the deployed pool.

## 9. Risks / decisions
- **Decision:** CDK + HTTP API + DynamoDB chosen over Amplify Gen 2 / AppSync for transparency and clean BYO-account deploys (architecture §9/§12). Revisit only if scaffold speed dominates.
- Use a **dedicated sandbox account** for development; least-privilege deploy role; SSO/short-lived creds.

## 10. Definition of done
All ACs pass; stack deploys and tears down cleanly on a sandbox; authorised, user-isolated `/sync/*` live; client authenticates; no secrets committed.
