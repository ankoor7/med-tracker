# Stage 18 — Execution Plan (Capacitor App Store packaging)

Companion to `specs/stage-18-app-store-packaging.md` (the *what/why*). This is the
*how / in what order*, with verification gates and rough effort. Investigation
backing: `spikes/2026-06-20-capacitor-app-store-mechanics.md`. Registered in
`specs/03-implementation-plan.md` as Stage 18 (Milestone F).

**Goal of this stage:** the current app, **local-first**, on the **App Store** as a
native iOS build with **reliable closed-app reminders** — no backend, no account, no
iCloud (iCloud is Stage 19).

**Total effort (eng):** ~3–5 focused days, plus Apple Developer enrolment latency
(can run in parallel from day 0). Phases B–E are the critical path; Phase A (Apple
account) is parallel and gates only the final submit.

---

## Track A (parallel, start day 0) — Apple operational setup
Not code; start immediately because enrolment can take ~a day to activate.

- A1. Enrol in the **Apple Developer Program** ($99/yr).
- A2. Reserve the app name **SteadyDose** in **App Store Connect**; create the app
  record with bundle id **`app.steadydose.app`**.
- A3. Publish a **privacy policy URL** (a short page: "data is stored on your device;
  we collect nothing"). Needed for the App Store listing.
- A4. Decide the **display name**, subtitle, category (Medical or Health & Fitness),
  and age rating; draft the listing copy + the medical disclaimer text.

**Gate A (needed only before Phase E):** active Developer Program membership, the App
Store Connect record, and the privacy policy URL exist.

---

## Phase B — Scaffold + native build flavour
*Effort ~½ day. Spec tasks 1–2, 5 (suppression). Gate: AC1, AC5.*

- B1. Add deps: `@capacitor/core @capacitor/ios`, dev `@capacitor/cli
  @capacitor/assets`, plus `@capacitor/local-notifications @capacitor/app
  @capacitor/status-bar @capacitor/splash-screen`.
- B2. `npx cap init SteadyDose app.steadydose.app --web-dir dist`; write
  `capacitor.config.ts` (no `server.url`). `npx cap add ios`. Add `ios/` build
  artifacts to `.gitignore`; add `package.json` scripts (`cap:sync`, `ios:build`).
- B3. Add the **`CAP_BUILD`** flag to `vite.config.ts` so the native build **omits
  `VitePWA`** (no Workbox SW). Produce the native build with **no `VITE_SUPABASE_*`**
  → `getBackendConfig()` is `null`.
- B4. Hide account/sign-in/sync UI when `Capacitor.isNativePlatform()`.

**Gate B:** `CAP_BUILD=1 pnpm build && npx cap sync ios && npx cap open ios` launches
the app in the iOS simulator, **offline**, to the working local-first UI; **no SW
registered, no Supabase client instantiated** (AC5). The plain `pnpm build` (web)
still emits the PWA SW + Supabase path unchanged (AC1).

---

## Phase C — Native notification adapter (the core of the stage)
*Effort ~1–2 days. Spec tasks 3–4. Gate: AC2, AC3, AC4.*

- C1. `src/reminders/localNotifications.ts`: `toIntId` (string→int31), a **≤60
  soonest-first rolling window**, `syncLocalNotifications(reminders)`
  (cancel-pending → schedule), a `TAKE` action type, and `extra =
  { id, slotId, scheduledInstant }`.
- C2. `localNotificationActionPerformed` listener → record the scheduled take via the
  existing store action (no amount — FR-6.6).
- C3. Branch `reminders/useReminders.ts`: native → `syncLocalNotifications` on
  data/zone/pref change **and** on `App` `resume`; web → unchanged. Add the native
  permission branch in `reminders/notifications.ts`.
- C4. Unit tests against a **mocked `LocalNotifications`** (payload shape, cancel
  before reschedule, cap, id stability, action wiring).

**Gate C (device/simulator):** with reminders on and the **app fully closed**, a dose
reminder fires natively at the right local time (AC2); scheduling stays ≤64 and
reschedules on resume with no duplicates (AC3); "Mark taken" records the scheduled
dose only (AC4); permission-denied still yields in-app catch-up (FR-18.5).

---

## Phase D — Assets + chrome
*Effort ~½ day. Spec task 6. Gate: AC6.*

- D1. Provide a 1024² master icon; `npx capacitor-assets generate --ios` for
  icons/splash.
- D2. `@capacitor/status-bar` config + CSS `env(safe-area-inset-*)` padding (viewport
  already `viewport-fit=cover`).

**Gate D:** icon + splash render; content clears the notch / Dynamic Island / home
indicator; status bar legible (AC6).

---

## Phase E — Compliance, build & submit
*Effort ~1 day + review latency. Spec tasks 7–8. Gate: AC7, Gate A.*

- E1. Xcode: Team + "Automatically manage signing"; version/build number; set
  `ITSAppUsesNonExemptEncryption=false` in `Info.plist`.
- E2. App Store Connect: **privacy labels = Data Not Collected**; attach the privacy
  policy URL; finalize listing + medical disclaimer; add **review notes** ("no account
  required; data is local; reminders are native — try offline").
- E3. `Product ▸ Archive ▸ Distribute ▸ App Store Connect ▸ Upload` → **TestFlight**
  (internal testers, no review) → smoke on a real device → **submit for App Review**.

**Gate E (definition of done):** build on TestFlight and submitted for App Review with
accurate labels, policy URL, encryption flag, and disclaimer (AC7).

---

## Cross-cutting
- **CI builds both flavours** (web + `CAP_BUILD`) so a native change can't regress the
  PWA/Supabase path (risk in spec §9).
- **No secrets** (unchanged rule): no signing assets, no production keys in the repo.
- **Safety invariant** holds end-to-end: notifications never carry a dose amount
  (FR-6.6 / AC4).

## "Ready to submit" checklist
- [ ] Native build launches offline to the local-first UI; web build unchanged (AC1)
- [ ] Closed-app native reminder fires at the right local time (AC2)
- [ ] ≤64 pending; resume reschedules; no duplicates (AC3)
- [ ] "Mark taken" records the scheduled dose, no amount (AC4)
- [ ] No Supabase client / no account UI / no SW on native; Dexie survives relaunch (AC5)
- [ ] Icon + splash + safe-area + status bar (AC6)
- [ ] Privacy labels "Data Not Collected" + privacy policy URL (AC7, Gate A)
- [ ] `ITSAppUsesNonExemptEncryption=false`; medical disclaimer in-app + listing
- [ ] Demo/no-account review notes written
- [ ] Apple Developer Program active; App Store Connect record created (Gate A)

## Hand-off to Stage 19 (iCloud sync, point release)
After Stage 18 ships, add cross-device sync **without a developer backend** — data
stays in the user's iCloud. Recommended path (spike §3.1): the **whole-dataset blob**
in the iCloud Documents container, reusing `store/transfer.ts`
(`exportJSON`/`parseImport` + `mergeDatasets(...,'merge')`, which already does
per-record LWW). Higher-fidelity alternative (spike §3.2): a record-level CloudKit
backend implementing the injectable `SyncBackend` port (`sync/syncEngine.ts:28-33`).
Either needs the iCloud capability + container; neither adds an app account or a
deletion gate.
