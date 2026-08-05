# CLAUDE.md — SteadyDose

Local-first, offline-capable PWA (with a secure, server-readable cloud) for
tracking adjusted medication doses.
See `specs/` for the full product/architecture/stage specs. Build proceeds in
sequenced stages (see `specs/03-implementation-plan.md`).

## Commands

Package manager is **pnpm** (pinned via `packageManager` + `.nvmrc`).

| Task              | Command           |
| ----------------- | ----------------- |
| Install           | `pnpm install`    |
| Dev server        | `pnpm dev`        |
| Typecheck         | `pnpm typecheck`  |
| Lint              | `pnpm lint`       |
| Format            | `pnpm format`     |
| Test (run once)   | `pnpm test`       |
| Test (watch)      | `pnpm test:watch` |
| E2E (Playwright)  | `pnpm test:e2e`   |
| Combined coverage | `pnpm coverage`   |
| Production build  | `pnpm build`      |
| Preview build     | `pnpm preview`    |

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

**E2E-mocked:** `pnpm test:e2e:mocked` runs a Docker-free smoke suite
(`e2e-mocked/`, `playwright.mocked.config.ts`) against a dev server with
`VITE_SUPABASE_*` set but every Supabase network call intercepted
(`e2e-mocked/helpers/mockSupabase.ts`) — the only CI coverage of the
_configured_-backend code path, since the main `build` job always runs
unconfigured.

CI (`.github/workflows/ci.yml`) runs typecheck → lint → test → build on push/PR,
a `coverage` job (below), an `e2e-mocked` job, and a separate `db-tests` job
that boots Supabase and runs the pgTAP suite. A husky pre-commit hook runs
`lint-staged` + `typecheck`. A `.claude/hooks/fallow-gate.sh`
PreToolUse hook blocks git operations while any fallow `*_introduced` count is above 0 —
clear it by extracting/covering the new code, not by suppressing.

**Fallow config** lives in `.fallowrc.jsonc` (`fallow` is a devDependency, so
`pnpm exec fallow ...` always resolves). Two things there are easy to get wrong:

- Fallow reads entry points from package.json scripts, which covers the agent
  CLIs and their `.sh` wrappers — but _not_ `agent:test`, because its
  `vitest.agent.config.ts` is a non-default vitest config the plugin never
  loads. The `entry` glob supplies it; keep the two in sync or the whole agent
  test suite reads as dead code.
- `fallow audit` ignores the config's `health.coverage` — only `--coverage` /
  `FALLOW_COVERAGE` reach it. The gate hook exports the env var itself. Run
  `pnpm agent:test:coverage` after touching `scripts/agent/**`, or its functions
  audit as zero-coverage and score as critical CRAP risks.

Locally, use **`pnpm agent:audit`** rather than calling `fallow audit` directly:
it attaches that coverage and fails closed when the report is missing or older
than the sources it describes (stale line offsets stop fallow matching functions
to coverage, and it falls back to estimation silently — a green local run then
goes red in CI for no visible reason).

In CI the audit runs in **one** place: the separate `Fallow` workflow
(`.github/workflows/fallow.yml`, PR-only), which generates the coverage itself
immediately before auditing, so it cannot go missing or stale there. `ci.yml`'s
`agent-tooling` job only runs the agent suite — don't add a second audit to it;
two gates that can disagree is worse than one. The local
`.claude/hooks/fallow-gate.sh` hook fails _open_ by design and gates only the
machine it runs on; the `Fallow` workflow is what actually enforces this.

**Combined coverage:** unit (vitest), the real E2E suite, and the E2E-mocked
suite each collect raw V8 coverage, merged into one report with
[Monocart Coverage Reports](https://github.com/cenfun/monocart-coverage-reports).
`pnpm test:coverage` runs vitest with the `vitest-monocart-coverage` custom
provider, writing `coverage/unit/`. `pnpm test:e2e:coverage` / `pnpm
test:e2e:mocked:coverage` run the two Playwright suites with `monocart-reporter`
collecting per-test browser coverage (via `e2e/fixtures.ts` /
`e2e-mocked/fixtures.ts` and the shared `playwright.coverage.ts`), writing
`coverage/e2e/` / `coverage/e2e-mocked/`. `pnpm coverage` runs all three suites
(needs the local Supabase stack for the real E2E suite) then `pnpm
coverage:merge` (`scripts/merge-coverage.mjs`) combines whichever `raw` outputs
exist into `coverage/merged/`. `pnpm coverage:ci` skips the real E2E suite
(unit + E2E-mocked only) — that's what CI's `coverage` job runs, posting the
summary to the job's GitHub Actions summary and uploading the full report as
an artifact.

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
- **Editing the orchestrator doctrine means editing its ledger.** Every rule in
  `.claude/agents/sequential-fix-orchestrator.md` carries provenance in
  [`docs/agent-doctrine-ledger.md`](docs/agent-doctrine-ledger.md), and
  `pnpm agent:doctrine check` (part of `pnpm agent:test`) fails a rule added
  without an incident or a `prior` marker. Rules dormant across three runs are
  proposed for removal by `pnpm agent:doctrine prune`.

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
