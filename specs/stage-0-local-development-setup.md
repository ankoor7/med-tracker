# Stage 0 Spec — Local Development Setup

| | |
|---|---|
| **Depends on** | — |
| **Enables** | Stage 1 (and all later stages) |
| **Milestone** | A (pre-build) |
| **Status** | Ready |

## 1. Objective
Establish a **reproducible local development environment** and an **empty-but-wired app shell** with a working dev loop — run, test, lint, typecheck, build — and **green CI**. After this stage, Stage 1 starts on features, not plumbing. No domain logic is built here.

## 2. Scope
**In:** developer prerequisites + install; repo initialisation and folder skeleton (matching architecture §4); toolchain config (TypeScript strict, Vite, Tailwind base, `vite-plugin-pwa` baseline); ESLint + Prettier; Vitest + Testing Library; pre-commit hooks; env handling + ignore files + Node pin; pnpm scripts; CI workflow; a placeholder app shell with one smoke test; README quickstart; Claude Code project context (`CLAUDE.md`).
**Out:** data model and screens (Stage 1); AWS/IaC (Stage 3); encryption (Stage 4); sync (Stage 5); real notifications (Stage 6); charts/export (Stage 7). Do **not** add feature dependencies (Dexie, crypto libs, charts) yet.

## 3. Prerequisites (developer machine)
- **Node.js ≥ 20 LTS** (22 LTS recommended), pinned via `.nvmrc`; **pnpm** (package manager; install via `npm install -g pnpm` or `corepack enable`).
- **Git**.
- An editor (VS Code suggested) with ESLint, Prettier, and Tailwind extensions.
- **Claude Code** (the build tool). Install via the **native installer** (recommended; no Node.js dependency) or via **pnpm**: `pnpm add -g @anthropic-ai/claude-code` — this path **requires Node.js 18+** (official setup docs: https://code.claude.com/docs/en/setup). Authenticate with a paid Anthropic account; behind a corporate proxy/firewall, use API-key auth.
- *Later (Stage 3, not required now):* AWS CLI v2 with SSO / named profile.

Keep this project in a **separate repo from corporate code**.

## 4. Setup requirements
- FR-0.1. Environment is reproducible: Node pinned (`.nvmrc`), lockfile committed.
- FR-0.2. `pnpm install` then `pnpm dev` serves a running app shell on localhost.
- FR-0.3. TypeScript in **strict** mode; `pnpm typecheck` passes.
- FR-0.4. ESLint + Prettier configured; `pnpm lint` / `pnpm format` work; a pre-commit hook runs them on staged files.
- FR-0.5. Test runner wired; `pnpm test` runs and a smoke test passes.
- FR-0.6. `pnpm build` produces a production bundle; `vite-plugin-pwa` emits a manifest + registers a service worker (baseline shell cache; **no notifications**).
- FR-0.7. CI runs typecheck + lint + test + build on push/PR and is **green** on the empty project.
- FR-0.8. Secrets/config: only `.env.example` is committed; `.gitignore` excludes env files, build output, and `node_modules`; **no secrets in the repo**.
- FR-0.9. Folder skeleton matches architecture §4; project conventions (scripts, branch/commit) documented.
- FR-0.10. `CLAUDE.md` documents build/test commands and conventions so Claude Code works effectively in the repo; `.claude/` settings/hooks added as desired.

## 5. Technical approach
- **Scaffold:** Vite **React + TypeScript** template. Add Tailwind (PostCSS + config) seeded with the architecture's design tokens (neutral slate chrome, teal accent) but **no components**. Add `vite-plugin-pwa` with a minimal manifest and `autoUpdate` registration.
- **Folder skeleton** (placeholders/`index.ts` stubs): `src/core/`, `src/store/`, `src/ui/`, `src/crypto/` (stub), `src/sync/` (stub); plus `infra/` (placeholder), `docs/` (these specs), `.github/workflows/`.
- **Quality:** ESLint (`typescript-eslint`, `react-hooks`, `import`) + Prettier. Scaffold an import-boundary rule reserving `src/core/` as React-free (enforced in Stage 1).
- **Hooks:** husky + lint-staged (or `simple-git-hooks`) running lint + typecheck on commit.
- **Scripts (`pnpm <script>`):** `dev`, `build`, `preview`, `typecheck`, `lint`, `format`, `test`, `test:watch`, `prepare`.
- **CI:** GitHub Actions on the pinned Node version with dependency caching; run typecheck → lint → test → build. (Dependency audit/CSP land in Stage 8.)
- **App shell:** minimal `App.tsx` rendering the title and four **tab placeholders** (Today / Schedule / Meds / History) with no logic — enough to install as a PWA and smoke-test.
- **Claude Code:** `CLAUDE.md` with commands + conventions; optional `.claude/` config consistent with your existing workflow.

## 6. Tasks
1. Verify prerequisites; install pinned Node, Git, and Claude Code (native or npm); authenticate Claude Code.
2. Initialise the repo; scaffold Vite React-TS; commit the lockfile; add `.nvmrc`, `.editorconfig`, `.gitignore`, `.env.example`.
3. Configure strict TypeScript, ESLint + Prettier, and pre-commit hooks + lint-staged.
4. Add Tailwind (base + token placeholders) and `vite-plugin-pwa` (minimal manifest + SW registration).
5. Create the folder skeleton and the `App.tsx` shell with four tab placeholders.
6. Add Vitest + Testing Library and one smoke test.
7. Add pnpm scripts and the GitHub Actions CI workflow.
8. Add `CLAUDE.md` (+ `.claude/` if desired) and a README quickstart.
9. Run the full loop locally and confirm CI is green.

## 7. Acceptance criteria
- AC1. Given a fresh clone, when running `pnpm install --frozen-lockfile` then `pnpm dev`, the app shell loads on localhost with no console errors.
- AC2. Given the empty project, when running `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build`, all pass.
- AC3. Given a staged change, when committing, the pre-commit hook runs lint + typecheck on staged files.
- AC4. Given a push/PR, when CI runs, it is green (typecheck + lint + test + build).
- AC5. Given `npm run build`, when inspected, a PWA manifest and service worker are emitted and the app is installable.
- AC6. Given the repo, when scanned, it contains no secrets — only `.env.example`; env/build/`node_modules` are gitignored.
- AC7. Given the repo, when `claude --version` is run and Claude Code is launched in it, `CLAUDE.md` provides the build/test commands and conventions.
- AC8. Given the skeleton, when inspected, folders match architecture §4 and the `core/`-no-React boundary rule is scaffolded.

## 8. Verification plan
- **Clean-clone dry run:** remove `node_modules`, run `pnpm install --frozen-lockfile`, then every script.
- Observe a **green CI** run.
- **PWA installability** smoke (e.g. Lighthouse) — manifest + SW present.
- Trial commit fires the **pre-commit** hook.

## 9. Risks / decisions
- **Decision:** pnpm as package manager. Claude Code **native installer recommended** (avoids Node version headaches); pnpm global install path documented for those who prefer it (needs Node 18+).
- Corporate proxy/firewall can block Claude Code OAuth → use **API-key auth**; keep this repo separate from corporate code.
- Hold back feature dependencies (Dexie, crypto, charts) until their stages to keep the baseline clean and the bundle small.
- **No secrets** in the repo or in any prompt (carries the architecture security model from day one).

## 10. Definition of done
All ACs pass; a teammate can clone and be productive within minutes; CI is green on the empty project; the app shell installs as a PWA; Stage 1 can begin against a fully wired skeleton.
