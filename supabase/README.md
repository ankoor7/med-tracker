# SteadyDose backend (Supabase)

The entire cloud tier is **one Postgres table, one RLS policy set, and one
function** — no API Gateway, Lambda, DynamoDB, or CDK. Supabase provides auth
(GoTrue), the database (Postgres), and the data API (PostgREST). The client talks
to it through `@supabase/supabase-js`; the sync engine, local store, and UI sit
above the seams and don't know which backend is underneath.

The app is **local-first**: with no Supabase config it runs fully offline. Cloud
sync turns on only when `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` are set.

## Layout

| File                          | What it is                                                                                    |
| ----------------------------- | --------------------------------------------------------------------------------------------- |
| `config.toml`                 | Local stack config for the Supabase CLI (ports, auth settings).                               |
| `migrations/0001_records.sql` | The `records` table, indexes, size guard, RLS, `validate_record`, and the `push_records` RPC. |
| `seed.sql`                    | A throwaway local dev user (`dev@steadydose.local` / `DevPassw0rd!`).                         |
| `tests/records_test.sql`      | pgTAP suite for RLS, the LWW push guard, and validation parity.                               |

## How the pieces map to the old AWS design

| Concern                       | AWS (Stages 3–5)                      | Supabase (Stage 8)                            |
| ----------------------------- | ------------------------------------- | --------------------------------------------- |
| Auth                          | Cognito                               | GoTrue                                        |
| Data                          | DynamoDB (`PK=userId, SK=id`)         | `records` table (`primary key (user_id, id)`) |
| Pull cursor                   | `byUpdatedAt` GSI                     | `records_by_updated_at` index                 |
| Isolation                     | Lambda scoped every query by `userId` | Row-Level Security on `auth.uid()`            |
| Pull                          | `handlePull` (Lambda)                 | a PostgREST select (no server code)           |
| Push + LWW guard + validation | `handlePush` + `putIfNewer` (Lambda)  | the `push_records` RPC (SQL)                  |
| Schema validation             | shared TS `validateSyncRecord`        | `validate_record` plpgsql mirror              |
| Size guard                    | `MAX_RECORD_BYTES` in TS              | `payload_size` check constraint               |

`updated_at` stays epoch-ms `bigint`, so the client sync cursor and
`isNewerRecord` LWW ordering are byte-for-byte unchanged.

## Local development

Requires Docker and the [Supabase CLI](https://supabase.com/docs/guides/cli).

```bash
supabase start        # boot Postgres + GoTrue + PostgREST + Studio (pnpm local:up)
pnpm local:env        # write .env.local from the running stack
pnpm dev              # run the app against the local stack
```

Sign in with `dev@steadydose.local` / `DevPassw0rd!`. Email confirmation is
disabled locally (`config.toml` → `[auth.email] enable_confirmations = false`),
so sign-up is immediately usable.

```bash
supabase db reset     # re-apply migrations + seed, wiping local data (pnpm local:reset)
supabase test db      # run the pgTAP suite (pnpm db:test)
supabase stop         # stop the stack (pnpm local:down)
```

## Production

1. Create a Supabase project (free tier is fine for a personal user).
2. `supabase link --project-ref <ref>` then `supabase db push` (or `pnpm deploy:db`)
   applies the migrations. Auth + Postgres + PostgREST are managed — nothing to
   provision.
3. Read the project **URL** and **anon key** from the project's API settings into
   the static host's env as `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`.
4. Build and deploy the static PWA (`pnpm deploy` defaults to Cloudflare Pages).

### Security notes

- The **anon key is publishable** — it only lets the client reach PostgREST/GoTrue;
  RLS is what actually protects data. Never ship the **service-role key** (it
  bypasses RLS) to the client or commit it.
- The cloud is **server-readable, not zero-knowledge**: `payload` is plain `jsonb`
  by design (so the server can validate it and future server-side features can read
  it). RLS guarantees a user can only ever read/write their own rows.
- Free Supabase projects pause after ~1 week idle — verify current limits when you
  deploy.
