# SteadyDose — One-Page Description

**Working name:** SteadyDose · **Type:** Local-first, offline-capable PWA with a secure cloud · **Status:** Spec / pre-build

## The problem
People on anti-epileptic medication take several drugs at fixed times each day. When a dose is taken late, the right correction is to take an *adjusted* dose so blood levels stay roughly constant until the next normally-scheduled dose — then continue as normal. Doing this by hand in a spreadsheet is error-prone, has no reminders, no history, and breaks across time zones and BST/GMT changes.

## The solution
A single app — usable in any browser and installable on a phone — that manages a **fixed daily schedule of grouped doses**, lets the user **log an adjusted dose** for any late occurrence, and keeps **secure history** that syncs across devices. The user keeps their data in **their own AWS account**, where the backend can read and use it to power features; the project is open source so others bring their own account too.

The app deliberately **does not calculate pharmacology**. Each medication stores its half-life and safety caps; the user's own equations plug into a single, documented extension point and any suggested dose is checked against the caps before it can be logged.

## Who it's for
Primarily the author — a developer managing their own epilepsy regimen. Secondarily, other technically-capable patients who self-host via their own AWS account.

## Key capabilities
- Medication library: name, unit, **half-life**, **safety guardrails** (max single, max daily, min interval), timing-sensitive vs flexible.
- Fixed daily schedule built from **time-slots that group one or more meds**; same med can appear in several slots at different doses.
- **Group-level and partial dose logging**; a missed "dose" is a group, possibly only some of its meds.
- **Adjusted-dose logging** for late doses, validated against caps; optional one-tap fill from the user's own equations.
- **Timezone- and flight-aware** scheduling; correct across BST/GMT.
- History, adherence tracking, and **missed-pattern warnings** (timing-sensitive meds only).
- **Reminders** for upcoming and adjusted doses.

## Data rights & privacy
Secure but **not zero-knowledge**: the cloud stores readable, structured data so the backend can use it, protected by TLS in transit, KMS encryption at rest, per-user login, and server-side authorization. Data lives in the user's own AWS account, deployed via infrastructure-as-code. No shared backend, no third-party data custody.

## Tech at a glance
React + TypeScript PWA · IndexedDB (offline source of truth) · readable record sync with server-side validation · AWS CDK stack (Cognito + API Gateway + Lambda + DynamoDB + S3/CloudFront + KMS) in the user's own account.

## Next
Build in 8 sequenced stages (see `03-implementation-plan.md`), each with its own kick-off spec in `specs/`.
