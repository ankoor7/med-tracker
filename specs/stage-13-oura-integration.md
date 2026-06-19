# Stage 13 Spec — Oura Ring Health Data & Correlation Visualisations

| | |
|---|---|
| **Depends on** | Stage 1 (core + adherence), Stage 2 (local store), Stage 7 (History charts) |
| **Implements** | FR-13.1 … FR-13.6 |
| **Milestone** | C (daily-driver polish) |
| **Status** | Ready — auth is **mock-only** for now |

## 1. Objective
Bring **Oura Ring** health data into SteadyDose so the user can eyeball whether
their wellbeing tracks their medication adherence. We ingest **Daily Readiness**
and **Daily Stress** from the Oura API v2, normalise them into one per-day
summary, and overlay those metrics on the existing adherence timeline, with a
plain-English correlation read-out.

This stage ships the full data path **offline against a deterministic mock**. Live
OAuth/token auth is intentionally **not** wired — a clearly-marked seam is left for
it (see §6).

## 2. Scope
**In:** Oura v2 schema modelling (Daily Readiness + Daily Stress), a typed API
client (mock + real-HTTP), offline fixtures, timezone-correct daily bucketing,
correlation/overlay math (all pure, in `src/core`), a local cache, a server-table
migration mirroring `records`, and a History-screen panel with an overlay chart.
**Out:** live OAuth/token auth and refresh; ingesting other Oura collections
(sleep, activity, heart-rate, sessions); server-side ingest of the cache; causal
inference (we surface correlation only, with a "not medical advice" caveat).

## 3. Oura API v2 schemas used
Base: `https://api.ouraring.com`. Auth (when wired): `Authorization: Bearer <token>`.
Both endpoints accept `start_date`/`end_date` (`YYYY-MM-DD`) and paginate via
`next_token`; the response envelope is `{ data: T[], next_token: string | null }`.

- **`GET /v2/usercollection/daily_readiness`** → `DailyReadinessModel`:
  `{ id, contributors{…}, day, score (1-100|null), temperature_deviation,
  temperature_trend_deviation, timestamp (ISO-8601 w/ offset) }`.
- **`GET /v2/usercollection/daily_stress`** → `DailyStressModel`:
  `{ id, day, stress_high (sec|null), recovery_high (sec|null),
  day_summary ('restored'|'normal'|'stressful'|null) }`.

Modelled verbatim in `src/core/oura.ts` (`OuraDailyReadiness`, `OuraDailyStress`,
`OuraCollectionResponse<T>`).

## 4. Data model
- **Normalised summary (`OuraDaySummary`)** — one row per calendar day:
  `{ day, readinessScore, temperatureDeviation, readinessInstant,
  stressHighSeconds, recoveryHighSeconds, stressDaySummary }`. Missing metrics
  stay `null`. This is what the store caches and the UI overlays.
- **Local cache** — Dexie table `ouraDaily` (key `day`), repository methods
  `loadOura()` / `saveOura()` (full-snapshot replace). It is **not** a synced
  `record`: external health data has its own table and is replaced wholesale per
  fetch, so it never enters the `records` outbox/LWW path.
- **Server mirror** — `supabase/migrations/0003_oura_daily.sql`: an `oura_daily`
  table with the **same isolation pattern as `records`** (per-user PK, RLS on
  `auth.uid()`, `authenticated`-only grants). Shipped now to set the pattern;
  client write-through is part of the auth-wiring follow-up (§6).

## 5. Timezone-correct bucketing (Time rule)
Per CLAUDE.md, events are absolute instants bucketed into a day in the app's
**active zone**, never the host zone:
- **Readiness** carries an absolute `timestamp`, so its day is
  `isoDateInZone(Date.parse(timestamp), zone)` — this keeps Oura days aligned with
  the adherence timeline even when the app zone differs from the ring's account
  zone. If the timestamp is unparseable we fall back to the document `day`.
- **Stress** has no timestamp in v2, so we use its provided `day` (documented
  limitation; revisit if Oura adds a timestamp).

## 6. Mock / auth seam
- **`OuraClient`** port: `getDailyReadiness(range)` / `getDailyStress(range)`.
- **`MockOuraClient`** (default): deterministic synthetic data from
  `generateOuraFixtures(range)` — fully offline, seeded per date, with a mild
  inverse stress↔readiness relationship so correlations are believable. Static
  shape-accurate fixtures (`FIXTURE_READINESS`/`FIXTURE_STRESS`) back the tests.
- **`HttpOuraClient`** (real, fully implemented): fetch against the documented
  endpoints, cursor pagination, `OuraApiError` on non-2xx. It pulls its bearer
  token from an injected **`OuraAuthProvider`** — **THE AUTH SEAM**.
- **`config.ts` / `parseOuraConfig`**: defaults to `mock`; only enters `live` when
  **both** `VITE_OURA_MODE=live` and `VITE_OURA_ACCESS_TOKEN` are present, so the
  app can never silently break into a tokenless live mode. No secrets in the repo;
  `.env.example` documents the vars commented-out.
- **`registry.ts`** (`getOuraClient`/`setOuraClient`): mirrors `store/repository.ts`
  so the store never hard-wires mock vs live and tests can inject a stub.

**What's left for real auth:** implement an `OuraAuthProvider` that performs the
OAuth2 Authorization-Code flow (or stores a Personal Access Token), persists +
refreshes the access token, and flip the config to `live`. Optionally add a
client → `oura_daily` write-through after fetch.

## 7. Correlation / overlay (pure, `src/core/oura.ts`)
- `normalizeOuraData(readiness, stress, zone)` → sorted `OuraDaySummary[]`.
- `buildOuraOverlay(summaries, adherenceDays)` → `OuraOverlayPoint[]` joining each
  Oura day to that day's adherence ratio (`taken/expected`, `null` when nothing was
  expected so a no-dose day never reads as 0%). The adherence timeline
  (`adherenceTimeline`, Stage 7) supplies the x-axis.
- `pearson(xs, ys)` → Pearson r ignoring null-paired positions; `null` when < 2
  pairs or a series has zero variance.
- `correlateAdherence(points, metric)` → `{ metric, coefficient, n }` for
  `'readiness'` (score) or `'stress'` (high-stress minutes) vs adherence.

## 8. Visualisation
- `OuraCorrelationChart` — hand-rolled SVG (no new dependency; matches
  `AdherenceChart`/`BloodLevelChart` and the small-bundle NFR): faint adherence
  bars in the background, the selected Oura metric as a line+dots (readiness on a
  fixed 0-100 axis; stress scaled to its own max), gaps where data is missing.
- `OuraPanel` (in `HistoryScreen`) — a **Connect Oura (mock)** / **Refresh**
  button (`store.syncOura`), a Readiness/Stress metric toggle, the chart, the
  plain-English correlation read-out with `n` days and last-synced time, and a
  "correlation is not causation / not medical advice" caveat.

## 9. Store
`syncOura()` computes a 30-day window ending today (active zone), fetches via the
active client, normalises, awaits the local cache save, then exposes
`ouraSummaries` / `ouraStatus` / `ouraLastSyncedAt` / `ouraError`. `hydrate()`
rehydrates the cache so data survives reload. Errors are caught and surfaced
without crashing the screen.

## 10. Functional requirements
- FR-13.1. Model Daily Readiness + Daily Stress v2 schemas exactly.
- FR-13.2. Provide a typed client with an offline mock default and a real HTTP
  implementation behind an auth seam; ship deterministic fixtures.
- FR-13.3. Normalise to one per-day summary, bucketed in the active zone.
- FR-13.4. Overlay a chosen Oura metric on adherence over time and report a
  correlation coefficient + sample size; keep all maths pure in `src/core`.
- FR-13.5. Cache fetched data locally so it renders offline and across reloads.
- FR-13.6. Add a server `oura_daily` table mirroring the `records` RLS pattern.

## 11. Acceptance criteria
- AC1. With no env, tapping **Connect Oura (mock)** loads ~30 days of readiness +
  stress and renders the overlay chart against adherence.
- AC2. A readiness `timestamp` near midnight buckets to the correct day in the
  active zone (verified across `Europe/London` vs `America/New_York`).
- AC3. `pearson` returns 1/−1 for perfect ±linear series, `null` for < 2 pairs or
  zero variance, ignoring null pairs.
- AC4. The metric toggle switches the overlaid line; days without Oura data show a
  line gap, not a zero.
- AC5. Synced data survives a reload (loaded from the `ouraDaily` cache).
- AC6. A client error sets `ouraStatus: 'error'` and shows a message; the rest of
  History keeps working.
- AC7. `HttpOuraClient` sends `Bearer` auth + date params, follows `next_token`,
  and throws `OuraApiError` on non-2xx; with no token it throws 401 (seam unwired).

## 12. Test plan
- Core (`oura.test.ts`): normalisation/merge, zone bucketing, `pearson` edge cases,
  overlay join + ratio nulls, `correlateAdherence` sign/n.
- Client (`ouraClient.test.ts`): mock determinism, config parsing (mock vs live),
  HTTP token/params/pagination/error/401.
- Store (`oura.store.test.ts`): syncOura happy path, 30-day window, cache reload,
  error handling.

## 13. Risks / decisions
- **Correlation, not causation.** Surface r as an insight aid only, with a caveat;
  no clinical claims.
- **External data is cached, not synced.** Keeping it out of the `records` LWW set
  avoids polluting the user-authored sync stream; the server table is the future
  home once auth + ingest are wired.
- **Stress lacks a timestamp** in v2 → bucketed by Oura's `day`. Acceptable; noted.
- **Mock vs live** is a single factory switch; live is inert until a token exists.

## 14. Definition of done
All ACs pass as unit tests; `pnpm typecheck`/`lint`/`test` green; the History panel
loads mock Oura data and charts readiness/stress against adherence; the auth seam
and server migration are in place and documented for the live-auth follow-up.
