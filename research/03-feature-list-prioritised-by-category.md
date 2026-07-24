# Feature List — by Category, Prioritised

_Prioritisation reflects the product's strategic focus (better medication use + better physician conversations + rounded dataset + patient insight), anchored in the evidence: a meta-analysis ranks **documentation and reminders** highest; PGHD research says the **distilled clinician-ready output** is the unlock; reviews say **notification reliability** is the #1 real-world failure point._

## Prioritisation scheme

| Priority        | Meaning                                                               |
| --------------- | --------------------------------------------------------------------- |
| **P0 — Must**   | Core to the value proposition or to safety/trust; v1 fails without it |
| **P1 — Should** | Strong differentiator or high user value; target for v1–v1.x          |
| **P2 — Could**  | Valuable but deferrable; v2+                                          |
| **P3 — Later**  | Nice-to-have / lower fit with the strategic focus                     |

## Cross-cutting guardrail (applies to every category)

> **Surface, don't interpret.** The app records, organises, and displays data and runs only _user-supplied_ adjustment logic. It never originates or calculates clinical/dose values, and insights stay **descriptive/correlational**, never **prescriptive**. This keeps the product clear of "dosage calculator" / regulated clinical-decision-support territory and is the same boundary that protects App Store eligibility. Features that edge toward this line are flagged ⚠️.

## Platform context

iOS-first from the JS codebase is decided; a Flutter native rewrite for both platforms is feasible. This matters most for **health-data integration**: Apple Health is device-local with no cloud API, so native access is required to reach it. Going native upgrades several "P2-because-hard" integration features toward "achievable."

---

## 1. Core medication management

_The regimen is the spine of the product._

| Priority | Feature                                                                           | Rationale                                                                                |
| -------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **P0**   | Define a fixed daily schedule of grouped dose slots                               | The organising structure; everything hangs off it                                        |
| **P0**   | Log a dose occurrence as taken / skipped / late (one tap)                         | "Documentation" is the highest-weighted adherence feature; logging integrity comes first |
| **P0**   | Per-medication metadata (name, strength, form, timing-sensitive vs flexible flag) | Needed for correct handling of late/missed occurrences                                   |
| **P0**   | Run **user-supplied** dose-adjustment logic for late/missed occurrences ⚠️        | Core function; logic stays external/user-owned to hold the safety line                   |
| **P1**   | Refill / supply tracking + low-supply alerts                                      | High user value; consistently expected in the category                                   |
| **P1**   | "Missed group" handling (partial/full group)                                      | Matches the real failure unit — a missed slot, not a single pill                         |
| **P2**   | Barcode/database-assisted medication entry                                        | Speeds setup (a known adoption lever); can start with manual entry                       |
| **P2**   | Multiple profiles (self + dependents)                                             | Useful but not core to the insight/doctor-conversation thesis                            |

## 2. Logging & data capture

_Fuel for both insight and the doctor conversation._

| Priority | Feature                                                | Rationale                                                              |
| -------- | ------------------------------------------------------ | ---------------------------------------------------------------------- |
| **P0**   | Side-effect logging tied to a medication/occurrence    | Directly feeds doctor conversations; what patients most want to convey |
| **P1**   | Symptom tracking (severity/frequency, custom symptoms) | Required to surface med↔symptom patterns                               |
| **P1**   | Mood / wellbeing logging                               | Cheap to capture, high correlation value (see Bearable)                |
| **P1**   | Free-text notes per occurrence                         | Captures the nuance a clinician actually asks about                    |
| **P2**   | Manual vitals entry (BP, weight, glucose)              | Valuable; partly superseded by wearable/records sync                   |
| **P2**   | Custom user-defined factors (sleep, diet, triggers)    | Powerful for correlations; can follow once core loop works             |

## 3. Health-data integration (wearables + records)

_The "rounded dataset." Hardest engineering; native direction helps._

| Priority | Feature                                            | Rationale                                                                        |
| -------- | -------------------------------------------------- | -------------------------------------------------------------------------------- |
| **P1**   | Apple Health (HealthKit) read integration          | Largest ecosystem; native access now feasible; core to the "rounded data" vision |
| **P1**   | Android Health Connect integration                 | The post-Google-Fit standard (Fit APIs deprecating from 2026)                    |
| **P2**   | Direct wearable APIs (Fitbit, Garmin, Oura, Whoop) | Each is its own mini-project; consider a unified wearable API instead            |
| **P2**   | Data normalisation layer across sources            | Quality > quantity; scores aren't comparable across vendors                      |
| **P2**   | Medical-records import (MyChart/Cerner, CCDA) ⚠️   | High value (Guava-style) but heavy privacy/compliance load; defer                |
| **P3**   | Lab/DICOM upload + parsing                         | Broad-hub scope; off the critical path for v1                                    |

## 4. Insights & analytics

_The "spark insights" pillar — bounded by the guardrail._

| Priority | Feature                                                      | Rationale                                                                |
| -------- | ------------------------------------------------------------ | ------------------------------------------------------------------------ |
| **P1**   | Med ↔ symptom/side-effect correlation views (descriptive) ⚠️ | The differentiating insight; must stay non-prescriptive                  |
| **P1**   | Adherence trends and history visualisation                   | Expected; low risk; supports the doctor conversation                     |
| **P2**   | Mood/energy/sleep correlations with regimen                  | Extends the insight engine (Bearable-style)                              |
| **P2**   | User-defined "experiments" (try X, observe Y) ⚠️             | Powerful, but frame as observation, never as clinical recommendation     |
| **P3**   | Predictive/AI nudges                                         | Useful later; AI-derived suggestions risk crossing the prescriptive line |

## 5. Physician & care-team collaboration (outputs)

_The headline differentiator. PGHD research says distillation is the unlock._

| Priority | Feature                                                     | Rationale                                                                |
| -------- | ----------------------------------------------------------- | ------------------------------------------------------------------------ |
| **P0**   | One-page **pre-visit summary** (what changed + what to ask) | The single biggest differentiator; the artifact clinicians actually want |
| **P0**   | Portable, current medication list (PDF/share)               | Useful at every visit and in ER/hospital contexts                        |
| **P1**   | Exportable adherence + side-effect report (PDF)             | Table stakes for doctor conversations; match MyTherapy                   |
| **P1**   | Secure one-time share code / link                           | Proven low-friction pattern (MyTherapy); privacy-preserving              |
| **P2**   | Patient-curated "what to share" selector                    | PGHD research: patients share selectively and for a reason               |
| **P3**   | Direct provider portal / EHR push                           | High integration cost; not needed to deliver the core value              |

## 6. Engagement & adherence support

| Priority | Feature                                                      | Rationale                                                    |
| -------- | ------------------------------------------------------------ | ------------------------------------------------------------ |
| **P0**   | Reliable, persistent/escalating reminders                    | The #1 real-world failure point; reliability beats features  |
| **P1**   | Confirm-to-dismiss notifications (no silent "assumed taken") | Closes the biggest adherence-logging gap                     |
| **P2**   | Caregiver / "medfriend" missed-dose alerts                   | High value for some segments; not core to the insight thesis |
| **P2**   | Appointment reminders                                        | Lowest-weighted in the adherence meta-analysis, but cheap    |
| **P3**   | Gamification / rewards / streaks                             | Low fit with an insight- and clinician-focused product       |
| **P3**   | Educational content                                          | Useful; off the critical path; sourcing/liability overhead   |

## 7. Privacy, security & data ownership

_A clear trust differentiator vs. pharma-funded and records-aggregating incumbents._

| Priority | Feature                                              | Rationale                                                       |
| -------- | ---------------------------------------------------- | --------------------------------------------------------------- |
| **P0**   | Local-first storage; user owns the data              | Core trust position; contrasts with data-monetising competitors |
| **P0**   | End-to-end encryption (at rest + in transit)         | Sensitive health data; baseline for credibility                 |
| **P0**   | No third-party data monetisation; transparent policy | The explicit differentiator vs. MyTherapy's model               |
| **P1**   | Recovery mechanism (recovery code)                   | Necessary companion to E2E encryption                           |
| **P1**   | Granular export/delete (data portability)            | User-ownership in practice; supports trust and compliance       |
| **P2**   | Per-share scoping & expiry on doctor shares          | Tightens the sharing model beyond a basic code                  |

## 8. Platform, sync & accessibility

| Priority | Feature                                                  | Rationale                                                              |
| -------- | -------------------------------------------------------- | ---------------------------------------------------------------------- |
| **P0**   | iOS native (decided)                                     | Already chosen; required for HealthKit access                          |
| **P1**   | Android native (Flutter rewrite)                         | Enables Health Connect; broadens reach with shared codebase            |
| **P1**   | Offline-first operation                                  | Reminders/logging must work without connectivity                       |
| **P1**   | Multi-device sync (last-write-wins)                      | Expected; aligns with existing architecture                            |
| **P2**   | Accessibility (large text, screen-reader, high contrast) | Important for older/chronic-condition users; bake in early where cheap |
| **P2**   | Localisation / multi-language                            | Broadens reach; deferrable past v1                                     |
| **P3**   | Web companion                                            | Convenient; not required for the core mobile loop                      |

---

## v1 critical path (the P0 spine)

Fixed grouped schedule → reliable confirm-to-dismiss reminders → one-tap occurrence logging (taken/skipped/late) with side-effect capture → user-supplied adjustment logic → local-first, E2E-encrypted, user-owned storage → **one-page pre-visit summary + portable medication list**.

Everything in P1+ (wearable integration, correlation insights, broader sharing) layers onto that spine without changing it — and each addition should be checked against the **surface-don't-interpret** guardrail.

_Priorities are a starting position, not fixed; revisit as user research and the build progress._
