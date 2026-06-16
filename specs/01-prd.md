# SteadyDose — Product Requirements Document (PRD)

| | |
|---|---|
| **Working name** | SteadyDose |
| **Doc owner** | (you) |
| **Status** | Draft for build |
| **Related** | `00-one-pager.md`, `02-architecture.md`, `03-implementation-plan.md` |

---

## 1. Overview & problem statement
Patients on anti-epileptic drugs (AEDs) follow a fixed daily schedule of doses, often several medications grouped at the same times. Taking a dose late requires a one-off **adjusted dose** to keep blood concentration approximately constant until the next scheduled dose, after which the normal schedule resumes. Managing this in a spreadsheet provides no reminders, no secure synced history, no multi-device access, and no correct handling of time zones, flights, or BST/GMT transitions.

SteadyDose provides the **data, scheduling, logging, safety, history, and reminder** layer around this routine. It does **not** compute the pharmacological adjustment itself; the user supplies that via a documented extension interface.

## 2. Goals
- G1. Manage multiple medications and a **fixed, grouped daily schedule**.
- G2. Make logging fast for the common case and support **adjusted doses** for late doses.
- G3. Enforce user-defined **safety caps** on every logged or suggested dose.
- G4. Be correct across **time zones, flights, and BST/GMT**.
- G5. Keep **secure history** that **syncs across devices** and is **usable by the backend** (not zero-knowledge).
- G6. Keep all data in the **user's own AWS account**; ship as **open source** with bring-your-own-account deploy.
- G7. Provide **reminders** and **missed-pattern warnings**.

## 3. Non-goals
- N1. Calculating pharmacokinetics or recommending doses (user's own equations do this).
- N2. Clinical decision support, diagnosis, or any regulated medical-device function.
- N3. Multi-tenant hosted SaaS or any shared backend.
- N4. Prescriber/clinic-facing features or EHR integration (future, out of scope).

## 4. Users / personas
- **Primary — Author/patient (technical).** Manages own regimen; comfortable deploying AWS via CLI; wants control of data.
- **Secondary — Self-hosting patient (technical).** Forks the repo, deploys to their own AWS account, configures their own meds and equations.

## 5. User stories
- US1. As a patient, I add each of my medications with its unit, half-life, and safety caps.
- US2. As a patient, I build my day as time-slots, each grouping the meds I take then, with each med's normal dose.
- US3. As a patient, in the morning I tap once to log the whole 08:00 group as taken on time.
- US4. As a patient, when I realise I'm late for one med, I open it, enter my calculated adjusted dose, and it's checked against my caps before logging.
- US5. As a patient, I sometimes take only some meds in a group; the rest stay shown as still due.
- US6. As a patient flying abroad, the schedule shows in local time and the real gap between doses is reflected so I can adjust.
- US7. As a patient, I see my history and get warned if I've missed a pattern of timing-sensitive doses.
- US8. As a patient, I get reminded when upcoming and adjusted doses are due.
- US9. As a patient, my data is private and secure (encrypted in transit and at rest, behind my own login) and lives in my own cloud account, where my backend can use it to power features.
- US10. As a developer-patient, I plug my own pharmacology equations into one interface and they drive suggested adjusted doses.

## 6. Functional requirements
IDs are referenced by stage specs.

### Medications (FR-MED)
- FR-MED-1. Create/edit/delete a medication: name, colour, dose unit, half-life (hours), notes, active flag.
- FR-MED-2. Per-medication **timing-sensitive** flag (`adjustWhenLate`): true = needs adjusted dose when late and counts toward missed-pattern warnings; false = flexible.
- FR-MED-3. Per-medication **guardrails**: optional max single dose, max daily dose, min interval (hours).
- FR-MED-4. Deleting a medication removes it from all schedule slots.

### Schedule (FR-SCH)
- FR-SCH-1. Schedule is a list of **time-slots**, each: wall-clock time, optional label, and ≥1 item.
- FR-SCH-2. A slot **item** references a medication and a normal dose.
- FR-SCH-3. The same medication may appear in multiple slots with different doses.
- FR-SCH-4. The schedule is **fixed** — there is no schedule versioning/titration timeline.

### Dosing & logging (FR-LOG)
- FR-LOG-1. "Today" shows each slot for the current date, grouped, sorted by time, with per-item status (upcoming / taken / missed / still-due).
- FR-LOG-2. **Take whole group**: one action logs all not-yet-taken items in a slot at normal dose, time = now.
- FR-LOG-3. **Log single item**: opens a logger with editable **dose** (default = normal) and **time taken** (default = now).
- FR-LOG-4. A logged dose records: med, slot, scheduled instant, actual instant, actual dose, unit, zone, status, adjusted flag, any cap warnings.
- FR-LOG-5. **Partial groups** are valid: some items taken, others remain due.
- FR-LOG-6. If the pharmacology extension returns a suggestion, the logger offers a one-tap fill (cap-checked first).

### Guardrails (FR-GRD)
- FR-GRD-1. Every logged or suggested dose is validated against the med's guardrails.
- FR-GRD-2. Exceeding a cap warns the user and requires explicit confirmation; the resulting entry is flagged.
- FR-GRD-3. Validation is a single shared function reused by manual logging, "take group", and suggestions.

### Time & timezone (FR-TZ)
- FR-TZ-1. All events stored as absolute instants (UTC epoch).
- FR-TZ-2. Schedule wall-clock times resolved to instants in the user's **current** zone.
- FR-TZ-3. Display labels in the active zone, including correct **BST/GMT** abbreviation.
- FR-TZ-4. Changing zone (flight) reflects the changed real interval between doses.

### Reminders (FR-REM)
- FR-REM-1. Notify for upcoming scheduled doses.
- FR-REM-2. Notify/snooze-aware for an adjusted dose's follow-up timing where applicable.
- FR-REM-3. Reminder scheduling honours the active zone.
- FR-REM-4. Document and degrade gracefully where background scheduling is limited (see architecture).

### History & adherence (FR-HIS)
- FR-HIS-1. Chronological dose log with med, scheduled vs actual time+zone, dose, adjusted/late/over-cap markers.
- FR-HIS-2. Adherence view over a configurable window, **counting timing-sensitive meds only**.
- FR-HIS-3. **Missed-pattern warning** when missed timing-sensitive doses exceed a configurable threshold across the window.
- FR-HIS-4. Visualisations: adherence over time, and a blood-level chart fed by the pharmacology extension's output (chart, not calculation).
- FR-HIS-5. Export all data as JSON and CSV (data portability).

### Sync & security (FR-SYNC, FR-SEC)
- FR-SYNC-1. App is fully usable offline; local store is the source of truth.
- FR-SYNC-2. Bidirectional sync across devices for the same user.
- FR-SYNC-3. Conflict resolution defined and deterministic (last-write-wins by record).
- FR-SEC-1. The cloud stores **readable, structured data** the backend can validate and operate on — **not zero-knowledge**. Data is encrypted **in transit** (TLS) and **at rest** (KMS).
- FR-SEC-2. Per-user authentication (Cognito) and **server-side authorization** isolate each user's data; the server validates every record's schema and ownership.
- FR-SEC-3. Account recovery is via the identity provider (email reset); an **optional on-device lock** protects the local cache on a shared/lost device.

### Identity, deploy & open source (FR-OSS)
- FR-OSS-1. Per-user authentication.
- FR-OSS-2. Entire backend deployable to a fresh AWS account via one IaC command.
- FR-OSS-3. No secrets committed; credentials sourced from the deployer's environment.
- FR-OSS-4. Documentation enables a new user to deploy, configure meds, and plug in their own equations.
- FR-OSS-5. Pharmacology extension is a documented, swappable interface.

## 7. Non-functional requirements
- NFR-Security. Least-privilege IAM; JWT-authorised API; per-user server-side authorization; TLS in transit and KMS encryption at rest; server-side input validation; optional MFA; no long-lived keys in code or prompts.
- NFR-Privacy. No analytics/telemetry that leaves the user's account by default.
- NFR-Offline. Core flows (view today, log, edit schedule/meds) work with no network.
- NFR-Performance. Today view interactive < 1s on a mid phone; logging action < 100ms perceived.
- NFR-Accessibility. Keyboard navigable, visible focus, reduced-motion respected, adequate contrast.
- NFR-Portability. Full export/import; no lock-in beyond standard AWS primitives.
- NFR-Cost. Idle cost ≈ \$0 for a single user (serverless, pay-per-use).
- NFR-Reliability. No data loss on offline edits; sync is idempotent and resumable.
- NFR-Safety. The app never originates a dose value; it only records and validates.

## 8. Success criteria
- SC1. Author replaces the spreadsheet for daily use.
- SC2. A late dose can be logged with an adjusted amount in < 15 seconds, cap-checked.
- SC3. Data is verified private and secure: encrypted at rest (KMS) and in transit (TLS), reachable only with a valid login, and no user can read another's records.
- SC4. A clean AWS account is fully deployed from docs in < 30 minutes.
- SC5. BST/GMT transition day shows correct intervals (verified by test).

## 9. Risks & mitigations
| Risk | Mitigation |
|---|---|
| Safety: app misused as dosing authority | App computes no doses; caps + confirmations + disclaimers; clinician validation called out |
| Cloud not zero-knowledge → DB compromise exposes data | Single-user BYO account (bounded blast radius); KMS at rest; least-privilege IAM; CloudTrail audit; optional MFA; optional on-device lock |
| Background reminders unreliable on web | Document limits; OS notifications via installed PWA; degrade gracefully |
| Sync conflicts corrupt data | LWW per record + tombstones + idempotent sync + tests |
| Timezone bugs around DST/flights | UTC storage; two-pass zone conversion; explicit DST test suite |
| Open-source users mishandle AWS creds | IaC + docs mandate SSO/short-lived creds, sandbox account, least privilege |

## 10. Glossary
- **Slot / group** — a scheduled time containing one or more medications.
- **Timing-sensitive** — a med that needs an adjusted dose when late.
- **Adjusted dose** — a one-off dose for a late occurrence; schedule itself unchanged.
- **Guardrail** — a user-set safety cap (max single, max daily, min interval).
- **Extension point** — the interface where the user's pharmacology equations plug in.
