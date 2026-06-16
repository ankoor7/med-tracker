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
| Production build | `pnpm build`      |
| Preview build    | `pnpm preview`    |

`pnpm typecheck` covers both the app (`tsc -b`) and `infra/` (`tsconfig.infra.json`).

### Local AWS dev (Stage 3) — needs Docker

| Task                       | Command                                |
| -------------------------- | -------------------------------------- |
| Start LocalStack + Cognito | `pnpm local:up`                        |
| Create table/pool/dev user | `pnpm local:bootstrap`                 |
| Run local sync API         | `pnpm local:api`                       |
| Stop / wipe                | `pnpm local:down` / `pnpm local:reset` |

Dev account: `dev@steadydose.local` / `DevPassw0rd!`. Real AWS deploy: `pnpm deploy`
(see `infra/README.md`). CDK: `pnpm cdk:synth` / `cdk:deploy` / `cdk:destroy`.

CI (`.github/workflows/ci.yml`) runs typecheck → lint → test → build on push/PR.
A husky pre-commit hook runs `lint-staged` + `typecheck`.

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
- `src/auth/` — Cognito client (`amazon-cognito-identity-js`) + `useAuth` hook.
- `src/sync/` — authorized API client (Stage 3); full sync engine in Stage 5.
- `src/config.ts` — backend config from `VITE_*` env (null = local-first only).
- `infra/` — backend: shared `sync/` handler-core, `lambda/` adapter, `local/`
  dev server + bootstrap (LocalStack + cognito-local), `cdk/` stack. See
  `infra/README.md`. Linted-exempt but typechecked (`tsconfig.infra.json`) and
  tested (Node env via `environmentMatchGlobs`).
- `specs/` — product, architecture, and per-stage specs (source of truth).

### Rules

- **Time:** store every event as a UTC `Instant` (epoch ms). Resolve schedule
  wall-times in the app's **active zone**, never the host zone implicitly.
- **Safety:** the app never originates a dose value; it records and validates.
  Guardrail checks live in one shared function (`core/guardrails.ts`).
- **No secrets** in the repo or in prompts. Only `.env.example` is committed.
- TypeScript is **strict**. Keep `pnpm typecheck` and `pnpm lint` green.

## Git conventions

- Default working branch is `main`. Branch before committing if on `main`.
- Conventional-ish commit subjects (e.g. `feat(core): add schedule enumeration`).
