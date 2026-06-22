# Stage 18 Spec — Capacitor App Store Packaging (local-first iOS app)

| | |
|---|---|
| **Depends on** | Stage 1 (core), Stage 2 (local persistence), Stage 6 (reminder engine + `ScheduledReminder` model) |
| **Deliberately not** | Stage 8 (Supabase) — excluded from this build by design |
| **Implements** | FR-18.1 … FR-18.8; App Store (local-first) release; closes the FR-6.5 / FR-REM background-reminder concession |
| **Milestone** | F (native / App Store distribution) |
| **Status** | Draft |
| **Source** | `spikes/2026-06-20-capacitor-app-store-mechanics.md` (technical investigation) |

## 1. Objective
Ship the existing SteadyDose PWA to the **Apple App Store** as a native iOS app by
wrapping it in **Capacitor**, in its **local-first** configuration: on-device data
(Dexie), **native local notifications**, full offline, export/import — and **no
developer backend, no account, no Supabase** in this build. The headline win is
reliability: native OS scheduling fires reminders **while the app is closed and
offline**, retiring the web platform's concession that it "cannot reliably wake a
closed PWA" (`reminders/useReminders.ts:7-8`, FR-6.5). Cross-device **iCloud sync is
the planned follow-up (Stage 19)** and is explicitly out of scope here — this stage
ships a complete single-device native app first.

> The wrap is **additive**: the pure core, the Dexie store, and the sync *engine* are
> untouched. The work is a native `ios/` project, a build flag, one new reminder
> delivery adapter, and the App Store submission artifacts. See the companion
> execution plan: `specs/stage-18-app-store-packaging-plan.md`.

## 2. Scope
**In:** a Capacitor iOS project (`ios/`, `capacitor.config.ts`) wrapping the existing
Vite/React build; a **native build flavour** (`CAP_BUILD` flag) that omits the PWA
service worker and ships with **no Supabase env**, so the app runs its existing
local-first path; a **native local-notifications delivery adapter**
(`reminders/localNotifications.ts`) that consumes the *same* pure `ScheduledReminder[]`
the web layer uses, schedules a rolling window respecting the **iOS 64-pending cap**,
reschedules on launch/resume, preserves the **"Mark taken" no-dose-value invariant**
(FR-6.6), and uses the native permission flow; suppression of the Supabase/account/SW
surfaces on native; app **icons + splash** (PNG) and **safe-area / status-bar** chrome;
and the **submission pack** (Apple Developer Program, bundle id + signing, App Store
Connect record, privacy policy URL, "Data Not Collected" privacy labels, medical
disclaimer, encryption-exemption flag, no-account review notes, TestFlight → App
Review). The existing **web/PWA build is preserved unchanged**.
**Out:** **iCloud sync / any cross-device sync** (Stage 19); APNs / server push;
Android packaging; biometric app-lock and home-screen widgets; any Supabase, auth, or
multi-tenant capability in this build; dropping the dose-recalculation feature (a
separate product decision, not required for the wrap). This build neither originates a
dose nor adds clinical logic — it repackages the existing app.

## 3. Prerequisites
- The pure reminder model (`core/reminders.ts` → `computeDoseReminders` →
  `ScheduledReminder[]`, timing-only, no dose value) and the reminder engine
  (`reminders/useReminders.ts`) whose delivery layer is already pluggable
  (`reminders/notifications.ts`, `reminders/push.ts`).
- The local-first config path: `getBackendConfig()` returns `null` with no
  `VITE_SUPABASE_*` (`config.ts:15-29`), so `supabase/client.ts:21` never instantiates
  the client and the app is fully usable offline (Stage 2).
- The Vite/`vite-plugin-pwa` build (`vite.config.ts`) and the custom service worker
  (`src/sw.ts`) — both gated off in the native flavour.
- An Apple Developer account ($99/yr) and a macOS + Xcode toolchain for archiving.

## 4. Functional requirements
- FR-18.1. **Native iOS shell.** Capacitor wraps the existing built assets
  (`webDir: dist`), **bundled into the app** (no `server.url`), and launches to the
  working local-first UI. `Vite base` stays `/` (Capacitor serves `webDir` at the
  WebView root).
- FR-18.2. **Native local notifications.** Dose, follow-up, and missed-pattern
  reminders schedule via `@capacitor/local-notifications` from the *same*
  `ScheduledReminder[]` the engine already computes, and **fire while the app is
  closed and offline**, with no server.
- FR-18.3. **Rolling-window scheduling within the iOS cap.** At most ~60 pending
  notifications are scheduled at a time (iOS silently drops beyond 64); the soonest
  reminders are scheduled first, and the window is **rescheduled on app launch/resume**.
  Notifications are keyed by a stable id derived from the reminder id, so recomputes do
  not duplicate.
- FR-18.4. **"Mark taken" carries no dose value (FR-6.6).** A dose notification offers a
  "Mark taken" action that records the **already-scheduled** dose (the same semantics
  as `reminders/push.ts:71` `takeUrl`) — never an amount. A plain tap just opens the app.
- FR-18.5. **Native permission flow + honest degradation.** Reminders request OS
  permission via the native API; when denied or unavailable, the existing in-app
  catch-up path still surfaces what came due (FR-6.5 is preserved, not regressed).
- FR-18.6. **Local-first native build.** The native flavour ships with **no Supabase
  client, no account/sign-in UI, and no service worker registered**; data persists in
  Dexie across relaunch; offline is the normal mode. Account/sync affordances are hidden
  when running natively.
- FR-18.7. **App assets + chrome.** A native PNG app icon and splash screen are
  generated; the layout respects `env(safe-area-inset-*)` (notch / Dynamic Island /
  home indicator) and sets a legible status bar.
- FR-18.8. **Compliance + dual-build integrity.** The submission carries a privacy
  policy URL, **"Data Not Collected"** privacy labels (data is on-device only),
  `ITSAppUsesNonExemptEncryption=false`, and an in-app medical disclaimer; with no
  developer account there is **no in-app account-deletion requirement**. The **web/PWA
  build remains unchanged** (Supabase, auth, sync, service worker, Web Push all still
  work in that flavour).

## 5. Technical approach
- **Build flavour (`CAP_BUILD`).** A single env flag selects the native build:
  - `vite.config.ts` **omits `VitePWA`** when `CAP_BUILD` is set (no Workbox SW, no
    `registerSW` auto-injection) — the cleanest way to drop the SW that
    `injectRegister:'auto'` otherwise wires in.
  - The native build is produced with **no `VITE_SUPABASE_*`**, so `getBackendConfig()`
    is `null` and the local-first path is taken with zero code changes.
  - `Capacitor.isNativePlatform()` selects the native reminder adapter at runtime and
    hides account/sync UI. One `src/`, two `dist/` flavours.
  - The native build must **not inherit Stage 9's strict Supabase-origin CSP** (it has
    no Supabase origin and serves from a `capacitor://` scheme): keep that CSP web-only,
    or give the native flavour its own minimal policy. Like the SW and Supabase client,
    the web CSP is a Stage 9 surface this build must not carry (see
    `stage-9-open-source-packaging.md` §5).
- **Native notification adapter** (`src/reminders/localNotifications.ts`): takes
  `ScheduledReminder[]`, maps each to a Capacitor notification with `schedule.at =
  new Date(fireAt)`; a stable **string→int31 hash** for the required numeric id; a
  **≤60 rolling window** (soonest first); a `TAKE` action type for dose reminders; and
  `extra` carrying `{ id, slotId, scheduledInstant }`. A
  `localNotificationActionPerformed` listener records the scheduled take (reusing the
  existing store action). `useReminders` branches: native → `syncLocalNotifications`
  on data/zone/pref change + on `App` `resume`; web → today's `setTimeout`/Web-Push
  path. Permission glue in `reminders/notifications.ts` gains a native branch
  (`LocalNotifications.requestPermissions`).
- **Boundary.** All Capacitor imports live in `src/reminders/` (the existing impure
  layer); `src/core/*` stays pure (`eslint.config.js:53-71` unaffected). Optionally add
  `@capacitor/*` to the core's `no-restricted-imports` to enforce.
- **Assets + chrome:** `@capacitor/assets` generates icons/splash from a 1024² master;
  `@capacitor/status-bar` + CSS safe-area insets (the viewport already sets
  `viewport-fit=cover`, `index.html`).
- **Capacitor config:** `appId app.steadydose.app`, `appName SteadyDose`,
  `webDir dist`, no `server.url`, `LocalNotifications` plugin options.
- **Submission:** Apple Developer Program; Xcode-managed signing; App Store Connect
  record; `Info.plist` `ITSAppUsesNonExemptEncryption=false`; privacy labels = Data Not
  Collected; privacy policy URL; demo/no-account review notes; TestFlight → App Review.

## 6. Tasks
1. **Capacitor scaffold.** Add `@capacitor/*` deps; `cap init` (`app.steadydose.app`,
   `webDir: dist`); `capacitor.config.ts`; `cap add ios`; `.gitignore` for iOS build
   artifacts; `package.json` scripts (`cap:sync`, `ios:build`).
2. **Native build flavour.** `CAP_BUILD` flag in `vite.config.ts` to omit `VitePWA`;
   confirm `getBackendConfig()===null` with no Supabase env; verify the standard web
   build is byte-for-byte unaffected.
3. **Native notification adapter.** `reminders/localNotifications.ts` (id hash, ≤60
   rolling window, schedule/cancel, `TAKE` action, action listener) + unit tests with a
   mocked plugin.
4. **Engine branch.** Platform branch in `reminders/useReminders.ts`
   (native → `syncLocalNotifications` on change + `App.resume`); native permission
   branch in `reminders/notifications.ts`.
5. **Native UI suppression.** Hide account/sign-in/sync indicators when
   `isNativePlatform()`; confirm no service worker registers and no Supabase client
   instantiates in the native build.
6. **Assets + chrome.** `@capacitor/assets` icons/splash from a 1024² master; status
   bar + safe-area insets; verify on a notched device/simulator.
7. **Submission pack.** Apple Developer enrolment; bundle id + signing; App Store
   Connect record; privacy policy page + URL; privacy labels; disclaimer; encryption
   flag; review notes; archive → TestFlight.
8. **Verify + submit.** Device-test the matrix (§8 test plan); submit for App Review.

## 7. Acceptance criteria
- AC1. `CAP_BUILD=1 pnpm build && npx cap sync ios` produces an iOS app that **launches
  to the working local-first UI with no network**, and the standard `pnpm build` (web)
  is unchanged — its PWA service worker, Supabase auth, and sync still function.
- AC2. With reminders enabled and the **app fully closed**, a scheduled dose reminder
  **fires as a native iOS notification** at the correct local (zone-aware) time.
- AC3. No more than 64 notifications are ever pending; reopening the app reschedules the
  rolling window; the same reminder id never produces a duplicate notification.
- AC4. A notification's **"Mark taken"** records the scheduled dose **with no amount**
  (FR-6.6 holds); a plain tap opens the app without recording.
- AC5. In the native build, **no Supabase client is instantiated, no account UI is
  shown, and no service worker is registered**; Dexie data survives a relaunch.
- AC6. The app icon and splash render; content respects safe-area insets on a notched
  device; the status bar is legible.
- AC7. App Store Connect shows **"Data Not Collected"** privacy labels and a privacy
  policy URL; `ITSAppUsesNonExemptEncryption=false` is set; an in-app medical disclaimer
  is present; the build reaches **TestFlight** (and is submitted for App Review).

## 8. Test plan
- **Unit:** the string→int31 id hash (stability, range); rolling-window selection
  (soonest-first, ≤60 cap, future-only filter); the platform-branch selector; the
  adapter against a **mocked `LocalNotifications`** (schedule payload shape, cancel
  before reschedule, `TAKE` action wiring); permission-state mapping.
- **Build:** two-flavour verification — native build omits `VitePWA` and Supabase; web
  build retains both (snapshot/asset check); `getBackendConfig()` null on native.
- **Device matrix (manual, documented):** closed-app delivery; resume-reschedule; the
  64-cap (schedule > 64 reminders, assert ≤64 pending, soonest kept); permission denied
  → in-app catch-up still works; offline cold-start; "Mark taken" records the dose;
  safe-area on a notched device.
- **Submission dry-run:** the §7 / plan checklist (labels, policy URL, encryption flag,
  disclaimer, review notes, demo path) walked before upload.

## 9. Risks / decisions
- **Don't break the web build.** The `CAP_BUILD` flavour must be strictly additive; CI
  builds **both** flavours so a native-only change can't silently regress the PWA/Supabase
  path (AC1).
- **iOS 64-pending cap** is a hard platform limit — the rolling window + resume
  reschedule is the standard mitigation; reminders beyond the window are picked up on
  next open (matches the existing horizon model, `DEFAULT_HORIZON_MS`).
- **Background reschedule** relies on launch/resume (iOS won't run JS in the
  background); acceptable for a fixed daily schedule. A Notification Service Extension /
  background runner is out of scope.
- **Guideline 4.2 (minimum functionality):** native notifications + offline on-device
  data is unambiguous native value, and there's no remote site it proxies — low risk.
- **No account ⇒ no deletion gate.** Apple's in-app account-deletion requirement targets
  developer-side account creation, which this build has none of; iCloud (Stage 19) uses
  the OS Apple ID and likewise triggers no app-account deletion gate.
- **Privacy posture is trivially clean** here (Data Not Collected, on-device only) — and
  it stays that way only while there's no developer backend in the binary. Re-evaluate at
  Stage 19 (iCloud keeps data in the user's iCloud → still "not collected" by the
  developer).
- **Spec reconciliation:** Stage 9 §2 previously listed "app-store distribution (PWA
  install only)" as out of scope; that line is superseded by this stage (PRD non-goal
  **N3** "no multi-tenant" remains valid — this stage is single-tenant/local-first).
- **iCloud deferred (Stage 19):** shipping local-first first de-risks the App Store
  process; sync lands as a point release. See the spike §3 for the two iCloud paths
  (whole-dataset blob via `transfer.ts` merge, recommended; or record-level CloudKit via
  the injectable `SyncBackend` port).

## 10. Definition of done
All ACs pass; a **local-first** SteadyDose iOS app, wrapped in Capacitor, reaches
**TestFlight and is submitted for App Review**; **native reminders fire while the app is
closed and offline** while preserving the no-dose-value safety invariant; the **web/PWA
build is unchanged** and CI builds both flavours; the submission carries accurate
"Data Not Collected" privacy labels, a privacy policy URL, the encryption-exemption
flag, and a medical disclaimer; iCloud sync is queued as Stage 19. Docs (this spec, the
execution plan, the master plan map) reflect the new stage.
