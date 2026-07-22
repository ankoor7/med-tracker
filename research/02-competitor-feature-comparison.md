# Direct Competitor Feature Comparison

_Four apps chosen because together they span the exact intersection being targeted — medication management, patient insight, doctor-facing output, and health-tracker data. Each leads in a different tier, so the comparison also maps where the white space is._

| App           | Tier                          | Why it's a direct comparator                                                  |
| ------------- | ----------------------------- | ----------------------------------------------------------------------------- |
| **Medisafe**  | Adherence-first               | Market leader; sets the bar for reminders, interactions, and provider reports |
| **MyTherapy** | Adherence + journal           | Closest "free" all-rounder; strong doctor-share flow and side-effect logging  |
| **Bearable**  | Symptom-correlation / insight | The clearest "spark insights" comparator; correlation engine is its core      |
| **Guava**     | Health hub / records          | Combines records, wearables, correlations, and AI summarisation in one place  |

---

## Side-by-side feature matrix

Legend: ✅ strong / core · ◑ partial or basic · ⚠️ caution/limited · ❌ not a focus · ❓ not clearly documented (verify)

| Dimension                             | Medisafe                                                       | MyTherapy                                                           | Bearable                                       | Guava                                                   |
| ------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------- |
| **Primary positioning**               | Clinical-grade adherence                                       | Free pill reminder + health diary                                   | Symptom/mood correlation tracker               | Personal health organiser + records                     |
| **Med reminders & scheduling**        | ✅ Advanced, behavioural-AI nudges                             | ✅ Reliable, barcode/database setup                                 | ◑ Reminders, not the focus                     | ✅ Reminders + pill-count + refill                      |
| **Adherence logging & history**       | ✅ Detailed, with adherence analytics                          | ✅ Auto-documents taken/skipped + notes                             | ◑ Logs meds among many factors                 | ✅ Tracks schedule + effects                            |
| **Symptom & side-effect tracking**    | ◑ Some health measurements                                     | ✅ Symptoms + side-effects in diary                                 | ✅ Core; unlimited custom symptoms             | ✅ Symptom tracker + body heat map                      |
| **Mood / wellbeing tracking**         | ◑ Limited                                                      | ✅ Mood logging                                                     | ✅ Core strength                               | ✅ Mood + mental health                                 |
| **Correlation / insight engine**      | ◑ Provider-side "real-world data" insights                     | ◑ Trends in diary                                                   | ✅ Core; correlations, experiments, reports    | ✅ Correlations across meds/symptoms/lifestyle          |
| **Wearable / health-app integration** | ◑ Broad health tracking; HealthKit ❓ scope                    | ◑ Draws iPhone + Apple Watch data (HealthKit)                       | ◑ Imports some metrics (e.g., Apple Health) ❓ | ✅ Syncs sleep trackers + glucose monitors              |
| **Medical records integration**       | ❌                                                             | ❌                                                                  | ❌                                             | ✅ MyChart/Cerner, 50,000+ providers; CCDA/DICOM upload |
| **Doctor-facing output**              | ✅ Adherence reports for providers                             | ✅ One-time code shares plan + diary; exportable report             | ✅ Weekly/correlation reports to share         | ✅ AI-summarised records; shareable                     |
| **Caregiver / family sharing**        | ✅ "Medfriend" missed-dose alerts                              | ◑ Sharing via code                                                  | ❌ Personal-use focus                          | ◑ Care-coordination features                            |
| **Drug-interaction checking**         | ✅ Built-in                                                    | ✅ Interaction check                                                | ❌                                             | ❓                                                      |
| **AI features**                       | ✅ Behavioural AI / voice agent (enterprise)                   | ❌                                                                  | ◑ Correlation analytics                        | ✅ AI note summarisation + data extraction              |
| **Platforms**                         | iOS, Android                                                   | iOS, Android                                                        | iOS, Android, web                              | iOS, Android, web                                       |
| **Data model / privacy**              | Cloud, account required                                        | Cloud; vendor monetises adherence data via pharma/research partners | Cloud; personal-data focus                     | Cloud; aggregates sensitive records                     |
| **Business model / pricing**          | Freemium — **paid since Jan 2026**, free tier capped at 2 meds | **Free** (pharma/research-funded)                                   | Free + subscription (~$34.99/yr)               | Free + premium                                          |
| **Open source**                       | ❌                                                             | ❌                                                                  | ❌                                             | ❌                                                      |

> Cells marked ❓ or ⚠️ should be re-verified against current store listings before any product decision rests on them. Wearable-integration scope in particular shifts often.

---

## Per-app profiles

### Medisafe — the adherence benchmark

**Strengths:** most clinically positioned; behavioural-AI reminders; "Medfriend" caregiver alerts; interaction checking; provider-facing adherence analytics.
**Weaknesses for this concept:** no records integration; insight is provider-side, not patient-facing; the 2026 paywall (2-med free cap) opened a gap at the free end; enterprise features can overwhelm individuals.
**Take-away:** the reference for reminder reliability and provider reporting. Match its logging/reminder integrity; don't try to out-enterprise it.

### MyTherapy — the free all-rounder

**Strengths:** genuinely free; auto-documents intakes; symptom/side-effect diary; clean **one-time-code doctor-share** of plan + diary; exportable compact health report; pulls HealthKit/Apple Watch data; interaction checking.
**Weaknesses for this concept:** business model depends on sharing adherence data with pharma/research partners (a privacy/trust contrast for a local-first, user-owned product); no correlation/insight engine; no records integration.
**Take-away:** the closest functional competitor on the doctor-conversation axis. Its share-code flow and pre-visit report are the patterns to beat — and its data model is the thing to differentiate against (user-owned, E2E-encrypted, no third-party monetisation).

### Bearable — the insight engine

**Strengths:** best-in-class correlation tracking; unlimited custom factors; experiments; reports; explicitly designed to fix the "I couldn't remember my symptoms at the appointment" problem.
**Weaknesses for this concept:** not anchored to a medication regimen; general symptom tracker rather than a med-management tool; no records or interaction features; reports are exploratory rather than a tight clinician-ready summary.
**Take-away:** the model for _patient insight_, but it stops short of regimen-anchoring and of a focused pre-visit artifact. That's the differentiation lane.

### Guava — the records hub

**Strengths:** unifies records (MyChart/Cerner), labs, wearables (sleep/glucose), meds, symptoms, and correlations; AI summarises clinician notes; body heat-map UX.
**Weaknesses for this concept:** breadth dilutes the medication-management focus; aggregating sensitive records centrally is a heavier privacy/compliance burden; US-records-centric.
**Take-away:** shows demand for "rounded dataset + insight + records." The opportunity is to deliver the _medication-anchored, distilled-output_ slice without taking on full records-aggregation scope (and its privacy load) on day one.

---

## Synthesis — where the white space is

| Capability                                       | Owned by an incumbent?    | White space                                                               |
| ------------------------------------------------ | ------------------------- | ------------------------------------------------------------------------- |
| Reliable reminders + logging                     | Yes (Medisafe, MyTherapy) | Table stakes — must match, won't differentiate                            |
| Doctor-share of plan/diary                       | Partly (MyTherapy)        | Improve: from raw diary → **distilled pre-visit summary**                 |
| Patient-facing correlation insight               | Partly (Bearable, Guava)  | **Regimen-anchored** insight, bounded to descriptive (not prescriptive)   |
| Wearable-enriched dataset                        | Partly (Guava)            | Deeper, normalised, native-integrated context                             |
| User-owned / E2E-encrypted data                  | **No incumbent**          | Clear trust differentiator vs. pharma-funded / records-aggregating models |
| The 1-page "what changed + what to ask" artifact | **No incumbent**          | The headline differentiator                                               |

**Bottom line:** no competitor owns _medication-anchored logging + wearable-enriched context + a distilled, clinician-ready output + user-owned data_ simultaneously. That combination is the defensible position.

_App features and pricing change frequently — verify on current store listings before committing._
