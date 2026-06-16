# SteadyDose

A **local-first, end-to-end-encrypted PWA** for people on fixed daily medication
schedules (built for anti-epileptic regimens). It manages a grouped daily
schedule, lets you log an **adjusted dose** when you're late, enforces your own
safety guardrails, and keeps encrypted history that syncs to **your own AWS
account**.

> **Safety:** SteadyDose computes **no pharmacology**. It records and validates
> doses against caps you set; any dose suggestion comes from a pluggable
> extension you supply. Not a medical device. Validate your regimen with a
> clinician.

See [`specs/`](./specs) for the product, architecture, and per-stage specs.

## Quickstart

Prerequisites: **Node.js ≥ 20** (22 LTS recommended; see `.nvmrc`) and
**pnpm** (`corepack enable pnpm`).

```bash
pnpm install
pnpm dev          # http://localhost:5173
```

### Common scripts

```bash
pnpm typecheck    # strict TypeScript, no emit
pnpm lint         # ESLint (incl. core/-no-React boundary)
pnpm test         # Vitest (run once)
pnpm test:watch   # Vitest (watch)
pnpm build        # production build + PWA manifest/service worker
pnpm preview      # serve the production build
```

## Project layout

| Path          | Purpose                                                         |
| ------------- | --------------------------------------------------------------- |
| `src/core/`   | Pure TypeScript domain core (no React) — the portable spine.    |
| `src/store/`  | Zustand store binding the core to the UI.                       |
| `src/ui/`     | React screens & components (Today / Schedule / Meds / History). |
| `src/crypto/` | Encryption (stub until Stage 4).                                |
| `src/sync/`   | Sync client (stub until Stage 5).                               |
| `infra/`      | AWS CDK stack (lands in Stage 3).                               |
| `specs/`      | Source-of-truth specs.                                          |

## Status

Built in [8 sequenced stages](./specs/03-implementation-plan.md). Currently
through **Stage 3**:

- **0–2** — reproducible dev setup, domain core + UI, local IndexedDB
  persistence (a usable offline single-device app).
- **3** — per-user backend (Cognito auth, JWT-protected `/sync/*` over DynamoDB,
  S3 + CloudFront) as a CDK stack, plus a **local Docker dev environment**
  (LocalStack + cognito-local) so you can develop without a real AWS account.
  See [`infra/README.md`](./infra/README.md).

Encryption (4), the full sync engine (5), reminders (6), history/charts (7), and
open-source packaging (8) are still to come.

## License

MIT — see [`LICENSE`](./LICENSE) (added in Stage 8).
