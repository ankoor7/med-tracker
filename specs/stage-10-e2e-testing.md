# Stage 10 Spec — End-to-End Testing (Playwright + Supabase)

| | |
|---|---|
| **Depends on** | Stage 8 (Supabase backend); Stage 5 (sync engine); Stages 1–7 (full UI) |
| **Implements** | FR-E2E-1..6; verified UI→DB round-trip |
| **Milestone** | E (release hardening) |
| **Status** | Done |

## 1. Objective
Add a **browser-driven end-to-end (E2E) test suite** that exercises SteadyDose the
way a real user does — clicking through the actual UI in a real browser — and
proves that those interactions **persist all the way through to the Supabase
database**. The unit/integration suites (Vitest) already cover the core, the store,
the sync engine, and the SQL contract in isolation; this stage closes the last gap:
that the *wired-together* system (React UI → Zustand store → local repository →
sync engine → PostgREST/`push_records` RPC → `records` table) actually works against
a real Postgres + GoTrue stack.

The flagship scenario is **first-run setup**: a new user signs in, creates three
medications, and arranges them into mixed time-slot groups across the day — then we
assert the resulting rows exist in the `records` table with the correct typed
payloads.

## 2. Scope
**In:** Playwright (`@playwright/test`) wired to run against the local Supabase stack
(`supabase start`); a Playwright config with a managed Vite `webServer`; an E2E
helper for asserting DB state via a direct Postgres connection; a first-run
setup-flow spec (sign in → 3 meds → mixed slots → sync → DB assertions); the
**Playwright MCP** server registered in the repo (`.mcp.json`) so the UI can be
driven interactively during development; npm scripts and CI notes.
**Out:** cross-browser matrix (Chromium only for now); visual-regression snapshots;
testing the deployed/production Supabase project (local stack only); load/perf
testing; mobile-device emulation beyond the default viewport.

## 3. Prerequisites
- The Supabase local stack from Stage 8 (`pnpm local:up`) running, with migrations
  applied and the dev account seeded (`dev@steadydose.local` / `DevPassw0rd!`,
  `supabase/seed.sql`).
- Client config pointing at the local stack (`pnpm local:env` writes `.env.local`
  with `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`).
- The sync engine (Stage 5) and Supabase backend port (Stage 8): the app pushes
  local mutations to the `records` table via the `push_records` RPC.

## 4. Functional requirements
- FR-E2E-1. The suite runs in a **real browser** (Chromium) against the running app,
  starting from a clean browser context (empty IndexedDB) per test.
- FR-E2E-2. Tests run with the app **configured for the local Supabase stack** so
  auth and sync are live — not in local-first-only mode.
- FR-E2E-3. The flagship spec covers **initial user setup**: sign in with the dev
  account, then create **three medications** and group them into **mixed time-slots
  across the day** (e.g. a morning group and an evening group, with at least one
  medication appearing in more than one slot) entirely through the UI.
- FR-E2E-4. After the UI flow, the suite **asserts the database** directly: the
  `records` table contains the expected `medication` and `slot` rows for the signed-in
  user, with correct typed payloads (names, units, slot times, and slot `items`
  referencing the right medication ids and doses).
- FR-E2E-5. Each test is **self-isolating**: it clears the dev user's `records` rows
  before running, so re-runs are deterministic and order-independent.
- FR-E2E-6. The **Playwright MCP** server is registered in the repo so a developer
  (or an agent) can drive the live UI for exploration/debugging; the automated suite
  itself does not depend on the MCP server being connected.

## 5. Technical approach
- **Runner:** `@playwright/test`, config in `playwright.config.ts`. `testDir: ./e2e`,
  Chromium project, `baseURL` from `E2E_BASE_URL` (default `http://localhost:5173`).
  A `webServer` block runs `pnpm dev` and reuses an already-running dev server
  locally (`reuseExistingServer`), so the existing `.env.local` (Supabase config) is
  picked up by Vite automatically.
- **DB assertions:** a small helper (`e2e/helpers/db.ts`) opens a `pg` pool to the
  local Postgres (`SUPABASE_DB_URL`, default
  `postgresql://postgres:postgres@127.0.0.1:54322/postgres`). It resolves the dev
  user id from `auth.users` by email, can **clear** that user's `records` rows
  (test isolation, FR-E2E-5), and reads back rows by `type`. This is the same table
  the `push_records` RPC writes — asserting it proves the full round-trip.
- **Global setup:** `e2e/global-setup.ts` fails fast with an actionable message if
  the Supabase stack is unreachable, so a missing `pnpm local:up` is a clear error
  rather than a confusing timeout.
- **Page interactions:** built on accessible locators (the editors already expose
  `aria-label`s for every field; the `SyncIndicator` exposes `data-sync-phase`),
  with small reusable helpers (`e2e/helpers/app.ts`) for sign-in, add-medication,
  add-slot, and trigger-sync.
- **Sync determinism:** after building the schedule the test clicks **Sync now** and
  waits for `data-sync-phase="synced"`, then asserts the DB with `expect.poll` so a
  debounced auto-sync vs. the manual sync can't race the assertion.
- **MCP:** `.mcp.json` registers `@playwright/mcp` (project scope) so the live UI can
  be driven interactively; kept independent of the headless suite.
- **Scripts:** `pnpm test:e2e` (run), `pnpm test:e2e:ui` (Playwright UI mode),
  `pnpm test:e2e:report` (open last report).

## 6. Tasks
1. Add `@playwright/test`, `pg`, `@types/pg` to dev dependencies; install Chromium.
2. Register the Playwright MCP server in `.mcp.json`.
3. Write `playwright.config.ts` (Chromium project + managed `webServer`).
4. Write the DB helper (`e2e/helpers/db.ts`) and app helper (`e2e/helpers/app.ts`),
   plus `e2e/global-setup.ts` (stack reachability check).
5. Write the first-run setup-flow spec (`e2e/setup-flow.spec.ts`): sign in → 3 meds →
   mixed slots → sync → DB assertions.
6. Add `test:e2e*` scripts; ignore Playwright artifacts in git; keep lint/typecheck
   green for the new `e2e/` dir.
7. Run the suite against the local stack and confirm green.

## 7. Acceptance criteria
- AC1. Given the local Supabase stack is running, when `pnpm test:e2e` runs, the
  setup-flow spec passes in a real browser.
- AC2. Given the spec signs in and builds the schedule through the UI, when it
  inspects the database, the `records` table holds exactly **three** `medication`
  rows (correct names/units) and the expected **slot** rows for the dev user.
- AC3. Given the mixed-group schedule, when the slot rows are inspected, each slot's
  `items` payload references the correct medication ids and doses, and at least one
  medication appears in more than one slot.
- AC4. Given a prior run left data, when the spec runs again, it still passes (clears
  the dev user's rows first) — i.e. runs are deterministic and repeatable.
- AC5. Given the Supabase stack is **not** running, when the suite starts, it fails
  with a clear "start the stack" message rather than an opaque timeout.
- AC6. Given the repo, when opened in a Playwright-MCP-capable client, the MCP server
  is available from `.mcp.json` and can drive the live app.

## 8. Test plan
- Happy path: full setup flow green; DB rows match (AC1–AC3).
- Repeatability: run twice back-to-back; both green (AC4).
- Negative: stop the stack → suite errors fast with guidance (AC5).
- Lint/typecheck/format remain green with the new `e2e/` sources.

## 9. Risks / decisions
- **Secrets:** the suite uses only the local dev stack's well-known credentials
  (the seeded dev account and the standard `postgres:postgres` local DB URL). No
  real secrets enter the repo or prompts; `.env.local` stays git-ignored. The
  service-role key is never needed (the test reads Postgres directly).
- **Flake from sync timing:** mitigated by an explicit "Sync now" + `synced` wait and
  `expect.poll` DB assertions.
- **Cross-test contamination:** the dev account is shared across tests, so each test
  clears that user's `records` rows up front (FR-E2E-5); browser IndexedDB is clean
  per context automatically.
- **Decision:** assert the DB by connecting to Postgres directly (via `pg`) rather
  than through PostgREST with a service-role key — fewer moving parts, no extra
  secret in client reach, and it inspects the exact table the RPC writes.
- **Decision:** Chromium-only for now; the cross-browser matrix is out of scope until
  the flow is stable.

## 10. Definition of done
All ACs pass; `pnpm test:e2e` is green against the local Supabase stack; the suite
clears state for deterministic re-runs; the Playwright MCP server is registered;
lint/typecheck/format remain green; Stage 10 is documented here and referenced from
the implementation plan.
</content>
</invoke>
