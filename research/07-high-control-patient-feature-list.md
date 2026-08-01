# Feature List — the "high-control patient" positioning

_Speculative. A positioning exercise, not validated user research._

`research/03-feature-list-prioritised-by-category.md` prioritises features for the
medication-app market in general — a market whose centre of gravity is *"did you
remember to take it?"*. This document re-prioritises for a **narrower, sharper
segment**: patients whose condition is **well controlled**, whose regimen is
**stable and long-running**, and for whom the app's job is to *protect* that
control rather than to establish it.

It assumes a **PWA or native app holding no user data server-side**. That
constraint is not neutral — §2 shows it reorders the priorities as much as the
demographic change does.

---

## 1. Who this user is

The archetype (drawn from the epilepsy case that anchors the product, but the
shape generalises to T1D, IBD in remission, RA on biologics, bipolar on a stable
regimen, HIV on ART, post-transplant immunosuppression):

- **Seizure-free for months or years.** Holds a driving licence. Works full
  time. Travels. Has a stable regimen they could recite from memory.
- **Reviewed rarely** — neurology once every 6–12 months, not monthly. The
  appointment is a compression problem, not a frequency problem.
- **Not confused about their meds. Distracted by their life.** They do not need
  education about what a dose is; they need the regimen to survive a delayed
  flight, a bad night's sleep, a pharmacy that's out of stock, and a week where
  they are simply busy.
- **Control is the asset, and it is fragile.** One breakthrough event costs them
  their licence for 6–12 months, and a chunk of independence with it. The stakes
  attached to adherence are far higher than for the median adherence-app user,
  and they know it.
- **Privacy-motivated and technically capable.** A no-account, no-server product
  is a feature to them, not a limitation.

### What this changes

| The generic app assumes… | This user actually… |
| --- | --- |
| Forgetting is the problem | Remembers the regimen; **loses to disruption and ambiguity** |
| Adherence is the goal | Adherence is **instrumental** — the goal is uninterrupted control |
| Frequent clinical contact | Sees a specialist **twice a year**, so the record must span 6–12 months |
| Needs teaching | Needs **their own protocol executed reliably**, and to be left alone |
| Failure = a missed pill | Failure = **a breakthrough event, a licence, a job** |

The product is therefore closer to a **continuity-of-control instrument** than to
a pill reminder. Three modes, and the app should feel like three different apps:

- **Flare-up** — rare, high-stakes, executed under cognitive impairment. All P0.
- **Daily** — must cost near-zero attention. Friction is the whole battle.
- **Monthly / periodic** — supply continuity, patterns, review prep.

---

## 2. The no-server constraint — read this before the priorities

Holding no data server-side is compatible with almost every feature below, but it
hard-blocks a few and quietly reshapes several more.

### It rules **out**

| Capability | Why |
| --- | --- |
| **Reliable reminders in a PWA** | ⛔ **The critical one.** A web app cannot schedule a local notification for later. The Notification Triggers API (`TimestampTrigger`) never shipped beyond a Chromium origin trial; service workers are not alive at dose time; Web Push requires a server to send the push. Under a no-server rule, **a PWA cannot deliver a reminder unless the app happens to be open.** Reminder reliability is the #1 documented failure mode in this category (doc 01 §2) — so the constraint makes **native (or a Capacitor/native shell) effectively mandatory**, not a Stage-12-style "nice later". |
| Automatic caregiver / missed-dose alerts | Requires a server to observe absence and notify a third party. Only user-initiated sharing survives. |
| Server-mediated share links / one-time codes (MyTherapy's pattern) | Nothing to host the payload. Replaced by on-device PDF + share sheet + QR. |
| Cloud wearable APIs as a background source (Oura, Whoop, Fitbit, Garmin) | OAuth via PKCE is doable client-side, but **background token refresh and periodic pull are not**. Data only arrives when the app is open. ⚠️ Note: **the existing Stage 14 Oura integration fits this positioning poorly** and should be re-scoped or dropped. |
| Cross-device sync through our own backend | Replaced by user-owned cloud (below). |

### It rules **in** (and these get *cheaper*, not just possible)

- **HealthKit / Health Connect** are device-local by design. Under a no-server
  rule they go from "the hard integration" to **the only sane one** — and they
  cover sleep, HRV, cycle, and activity, which is most of what this segment's
  trigger analysis needs.
- **User-owned cloud** for sync and device-loss recovery: **CloudKit private
  database** (iOS) and Android Auto Backup / Drive app-data folder. The vendor
  holds nothing; the user's existing Apple/Google account does the work. This is
  the honest answer to "no server, but I can't lose 4 years of history."
- **No accounts at all** — no signup, no password, no reset, no breach surface.
  A material conversion and trust advantage with this segment specifically.
- **On-device automation**: Siri/Shortcuts, widgets, watch complications, NFC
  tags. All local, all zero-friction, all native-only.
- **Bundled reference data** (interaction tables, MHRA brand categories) ships
  with the binary and updates with the app — no user data leaves.

### Strategic cost to be explicit about

The product as built runs on Supabase (Stages 3–8: sync engine, RLS,
`push_records`, server-side `validate_record`). This positioning **demotes that
work to optional** and moves server-side validation back onto the client. That is
a real write-off and should be a conscious decision, not a drift. It also removes
the last technical reason the app must be a PWA.

---

## 3. Prioritisation scheme

Same scheme as doc 03, so the two can be diffed directly.

| Priority | Meaning |
| --- | --- |
| **P0 — Must** | The positioning fails without it |
| **P1 — Should** | Strong differentiator for *this* segment; v1–v1.x |
| **P2 — Could** | Valuable, deferrable |
| **P3 — Later** | Weak fit or high cost |

⚠️ marks features that edge toward the repo's standing guardrail — **surface,
don't interpret**. The app records, organises, and displays; it never originates a
clinical value and never states a legal or medical conclusion. This segment
generates *more* ⚠️ features than the general market, because the things they
care about (driving eligibility, rescue protocols, travel dose shifts, pregnancy)
are exactly the things it would be most dangerous to appear to advise on.

---

## 4. Flare-up mode — rare, high-stakes, degraded operator

_Design premise: **the user is post-ictal, frightened, or not the one holding the
phone.** Every interaction must survive being performed badly, hours late, or by
a stranger. This is the mode that earns the app its place, and it must be
reachable without unlocking into a nav hierarchy._

| Priority | Feature | Rationale |
| --- | --- | --- |
| **P0** | **One-tap event capture from outside the app** — lock-screen widget, watch complication, Siri phrase, Quick Settings tile | If it requires opening the app and navigating, it will not happen. Native-only; free under a no-server rule |
| **P0** | **Forgiving retroactive logging** — backdate freely, and an explicit *"time uncertain"* / *"sometime this morning"* option | Real events are logged hours later, from a gap in memory. Forcing a precise timestamp corrupts the record |
| **P0** | **Rescue-medication logging with hard guardrails** ⚠️ | Buccal midazolam / clobazam bridges carry max-in-24h and min-interval limits. Enter the **user's own prescribed protocol**, then enforce and display it. The app must show *"your protocol says max 2 in 24h; you have logged 1 at 14:32"* — never *"take another"* |
| **P0** | **Emergency/seizure action plan card**, viewable without unlocking the app | Current regimen, allergies, rescue protocol, emergency contact, what a bystander should do, when to call an ambulance. Entirely user- or clinician-authored text. High value, low build cost, no server |
| **P0** | **Automatic context snapshot attached to the event** | On log, capture the preceding 72h: doses taken/missed/late, sleep and HRV from HealthKit, any logged illness or alcohol. **Descriptive only** — this is the single highest-value use of the "rounded dataset" thesis, because it fires exactly when the user cannot reconstruct it themselves |
| **P1** | **Witness capture** — hand the phone over: a duration timer, a voice memo, a short structured "what did you see" prompt | The clinically useful description of an event is the one the patient cannot give |
| **P1** | **Post-event checklist**, user-configured ⚠️ | Contact neurologist? Notify DVLA? Work? Reset the driving clock? Presented as *the user's own checklist*, never as legal advice |
| **P1** | **Cluster / frequency-in-window view** | "3 events in 6 weeks after 14 months clear" is the sentence that triggers a clinical conversation |
| **P2** | Photo/video attachment to an event | Useful evidence; storage and privacy weight |
| **P2** | Fall/impact detection prompt via watch → "did something happen?" ⚠️ | Native-only, plausible, and easy to get creepy or wrong. Prompt only; never auto-log |
| **P3** | Automatic emergency contact notification | ⛔ Needs a server, or an unreliable local SMS hack. Out under the constraint |

---

## 5. Daily mode — fit into a busy life

_Design premise: **attention is the scarce resource, not memory.** The competitor
here is not another app; it is the pill box and the habit the user already has.
Anything that costs more than a glance loses._

| Priority | Feature | Rationale |
| --- | --- | --- |
| **P0** | **"Did I already take it?" resolution** | The signature daily failure for a stable-regimen patient on autopilot, and the direct cause of double-dosing. The answer must be visible **without opening the app** — widget, complication, glance. Arguably the highest-frequency job the product does |
| **P0** | **Log from outside the app** — widget button, watch tap, Siri, Shortcuts automation | One tap, no launch. Native-only, no server, and the largest single friction reduction available |
| **P0** | **Reliable, escalating, confirm-to-dismiss reminders** | Unchanged from doc 03, but see §2: **native is the only way to deliver this** under the constraint. A silently-swiped reminder that the app records as "assumed taken" corrupts the record, which is the asset |
| **P0** | **Late-dose adjustment** ⚠️ (already the product's spine) | Retained wholesale. The user-supplied-equation boundary holds |
| **P1** | **Watch app as a first-class surface** | For someone in meetings all day, a wrist tap is delivered and a phone banner is not. Also the best "did I take it" surface |
| **P1** | **Time-zone and travel handling** (already built) | Elevated for this segment: they fly. Long-haul dose shifting should be **user-planned and app-executed**, ⚠️ never app-designed |
| **P1** | **Quiet by default, loud when it matters** | Adaptive noticeability: silent confirmation when on schedule, escalation only when a timing-sensitive dose is drifting. A well-controlled patient will disable an app that nags them daily, and then it protects nothing |
| **P1** | **Fast disruption logging** — poor sleep, alcohol, illness, stress, missed dose, new medicine | The known trigger set. Must be a single tap each; this is the raw material for §6 pattern views and §4 context snapshots |
| **P2** | **NFC tag on the pill box** — tap the phone to the box to log | Friction approaches zero and it piggybacks on a habit that already exists. Native-only, cheap, genuinely novel in this category |
| **P2** | Free-text note on an occurrence | Carried over from doc 03; low cost |
| **P2** | Sick-day / vomiting handling ⚠️ | "Dose taken, then vomited within 30 min" is a real gap in every competitor. Record the fact; **do not** advise on redosing |
| **P3** | Streaks and gamification | Doc 03 rates this P3 and that holds — **but see §7**: "days since last event" is not gamification to this user, it is the number that governs their licence |

---

## 6. Monthly / periodic mode — continuity and patterns

_Design premise: **the slow failures are the ones that cost control** — running
out, a brand switch, a drifting pattern nobody noticed. These are cheap to
prevent and expensive to miss._

| Priority | Feature | Rationale |
| --- | --- | --- |
| **P0** | **Supply tracking and refill lead-time alerts** | Doc 03 rates this P1. For this segment it is **P0**: running out is not an inconvenience, it is a breakthrough-event risk. Must alert on the **repeat-prescription lead time** (order-by date), not the last-pill date |
| **P1** | **Holiday / travel supply calculator** | "Away 14 days from the 3rd — you need 31 tablets and you have 22." Trivial arithmetic, high anxiety relief, and it prevents the worst supply failure |
| **P1** | **Brand and manufacturer tracking with switch alerts** ⚠️ | Specific and under-served. MHRA classifies anti-seizure medicines into three switching categories — **Category 1** (carbamazepine, phenytoin, phenobarbital, primidone) requires maintaining a *specific manufacturer's* product; **Category 2** (including lamotrigine, sodium valproate, topiramate, clobazam, zonisamide) is a clinical judgement. Record which manufacturer was dispensed and flag a change. Frame as *"this is a different manufacturer from last time; your medicine is MHRA Category 1"* — a **factual prompt to ask the pharmacist**, never an instruction to refuse the medicine. Ship the category table as bundled data and version it |
| **P1** | **Drug-shortage / continuity notes per medication** | AED shortages are a recurring UK reality. Even a manual "pharmacy said 2-week wait" note with a follow-up prompt beats nothing |
| **P1** | **Pattern views over long windows** ⚠️ | 6–12 month windows, not 7-day. Adherence drift, event clustering, trigger co-occurrence. **Descriptive and correlational only** — "you logged 4 of 5 events within 48h of a night under 5 hours' sleep" |
| **P1** | **Cycle-aware patterns** (where relevant) ⚠️ | Catamenial patterns are real and clinically actionable, and HealthKit already holds the cycle data on-device. Surface the correlation; the clinician draws the conclusion |
| **P2** | **Blood-level and lab tracking** with due-date prompts | Lamotrigine and valproate levels, LFTs, sodium, vitamin D on enzyme-inducers. Manual entry is fine; the value is having a 5-year series in one place at the appointment |
| **P2** | Repeat-prescription request reminder tied to the GP's cycle | Small, and it targets the actual bottleneck in UK supply |
| **P3** | Pharmacy integration / auto-refill | ⛔ Needs a server and partnerships. Out |

---

## 7. Control metrics — the segment-specific reframe

Doc 03 puts streaks at P3 as poor fit. That judgement is right about *badges* and
wrong about *this number*.

| Priority | Feature | Rationale |
| --- | --- | --- |
| **P1** | **"Days since last event" as a primary, prominent metric** ⚠️ | Not a gamification streak — for a UK driver it is the count that determines their licence. DVLA Group 1 licensing generally requires **12 months seizure-free**, with **6 months** applying to a single unprovoked seizure (subject to clinical factors), and separate provisions where a seizure followed a doctor-directed medication change. **Display the count and the user's own configured target. Never state that the user is or is not eligible to drive, and never prompt them to drive.** Link out to DVLA/Epilepsy Action rather than encoding the rules as authority |
| **P2** | Longest-controlled-period history | Context for whether the current run is typical or exceptional |
| **P2** | Medication-change markers on every timeline (already specced, Stage 16) | "Control changed 3 weeks after the dose change" is the highest-value observation the record can support |
| **P3** | Badges, rewards, points | Correctly P3. Actively wrong for this segment — it trivialises the stakes |

---

## 8. Clinician output — a 12-month compression problem

This segment sees a specialist **rarely**, which makes doc 03's headline
differentiator *more* important, not less, and changes its shape: the summary
must span a year, not a fortnight.

| Priority | Feature | Rationale |
| --- | --- | --- |
| **P0** | **One-page pre-visit summary, scoped to "since last visit"** | Unchanged as the headline differentiator, but anchored to the previous appointment date and capable of compressing 12 months to one page |
| **P0** | **Portable current medication list** (PDF/share) | Unchanged. Doubles as ER/hospital material and pairs with the §4 action plan card |
| **P0** | **On-device export and share sheet** (PDF, print, AirDrop, email) | Under the no-server rule this *replaces* share links. Not a downgrade — for an in-room handover it is faster than a code |
| **P1** | **Patient-authored agenda** — "3 things I want to ask" | PGHD research names the pre-visit agenda explicitly (doc 01 §3). For a twice-a-year appointment, the questions the patient forgot to ask cost them six months |
| **P1** | **Event log formatted for a specialist** — dates, durations, witness descriptions, context | The specialist's actual diagnostic input, and the thing the patient reconstructs worst from memory |
| **P2** | QR-code handover for in-room transfer | Bounded payload, no server, no email trail |
| **P2** | Patient-curated "what to share" selector | PGHD research: patients share selectively and for a reason |
| **P3** | Provider portal / EHR push | ⛔ Server-dependent by definition. Out |

---

## 9. Platform, data and trust

| Priority | Feature | Rationale |
| --- | --- | --- |
| **P0** | **Native app (iOS first)** | §2: under the no-server rule, native is the **only** way to deliver reliable reminders, and it also unlocks widgets, complications, Siri, HealthKit and NFC — four of the highest-value items above. This flips the audit's deferred item #12 into the critical path |
| **P0** | **No account, no server-side data, stated plainly in-product** | The trust position, and with this segment it is also a *conversion* position |
| **P0** | **Local-first storage; user owns the data** | Unchanged |
| **P1** | **User-owned cloud backup and sync** (CloudKit private DB / Drive app-data) | Device loss must not cost 4 years of history. Preserves "we hold nothing" |
| **P1** | **Encrypted local export/import** | Portability and the no-lock-in promise, and the fallback if user-cloud sync slips |
| **P1** | **HealthKit / Health Connect read integration** | Sleep, HRV, cycle, activity — the trigger dataset, on-device, no server |
| **P1** | **Watch app** | See §5 |
| **P2** | Optional on-device app lock (biometric) | The `src/crypto/` stub's natural home; cheap and expected for health data |
| **P2** | Android (Health Connect) | Broadens reach; sequence after iOS proves the positioning |
| **P2** | Accessibility (dynamic type, screen reader, contrast) | Do it because it is right, not because this segment demands it — this cohort skews younger and less impaired than the general market |
| **P3** | Web companion / the PWA itself | Demoted to a **viewer**, not the product. It cannot remind |
| **P3** | Multiple profiles / dependents | Off-thesis for a self-managing single patient |
| **P3** | Medical records aggregation (MyChart/CCDA) | ⛔ Heavy, and irreconcilable with holding no data server-side |

---

## 10. Delta against `03-feature-list-prioritised-by-category.md`

### Moves up

| Feature | Was | Now | Why |
| --- | --- | --- | --- |
| iOS native | P0 *(deferred in the audit)* | **P0, critical path** | No-server + reliable reminders leaves no alternative |
| Refill / supply tracking | P1 | **P0** | Running out is a control risk, not an inconvenience |
| Off-app logging surfaces (widget/watch/Siri/NFC) | *absent* | **P0/P1** | The dominant friction reduction for a busy, capable user |
| "Did I already take it?" resolution | *absent* | **P0** | The signature daily failure mode of a stable regimen |
| Rescue-med protocol enforcement | *absent* | **P0** ⚠️ | Flare-up mode's sharpest safety feature |
| Emergency action plan card | *absent* | **P0** | High value, low cost, no server |
| Automatic event context snapshot | *absent* | **P0** | Best expression of the rounded-dataset thesis |
| Brand/manufacturer switch alerts | *absent* | **P1** ⚠️ | Specific, under-served, MHRA-grounded |
| Travel supply calculator | *absent* | **P1** | Prevents the worst supply failure |
| Days-since-last-event metric | *P3 as "streaks"* | **P1** ⚠️ | Reframed: licence-relevant, not a badge |
| Apple Health / Health Connect | P1 | **P1, but now the only viable source** | Device-local suits the constraint |

### Moves down

| Feature | Was | Now | Why |
| --- | --- | --- | --- |
| Caregiver / medfriend alerts | P2 | **P3 / out** | ⛔ Server-dependent, and this user manages alone |
| Cloud wearable APIs (Oura, Whoop, Fitbit) | P2 | **P3** | ⛔ No background pull without a server. **Re-scope Stage 14** |
| Secure share code / link | P1 | **P3** | ⛔ Replaced by on-device PDF + share sheet |
| Medical-records import | P2 | **P3 / out** | Irreconcilable with the constraint |
| Multiple profiles | P2 | **P3** | Off-thesis |
| Barcode/database-assisted entry | P2 | **P3** | One-time setup cost for a stable regimen; a five-year regimen is typed once |
| Educational content | P3 | **P3, firmly** | This user knows more about their condition than the app will |
| Web companion / PWA | P3 | **P3, as a viewer only** | It cannot remind |

---

## 11. Revised critical path

> **Native shell with reliable local reminders** → off-app logging (widget /
> complication / Siri) with **"did I already take it?"** answerable at a glance →
> late-dose adjustment (existing spine) → **flare-up capture with automatic
> context snapshot + rescue protocol guardrails** → supply and refill lead-time
> alerts → **"since last visit" one-page summary + portable med list, exported
> on-device** → user-owned cloud backup.

Everything else layers onto that without changing it. Note what the first item
does to the roadmap: **the native shell moves from deferred to blocking**, and it
gates four of the seven steps.

---

## 12. Open questions to settle before building on this

1. **Is the no-server rule a principle or a preference?** It costs automatic
   caregiver alerts, background wearable sync and share links, and it writes off
   most of Stages 3–8. Worth confirming it buys enough trust to be worth that.
2. **Does "user-owned cloud" (CloudKit/Drive) satisfy the rule?** If not, device
   loss means total data loss, and this segment will not accept that for a
   multi-year record.
3. **Is the segment large enough?** Well-controlled patients are the ones least
   likely to think they need an app — the classic addressable-but-unmotivated
   trap. The wedge is probably *travel, supply and the annual review*, not
   adherence, because those are the pains they already feel.
4. **Where exactly is the line on driving and rescue protocols?** Both are the
   highest-value features here and the closest to the guardrail. Settle the exact
   wording in the spec before either is built.
5. **Regulatory posture.** Enforcing a user-entered rescue protocol and flagging
   brand switches are both defensible as *recording and surfacing the user's own
   data and published reference tables* — but they are closer to the medical-device
   line than anything currently shipped. Worth an explicit written position.
6. **Does the flare-up/daily split survive contact with a real user?** The whole
   structure of this document rests on it.

---

## Sources

Regulatory anchors for the two features that depend on them (§6 brand switching,
§7 days-since-last-event). Both should be re-verified before implementation, and
neither should be encoded in-app as authoritative.

- [Driving rules for epilepsy — Epilepsy Action](https://www.epilepsy.org.uk/living/driving/driving-rules-for-epilepsy)
- [Epilepsy advice and guidelines for licence holders (INS9) — DVLA](https://assets.publishing.service.gov.uk/media/5a7eef1440f0b6230268c73e/INS9.pdf)
- [DVLA epilepsy driving licence requirements, Group 1 — Medical Fitness To Drive Consultancy](https://www.mftdc.co.uk/case-studies/dvla-epilepsy-driving-licence-requirements-uk-group-1/)
- [Switching brand and generic anti-seizure medicines for epilepsy — NHS Specialist Pharmacy Service](https://sps.nhs.uk/articles/switching-brand-and-generic-anti-seizure-medicines-for-epilepsy/)
- [Appropriately switching antiepileptic drugs (Briefing 70) — PrescQIPP](https://www.prescqipp.info/media/1071/b70-appropriately-switching-antiepileptic-drugs-20.pdf)

Product-strategy inputs are carried over from `01-medication-app-landscape-analysis.md`
(adherence-app feature meta-analysis; PGHD literature) and
`02-competitor-feature-comparison.md`.

_Priorities here are speculative and demographic-driven. Treat them as a position
to argue with, not a plan._
