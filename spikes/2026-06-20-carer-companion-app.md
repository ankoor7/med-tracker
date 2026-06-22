# Spike: A "carer" companion app for family & carers

|             |                                                                                                                                                                                                                                                       |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Date**    | 2026-06-20                                                                                                                                                                                                                                            |
| **Status**  | Investigation / feasibility — **not legal advice**                                                                                                                                                                                                    |
| **Trigger** | Idea: a companion app for **family members / carers** that pairs with a patient's SteadyDose, receives **emergency notifications**, sees **general metrics**, and is given **scoped access to some patient data** to help manage the condition.       |
| **Author**  | Claude (research spike for Ankoor)                                                                                                                                                                                                                    |
| **Reopens** | PRD non-goal **N3** (no multi-tenant / shared backend) and touches **N4** (no clinic/third-party-facing features). See `2026-06-20-open-source-app-store-and-privacy.md` — its multi-tenant privacy/legal analysis is **directly load-bearing here**. |

> ⚠️ **Caveat.** Engineering/product research, not legal advice. A carer app
> _deliberately discloses one person's special-category health data to another
> person_. That is the single most consequential thing in this document and it is a
> **legal** decision before it is a technical one. Get a short paid UK privacy-lawyer
> review before shipping anything past Phase 1 (§7).

---

## 0. TL;DR — outcomes

| Question                                         | Answer                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Is it technically feasible on today's stack?** | **Yes, but it is the multi-tenant pivot in disguise.** A carer reading a patient's data is **cross-user data sharing**, which collides with PRD **N3** and with the single-tenant / local-first direction just locked in (Stages 9/18). The Supabase substrate (RLS, GoTrue, the push relay) makes the _mechanics_ cheap; the **tenancy model and the law** are the hard part.                                     |
| **What's the cleanest topology?**                | **A narrow, consented "carer relay"** (option D, §2): a _purpose-built, data-minimized_ shared backend that holds only the **carer↔patient link**, a **push channel for emergencies**, and a small **shared summary projection** (adherence %, last dose, recent flare-up count) — **not** the full medication record store. You become controller of a _tiny bounded_ dataset instead of everyone's full records. |
| **Do the emergency-notification rails exist?**   | **Mostly.** Triggers already exist: missed-pattern (`FR-HIS-3`), logged events/seizures (Stage 15), plus a new manual **SOS**. Delivery can reuse the Web Push relay (`scheduled_pushes` / `push_subscriptions` / `send-push`, migrations `0005`/`0006`) — but it is **owner-scoped** today (`user_id = auth.uid()`), so it needs a **carer fan-out** path.                                                        |
| **Do the "general metrics" exist?**              | **Yes — reuse Stage 17.** The GP Adherence Summary already computes adherence + flare-ups **on-device**. The carer view is a _shared, live_ version of that report. New work is the _sharing_, not the computation.                                                                                                                                                                                                |
| **What about the App Store binary (Stage 18)?**  | **Keep carer features OUT of it.** Stage 18's whole privacy win is "Data Not Collected / no developer backend." A carer relay reintroduces a backend, accounts, **in-app account-deletion gate**, and "Health data, linked to you" privacy labels. Carer lives on the **hosted/web path**, not the local-first iOS binary.                                                                                         |
| **Biggest watch-out**                            | This is **not "add a screen."** It flips N3, makes you a **GDPR data controller** of shared health data (consent for _disclosure_, revoke, deletion, breach runbook — the companion spike's whole apparatus), and pulls in the **safety invariant** (a carer must **never** originate or edit a dose).                                                                                                             |
| **Cheapest real first step**                     | **Phase 1: one-way share of a Stage 17 summary snapshot** (link/PDF) to a carer — no live access, no new account model, minimal new legal surface. De-risks the idea before you build the relay.                                                                                                                                                                                                                   |

**One-line recommendation:** Treat the carer app as a **deliberate, opt-in,
data-minimized disclosure feature on the hosted/BYO path** (not the local-first App
Store binary); **decide the tenancy question (amend N3) first**; ship a **Stage 17
snapshot share** as Phase 1; build the **consented emergency relay** (Phase 2) and
**live scoped metrics** (Phase 3) only behind a proper consent + legal pack.

---

## 1. What the carer app actually is

Three asks, in increasing order of cost and legal weight:

1. **Emergency notifications** — the carer is alerted when something goes wrong:
   a pattern of missed timing-sensitive doses, a logged seizure/event, or the patient
   taps a manual **SOS**.
2. **General metrics** — the carer sees a high-level picture: adherence over a window,
   last dose taken, recent flare-up count, next scheduled dose. (Deliberately _not_ the
   full dose-by-dose log unless explicitly granted.)
3. **Scoped data access to help manage** — the carer can see more detail (schedule,
   upcoming doses, event history) at the patient's granular consent, and possibly
   **nudge** (send a reminder) — but **never write a dose**.

Two personas, a new relationship:

- **Patient** — owns the data, grants/revokes access, sets scope. Unchanged primary user.
- **Carer** — a _separate person with their own account_, linked to one or more patients
  by invitation. Read-mostly. May themselves be elderly / non-technical → the carer app
  must be dead simple.

The carer↔patient **link with consent and revocation** is the new first-class concept;
everything else hangs off it.

---

## 2. The core tension: this is cross-user sharing (topologies)

Today every design choice assumes **one user's data, isolated** (`records` RLS:
`user_id = auth.uid()`, `0001_records.sql:46-50`). A carer reading a _different_ user's
data breaks that assumption. Four ways to resolve it:

| #     | Topology                                                                              | How the carer sees data                                                                                                                          | Verdict                                                                                                                                                                                                                                                                                             |
| ----- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A** | **Full hosted multi-tenant** (the companion-spike pivot)                              | Patients + carers are accounts in one project you operate; RLS grants share rows.                                                                | Most capable, **most liability**. Inherits the _entire_ GDPR-controller / FTC-HBNR / WA-MHMDA / consent / deletion / breach apparatus — and now you're _intentionally_ sharing special-category data with a third party, which is _worse_, not better. Over-kill for "let my mum see my adherence." |
| **B** | **BYO single-tenant + carer as a 2nd identity** on the patient's own Supabase project | Patient invites the carer into _their_ project with a read-scoped RLS role.                                                                      | Keeps "no backend _you_ operate," but the BYO ops burden lands on the patient, invites are awkward, and it doesn't scale to "one carer, three relatives in three projects." Niche / self-host only.                                                                                                 |
| **C** | **Local-first / App Store (Stage 18)** — no backend at all                            | Would need **CloudKit sharing** (shared zone between two Apple IDs) or a share-sheet export.                                                     | **Emergency _push_ is near-impossible with no server** (nothing to push from). CloudKit cross-Apple-ID sharing is complex and out of Stage 18/19 scope. Good for _manual_ share, not live alerts.                                                                                                   |
| **D** | **Narrow "carer relay"** _(recommended)_                                              | A _minimal_ shared service holding only the **link**, a **push channel**, and a small **shared summary projection** — not the full record store. | **Data-minimization sweet spot.** You become controller of a _tiny bounded_ dataset (a link row + a few summary numbers + push tokens), not everyone's full medication history. Full data stays local-first/BYO; only a **consented projection** is shared.                                         |

**Why D wins:** it gives the user the three things they asked for (alerts, metrics,
scoped help) while holding the _least_ third-party data possible — which is exactly what
GDPR data-minimization and the FTC reward, and it keeps the blast radius small. It is
still a backend you operate, so N3 still has to move — but it moves a _little_, not all
the way to "hosted SaaS for everyone's full records."

---

## 3. Feasibility by capability (what exists vs what's new)

### 3.1 Emergency notifications — rails ~70% there

- **Triggers already exist as pure logic:** missed-pattern over a window
  (`FR-HIS-3`, `core/adherence.ts`), logged events (Stage 15 `EventInstance`, e.g. a
  seizure), and a new **manual SOS** (one button → one record).
- **Delivery exists but is owner-scoped:** the Web Push relay (`push_subscriptions`,
  `scheduled_pushes`, the `send-push` Edge Function on a `pg_cron` tick —
  `0005_push_notifications.sql`, `0006_push_cron.sql`) already delivers to a closed app,
  but every policy is `user_id = auth.uid()` (`0005:28-29,51-52`). **New work:** a
  `carer_links` table + an **emergency fan-out** — on a patient trigger, enqueue a push
  to each _linked carer's_ subscription. The `send-push` function already reads across
  users via the service-role key (`0005:54-56`), so the fan-out lives there.
- **Safety:** an emergency push says _"check on X"_ / _"missed-dose pattern"_ — **never a
  dose amount** (same FR-6.6 discipline the dose relay already keeps, `0005:11`).

### 3.2 General metrics — reuse Stage 17 wholesale

- **Stage 17 (GP Adherence Summary)** already computes adherence + flare-ups **on-device**
  and renders a shareable clinician report. The carer "general metrics" view is the
  **same computation, shared live** to a different audience.
- **New work:** publish a **summary projection** (a handful of numbers, recomputed
  client-side and pushed to the relay) rather than the raw records — keeps §2-D minimal.

### 3.3 Scoped data access — read-mostly, granular, revocable

- Define **scopes** the patient grants per carer: `alerts-only` ⊂ `summary` ⊂
  `schedule+events` ⊂ `full`. Default to the _least_. The carer app renders whatever the
  granted projection contains and nothing more.
- **Safety invariant (PRD NFR-Safety) extends to carers:** a carer **never originates or
  edits a dose**. The most a carer write can be is a **nudge** (ask the relay to send the
  _patient_ a reminder) — which still carries no amount. No carer path may write to
  `doseLog` / `doseOverride`.

### 3.4 What's genuinely new (the build surface)

- `carer_links` (patient_id, carer_id, scope, status, consent_at, revoked_at) + RLS that
  lets **either party read the link** and **only the patient mutate scope/revoke**.
- A **shared summary** store (the minimized projection) readable by linked carers.
- The **emergency fan-out** in `send-push`.
- An **invite/accept** flow (email or code) and a **revoke** flow.
- A **carer-mode UI** (role-gated screens; can be the same app — see §5).
- The **legal pack** (§4).

---

## 4. Privacy & legal — the crux (why this is N3, not a screen)

Sharing special-category health data with a **named third party** is a _deliberate
disclosure_, which is heavier than merely _storing_ it:

- **GDPR (UK/EU):** medication + condition data is **Art. 9 special-category**. The
  disclosure to a carer needs the patient's **explicit, specific, separate consent**
  ("share my adherence + alerts with <named carer>"), a clear **scope**, and an easy
  **revoke** (un-link → stop sharing → delete the projection). The carer's _own_ account
  data is ordinary personal data you must also handle.
- **You become a data controller** of the shared projection + links + push tokens. The
  _entire_ companion-spike apparatus applies (privacy policy, **self-serve account+data
  deletion**, ICO 72-h breach, FTC HBNR 60-day, WA-MHMDA opt-in + private right of
  action) — but **scaled to a minimal dataset** if you take §2-D. Minimization is your
  best friend here.
- **Apple:** a carer app with accounts re-triggers the **in-app account-deletion gate**
  and flips privacy labels from Stage 18's clean _"Data Not Collected"_ to **"Health &
  Fitness, linked to you."** → **Do not bolt carer onto the local-first App Store
  binary.** It belongs on the hosted/web path (or a separate "SteadyDose Care" app).
- **N4 nuance:** N4 rules out _clinic/EHR_ features. A _family carer_ is not a clinic, but
  it **is** third-party access, so N4's wording should be clarified, not just N3.

---

## 5. Product shape: one app or two?

| Option                                         | Shape                                                                                                                                                   | Trade-off                                                                                                                                                                 |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Role-gated single codebase** _(recommended)_ | One app; a **carer mode** lights up carer screens; patient mode is unchanged. Carer/relay features only activate on the **hosted/BYO-with-relay** path. | One codebase, shared components (reuse Stage 17 charts). The **local-first App Store binary simply never enables carer mode**, so its clean privacy posture is preserved. |
| **Separate "SteadyDose Care" app**             | A second, slimmer app for carers.                                                                                                                       | Cleaner mental model + App Store privacy story, but a second build/submission/codebase to maintain. Consider only if the carer UX diverges a lot.                         |

Recommendation: **role-gated single codebase**, with a hard rule that carer/relay code is
inert unless a backend + an accepted link are present (mirrors `getBackendConfig() ===
null ⇒ local-first`, `config.ts`). The App Store binary stays carer-free.

---

## 6. How it sits against the existing specs/stages

- **Reopens PRD N3** (no multi-tenant). Must be **amended** — ideally narrowly: _"opt-in
  carer sharing of a minimized projection"_ rather than _"full multi-tenant SaaS."_
- **Clarifies N4** (third-party access, carer ≠ clinic).
- **Builds on:** Stage 15 (event triggers), Stage 17 (the metrics computation), the push
  relay (`0005`/`0006`), the injectable `SyncBackend` port if a carer needs a real sync
  channel for the projection.
- **Must NOT regress Stage 18** — keep carer out of the local-first binary (§4).
- **Companion spike** (`2026-06-20-open-source-app-store-and-privacy.md`) is the legal
  reference; its multi-tenant analysis was shelved for the App Store decision but is
  **live again** for this.

---

## 7. Recommended path (phased — each phase shippable, de-risks the next)

0. **Decide tenancy first.** Amend **N3** to permit a _narrow consented carer relay_
   (§2-D). Cheapest, highest-leverage step; prevents building against a stale non-goal
   (exactly the lesson from the companion spike's §6.4).
1. **Phase 1 — one-way snapshot share (no backend change).** Patient generates a **Stage
   17 summary** and shares it (link/PDF/native share). No live access, no carer account,
   minimal new legal surface (a one-off disclosure the patient initiates). **Best MVP** —
   proves the value of "let my family see how I'm doing" before any relay exists.
2. **Phase 2 — consented emergency relay.** `carer_links` + invite/accept/revoke + the
   **emergency fan-out** in `send-push` (missed-pattern, events, manual SOS). First real
   shared-backend addition → **legal pack required** (consent-for-disclosure, deletion,
   breach runbook; the short lawyer review lands here).
3. **Phase 3 — live scoped metrics.** Sync the **summary projection** to the carer app
   with granular scopes + revoke; optional carer **nudge** (no dose value, no dose write).
4. **Phase 4 (optional) — richer scoped detail / multiple patients per carer.** Only if
   demand proves out; widens the controller surface, so weigh against minimization.

**Effort (very rough, eng only):** Phase 1 ≈ 1–2 days (mostly Stage 17 reuse). Phase 2 ≈
4–7 days (links + fan-out + invite/consent UI + tests + RLS). Phase 3 ≈ 4–6 days. Legal
pack + lawyer review is a parallel, non-eng cost from Phase 2.

---

## 8. Open decisions (for you)

1. **Tenancy appetite:** accept a _narrow_ relay (§2-D, recommended), or keep N3 absolute
   and ship **only** Phase 1 snapshot-sharing (no live carer access ever)?
2. **Where carer lives:** role-gated in the main app (recommended) vs a separate "Care"
   app — and confirm it's **excluded from the Stage 18 local-first binary**.
3. **Emergency triggers in v1:** which of {missed-pattern, logged event/seizure, manual
   SOS} fire a carer alert first? (SOS is simplest + highest signal.)
4. **Carer write capability:** strictly read-only, or allow a **nudge** (reminder to the
   patient, no dose)? (Recommend nudge-at-most.)
5. **Scope granularity:** a single `summary` scope to start, or the full
   `alerts ⊂ summary ⊂ schedule+events ⊂ full` ladder?
6. **Jurisdiction at launch** (inherits the companion spike's Q): UK-first vs global from
   day one (UK-GDPR + FTC-HBNR + WA-MHMDA all live the moment you operate the relay).

---

## 9. Sources

**This repo (integration points cited)**

- Push relay + owner-scoped RLS + service-role fan-out seam: `supabase/migrations/0005_push_notifications.sql`, `0006_push_cron.sql`; per-user isolation `supabase/migrations/0001_records.sql:44-50`.
- Reuse targets: `specs/stage-17-gp-adherence-summary.md` (metrics), `specs/stage-15-event-tracking.md` (event triggers), `src/core/adherence.ts` (missed-pattern), `src/sync/syncEngine.ts` (injectable `SyncBackend` port), `src/config.ts` (`null ⇒ local-first` gate).
- Safety invariant: `specs/01-prd.md` NFR-Safety / FR-6.6 (a notification never carries a dose amount).

**Legal / platform (see also the companion spike §9)**

- ICO — special-category (health) data & explicit consent: https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/special-category-data/
- ICO — sharing personal data / data sharing code of practice: https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/data-sharing/
- FTC — Health Breach Notification Rule (health apps not under HIPAA): https://www.ftc.gov/business-guidance/resources/complying-ftcs-health-breach-notification-rule-0
- WA "My Health My Data" Act (consumer health data, private right of action): https://www.atg.wa.gov/protecting-washingtonians-personal-health-data-and-privacy
- Apple — in-app account deletion requirement: https://developer.apple.com/support/offering-account-deletion-in-your-app/
- Apple — App Privacy Details (nutrition labels, "linked to you"): https://developer.apple.com/app-store/app-privacy-details/
- Apple CloudKit — sharing records across users (`CKShare`), if option C is ever revisited: https://developer.apple.com/documentation/cloudkit/shared-records
