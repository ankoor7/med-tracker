# Spike: Open-sourcing SteadyDose, App Store distribution & the multi-tenant privacy/HIPAA question

|             |                                                                                                                                                                |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Date**    | 2026-06-20                                                                                                                                                     |
| **Status**  | Investigation / decision input — **not legal advice**                                                                                                          |
| **Trigger** | Pivot idea: drop dose recalculation, keep time + records, go **multi-tenant** (users register, no BYO backend), open-source it, and ship on the **App Store**. |
| **Author**  | Claude (research spike for Ankoor)                                                                                                                             |

> ⚠️ **Caveat.** This is engineering/product research, not legal advice. The
> regulatory facts below are accurate as of June 2026 and sourced (§9), but before
> you _launch a multi-tenant service that stores other people's medication data_
> you should get a short paid review from a privacy lawyer in your home
> jurisdiction (UK) covering your specific data flows. The cost of that review is
> trivial next to the cost of getting consumer-health-data law wrong.

---

## 0. TL;DR — outcomes

| Question                                    | Answer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Do I need to be HIPAA compliant?**        | **Almost certainly no.** HIPAA binds _covered entities_ (providers, health plans, clearinghouses) and their _business associates_. A direct-to-consumer app where users record **their own** medication data, and you are **not** acting on behalf of a provider/plan, is outside HIPAA per HHS/OCR's own guidance.                                                                                                                                                                                                                 |
| **"AWS Amplify would give that assurance"** | **Misconception to correct.** A BAA (from AWS _or_ Supabase) only matters _if HIPAA applies to you_ — and it doesn't. A BAA also never makes _you_ "HIPAA compliant"; it's a shared-responsibility contract covering the vendor's slice. You do **not** need to leave Supabase: Supabase signs BAAs too (Team plan + HIPAA add-on). Reverting to Amplify would undo the entire Stage 8 re-platform for a problem you don't have.                                                                                                    |
| **So what law _does_ apply?**               | The thing that actually changes your obligations is **going multi-tenant**, not the dose feature. As data controller you'd be subject to: **UK/EU GDPR** (medication data = _special-category_ health data → explicit consent, DPA-2018 appropriate-policy doc, 72-hr ICO breach notice), **US FTC Health Breach Notification Rule** (60-day breach notice for health apps not under HIPAA), **FTC Act §5**, and **US state health-privacy laws** (Washington _My Health My Data_ Act is the strict one — private right of action). |
| **Does dropping dose-recalc help?**         | **Yes, materially** — it moves you further from "medical device / clinical decision support" (PRD non-goal N2) and lowers Apple's medical-app review scrutiny (Guideline 1.4.1). Keep doing it.                                                                                                                                                                                                                                                                                                                                     |
| **Best App Store packaging?**               | **Capacitor** wrapping the existing Vite/React PWA — single codebase, and it lets you add the **native reminders (local notifications)** that the PWA can't do reliably (the spec already concedes this in FR-REM-4). A _bare_ PWA/WebView wrapper gets **rejected under Guideline 4.2** (minimum functionality).                                                                                                                                                                                                                   |
| **Biggest watch-out**                       | The pivot **contradicts three places in the current specs** (PRD non-goal **N3** "no multi-tenant / shared backend", the one-pager's "your own AWS account" framing, and Stage 9 which explicitly lists _"hosted multi-tenant offering; app-store distribution"_ as **out of scope**). These need rewriting before you build, or the spec stops being the source of truth.                                                                                                                                                          |

**One-line recommendation:** Keep Supabase, **don't chase HIPAA/Amplify**, treat
this as a **UK-GDPR + FTC-HBNR consumer-health-data** product, ship via
**Capacitor**, and reconcile the specs (N3, one-pager, Stage 9) to the new
multi-tenant direction first.

---

## 1. What actually changed (the pivot vs. today's specs)

The current design (specs `00`/`01`/`02` + Stage 9) is deliberately the _opposite_
of what's now proposed on two axes, and identical on one:

| Axis         | Current spec                                                                                                                                                                              | Proposed pivot                                                            | Net effect                                                             |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Pharmacology | App never computes a dose; user's equations plug into a documented extension point (`DoseAdjustmentStrategy`).                                                                            | **Remove dose recalculation entirely.**                                   | ✅ _Lowers_ regulatory + Apple risk. Easy win.                         |
| Tenancy      | **Single-tenant, bring-your-own backend** (originally AWS account; Stage 8 → own Supabase project). PRD **N3** explicitly: _"Multi-tenant hosted SaaS or any shared backend"_ = non-goal. | **Multi-tenant: users register for an account on a backend you operate.** | ⚠️ _This_ is the change that creates real privacy/legal obligations.   |
| Openness     | Open source, MIT, self-host.                                                                                                                                                              | Still open source.                                                        | ↔️ Unchanged in principle, but the _operating model_ changes (see §6). |

**Key insight that reframes the whole question:** Removing the dose math is the
change you _think_ is the big regulatory move, but it isn't — it only ever made you
_less_ like a medical device, and you were already careful there. **Going
multi-tenant is the actual pivot.** Today you hold _zero_ user data (everyone's data
lives in their own backend), so your liability surface is near-zero. The moment you
operate one backend that stores many people's medication records, **you become a
data controller of special-category health data** and inherit the obligations in
§2–§4. That trade is the entire story.

---

## 2. Do you need to be HIPAA compliant? (Short answer: no)

### 2.1 Who HIPAA actually binds

HIPAA applies to **covered entities** — health-care _providers_ who transmit health
info electronically for billing/claims, **health plans**, and **health-care
clearinghouses** — and to their **business associates** (vendors who handle PHI
_on a covered entity's behalf_). It is **not** a general "any app that touches health
data" law. That's the single most common misconception about HIPAA.

### 2.2 Why your app sits outside HIPAA

Per HHS/OCR's own developer guidance: _"If you are only offering services directly
to … consumers, and not on behalf of a provider, health plan or health-care
clearinghouse, you are not likely to be subject to HIPAA as either a covered entity
or business associate."_ Once health data is held by a consumer-chosen app that
isn't acting for a covered entity, **it is no longer governed by HIPAA at all.**

SteadyDose is the textbook example: an individual voluntarily types in _their own_
medication schedule and adherence. You're not receiving PHI from a clinic, not
billing insurers, not contracted by a provider. **→ HIPAA does not apply.**

(The line you'd cross _into_ HIPAA: partnering with clinics so _they_ push patient
data into your app, or selling a white-label version to a provider to use with their
patients. Not on the table here.)

### 2.3 The "AWS Amplify gives that assurance" misconception — corrected

Three precise corrections:

1. **A BAA only matters if HIPAA applies.** It doesn't here, so a BAA buys you
   nothing legally required. It can still be useful _defense-in-depth / future-proofing_
   (e.g. if you might go B2B2C with clinics later), but it's optional, not a gate.
2. **A BAA never makes _you_ "HIPAA compliant."** HIPAA is a _shared-responsibility_
   model: the BAA covers the vendor's infrastructure slice; _your_ compliance
   (risk analysis, access controls, workforce policy, breach procedures, the
   "appropriate-use" configuration) is still on you. "We're on Amplify" is not a
   compliance posture.
3. **You don't need AWS for a BAA.** Your current backend, **Supabase, also signs
   BAAs** (Team plan + HIPAA add-on; projects flagged _High Compliance_) and is
   SOC-2 Type 2 + HIPAA. So even in the future scenario where you _want_ a BAA, you
   can get it without reversing Stage 8. Going back to Amplify would throw away the
   whole Supabase migration to solve a problem you don't have.

### 2.4 What this means

Don't architect for HIPAA. Architect for **consumer-health-data privacy** (§3),
which for a self-tracking app is the _real_ and _stricter-in-practice_ regime —
especially the UK/EU and Washington-state pieces.

---

## 3. The laws that _do_ apply to a multi-tenant SteadyDose

Because the App Store is global, you'll have users in multiple regimes. Lead with
the UK (your home jurisdiction — the spec's BST/GMT focus gives it away), then US.

### 3.1 UK & EU GDPR — your primary regime

- **Medication data is "special-category" data** (Art. 9 — "data concerning
  health"). You may not process it on ordinary "legitimate interests"; you need an
  **Art. 9 condition**. For a consumer app the realistic one is **explicit consent**.
- **Explicit consent has a high bar:** a clear affirmative statement, _separate_ from
  other consent, naming the specific health data and purpose. A pre-ticked box or
  buried T&C line does **not** qualify. → You need a dedicated consent step at
  sign-up.
- **DPA 2018:** relying on a Sch. 1 condition typically requires an **Appropriate
  Policy Document** describing your condition and retention/erasure.
- **Data-subject rights:** access, rectification, **erasure**, and **portability**.
  You already have JSON/CSV **export** (FR-HIS-5) — that covers portability — but you
  do **not** yet have self-serve **account+data deletion**, which both GDPR _and_
  Apple require (§5.4).
- **Breach notification:** report to the **ICO within 72 hours** of awareness.
- **DPA/Processor terms:** sign Supabase's **Data Processing Addendum**; you're the
  _controller_, Supabase is your _processor_. List all sub-processors in your privacy
  policy.
- **Records/ROPA + DPIA:** processing special-category data at scale → do a **Data
  Protection Impact Assessment**. (Good news: a clean, focused dataset makes this
  short.)

### 3.2 US — FTC Health Breach Notification Rule (HBNR)

The FTC's **2024 amendments** (effective **29 Jul 2024**) explicitly pull
**health apps not covered by HIPAA** into the HBNR. If you operate the backend:

- A **"breach of security"** is defined broadly (includes unauthorized _disclosures_,
  not just hacks).
- Notify affected users **without unreasonable delay, ≤ 60 days** from discovery;
  for breaches **≥ 500 records**, notify the **FTC at the same time** (and media).
- **FTC Act §5** independently bans unfair/deceptive practices: whatever your privacy
  policy promises, you must actually do. (This is how the FTC fined GoodRx, BetterHelp,
  Premom — they shared health data contrary to their own promises.)

### 3.3 US state health-privacy laws — Washington MHMDA is the sharp edge

- **Washington "My Health My Data" Act (MHMDA)** (in force **31 Mar 2024**) defines
  **"consumer health data"** very broadly and applies to small developers too. It
  requires: a **separate Consumer Health Data Privacy Policy**, **opt-in consent** to
  collect _and_ a _separate_ consent to share, a **right to delete**, and — critically —
  a **private right of action** (individuals can sue; most privacy laws only allow
  regulator enforcement). It is **not limited to Washington-domiciled businesses** —
  it follows the _consumer's_ location.
- **Nevada SB370** is similar; **CCPA/CPRA** (California) treats health data as
  _sensitive personal information_ with extra limits. Connecticut/others add "consumer
  health data" carve-outs.
- Pragmatic posture: **build to GDPR + MHMDA** (the two strictest) and you're
  comfortably over the bar for the rest.

### 3.4 Practical compliance checklist (multi-tenant)

- [ ] **Explicit, separate consent** to store medication data at sign-up (GDPR Art. 9 / MHMDA opt-in).
- [ ] **Privacy policy** + a **distinct consumer-health-data privacy policy** (MHMDA wants its own link).
- [ ] **Terms of Service** with a clear **medical disclaimer** ("reminders & records only; not medical advice; not a dosing tool").
- [ ] **Self-serve account + data deletion** (GDPR erasure + Apple requirement). _Not built yet._
- [ ] Keep **export** (already have JSON/CSV) → covers portability.
- [ ] **Breach runbook**: ICO ≤72 h, FTC/users ≤60 days, templates pre-written.
- [ ] **Supabase DPA** signed; **sub-processor list** published.
- [ ] **DPIA** + **Appropriate Policy Document** on file.
- [ ] **Data minimization & retention**: collect only what the feature needs; define a retention/auto-delete policy; no analytics SDKs that exfiltrate health data (the spec's NFR-Privacy "no telemetry that leaves" stays a _feature_, now a legal asset).
- [ ] **Age gating**: decide a minimum age; under-13 (COPPA, US) / under-13–16 (UK "age of consent" for data) pull in children's-data rules — simplest is **18+ only** in ToS.

---

## 4. Multi-tenant backend — the architectural & liability shift

### 4.1 BYO-account vs. multi-tenant, side by side

|                                | BYO backend (today)             | Multi-tenant (proposed)              |
| ------------------------------ | ------------------------------- | ------------------------------------ |
| Who holds the data             | Each user, in their own project | **You**, in one shared project       |
| Your role under GDPR           | ~none (you ship code)           | **Data controller**                  |
| Privacy policy / ToS / consent | user's problem                  | **your legal obligation**            |
| Breach liability               | user's                          | **yours** (ICO 72 h / FTC 60 d)      |
| Onboarding friction            | high (must deploy infra)        | **low (register & go)** ← the upside |
| Ongoing cost to you            | ~£0                             | **Supabase bill + ops + DPO time**   |

The pivot is a deliberate trade: **much lower user friction** (the thing that makes a
public App-Store launch viable at all) in exchange for **you carrying the data
custody and legal weight.** That's a fine trade — it's just a real one, and the
specs currently assume the opposite (N3).

### 4.2 Your existing Supabase design already does most of the security work

The Stage 8 substrate is _well-suited_ to multi-tenant — arguably more than the
original BYO framing:

- **Row-Level Security** already isolates each user's rows by `auth.uid()` → the core
  multi-tenant safety property is built in.
- **GoTrue auth**, server-side `validate_record`, TLS in transit, Postgres encryption
  at rest → maps cleanly onto the GDPR "appropriate technical measures" expectation.
- What you **add** for multi-tenant: a **delete-my-account** RPC/flow, the consent
  capture, the legal docs, and Supabase **DPA + (optional) HIPAA add-on**.

### 4.3 If you ever _want_ the HIPAA assurance anyway

Path, in order of effort: stay on Supabase → upgrade to **Team plan** → enable
**HIPAA add-on** → request **BAA** in dashboard → flag PHI projects _High Compliance_
→ keep your own policies. No code rewrite, no cloud migration. File this under
"future B2B2C optionality," not "launch blocker."

---

## 5. App Store packaging

### 5.1 Why you can't just upload the PWA in a thin wrapper

Apple **Guideline 4.2 (Minimum Functionality)** rejects apps that are "not
sufficiently different from a mobile web browsing experience." Bare WebView/PWA
wrappers with no native UI, no push, no offline are the **single most common 4.2
rejection**. So "package the PWA" ≠ "ship a `WKWebView` pointing at the site."

### 5.2 Recommended: **Capacitor** (Ionic) wrapping the existing PWA

- **Single codebase.** Capacitor loads your built Vite/React assets inside a native
  shell; you keep `src/` exactly as is and add `ios/` + `android/` native projects.
- **Adds the native value Apple wants**, turning a 4.2 risk into a pass:
  - **Local notifications** (`@capacitor/local-notifications`) → _reliable_ dose
    reminders. This is the headline win: **FR-REM-4 already admits web background
    reminders are unreliable** — native packaging _fixes the product's weakest
    feature_, which is exactly the "native value" Apple is looking for.
  - **Push** via `@capacitor/push-notifications` (APNs). Note: your Web-Push/VAPID
    work (memory: `steadydose-push-vapid`) is the _web_ path; on iOS-native you'd use
    **APNs**, and push only works when the web assets are **bundled into the app**
    (not loaded from a remote `server.url`). Plan for both transports.
  - Biometric **app lock** (maps to the spec's "optional on-device lock"), offline
    (you already have it), home-screen/widget potential later.
- **Mature, well-trodden path** for Vite+React → iOS in 2025/26.

Alternative considered — **PWABuilder** (Microsoft): lighter, generates an iOS
package from the manifest, but it's a thinner wrapper that's _more_ exposed to 4.2,
and iOS push from its template is fiddly. Use it for Android/Windows convenience if
ever needed; **prefer Capacitor for the iOS submission.**

### 5.3 Dropping dose-recalc helps here too

Apple **Guideline 1.4.1** gives medical apps extra scrutiny and demands disclosure of
methodology behind any health _measurement/calculation_. By removing dose math,
SteadyDose presents as a **reminder + record-keeping** app, not a dosing tool — a
much smoother review. Keep a plain medical disclaimer regardless.

### 5.4 Apple submission checklist (the non-obvious ones)

- [ ] **Apple Developer Program** — **$99/yr**.
- [ ] **In-app account deletion** — _mandatory_ for any app with account sign-up.
      Not built yet; build it (doubles as GDPR/MHMDA erasure — §3).
- [ ] **Privacy "nutrition" labels** — you must declare **Health & Fitness** data
      collection, linkage to identity, and purpose. Be accurate (FTC §5 cross-checks this).
- [ ] **Privacy policy URL** + in-app link.
- [ ] **Sign in with Apple** — required _if_ you offer other third-party logins
      (e.g. Google). Pure email/password is exempt. (Supabase GoTrue supports SIWA.)
- [ ] **Medical disclaimer** in-app and in the listing.
- [ ] **Account-based content must work for the reviewer** — supply a demo account.
- [ ] Data not used for third-party advertising/tracking (you have none — keep it that way).

### 5.5 Notifications: decision

| Transport                         | Use                                                                | Note                                                                               |
| --------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| **Capacitor Local Notifications** | the **primary** reminder mechanism                                 | on-device scheduling, works offline, no server — best fit for fixed daily schedule |
| **APNs (Capacitor Push)**         | server-driven nudges (e.g. cross-device, adjusted-dose follow-ups) | needs the bundled-assets config; reuse your push backend re-pointed at APNs        |
| **Web Push/VAPID** (existing)     | the **installed-PWA** web path only                                | keep for non-App-Store web installs                                                |

---

## 6. Open-sourcing with a hosted multi-tenant service

Open-source + run-a-hosted-service is a well-known combo ("open-core/COSS"). Key
decisions:

### 6.1 License

- **MIT** is what `package.json` already declares — simplest, most permissive, great
  for adoption. Fine to keep.
- **Consideration:** MIT lets anyone stand up a _competing_ hosted SteadyDose from
  your code. If you care about that, the usual answer is **AGPL-3.0** (forces hosted
  forks to publish their changes) or a **source-available** license (e.g. BSL).
  For a personal/community health tool, **MIT is the pragmatic pick** — the moat
  isn't the code, it's running a trustworthy service. Recommend: **stay MIT**, revisit
  only if a commercial fork actually appears.

### 6.2 Separate "the open code" from "the service you operate"

- **In the repo (public):** client, Supabase **migrations/RLS/RPCs**, docs, example
  config, the self-host path. _No secrets_ (already a hard rule + CI secret-scan).
- **Not in the repo (your service):** the **production Supabase project + keys**, the
  **privacy policy / ToS / DPA**, the App-Store signing assets, the domain. These are
  _operational_, not source.
- **Config already supports both worlds:** `src/config.ts` treats backend env as
  optional (null ⇒ local-first). So you ship: (a) the **hosted default** (your
  Supabase URL + anon key) for App-Store users who just register, and (b) the
  **self-host path** (point at your own project) for the open-source crowd. Both fall
  back to **local-first offline** with no backend — keep that; it's a privacy selling
  point _and_ a great "try before you register" mode.

### 6.3 Removing the dose-calc extension cleanly

- Delete the `DoseAdjustmentStrategy` / `levelSeries` extension interface and its
  example, the one-tap "fill from suggestion" in the logger (FR-LOG-6), and the
  blood-level chart that consumes it (FR-HIS-4).
- **Keep** the guardrail/cap validation (`core/guardrails.ts`) — it now validates only
  _user-entered_ doses, which is even cleaner (the app _never_ originates a value;
  it only records & checks). This actually _strengthens_ the NFR-Safety story.
- **Keep** all of: schedule/time-slot model, timezone/BST-GMT engine, group/partial
  logging, history, adherence, missed-pattern, reminders, export. That's the "time
  management + records keeping" core the user wants to retain.

### 6.4 Specs/docs to reconcile (do this _before_ building — concrete actions)

The pivot makes parts of the source-of-truth specs wrong. Update:

1. **PRD `01` non-goal N3** — currently "_Multi-tenant hosted SaaS or any shared
   backend_" is a non-goal. **Invert it** (or add a new milestone) to make
   multi-tenant the goal.
2. **PRD N1/N2 & G1** — drop the pharmacology-extension language; restate as
   "reminders + records, no dose computation."
3. **One-pager `00`** — "your own AWS account" / "bring your own account" framing is
   stale (AWS retired in Stage 8 _and_ tenancy is flipping). Rewrite the "Data rights
   & privacy" + "Tech at a glance" sections for **hosted Supabase, multi-tenant**.
4. **Stage 9 spec** — its **Scope/Out** literally says _"hosted multi-tenant offering;
   app-store distribution (PWA install only)"_ are **out**. Rewrite, or supersede with
   new stages: **"Stage 18: Multi-tenant + legal/consent"** and **"Stage 19:
   Capacitor App-Store packaging."**
5. **SECURITY.md / new PRIVACY.md** — add the controller model, consent, deletion,
   breach process, retention.

---

## 7. Recommended path (phased)

1. **Decide & rewrite specs** (§6.4). Cheapest step; prevents building against stale
   non-goals. Lock in: multi-tenant **on Supabase**, **no** HIPAA/Amplify, MIT stays.
2. **Strip dose-recalc** (§6.3) — small, reduces risk, unblocks the rest.
3. **Build the multi-tenant gaps**: explicit consent at sign-up, **account+data
   deletion**, retention policy. (Reuses existing RLS/auth/export.)
4. **Legal pack**: privacy policy + consumer-health-data policy + ToS + medical
   disclaimer; sign **Supabase DPA**; write the **breach runbook**; DPIA. _(Get the
   short lawyer review here.)_
5. **Capacitor packaging**: add `ios/`, wire **local notifications** (kills the FR-REM-4
   weakness), APNs for server push, biometric lock. Apple Developer Program + privacy
   labels + demo account → submit.
6. **Open-source hardening** (your existing Stage 9 work mostly survives): CSP,
   dep-audit, secret-scan, README/DEPLOY for the self-host path, default-hosted config.

---

## 8. Open decisions for you

1. **Tenancy is really flipping?** Confirm multi-tenant is the intended default (vs.
   keeping self-host as the _primary_ and multi-tenant as a hosted convenience). This
   is the single highest-leverage decision — everything in §3–§4 hinges on it.
2. **Jurisdiction scope at launch:** UK-only first (simplest — one regime), or global
   App Store from day one (UK GDPR + FTC HBNR + WA MHMDA all live)?
3. **HIPAA optionality:** ignore entirely (recommended), or pay for the Supabase HIPAA
   add-on now as future-proofing for a possible clinic/B2B2C angle?
4. **License:** keep **MIT** (recommended) or move to **AGPL** to deter commercial
   re-hosting of your service?
5. **Account model:** email/password only (avoids the Sign-in-with-Apple requirement)
   or social logins (then SIWA becomes mandatory)?
6. **Minimum age:** 18+ in ToS (simplest) vs. supporting minors (pulls in
   children's-data rules)?

---

## 9. Sources

**HIPAA scope / health apps**

- HHS — Health App Use Scenarios & HIPAA (developer scenarios): https://www.hhs.gov/sites/default/files/ocr-health-app-developer-scenarios-2-2016.pdf
- HHS — Access right, health apps & APIs: https://www.hhs.gov/hipaa/for-professionals/privacy/guidance/access-right-health-apps-apis/index.html
- FTC — Mobile Health Apps Interactive Tool (which laws apply): https://www.ftc.gov/business-guidance/resources/mobile-health-apps-interactive-tool

**Supabase HIPAA / BAA**

- Supabase Docs — HIPAA Compliance: https://supabase.com/docs/guides/security/hipaa-compliance
- Supabase Docs — HIPAA Projects (High Compliance): https://supabase.com/docs/guides/platform/hipaa-projects
- Supabase — now HIPAA & SOC2 Type 2 compliant: https://supabase.com/blog/supabase-soc2-hipaa

**FTC Health Breach Notification Rule (2024)**

- FTC — Finalizes changes to HBNR (press release): https://www.ftc.gov/news-events/news/press-releases/2024/04/ftc-finalizes-changes-health-breach-notification-rule
- FTC — Updated HBNR protects users of health apps (blog): https://www.ftc.gov/business-guidance/blog/2024/04/updated-ftc-health-breach-notification-rule-puts-new-provisions-place-protect-users-health-apps
- FTC — Complying with the HBNR: https://www.ftc.gov/business-guidance/resources/complying-ftcs-health-breach-notification-rule-0

**US state — Washington MHMDA**

- WA AG — Protecting Washingtonians' Health Data: https://www.atg.wa.gov/protecting-washingtonians-personal-health-data-and-privacy
- Goodwin — MHMDA comes into force, what to do: https://www.goodwinlaw.com/en/insights/publications/2024/03/alerts-technology-hltc-my-health-my-data-act-mhmda

**UK/EU GDPR — special-category health data**

- ICO — Rules on special category data: https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/special-category-data/what-are-the-rules-on-special-category-data/
- ICO — Special category data guide: https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/a-guide-to-lawful-basis/special-category-data/

**Apple App Store**

- Apple — App Review Guidelines (4.2 minimum functionality, 1.4.1 medical, 5.1 privacy): https://developer.apple.com/app-store/review/guidelines/
- Apple — App Privacy Details (nutrition labels): https://developer.apple.com/app-store/app-privacy-details/
- MobiLoud — Will your WebView app be rejected? (4.2 in practice): https://www.mobiloud.com/blog/app-store-review-guidelines-webview-wrapper
- TermsFeed — Apple's in-app account deletion requirement: https://www.termsfeed.com/blog/apple-requirement-in-app-deletion-accounts/

**Capacitor packaging**

- Capacitor Docs — Building PWAs / native wrap: https://capacitorjs.com/docs/web/progressive-web-apps
