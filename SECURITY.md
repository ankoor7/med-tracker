# SteadyDose — Security & Threat Model

SteadyDose stores medication data in **your own Supabase project**. The cloud is a
**secure, server-readable** copy of your data — it is **not zero-knowledge**.
This is a deliberate design decision (see `specs/02-architecture.md` §7/§10 and
`specs/stage-4-cloud-data-and-security.md`): readable records let the backend
validate writes and, in future, power server-side features (reporting,
server-driven reminders, clinician sharing, richer backup). The dose and
blood-level math stays **on-device** in the pharmacology extension.

## What the server can see

Everything it stores, by design: your `user_id`, each record's `id`, `type`,
`updated_at`, `deleted` flag, and the **readable `payload`** (medications, slots,
dose logs, settings) as Postgres `jsonb`. There is no client-held-only key;
nothing is encrypted such that only your device can read it.

## How it is protected (layered, not key-custody)

- **In transit:** HTTPS/TLS only; a GoTrue JWT is required on every PostgREST/RPC
  call.
- **At rest:** Supabase-managed Postgres encryption at rest, with managed backups
  (per your Supabase plan).
- **Authentication:** Supabase **GoTrue** — email/password with a configurable
  password policy, **optional MFA**, short-lived access tokens with automatic
  refresh; sign-out clears tokens from browser storage.
- **Authorization:** per-user isolation enforced **in the database** by Row-Level
  Security. Every policy is `user_id = auth.uid()`, where `auth.uid()` comes from
  the verified JWT — so a record's owner is **never** read from the request body,
  and the guarantee holds for PostgREST selects and the push RPC alike.
- **Server-side validation:** the `push_records` RPC runs `validate_record` (a
  plpgsql mirror of `src/core/cloudRecord.ts`) before persist, plus the
  `payload_size` check constraint and the `record_type` enum. Malformed, oversized,
  or unknown-type writes are rejected per-id (one bad record doesn't sink the batch).
- **Keys:** only the **publishable anon key** ships in the client — it grants no
  data access on its own; RLS does the gating. The **service-role key bypasses
  RLS** and must never be shipped to the client or committed.
- **Optional on-device lock:** a passphrase-derived AES-GCM key
  (`src/crypto/`) can encrypt the **local** IndexedDB cache at rest as a
  convenience defense for a shared/lost device. It is **disabled by default**, is
  **not** zero-knowledge, and is **not** the security backbone.

## Threat model

| Threat                                           | Exposure                     | Mitigation                                                                 |
| ------------------------------------------------ | ---------------------------- | -------------------------------------------------------------------------- |
| Network eavesdropper                             | None (TLS)                   | HTTPS; JWT on every call                                                   |
| Another SteadyDose user                          | None                         | Row-Level Security (`user_id = auth.uid()`); owner never trusted from body |
| Stolen/lost device                               | Local cache                  | Optional on-device AES-GCM lock; cloud unaffected                          |
| Malformed/abusive writes                         | None                         | `validate_record` + `payload_size` check + enum, in SQL                    |
| Leaked **anon** key                              | None                         | Anon key grants no data access on its own — RLS gates every row            |
| **DB compromise _within your Supabase project_** | **Readable medication data** | Accepted trade-off (see below); encryption at rest, RLS, optional MFA      |

### The accepted trade-off

Because the cloud is server-readable, a compromise of your Postgres database
**inside your own Supabase project** would expose plaintext medication data. The
blast radius is bounded to **one user, in their own project**. We accept this to
keep the backend useful (validation, queries, future server features) and recovery
simple — losing a passphrase never loses the cloud copy, because recovery is via
GoTrue (email reset), not a cryptographic recovery code.

## Operator guidance

- Never commit secrets or paste them into prompts. Only `.env.example` is committed;
  `.env.local` (URL + **anon** key) is gitignored.
- Keep the **service-role key** secret — it bypasses RLS. It belongs only in
  trusted server contexts, never in the client bundle or the repo.
- Enable **MFA** on your SteadyDose account and on the Supabase account itself.
- Review the Supabase dashboard logs for unexpected auth or database access.

## Reporting

This is a single-user, bring-your-own-Supabase project. If you find a
vulnerability, open an issue describing the impact (omit any real personal data).
