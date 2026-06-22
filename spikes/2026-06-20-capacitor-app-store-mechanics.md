# Spike: Wrapping SteadyDose in Capacitor & the App Store submission mechanics

|                                      |                                                                                                                                                                                                                                           |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Date**                             | 2026-06-20                                                                                                                                                                                                                                |
| **Status**                           | Investigation / implementation input — **not legal advice**                                                                                                                                                                               |
| **Trigger**                          | Ship the **current** app to the Apple App Store: single-tenant, **bring-your-own-backend**, local-first. Go deep on the _technical_ mechanics of the Capacitor wrap + submission.                                                         |
| **Author**                           | Claude (research spike for Ankoor)                                                                                                                                                                                                        |
| **Strategy (locked for this spike)** | **No multi-tenant.** The App Store binary is **local-first with iCloud sync** (data stays in the user's own iCloud; you operate **no** backend). The Supabase **BYO/self-host** path stays a **web + build-it-yourself** path, unchanged. |

> ⚠️ **Scope.** This is the _current BYO_ strategy, **not** the multi-tenant pivot
> explored in the companion spike. That pivot's heavy caveats — GDPR-controller
> duties, FTC HBNR, WA MHMDA, consent capture, breach runbook, the in-app
> account-deletion gate — were **consequences of operating one shared backend**. Here
> you hold **zero user data** (it lives on-device + in each user's iCloud), so that
> apparatus **does not apply**. Apple still requires a **privacy policy URL** and
> accurate (here: trivial — "Data Not Collected") privacy labels for _any_ app, and a
> plain **medical disclaimer** is good practice. Not legal advice.

> Companion: [Open-sourcing, App Store distribution & multi-tenant privacy/HIPAA](./2026-06-20-open-source-app-store-and-privacy.md) — read it only for the _multi-tenant scenario_; its privacy/legal section is **out of scope** here by design.

---

## 0. TL;DR — outcomes

| Question                                        | Answer                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **What is the App Store binary?**               | A **local-first** app: on-device records (Dexie), native local notifications, full offline, export/import, **plus iCloud sync** for the user's own devices. **No developer backend, no app account, no Supabase** in this build.                                                                                            |
| **Do the companion spike's legal gates apply?** | **No.** Those followed from going multi-tenant. Under BYO/iCloud you're not a data controller of anyone's data. No consent machinery, no breach runbook, **no in-app account-deletion gate** (iCloud uses the device Apple ID at the OS level — not a developer account).                                                   |
| **How big is the wrap?**                        | **Small + additive.** Pure core, store (Dexie), and the **sync _engine_** are untouched. Work = a new `ios/` project + build config + **one reminder delivery adapter** + **one iCloud sync backend** + muting the Supabase/SW stack in the native build. No refactor.                                                      |
| **Why is iCloud sync cheap here?**              | Two existing seams do the heavy lifting: the **`SyncBackend` port** (`syncEngine.ts:28-33`) is injectable, so an iCloud backend is a drop-in; and **`mergeDatasets(...,'merge')`** (`transfer.ts:140`) already resolves conflicts by the _same per-record LWW_ sync uses, so a whole-dataset blob sync is correct for free. |
| **Headline product win**                        | Native **local notifications** fix the weakest feature. `useReminders.ts:38` caps timers at 6h and concedes "the web platform cannot reliably wake a closed PWA" → catch-up only. Native OS scheduling fires **while closed, offline, no server** (the FR-REM-4 gap).                                                       |
| **What actually conflicts?**                    | The **service worker** (`vite-plugin-pwa` + `src/sw.ts`): redundant inside a native WebView and causes stale-asset/update bugs. **Disable SW registration in the native build.** Everything else is additive.                                                                                                               |
| **Non-obvious iOS gotcha**                      | iOS caps **pending local notifications at 64** (extras silently dropped). The adapter schedules a **rolling window** of the soonest ~60 and reschedules on app resume — fits the existing `DEFAULT_HORIZON_MS` model.                                                                                                       |
| **Effort (eng only)**                           | Local-first-only first submission: ~**3–5 days**. **+ iCloud sync**: **+2–3 days** (whole-blob path, recommended MVP) or **+4–6** (record-level CloudKit). iCloud sync can be a **fast-follow** after a local-first v1.                                                                                                     |

**One-line recommendation:** Scaffold Capacitor (`webDir: dist`), ship the **native
local-notifications adapter**, **disable the Workbox SW + Supabase stack** in the
native build, and add **iCloud sync via the whole-dataset blob path** (reuse
`transfer.ts` merge) — graduating to record-level CloudKit later. Submit with **no
app account**; privacy label = **Data Not Collected**.

---

## 1. Why this is an adapter, not a rewrite

The architecture is unusually friendly to a native wrap because two things are
already pure + pluggable:

**Reminders** — `core/reminders.ts` → `computeDoseReminders(...)` returns
`ScheduledReminder[]` (`{ id, kind, fireAt, title, body, slotId?, scheduledInstant? }`,
timing-only, **no dose value** — the FR-6.6 invariant). `reminders/useReminders.ts`
routes each one and hits two web limits it documents: `MAX_TIMER_MS = 6h`
(`useReminders.ts:39`) and "can't wake a closed PWA → in-app catch-up"
(`useReminders.ts:7-8,144`). Delivery is already swappable glue
(`reminders/notifications.ts`, `reminders/push.ts`).

**Sync** — `syncEngine.ts` is **transport-agnostic**: `runSync(local, backend)` takes
an injectable `SyncBackend` (`pull(since) / push(changes)` over `SyncRecord` with
`(updatedAt, version)` LWW). Supabase is _one_ implementation (`supabaseBackend.ts`);
iCloud is _another_.

**So the wrap = two new sibling adapters** (a local-notifications sink, an iCloud
sync backend) feeding the _same_ pure layers. The 6h cap and the closed-PWA
compromise vanish on native; the sync engine, outbox, tombstones, and `useSync` are
reused verbatim.

Untouched: `src/core/*` (29 test files green), `src/store/*` (Dexie/Zustand),
`src/sync/syncEngine.ts`. The core import boundary (`eslint.config.js:53-71`) is
unaffected — Capacitor/iCloud plugin imports live in `src/reminders/` and `src/sync/`,
the existing impure layers, never in `core/`.

---

## 2. What the App Store binary contains

| Capability          | App Store binary (this spike)     | Web / self-host (unchanged)          |
| ------------------- | --------------------------------- | ------------------------------------ |
| Local data (Dexie)  | ✅ source of truth                | ✅                                   |
| Reminders           | ✅ **native** local notifications | Web Notifications + Web Push/VAPID   |
| Cross-device sync   | ✅ **iCloud** (user's own)        | **BYO Supabase** (build-it-yourself) |
| Account / auth      | ❌ none (iCloud = OS Apple ID)    | Supabase GoTrue email/pw             |
| Developer-held data | **none**                          | **none** (each user's own project)   |
| Service worker      | ❌ disabled in this build         | ✅ Workbox precache + push           |

**The Supabase stack is simply absent from the native build** — same "disable for
native" treatment as the SW. `getBackendConfig()` returns `null` (no
`VITE_SUPABASE_*` baked), so `client.ts:21` never instantiates supabase-js and the
app runs its local-first path. No auth UI, no `scheduled_pushes` relay, no GoTrue.
That also makes Apple **Guideline 4.2** a non-issue: native notifications + offline
on-device data + iCloud sync is unambiguously "more than a web page," and there's no
"thin client to a website" smell because there's no website it talks to.

---

## 3. iCloud sync — the one genuinely new piece

This is the largest unknown. Two viable paths, **both backed by existing code**;
both keep data in the _user's_ iCloud (developer can't read it).

### 3.1 Path B — iCloud Documents blob _(recommended MVP)_

Persist the whole dataset as a JSON file in the app's **iCloud ubiquity container**;
iCloud Drive syncs the file across the user's devices.

- **Reuses `transfer.ts` wholesale:** `exportJSON(dataset)` to write, `parseImport`
  to read, and **`mergeDatasets(local, remote, 'merge')`** to resolve two-device
  conflicts — which already does per-record LWW via `isNewerRecord` (`transfer.ts:122-158`),
  _the same rule sync uses_. So offline edits on two devices converge correctly.
- **Native surface is tiny:** read/write one file in
  `FileManager.url(forUbiquityContainerIdentifier:)` + a change notification. A
  community Capacitor filesystem-iCloud plugin or ~100–150 lines of Swift.
- **Trade-off:** whole-file granularity (coarser than per-record), but the existing
  merge salvages it. Great fit for a single-user, modest dataset.
- **Does not touch the sync engine** — it's store-level wiring (serialize → write
  container file; on change/launch → read → `mergeDatasets` → persist).

### 3.2 Path A — CloudKit private DB _(high-fidelity target)_

Implement the `SyncBackend` port over CloudKit's **private database**.

- New `sync/icloudBackend.ts` implements `pull(since)` / `push(changes)`; the
  **engine, outbox, tombstones, LWW, `useSync` are reused unchanged** (backend is
  injected at `runSync`).
- Map each `SyncRecord` → a `CKRecord` (fields `id,type,updatedAt,version,payload,deleted`).
  Keep the port's **numeric cursor**: `pull(since)` = a CloudKit query predicate
  `updatedAt > since` (no need for opaque CKServerChangeTokens), returning changes +
  new max-`updatedAt` token. LWW = compare `version`/`updatedAt` on
  `serverRecordChanged`.
- **Effort sink:** CloudKit has no WebView-usable JS SDK for installed apps → needs a
  **Swift Capacitor plugin** bridging `CKPrivateDatabase` (two methods). Community
  plugins exist but maturity varies — budget for writing/forking a small one. Bounded,
  because the port surface is just `pull`/`push`.

### 3.3 Recommendation & the rejected option

**Ship Path B first** (cheap, reuses `transfer.ts`, no engine work), **graduate to
Path A** if/when record-level efficiency or fidelity matters. **Reject**
`NSUbiquitousKeyValueStore` (1 MB / 1024-key cap — too small for growing history).

### 3.4 What iCloud needs at submission

- **iCloud capability** in Xcode + an **iCloud container** identifier; provisioning
  profile must include iCloud. Path A also needs a **CloudKit schema** (record type)
  defined in the CloudKit Console; Path B needs only the container.
- **No Sign in with Apple, no app account, no account-deletion gate** — iCloud uses
  the device's existing Apple ID via the OS. Apple's deletion requirement targets
  _developer-side_ account creation, which you don't have.

---

## 4. Conflict & change inventory

| Concern                    | Today                                                                                     | Under Capacitor (native build)                  | Action                                                                       | Size |
| -------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------- | ---- |
| **Service worker**         | `vite-plugin-pwa` injectManifest + `src/sw.ts`, auto-registered (`injectRegister:'auto'`) | Precache redundant; fights asset serving/update | **Omit VitePWA / don't register SW** in the native build                     | S    |
| **Reminder delivery**      | `notifications.ts` + `push.ts`                                                            | Native OS scheduling, fires while closed        | **New `reminders/localNotifications.ts`**; platform branch in `useReminders` | M    |
| **Cross-device sync**      | Supabase `SyncBackend`                                                                    | **iCloud** (Path B blob, or Path A CloudKit)    | §3 — new iCloud backend/wiring; **engine reused**                            | M–L  |
| **Supabase / auth / push** | GoTrue + sync + Web Push                                                                  | **Absent** (no baked `VITE_SUPABASE_*`)         | Build with `getBackendConfig()===null`; hide auth/account UI on native       | S    |
| **Notification IDs**       | string `r.id`                                                                             | Capacitor wants a **32-bit int**                | Stable `string → int31` hash                                                 | S    |
| **Permissions**            | `Notification.requestPermission()`                                                        | `LocalNotifications.requestPermissions()`       | Native branch in the permission glue                                         | S    |
| **Notification action**    | SW `notificationclick` → `?take=…`                                                        | `localNotificationActionPerformed` + `extra`    | Map existing `takeUrl()` (`push.ts:71`) to a native action type              | S    |
| **Local storage**          | Dexie/IndexedDB                                                                           | Persistent in Capacitor WKWebView               | None. Offline is a **review plus**                                           | None |
| **Icons / splash**         | only `public/icon.svg`                                                                    | Native PNG icon (1024²) + splash                | `@capacitor/assets` to generate                                              | S    |
| **Safe area / status bar** | `viewport-fit=cover` set (`index.html`)                                                   | Content under notch/Dynamic Island              | `env(safe-area-inset-*)` + `@capacitor/status-bar`                           | S    |

---

## 5. The wrap, concretely (happy path)

```bash
# 1. Native shell + the plugins this build needs (no Supabase, no push plugin)
pnpm add @capacitor/core @capacitor/ios
pnpm add -D @capacitor/cli @capacitor/assets
pnpm add @capacitor/local-notifications @capacitor/app \
         @capacitor/status-bar @capacitor/splash-screen
# iCloud: a community filesystem-iCloud plugin, or a small custom Swift plugin (§3)

# 2. Init — point Capacitor at the existing Vite build output
npx cap init SteadyDose app.steadydose.app --web-dir dist

# 3. Build the web app (NO VITE_SUPABASE_* → local-first), then create the iOS project
CAP_BUILD=1 pnpm build         # CAP_BUILD omits VitePWA; env has no Supabase creds
npx cap add ios
npx cap sync ios               # re-run after every web build

# 4. Icons/splash from a 1024px master
npx capacitor-assets generate --ios

# 5. Xcode: signing + iCloud capability, then archive
npx cap open ios
```

`capacitor.config.ts` — **no `server.url`** (bundle the assets):

```ts
import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: 'app.steadydose.app',
  appName: 'SteadyDose',
  webDir: 'dist',
  ios: { contentInset: 'always' },
  plugins: { LocalNotifications: { smallIcon: 'ic_stat_icon', iconColor: '#0f766e' } },
};
export default config;
```

- **Vite `base` is `/` (default) — correct for Capacitor** (serves `webDir` at the
  WebView root). No override.
- **Service-worker shim:** `vite-plugin-pwa` auto-injects `registerSW()` at build. A
  `CAP_BUILD` env flag omits the plugin for the native build (and lets
  `Capacitor.isNativePlatform()` pick the native adapters), yielding a `dist/` with no
  Workbox SW and no Supabase. The web/PWA build is unchanged.

---

## 6. The native reminder adapter

### 6.1 Drop-in shape (same input, different sink)

```ts
// src/reminders/localNotifications.ts  (native delivery adapter — illustrative)
import { LocalNotifications } from '@capacitor/local-notifications';
import type { ScheduledReminder } from '../core/reminders';

const toIntId = (s: string) => {
  // Capacitor ids must be 32-bit ints
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 2_147_483_647;
};
const IOS_PENDING_CAP = 60; // iOS silently drops pending > 64

export async function syncLocalNotifications(reminders: ScheduledReminder[]) {
  const pending = await LocalNotifications.getPending();
  if (pending.notifications.length)
    await LocalNotifications.cancel({ notifications: pending.notifications });
  const now = Date.now();
  const due = reminders
    .filter((r) => r.fireAt > now)
    .sort((a, b) => a.fireAt - b.fireAt)
    .slice(0, IOS_PENDING_CAP)
    .map((r) => ({
      id: toIntId(r.id),
      title: r.title,
      body: r.body,
      schedule: { at: new Date(r.fireAt) },
      actionTypeId: r.kind === 'dose' && r.slotId ? 'TAKE' : '',
      extra: { id: r.id, slotId: r.slotId, scheduledInstant: r.scheduledInstant },
    }));
  if (due.length) await LocalNotifications.schedule({ notifications: due });
}
```

Wire in `useReminders.ts` behind `Capacitor.isNativePlatform()`: on native, **replace**
the `setTimeout` routing + Web Push relay with one `syncLocalNotifications(allReminders)`
call (recompute on data/zone/pref change and on `App` resume). Catch-up stays as a
backstop; OS delivery becomes primary.

### 6.2 "Mark taken" — no dose value (FR-6.6 preserved)

Register a `TAKE` action; on `localNotificationActionPerformed` reuse the existing take
semantics from `push.ts:71` (record the _already-scheduled_ dose, never an amount).

### 6.3 Permissions

`LocalNotifications.requestPermissions()` replaces `Notification.requestPermission()`;
add a native branch in `reminders/notifications.ts` so `useReminders` is unchanged.

### 6.4 Auth — not in this build

The App Store binary has **no Supabase and no account**, so there is **no auth, no
deep-link, no OAuth/SIWA work** at all. (Auth + the Supabase deep-link considerations
only matter for the separate web/self-host build, which already works.)

---

## 7. App Store submission mechanics

### 7.1 One-time setup

1. **Apple Developer Program** — $99/yr (can take a day to activate).
2. **App Store Connect**: create the app record; reserve "SteadyDose"; set bundle ID
   `app.steadydose.app` (must match `capacitor.config.ts` + the Xcode target).
3. **Signing**: Xcode "Automatically manage signing" with your Team.
4. **iCloud capability**: enable iCloud (CloudKit and/or iCloud Documents per §3) +
   create the iCloud **container**; the profile picks it up.

### 7.2 Per-build pipeline

```
CAP_BUILD=1 pnpm build → npx cap sync ios → npx cap open ios
  → set version/build no., Team, signing, iCloud
  → Product ▸ Archive → Organizer ▸ Distribute ▸ App Store Connect ▸ Upload
  → (processing ~5–30 min) → TestFlight (internal, no review)
  → submit for App Review (~24–48h typical)
```

### 7.3 The non-obvious gotchas (specific to this app)

- **Privacy label = "Data Not Collected."** Data is on-device + in the user's iCloud;
  you receive nothing. Still provide a **privacy policy URL** (Apple requires one for
  every app) — a short "stored on your device and your iCloud; we collect nothing" page.
- **No account-deletion gate.** No developer-side account exists (§3.4). Don't add a
  Push entitlement or Sign in with Apple — neither is used.
- **Export compliance.** Only standard HTTPS/TLS (and the disabled-by-default Web
  Crypto cache lock, `src/crypto/`) → exempt; set `ITSAppUsesNonExemptEncryption=false`
  in `Info.plist` to skip the per-upload prompt.
- **Background.** iOS won't run JS in the background to reschedule notifications; the
  rolling 60-deep window reschedules on **launch/resume** (`App.addListener('resume', …)`)
  — the standard pattern; no background-mode entitlement.
- **Demo for review.** No login needed — the reviewer just uses the app; offline +
  native notifications + iCloud sync are visible immediately. Note "no account
  required; data is local + iCloud" in App Review notes to pre-empt 4.2.
- **Medical disclaimer** in-app + listing (1.4.1 / good practice). Dropping dose-recalc
  (if pursued) further lowers medical-app scrutiny, but isn't required for the wrap.

---

## 8. Phase 2 / deferred

- **Record-level CloudKit (Path A)** — graduate from the blob path when fidelity/efficiency warrants (§3.2).
- **Android** — `@capacitor/android` is a near-free addition later; Play Store is far more lenient than 4.2. (Android has no iCloud; it would use the BYO Supabase path or a separate sync — decide later.)
- **APNs server push** — not needed; local notifications cover the fixed schedule, and there's no developer backend to send from in this build.
- **Biometric app lock / widgets** — maps to the spec's optional on-device lock; nice-to-have.

---

## 9. Open decisions

1. **iCloud sync in v1, or fast-follow?** A local-first-only first submission is ~3–5
   days; iCloud adds +2–3 (Path B) or +4–6 (Path A). Shipping local-first first and
   adding iCloud in a point release is low-risk.
2. **Path B vs Path A** for iCloud (§3.3). Recommend **B first**.
3. **Notification horizon on native.** Current web horizon is 1 day
   (`DEFAULT_HORIZON_MS`); with a 60-slot budget you can schedule further out (3–7
   days) so reminders survive a week of not opening the app. Pick the window.
4. **One build or two?** A `CAP_BUILD` flag gives one `src/`, two `dist/` flavours
   (native: no VitePWA, no Supabase, native adapters; web: as today). Confirm.
5. **Bundle ID / display name** — confirm `app.steadydose.app` before reserving it.
6. **Spec touch-up** (small, _not_ the multi-tenant reconciliation): **Stage 9**
   currently lists "app-store distribution (PWA install only)" as out of scope — flip
   that line, and note the App Store edition uses **iCloud** as a _second_ sync backend
   alongside Supabase BYO. PRD **N3** (no multi-tenant) and the one-pager **stay valid**.

---

## 10. Sources

**Capacitor**

- iOS getting started / project structure: https://capacitorjs.com/docs/ios
- Config (`webDir`, `server.url`, appId): https://capacitorjs.com/docs/config
- `@capacitor/local-notifications` (schedule, action types, permissions): https://capacitorjs.com/docs/apis/local-notifications
- `@capacitor/app` (`appUrlOpen`, resume): https://capacitorjs.com/docs/apis/app
- `@capacitor/assets` (icon/splash): https://github.com/ionic-team/capacitor-assets
- Capacitor + PWA / service-worker guidance: https://capacitorjs.com/docs/web/progressive-web-apps

**iCloud / CloudKit**

- Apple — CloudKit overview (private database = user's iCloud, dev can't read it): https://developer.apple.com/documentation/cloudkit
- Apple — `CKDatabase` / private DB & quotas: https://developer.apple.com/documentation/cloudkit/ckdatabase
- Apple — iCloud Documents / ubiquity container (`FileManager.url(forUbiquityContainerIdentifier:)`): https://developer.apple.com/documentation/foundation/icloud
- Apple — Configuring iCloud capability/entitlements: https://developer.apple.com/documentation/xcode/configuring-icloud-services

**iOS / Apple platform limits & submission**

- Apple — `UNUserNotificationCenter` / local notifications (64-pending behaviour): https://developer.apple.com/documentation/usernotifications
- Apple — Upload & App Review / TestFlight: https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds
- Apple — Export compliance (`ITSAppUsesNonExemptEncryption`): https://developer.apple.com/documentation/security/complying-with-encryption-export-regulations
- Apple — App Review Guidelines (4.2, 1.4.1, 5.1): https://developer.apple.com/app-store/review/guidelines/

**This repo (integration points cited)**

- `src/core/reminders.ts` (pure `ScheduledReminder`), `src/reminders/useReminders.ts` (6h cap, closed-PWA concession), `src/reminders/push.ts` (`takeUrl`), `src/sw.ts` (Workbox + Web Push), `src/sync/syncEngine.ts:28-33` (injectable `SyncBackend` port), `src/sync/supabaseBackend.ts` (the port over PostgREST), `src/store/transfer.ts:122-158` (`mergeDatasets` per-record LWW), `src/config.ts` (`null` ⇒ local-first), `vite.config.ts` (VitePWA), `eslint.config.js:53-71` (core boundary).
