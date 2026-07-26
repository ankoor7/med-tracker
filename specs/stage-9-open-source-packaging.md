# Stage 9 Spec — Open-Source Packaging & Deploy (Supabase)

| | |
|---|---|
| **Depends on** | Stage 8 (Supabase re-platform); the full feature set (Stages 1–7) |
| **Implements** | FR-OSS-2..5; bring-your-own-Supabase release |
| **Milestone** | E (open-source release) |
| **Status** | Partial — LICENSE/README/SECURITY.md and one-command `pnpm deploy` done; setup wrapper, `DEPLOY.md`/`EXTENSION.md`/`CONTRIBUTING.md`, and CI release-hardening (FR-9.1/9.2/9.5/9.6) outstanding |

## 1. Objective
Make SteadyDose a clean **open-source project that any technical user can stand up
on their own free Supabase project** (plus a static host) in minutes, configure
their own medications, and **plug in their own pharmacology equations**. Provide
complete docs, security guidance, and a swappable extension. This stage ships the
project that **runs on the Stage 8 substrate** — Supabase (GoTrue + Postgres + RLS +
PostgREST/RPC) and a static PWA host — not the retired AWS stack.

## 2. Scope
**In:** one-command setup over the Supabase CLI + generated client config;
setup/teardown docs; LICENSE + contributing/security policy; secrets guidance
(anon vs service-role key); documented pharmacology extension guide + example;
first-run onboarding (create account + sign in; optional MFA + on-device lock);
minimal release hardening (CSP, dependency audit).
**Out:** hosted multi-tenant offering; app-store distribution (PWA install only).

## 3. Prerequisites
The Supabase backend and simplified client from **Stage 8** (auth, `records` table
+ RLS, `push_records` RPC, server-side validation), plus the local store (Stage 2),
sync (Stage 5), and the feature stages (6–7).

## 4. Functional requirements
- FR-9.1. A documented **one-command setup** path: a wrapper that runs
  `supabase link` → `supabase db push` (applies the Stage 8 migrations) → builds
  the PWA → deploys it to the chosen static host, using the operator's own Supabase
  access token. Targets a fresh, empty Supabase project.
- FR-9.2. The linked project's URL + **anon key** generate the client config
  (`.env.production` / `app-config.json`) automatically; no manual ID copying. The
  **service-role key is never written into client config or the bundle.**
- FR-9.3. Docs let a new user create a Supabase project, run setup, create their
  account, sign in (optionally enabling MFA and the on-device lock), configure
  meds/schedule, and start logging.
- FR-9.4. The **pharmacology extension** is documented and swappable with a worked
  example; replacing it requires no other code changes.
- FR-9.5. Repository contains LICENSE, README, SECURITY/contributing notes; **no
  secrets**; security guidance mandates that only the publishable **anon key** ships
  to the client (RLS is the protection), the **service-role key stays secret**, and
  the Supabase access token is kept out of the repo and prompts.
- FR-9.6. A documented **teardown** path removes the user's data/project (`supabase
  db reset` to wipe data, or project deletion via dashboard/CLI); docs advise
  exporting first (the Stage 7 JSON/CSV export).

## 5. Technical approach
- **Setup wrapper:** a script/Make target chaining `supabase link` (idempotent),
  `supabase db push`, `pnpm build`, and a static deploy (`wrangler pages deploy
  dist` by default; Netlify/Vercel/GH Pages documented). Prints the app URL; writes
  the client config.
- **Config generation:** read the project ref → fetch URL + anon key (CLI/dashboard)
  → emit `.env.production` / client config; never hardcode keys. Mirrors the
  Stage 8 `BackendConfig` (`supabaseUrl`, `supabaseAnonKey`).
- **Docs set:**
  - `README` — what/why/quickstart (local-first; free Supabase; static host).
  - `DEPLOY.md` — prereqs (Supabase account + access token, a static-host account,
    Node/pnpm); step-by-step (create project → `supabase link` → `db push` → build →
    deploy); free-tier notes incl. **idle-pause** caveat; teardown.
  - `SECURITY.md` — the **non-zero-knowledge** model (the backend can read your data;
    secured by per-user **RLS**, GoTrue auth, **TLS in transit**, Postgres
    **encryption at rest**, optional MFA + on-device lock); **anon vs service-role
    key** handling; threat notes.
  - `EXTENSION.md` — the `DoseAdjustmentStrategy`/`levelSeries` contract + a worked
    example.
  - `LICENSE` (e.g. MIT).
- **Onboarding:** first-run wizard — config check → create user / sign in (GoTrue)
  → optionally enable MFA (Supabase TOTP) and the on-device lock → optional sample
  data.
- **Extension example:** a sample strategy file (clearly a template, not medical
  advice) showing where equations go and that outputs are cap-validated.
- **Release hardening:** strict CSP for the PWA (allow only the project's Supabase
  origin); dependency audit in CI; production build checks; secret scan.

## 6. Tasks
1. Build the one-command setup wrapper (`supabase link`/`db push` + build + static
   deploy) and config generation.
2. Write `README`, `DEPLOY.md`, `SECURITY.md`, `EXTENSION.md`, add `LICENSE`.
3. Implement the first-run onboarding wizard (create account / sign in; optional
   MFA + on-device lock).
4. Add the example extension strategy and document the contract.
5. Add CSP (Supabase origin), dependency audit + secret scan to CI, and a teardown
   path with an export-first reminder.
6. Validate end-to-end on a brand-new, empty Supabase project from docs only.

## 7. Acceptance criteria
- AC1. Given a fresh Supabase project and the docs, when a new user follows
  `DEPLOY.md`, the full app is running in **< 20 minutes** (no AWS bootstrap step).
- AC2. Given setup completes, when the client starts, it uses the generated config
  (project URL + anon key) with no manual ID entry, and **no service-role key is in
  the bundle**.
- AC3. Given the example extension is replaced per `EXTENSION.md`, when a late dose
  is logged, the new equations drive the suggested dose and it is cap-validated —
  with no other code changes.
- AC4. Given the repo, when scanned, it contains no secrets and the docs mandate the
  anon-only-in-client rule, service-role secrecy, and access-token handling.
- AC5. Given onboarding, when completed, the user has a working account and is signed
  in (and, if chosen, MFA and the on-device lock are enabled).
- AC6. Given teardown is run, when complete, the user's data/project is removed
  (export-first advised).

## 8. Test plan
- Fresh-project dry run from docs only (record the timing for AC1).
- Extension swap test (AC3) with a trivial example strategy.
- Secret-scan in CI (catches a leaked service-role key); CSP smoke; dependency audit.
- Teardown verification (`supabase db reset` wipes data; RLS still blocks
  cross-user access).

## 9. Risks / decisions
- Open-source users leaking the **service-role key** (full DB access, bypasses RLS)
  → docs and scripts make the anon/service-role split explicit; the key never enters
  client config, the bundle, a commit, or any prompt; secret-scan in CI.
- Keep the extension boundary the **only** thing a self-hoster must touch for
  pharmacology — protects the safety model and lowers the bar to adopt.
- Free-tier **idle-pause** (projects sleep after inactivity) and the
  **non-zero-knowledge** trade-off (the backend can read your data; secured by RLS,
  auth, TLS, at-rest encryption) are stated plainly in docs (no over-promising).

## 10. Definition of done
All ACs pass; a fresh Supabase project deploys from docs within target time; the
extension is swappable with a worked example; secure-by-default docs and scripts
(anon-only client, service-role secret); teardown clean; release-hardening (CSP,
audit, secret-scan) in place.
