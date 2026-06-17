# SteadyDose

A **local-first, offline-capable PWA** for people on fixed daily medication
schedules (built for anti-epileptic regimens). It manages a grouped daily
schedule, lets you log an **adjusted dose** when you're late, enforces your own
safety guardrails, and keeps secure history that syncs to **your own Supabase
project** — a backend you own and control (secured by login, TLS, Row-Level
Security, and encryption at rest; readable by your own server, not zero-knowledge).

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

That's it for offline use. To enable **cloud sync** (auth + multi-device) you
need the [Supabase CLI](https://supabase.com/docs/guides/cli) + Docker:

```bash
pnpm local:up     # start Postgres + GoTrue + PostgREST + Studio (supabase start)
pnpm local:env    # write .env.local from the running stack
pnpm dev          # sign in with dev@steadydose.local / DevPassw0rd!
```

See [`supabase/README.md`](./supabase/README.md) for the schema, local dev, and
bring-your-own-Supabase deploy.

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
| `src/crypto/` | Optional on-device cache lock (Web Crypto AES-GCM).             |
| `src/sync/`   | Sync engine + the Supabase `SyncBackend` (PostgREST + RPC).     |
| `src/auth/`   | Supabase GoTrue auth client + `useAuth` hook.                   |
| `supabase/`   | Backend: migrations (table + RLS + RPC), seed, pgTAP tests.     |
| `specs/`      | Source-of-truth specs.                                          |

## Status

Built in [9 sequenced stages](./specs/03-implementation-plan.md). Through
**Stage 8**:

- **0–2** — reproducible dev setup, domain core + UI, local IndexedDB
  persistence (a usable offline single-device app).
- **3–5** — per-user cloud backend, readable+validated record model + security
  hardening, and the bidirectional LWW sync engine.
- **6–7** — reminders/notifications and history/charts + export.
- **8** — **re-platformed off AWS onto Supabase** (GoTrue + Postgres + RLS +
  PostgREST), collapsing the custom sync API into one table, one policy set, and
  one `push_records` function. See [`supabase/README.md`](./supabase/README.md).

Open-source packaging & one-command deploy (9) is still to come.

## License

MIT — see [`LICENSE`](./LICENSE).
