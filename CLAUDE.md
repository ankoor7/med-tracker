# CLAUDE.md — SteadyDose

Local-first, offline-capable PWA (with a secure, server-readable cloud) for
tracking adjusted medication doses.
See `specs/` for the full product/architecture/stage specs. Build proceeds in
sequenced stages (see `specs/03-implementation-plan.md`).

## Commands

Package manager is **pnpm** (pinned via `packageManager` + `.nvmrc`).

| Task             | Command           |
| ---------------- | ----------------- |
| Install          | `pnpm install`    |
| Dev server       | `pnpm dev`        |
| Typecheck        | `pnpm typecheck`  |
| Lint             | `pnpm lint`       |
| Format           | `pnpm format`     |
| Test (run once)  | `pnpm test`       |
| Test (watch)     | `pnpm test:watch` |
| E2E (Playwright) | `pnpm test:e2e`   |
| Production build | `pnpm build`      |
| Preview build    | `pnpm preview`    |

The backend is **Supabase** (Stage 8 re-platformed off AWS). The app is
local-first: with no Supabase env configured it runs fully offline.

### Local cloud dev (Supabase CLI) — needs Docker

| Task                          | Command                                  |
| ----------------------------- | ---------------------------------------- |
| Start stack (Postgres+GoTrue) | `pnpm local:up` (`supabase start`)       |
| Write `.env.local` from stack | `pnpm local:env`                         |
| Reset (re-apply migrations)   | `pnpm local:reset` (`supabase db reset`) |
| Run DB (pgTAP) tests          | `pnpm db:test` (`supabase test db`)      |
| Stop                          | `pnpm local:down` (`supabase stop`)      |

Dev account: `dev@steadydose.local` / `DevPassw0rd!` (seeded in `supabase/seed.sql`;
email confirmation is disabled locally). Deploy: `pnpm deploy` runs `supabase db push`,
the build, then `wrangler pages deploy dist` (Cloudflare Pages). DB-only push:
`pnpm deploy:db`.

**E2E (Stage 10):** `pnpm test:e2e` runs the Playwright suite (`e2e/`, spec
`specs/stage-10-e2e-testing.md`). It needs the local stack up (`pnpm local:up` +
`pnpm local:env`); it boots its own Vite dev server on port 5175 with
`VITE_DISABLE_SEED=true` (empty first run), signs in as the dev account, drives the
UI, then asserts the resulting rows in the Supabase `records` table via a direct
`pg` connection. The Playwright MCP server is registered in `.mcp.json`.

CI (`.github/workflows/ci.yml`) runs typecheck → lint → test → build on push/PR,
plus a separate `db-tests` job that boots Supabase and runs the pgTAP suite.
A husky pre-commit hook runs `lint-staged` + `typecheck`. A `.claude/hooks/fallow-gate.sh`
PreToolUse hook blocks git operations while any fallow `*_introduced` count is above 0 —
clear it by extracting/covering the new code, not by suppressing.

**Commit gotchas** (learned the hard way): the pre-commit hook (lint-staged +
typecheck + fallow) exceeds the 2-min foreground timeout on this codebase — run
commits with `run_in_background: true`. Write commit messages to a file and use
`git commit -F <file>` (apostrophes break heredocs). Use `git --no-pager diff`;
the pager hangs.

## Architecture / conventions

Folder layout mirrors `specs/02-architecture.md` §4:

- `src/core/` — **pure TypeScript domain core**. Entities, scheduling, guardrails,
  timezone math, adherence, pharmacology extension interface. **No React, no
  Zustand, no UI/store imports** — enforced by an ESLint `no-restricted-imports`
  boundary rule. Unit-tested in isolation.
- `src/store/` — Zustand store; wraps the core and (from Stage 2) the repository.
- `src/ui/` — React screens/components; presentation only, no business logic.
- `src/crypto/` — stub; Stage 4 may use it for an **optional** on-device cache
  lock (Web Crypto). Not zero-knowledge; disabled by default.
- `src/supabase/` — singleton `@supabase/supabase-js` client (lazy; only created
  when a backend is configured).
- `src/auth/` — Supabase GoTrue client (`supabaseAuth.ts`) + `useAuth` hook.
- `src/sync/` — `supabaseBackend.ts` (the `SyncBackend` port: PostgREST pull +
  `push_records` RPC) and the sync engine (`syncEngine.ts`).
- `src/config.ts` — backend config from `VITE_SUPABASE_*` env (null = local-first only).
- `supabase/` — the backend: `migrations/` (the `records` table, RLS,
  `push_records`, `validate_record`), `seed.sql`, `tests/` (pgTAP), `config.toml`.
  See `supabase/README.md`. The server logic lives in SQL, not TypeScript.
- `specs/` — product, architecture, and per-stage specs (source of truth).

### Rules

- **Time:** store every event as a UTC `Instant` (epoch ms). Resolve schedule
  wall-times in the app's **active zone**, never the host zone implicitly.
- **Safety:** the app never originates a dose value; it records and validates.
  Guardrail checks live in one shared function (`core/guardrails.ts`).
- **No secrets** in the repo or in prompts. Only `.env.example` is committed.
- TypeScript is **strict**. Keep `pnpm typecheck` and `pnpm lint` green.

## Workflow

Work is **spec-driven** and built through an **Implement → Validate → Review**
agent loop, one unit per commit. See [`docs/development-workflow.md`](docs/development-workflow.md)
for the full method. The loop is run by the
[`sequential-fix-orchestrator`](.claude/agents/sequential-fix-orchestrator.md) agent —
use it when work is enumerable up front and each item is independently shippable.

- Specs in `specs/` are the source of truth for what "done" means; a fix is
  finished when its acceptance criteria pass in the running app, not when tests go
  green.
- Settle open questions **in the spec**, not just the chat.
- Write session state to `HANDOFF.md` at a session boundary.

## Communication

- Be concise and clear. Lead with the answer; cut preamble and filler.
- State findings plainly. Drop hedges and qualifiers ("I think", "it seems",
  "probably", "should be fine") unless you are genuinely uncertain — and when you
  are, say so directly and why.
- Don't pad claims with validators or self-justification. Report what is true,
  including when something failed, was skipped, or is unverified.

## Git conventions

- Default working branch is `main`. Branch before committing if on `main`.
- Conventional-ish commit subjects (e.g. `feat(core): add schedule enumeration`).
