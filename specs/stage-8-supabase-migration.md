# Stage 8 Spec — Re-platform onto Supabase (drop AWS, simplify)

| | |
|---|---|
| **Depends on** | Stages 3–5 (auth, cloud data model, sync engine); runs after the feature track (6–7) |
| **Supersedes** | The AWS surface of architecture §3–§4, §7–§10, §13–§14; Stages 3 & 4 infra; the API tier of Stage 5 |
| **Implements** | Same FRs as Stages 3–5 (auth, per-user isolation, server-validated readable records, bidirectional LWW sync) on a smaller substrate |
| **Milestone** | D (re-platform — precedes the open-source release, Stage 9) |
| **Status** | Done |

## 1. Objective

Replace the bring-your-own-AWS backend (Cognito + API Gateway + Lambda + DynamoDB
+ S3/CloudFront + KMS, provisioned by CDK) with **Supabase**, and **collapse the
custom sync API tier** in the process. The functional contract is unchanged: a
per-user, auth-protected store of **readable, typed records** that the client syncs
bidirectionally with last-write-wins. What changes is the substrate and the amount
of code we own:

- **Auth:** Cognito → Supabase **GoTrue**.
- **Data:** DynamoDB → **Postgres** (one `records` table).
- **Isolation:** Lambda-enforced `userId` scoping → **Row-Level Security**.
- **Sync API:** API Gateway + Lambda + `handlerCore` → **PostgREST** (pull) + one
  **Postgres RPC** (push, with the version guard + validation in SQL). The entire
  `infra/` server tier is deleted.
- **Hosting:** S3 + CloudFront → a static host (Cloudflare Pages, default).
- **Local dev:** LocalStack + cognito-local + Express → the **Supabase CLI**
  (`supabase start`), one Docker stack with real GoTrue + Postgres + Studio.

### Why this is a net simplification
The original design routed every read/write through TS we maintain in three places
(Lambda adapter, `handlerCore`, `dynamoStore`) plus a parallel local Express server
and a CDK stack. Postgres + RLS already provide per-user isolation and conditional
writes natively, so the server logic shrinks to **one table, one policy set, one
function** — and the local/prod split disappears because GoTrue runs for real
locally (the reason cognito-local existed is gone).

## 2. Scope

**In:** Supabase schema (table + indexes + RLS + push RPC + server-side validation
in SQL); `@supabase/supabase-js` client; auth client + sync backend adapter swaps;
config + env changes; local dev via Supabase CLI; static hosting + deploy; test
migration; doc/spec updates; dependency and script cleanup.

**Out:** Any change to the **domain core**, the **local repository / Dexie store**,
the **sync engine orchestration**, the **record mapping**, or the **UI**. These sit
above the seams we swap and must not change behaviour. No new product features.

## 3. Architectural seams (what changes, what doesn't)

The client was already built against ports, which is what makes this cheap.

**Unchanged (must not be edited beyond imports):**
- `src/core/cloudRecord.ts` — `SyncRecord` shape, `validateSyncRecord`,
  `isNewerRecord` LWW. Still the shared source of truth.
- `src/sync/syncEngine.ts` — `runSync` + the `SyncBackend` port (`pull`/`push`).
  Only `defaultBackend` is repointed (§6.3).
- `src/sync/recordMapping.ts` — entity ↔ envelope conversion.
- `src/store/*` — `Repository`, outbox, `applyRemote`, sync token.
- `src/store/`, `src/ui/` — entirely untouched.
- `src/auth/useAuth.ts` — the **hook interface stays identical**; only the module
  it imports changes (§6.1).

**Swapped (same exported API, new implementation):**
- `src/auth/cognito.ts` → `src/auth/supabaseAuth.ts`
- `src/sync/apiClient.ts` → `src/sync/supabaseBackend.ts`
- `src/config.ts` — new `BackendConfig` fields.

**Deleted:**
- All of `infra/` (`sync/`, `lambda/`, `local/`, `cdk/`, `README.md`).
- `docker-compose.yml` (LocalStack + cognito-local).
- `tsconfig.infra.json` and its inclusion in `typecheck`.
- Deps: `amazon-cognito-identity-js`, `@aws-sdk/*`, `@types/express`,
  `@types/cors`, `express`, `cors`, `aws-cdk`/`aws-cdk-lib`/`constructs`, `tsx`
  (if unused elsewhere).

**Added:**
- `supabase/config.toml`, `supabase/migrations/0001_records.sql`,
  `supabase/seed.sql`.
- `src/supabase/client.ts` (singleton `createClient`).
- Dep: `@supabase/supabase-js`.

## 4. Data model (Postgres)

One table mirrors the `SyncRecord` envelope; `payload` stays a readable `jsonb`.

```sql
create type record_type as enum ('medication','slot','doseLog','settings');

create table records (
  user_id    uuid        not null references auth.users(id) on delete cascade,
  id         text        not null,
  type       record_type not null,
  updated_at bigint      not null,          -- epoch ms (matches SyncRecord.updatedAt)
  version    integer     not null,
  deleted    boolean     not null default false,
  payload    jsonb       not null,
  primary key (user_id, id)                 -- DynamoDB PK=userId, SK=id
);

-- Incremental pull cursor (replaces the `byUpdatedAt` GSI).
create index records_by_updated_at on records (user_id, updated_at);

-- Size guard (replaces MAX_RECORD_BYTES on the server side).
alter table records
  add constraint payload_size check (pg_column_size(payload) <= 65536);
```

**Mapping vs DynamoDB:** PK `(user_id, id)` = `PK=userId, SK=id`;
`records_by_updated_at` = the `byUpdatedAt` GSI; `type` as a column = the `byType`
GSI (a plain `where type = …` now). `updated_at` stays epoch-ms `bigint` so the
client cursor (`getSyncToken`/`setSyncToken`) and `isNewerRecord` are byte-for-byte
unchanged.

### 4.1 Row-Level Security (replaces Lambda isolation)
```sql
alter table records enable row level security;

create policy records_select on records
  for select using (user_id = auth.uid());
create policy records_modify on records
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
```
This is the core "owner is never trusted from the body" guarantee, now enforced by
the database for **every** path (PostgREST and RPC alike). `auth.uid()` comes from
the verified GoTrue JWT — the client cannot read or write another user's rows.

## 5. Server-side sync logic in SQL

### 5.1 Pull — PostgREST, no server code
`pull(since)` becomes a direct filtered select; RLS scopes it to the caller:
```
select id, type, updated_at, version, deleted, payload
from records
where updated_at > :since
order by updated_at asc
```
The client computes the new high-water token from the returned rows exactly as
`handlePull` did (max `updated_at`, floored at `since`).

### 5.2 Push — one RPC with the version guard + validation
The conditional "accept only if strictly newer" (`putIfNewer`) and the per-record
validation move into a single `security definer` function returning a per-id
verdict, preserving Stage 5 FR-5.7 (one bad record doesn't sink the batch):

```sql
create or replace function push_records(changes jsonb)
returns table (id text, accepted boolean, reason text)
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); rec jsonb; v_reason text;
begin
  if uid is null then raise exception 'unauthenticated'; end if;
  for rec in select * from jsonb_array_elements(changes) loop
    v_reason := validate_record(rec);              -- §5.3; null = ok
    if v_reason is not null then
      id := rec->>'id'; accepted := false; reason := v_reason; return next; continue;
    end if;
    insert into records as r (user_id,id,type,updated_at,version,deleted,payload)
    values (uid, rec->>'id', (rec->>'type')::record_type,
            (rec->>'updatedAt')::bigint, (rec->>'version')::int,
            coalesce((rec->>'deleted')::boolean,false), rec->'payload')
    on conflict (user_id,id) do update
      set updated_at=excluded.updated_at, version=excluded.version,
          deleted=excluded.deleted, payload=excluded.payload, type=excluded.type
      -- LWW guard, identical predicate to dynamoStore + isNewerRecord:
      where excluded.updated_at > r.updated_at
         or (excluded.updated_at = r.updated_at and excluded.version > r.version);
    id := rec->>'id';
    accepted := found;                              -- false = stale (LWW loss)
    reason := case when found then null else 'stale version' end;
    return next;
  end loop;
end $$;
```
The client adapter maps `{accepted:false, reason:'stale …'}` to the same silent
outbox-clear the engine already does (`isStaleRejection`). No engine change.

### 5.3 Validation: where it lives — **decision required (D1)**
The original design asserts "the cloud validates" via the shared TS
`validateSyncRecord`. Three options:

- **(A) plpgsql `validate_record(jsonb)`** mirroring the TS rules (required keys,
  enum `type`, numeric fields, `HH:MM`, size). *Pro:* server truly validates, zero
  extra infra. *Con:* the rules exist twice (TS + SQL) and must be kept in sync.
- **(B) Client-only validation + DB structural constraints** (column types, enum,
  `payload_size` check, RLS). *Pro:* single validation source (TS). *Con:* the
  server doesn't deep-validate payload field shapes — acceptable because RLS means
  a user can only ever corrupt **their own** data (integrity, not a security hole).
- **(C) Supabase Edge Function (Deno)** importing `cloudRecord.ts` verbatim. *Pro:*
  literally one validation source, reused. *Con:* re-introduces a function tier —
  against the simplify goal.

**Recommendation: (A)** — keep a genuine server-side gate (honours the Stage 4
"server validates" contract) while staying inside the database. Treat the SQL
validator as a generated artifact of the TS rules and cover it with pgTAP (§8) so
drift is caught. Fall back to (B) if the duplication proves annoying.

## 6. Client changes

### 6.1 Auth — `src/auth/supabaseAuth.ts`
Re-implement the exact functions `useAuth` already imports, over GoTrue:

| Current (Cognito) | Supabase |
|---|---|
| `signIn(email,pw)` | `supabase.auth.signInWithPassword` |
| `signUp(email,pw)` | `supabase.auth.signUp` |
| `confirmSignUp(email,code)` | email-link confirm — see D2 |
| `signOut()` | `supabase.auth.signOut()` |
| `getSession()` | `supabase.auth.getSession()` |
| `getIdToken()` | `session.access_token` (JWT; drives `auth.uid()`) |
| `currentAccount()` | `session.user.email` |

`useAuth.ts` changes only its import path. Prefer wiring
`supabase.auth.onAuthStateChange` so token refresh is automatic (drop the manual
Cognito refresh dance).

**D2 — email confirmation:** GoTrue uses an email link, not Cognito's code-based
`confirmSignUp`. Options: (i) disable email confirmation
(`[auth] enable_confirmations = false`) for a personal app — simplest, removes the
confirm screen; (ii) keep confirmation and drop the code-entry UI in favour of the
link. **Recommend (i)** locally and for single-user prod; revisit if opening signup.

### 6.2 Config — `src/config.ts`
Replace the Cognito/API fields with Supabase ones (the anon key is publishable;
RLS, not key secrecy, protects data):
```ts
interface BackendConfig { supabaseUrl: string; supabaseAnonKey: string; }
```
Env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (replace
`VITE_COGNITO_*`/`VITE_API_BASE_URL`). `parseBackendConfig` returns `null` unless
both are present — the **local-first "no backend configured" path is preserved**.
Update `.env.example` and `config.test.ts`.

### 6.3 Sync backend — `src/sync/supabaseBackend.ts`
Implement the existing `SyncBackend` port:
```ts
const supabaseBackend: SyncBackend = {
  pull: async (since) => {
    const { data, error } = await supabase.from('records')
      .select('id,type,updated_at,version,deleted,payload')
      .gt('updated_at', since).order('updated_at');
    // → map snake_case→camelCase into SyncRecord[]; token = max(updated_at, since)
  },
  push: async (changes) => {
    const { data, error } = await supabase.rpc('push_records', { changes });
    // → { results: data as PushResult[] }
  },
};
```
Point `syncEngine.defaultBackend` at it. Keep client-side `validateSyncRecord`
before push (fast-fail, as today). Replace `ApiError` with a small `SyncError`
carrying an `offline` flag derived from network/`error.code`, so `useSync`'s
offline-vs-error branch keeps working (only the import in `useSync.ts` changes).

## 7. Local dev & deployment

### 7.1 Local (Supabase CLI, one Docker stack)
`supabase/` holds `config.toml` + `migrations/` + `seed.sql`. New scripts:

| Task | Old | New |
|---|---|---|
| Start stack | `docker compose up` (LocalStack+cognito-local) | `supabase start` |
| Apply schema + seed dev user | `local:bootstrap` (tsx) | `supabase db reset` |
| Run sync API | `local:api` (Express) | — (gone) |
| Stop / wipe | `local:down` / `local:reset` | `supabase stop` / `supabase db reset` |

`supabase start` prints the local URL + anon key → write them to `.env.local`
(a tiny `local:env` script, or document the copy). Dev user
`dev@steadydose.local / DevPassw0rd!` is seeded in `seed.sql` via the admin API /
an `auth.users` insert, preserving the current dev-account ergonomics. GoTrue is
real locally, so auth behaviour matches prod exactly.

### 7.2 Production
- **Backend:** create a Supabase project; `supabase link`; `supabase db push`
  applies migrations. Auth + Postgres + PostgREST are managed — nothing to
  provision.
- **Hosting (D3):** the PWA is a static build; Supabase isn't a great SPA/CDN host.
  Default **Cloudflare Pages** (free, CDN, custom domains, Git auto-deploy);
  alternatives Netlify / Vercel / GitHub Pages. `deploy` becomes:
  `supabase db push && pnpm build && <pages deploy dist>`.
- Delete `cdk:*`, `infra:gen-config`, `deploy:host`, the AWS `deploy`.

### 7.3 Free-tier fit
Supabase free tier (one personal user) comfortably covers Postgres, ~50k MAU auth,
and storage; **note** free projects pause after ~1 week idle (verify current
limits at build time). Idle cost ≈ \$0, same as the AWS design's claim — with far
less to operate.

## 8. Testing

Removed: `handlerCore.test.ts`, `inMemoryStore.ts`, `infra/local/auth.test.ts`,
`steadydose-stack.test.ts` (the code they cover is gone).

Kept unchanged: `syncEngine.test.ts` (drives an in-memory `SyncBackend` harness —
storage-agnostic), `cloudRecord.test.ts`, `recordMapping.test.ts`,
`store.test.ts`, `transfer.test.ts`.

Added:
- **pgTAP** (or a vitest integration suite using `supabase-js` against the local
  stack) for the server logic that now lives in SQL:
  - RLS: user A cannot select/modify user B's rows.
  - `push_records` version guard: newer wins, stale rejected with `'stale version'`,
    idempotent re-push is a no-op, one invalid record doesn't block valid ones.
  - `validate_record` parity with `validateSyncRecord` (if D1=A).
- **`supabaseBackend.test.ts`** — unit test the snake↔camel mapping + token
  computation with a mocked `supabase` client.
- Run the DB suite in CI after `supabase start` (or `supabase db reset`).

`pnpm typecheck` drops the `tsconfig.infra.json` leg. CI (`ci.yml`): remove the
infra typecheck; add a job step that boots Supabase and runs the DB tests (or gate
it behind a label to keep PR CI fast — **D4**).

## 9. Documentation updates
- **`architecture/02-architecture.md`** — rewrite §3 diagram, §4 components, §7–§10
  (security/isolation now RLS + GoTrue + TLS; "KMS/Lambda/CloudFront" → Supabase),
  §8 sync (PostgREST + RPC), §12 stack table, §13–§14 (deploy/cost).
- **`CLAUDE.md`** — replace the "Local AWS dev" + deploy command tables and the
  `src/auth` / `src/sync` / `infra/` descriptions; drop the Cognito dev-account AWS
  framing; keep the core/store/ui boundary rules (still enforced).
- **New `supabase/README.md`** replacing `infra/README.md`.
- Mark Stages 3 & 4 specs as **re-platformed by Stage 8** (don't delete — they
  record the rationale, incl. the deliberate "not zero-knowledge" decision, which
  still holds: Postgres rows are server-readable by design).

## 10. Migration sequence (suggested commits)
1. `chore: scaffold supabase/ (config, 0001_records migration, seed)` — table, RLS,
   `push_records`, `validate_record`; `supabase start` + `db reset` green locally.
2. `feat: add supabase client + config` — `src/supabase/client.ts`, new
   `BackendConfig`, env, `config.test.ts`.
3. `feat: supabase auth client` — `supabaseAuth.ts`, repoint `useAuth`.
4. `feat: supabase sync backend` — `supabaseBackend.ts`, repoint `defaultBackend`,
   `SyncError`; delete `apiClient.ts`.
5. `test: pgTAP/integration for RLS + push_records + validation`.
6. `chore: remove AWS infra` — delete `infra/`, `docker-compose.yml`,
   `tsconfig.infra.json`, AWS/Cognito/Express/CDK deps; rewrite scripts.
7. `feat: static hosting + deploy via supabase db push + pages`.
8. `docs: re-platform architecture/CLAUDE/specs onto Supabase`.

Each step keeps `pnpm typecheck && pnpm lint && pnpm test` green; the engine/store/
UI layers never change, so the app stays runnable throughout.

## 11. Open decisions
- **D1.** Server-side validation: (A) plpgsql validator [recommended], (B)
  client-only + DB constraints, (C) Edge Function reusing TS.
- **D2.** Email confirmation: disable [recommended for single-user] vs keep link.
- **D3.** Static host: Cloudflare Pages [recommended] / Netlify / Vercel / GH Pages.
- **D4.** CI: run the Supabase DB suite on every PR vs nightly/label-gated.
