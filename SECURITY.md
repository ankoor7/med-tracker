# SteadyDose — Security & Threat Model

SteadyDose stores medication data in **your own AWS account**. The cloud is a
**secure, server-readable** copy of your data — it is **not zero-knowledge**.
This is a deliberate design decision (see `specs/02-architecture.md` §7/§10 and
`specs/stage-4-cloud-data-and-security.md`): readable records let the backend
validate writes and, in future, power server-side features (reporting,
server-driven reminders, clinician sharing, richer backup). The dose and
blood-level math stays **on-device** in the pharmacology extension.

## What the server can see

Everything it stores, by design: your `userId`, each record's `id`, `type`,
`updatedAt`, `deleted` flag, and the **readable `payload`** (medications, slots,
dose logs, settings). There is no client-held-only key; nothing is encrypted such
that only your device can read it.

## How it is protected (layered, not key-custody)

- **In transit:** HTTPS/TLS only. CloudFront redirects HTTP→HTTPS and sends
  **HSTS** (1 year, `includeSubdomains`); a Cognito JWT is required on every
  `/sync/*` call.
- **At rest:** DynamoDB SSE with a **KMS customer-managed key**; **PITR** enabled.
  Key custody is your AWS account.
- **Authentication:** Cognito user pool — strong password policy (≥12 chars,
  upper/lower/digit/symbol), **optional TOTP MFA**, refreshable tokens; sign-out
  clears tokens from browser storage.
- **Authorization:** per-user isolation enforced **server-side**. The Lambda
  derives `userId` from the verified JWT claim and scopes every read/write to that
  partition. A record's owner is **never** read from the request body.
- **Server-side validation:** each record's `type` and `payload` are
  schema-validated (and size-bounded) before persist using the same module the
  client runs before push (`src/core/cloudRecord.ts`). Malformed, oversized, or
  unknown-type writes are rejected with a reason.
- **Optional on-device lock:** a passphrase-derived AES-GCM key
  (`src/crypto/`) can encrypt the **local** IndexedDB cache at rest as a
  convenience defense for a shared/lost device. It is **disabled by default**, is
  **not** zero-knowledge, and is **not** the security backbone.

## Threat model

| Threat                                            | Exposure                     | Mitigation                                                                                |
| ------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------- |
| Network eavesdropper                              | None (TLS)                   | HTTPS + HSTS; JWT on every call                                                           |
| Another SteadyDose user                           | None                         | Server-side per-`userId` isolation; owner never trusted from body                         |
| Stolen/lost device                                | Local cache                  | Optional on-device AES-GCM lock (auto-lock on idle/sign-out once wired); cloud unaffected |
| Malformed/abusive writes                          | None                         | Shared schema + size validation server-side                                               |
| **DB/cloud compromise _within your AWS account_** | **Readable medication data** | Accepted trade-off (see below); SSE-KMS, least-privilege IAM, CloudTrail, optional MFA    |

### The accepted trade-off

Because the cloud is server-readable, a compromise of your DynamoDB table **inside
your own AWS account** would expose plaintext medication data. The blast radius is
bounded to **one user, in their own account**. We accept this to keep the backend
useful (validation, queries, future server features) and recovery simple — losing
a passphrase never loses the cloud copy, because recovery is via the identity
provider (email reset), not a cryptographic recovery code.

## Operator guidance

- Deploy with **short-lived / SSO credentials**; never commit secrets or paste
  them into prompts. Only `.env.example` is committed.
- Enable **MFA** on your SteadyDose account and on the AWS account itself.
- Keep the Lambda role **least-privilege** (single-table access, as provisioned).
- Review **CloudTrail** for unexpected access to the table or KMS key.

## Reporting

This is a single-user, bring-your-own-AWS project. If you find a vulnerability,
open an issue describing the impact (omit any real personal data).
