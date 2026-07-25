# Stage 26 Spec — Trust & Transparency (published privacy / no-monetisation policy)

| | |
|---|---|
| **Depends on** | Stage 8 (Supabase), existing `SECURITY.md`, Stage 2 (local-first) |
| **Implements** | FR-26.1 … FR-26.4 · closes **P0 #11**; restates the **P0 #10** posture (`specs/p0-feature-audit.md`) |
| **Milestone** | Post-release P0 hardening |
| **Status** | Ready |

## 1. Objective
Turn the product's privacy stance — already true in practice and documented for
developers in `SECURITY.md` — into a **user-visible, plain-language policy** that
states the explicit differentiator: **your data is local-first, lives in your own
Supabase project, and is never sold or shared with third parties; there is no
advertising or analytics that leaves your account.** This is P0 #11 ("No
third-party data monetisation; transparent policy") — the explicit trust contrast
versus pharma-funded and records-aggregating incumbents.

This stage also **restates the encryption posture (P0 #10)** in user terms so the
two privacy P0s read as one coherent story: TLS in transit + at-rest encryption,
with **zero-knowledge deliberately out of scope** so the backend can validate
records (unchanged from the PRD — no build work, just clear disclosure).

> Worked example: from Settings the user opens **Privacy & your data** and reads a
> one-screen policy: what is stored, where (their own project), that nothing is
> sold/shared, that there is no third-party analytics, how it is encrypted, and the
> one accepted trade-off (a compromise of their own DB exposes readable data). A
> footer link points to `SECURITY.md` for the technical detail.

## 2. Scope
**In:**
- A committed, plain-language **`PRIVACY.md`** (user-facing, distinct from the
  developer-facing `SECURITY.md`) covering: what data is collected (only what the
  user enters), where it lives, **no sale / no third-party sharing / no ad or
  off-device analytics**, encryption (in transit + at rest), the accepted
  server-readable trade-off, data ownership, and **export/delete** rights.
- A **user-visible in-app surface** — a "Privacy & your data" screen/section in
  Settings — rendering that policy (or a faithful summary) with a link to the full
  `PRIVACY.md` and to `SECURITY.md`.
- A one-line **no-telemetry assertion** made verifiable: a short note (and, if
  practical, a lightweight test/lint) affirming the client ships no third-party
  analytics/telemetry SDKs, matching NFR-Privacy.
- Cross-links so `README.md`, `SECURITY.md`, and `PRIVACY.md` reference each other
  coherently; the audit (`specs/p0-feature-audit.md`) marks #10/#11 closed.

**Out:** a cookie/consent banner (no third-party cookies exist to consent to);
GDPR/CCPA legal-review wording (this is a single-user BYO project — plain honest
disclosure, not a lawyered ToS); changing the encryption model (zero-knowledge
stays a non-goal — decided); the granular per-field export/delete UI beyond what
already exists (that is P1 "granular export/delete" — reference it, don't build it
here beyond linking the existing JSON export/import).

## 3. Prerequisites
- `SECURITY.md` (the technical posture — reuse, don't duplicate).
- Existing export/import (FR-HIS-5) to link from the "data ownership" section.
- Settings screen to host the new section.

## 4. Functional requirements
- **FR-26.1** — A committed **`PRIVACY.md`** in plain language stating: data is
  local-first and lives in the user's own Supabase project; it is **never sold or
  shared** with third parties; there is **no advertising and no off-device
  analytics/telemetry**; encryption in transit (TLS) and at rest; the accepted
  server-readable trade-off; and the user's ownership/export/delete rights.
- **FR-26.2** — A **Settings → "Privacy & your data"** in-app surface renders the
  policy summary and links to `PRIVACY.md` and `SECURITY.md`. Legible, accessible,
  on the design system.
- **FR-26.3** — The **encryption posture (P0 #10)** is stated in user terms on that
  surface: TLS + at-rest, zero-knowledge intentionally out of scope, one-line why.
  Consistent with `SECURITY.md`; no contradiction.
- **FR-26.4** — A **verifiable no-telemetry claim**: documented, and backed by a
  check (dependency/lint assertion or a test) that the client bundle includes no
  third-party analytics/telemetry SDK. If a full automated check is impractical,
  document the manual audit and record its result.

## 5. Acceptance criteria
- **AC1** — `PRIVACY.md` exists, is user-readable (no jargon-only), and covers all
  FR-26.1 points; cross-links to `SECURITY.md` and back.
- **AC2** — The in-app "Privacy & your data" surface is reachable from Settings,
  renders the summary + links, and passes the accessibility bar (contrast, focus,
  screen-reader labels) used elsewhere in the app.
- **AC3** — The encryption statement on the surface matches `SECURITY.md` (no
  claim of zero-knowledge; the trade-off is disclosed).
- **AC4** — The no-telemetry claim is backed by an executed check or a documented
  audit with its result recorded; `pnpm build`'s output contains no third-party
  analytics SDK.
- **AC5** — `README.md` links to both `PRIVACY.md` and `SECURITY.md`; the P0 audit
  marks #10 and #11 closed with pointers here.

## 6. Open questions
- Should the in-app surface **inline** the full policy or show a summary + link to
  the committed `PRIVACY.md`? Current call: **summary + link** (keeps the bundle
  lean and the source of truth in one committed file). Revisit if App Store review
  (deferred iOS track) later requires an inlined policy screen.
