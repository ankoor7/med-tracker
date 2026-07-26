# Stage 25 Spec — Reminder Reliability (escalation, persistence, delivery)

| | |
|---|---|
| **Depends on** | Stage 2 (offline store), Stage 6 (reminders + service worker), Stage 8 (Supabase), the Web Push server side (VAPID, done) |
| **Implements** | FR-25.1 … FR-25.7 · closes **P0 #8** (`specs/p0-feature-audit.md`); advances P1 "confirm-to-dismiss" |
| **Milestone** | Post-release P0 hardening |
| **Status** | Ready |

## 1. Objective
Make reminders **reliable, persistent, and escalating** — the research names
notification reliability the **#1 real-world failure point**, where reliability
beats features. Stage 6 shipped zone-aware, service-worker-driven **local**
notifications for upcoming doses, follow-ups, and missed-pattern alerts, and the
Web Push **server side** (VAPID) exists. Two gaps remain against P0 #8:

1. **Delivery is not wired end-to-end** — the built frontend has no
   `VITE_VAPID_PUBLIC_KEY` path subscribing the client and persisting the push
   subscription, so server-driven push cannot reach the device when the PWA is
   closed. Local-only notifications are best-effort and die with the tab.
2. **No escalation or persistence** — a reminder fires once and is easily missed;
   there is no re-alert, no "sticky" until acknowledged, and no confirm-to-dismiss.

This stage closes both, with **documented graceful degradation** where the
platform limits background delivery (the honest position the PRD already takes).

> Worked example: 08:00 dose reminder fires. The user misses it. At 08:10 and 08:20
> it **re-alerts** (escalating), staying **persistent** on the lock screen until the
> user taps **Taken** or **Snooze** — tapping **Taken** logs the dose as a *genuine*
> entry and clears the chain. If the whole chain is ignored, the occurrence resolves
> to whatever `assumeTakenOnTime` dictates, exactly as if no reminder had fired: with
> the setting **on** (the default) it becomes an **assumed-taken** dose, shown
> distinctly per FR-18.6 — **not** flipped to missed. Escalation is an *offer* to
> upgrade an assumed dose to a genuinely-logged one; it is never a precondition for
> the assumed-taken default.

> **Why this matters (non-negotiable):** patient engagement drops sharply during a
> well-managed "good patch" — the user stops interacting even though they are taking
> their doses. If enabling reminders silently converted ignored reminders into
> "missed", turning reminders on would *degrade* the record for exactly the users
> who need the least friction. Reminders and assume-taken are orthogonal: reminders
> improve delivery and offer acknowledgement; they never change the default outcome.

## 2. Scope
**In:**
- **End-to-end Web Push delivery**: client subscribes with the VAPID public key
  (`VITE_VAPID_PUBLIC_KEY`), persists the `PushSubscription` to Supabase, and the
  existing server side sends dose/follow-up/missed pushes to it; unsubscribe on
  sign-out / permission revoke; re-subscribe on key rotation.
- **Escalation**: a configurable re-alert chain for an unacknowledged dose reminder
  (e.g. +10, +20 min, capped count), computed in pure core; stops on
  acknowledgement or when the dose is logged.
- **Persistence**: notifications rendered with `requireInteraction`/`tag` so they
  stay on screen and **collapse** (a later alert replaces the earlier one, not a
  pile-up), within platform limits.
- **Confirm-to-dismiss actions** (advances the P1): notification action buttons
  **Taken** / **Snooze** that log or reschedule directly from the notification,
  giving users who *want* explicit acknowledgement an easy path to it. This is
  additive: an ignored chain still falls back to the `assumeTakenOnTime` default
  (assumed-taken when on), it does **not** withhold the assumed-taken outcome for
  reminded doses.
- **Reliability instrumentation & degradation**: a documented degradation matrix
  (iOS PWA background limits, permission states, offline) and a lightweight
  local "did the last N reminders fire?" self-check surfaced in the reminders panel
  so the user knows if delivery is degraded — no telemetry leaves the device.

**Out:** SMS/WhatsApp/email channels; caregiver/"medfriend" alerts (P2);
appointment reminders (P2); native (Capacitor) notifications — that rides the
deferred iOS track; changing the assume-taken model itself (Stage 18 §7.1 settled
it: **on** by default, and non-negotiable). This stage only adds an **optional
acknowledged** path for reminded doses; the assumed-taken default remains
authoritative when the chain is ignored (FR-25.8).

## 3. Prerequisites
- Stage 6 core (`core/reminders.ts`: `computeDoseReminders`, `followUpReminder`,
  `evaluateMissedPattern`), the service worker (`src/sw.ts`), and the reminders
  client (`src/reminders/*`, `push.ts`).
- The Web Push server side (VAPID keys provisioned; sender implemented).
- A Supabase table/record for push subscriptions (add if absent) under RLS.

## 4. Functional requirements
- **FR-25.1** — With `VITE_VAPID_PUBLIC_KEY` configured, the client requests
  permission, subscribes, and **persists the subscription** to the user's backend;
  server-driven push then reaches the device with the PWA closed. Absent key =
  local-notification-only mode, unchanged (graceful degradation).
- **FR-25.2** — Sign-out and permission-revoke **remove** the stored subscription;
  a rotated VAPID key triggers re-subscription. No dangling subscriptions.
- **FR-25.3** — Pure-core **escalation** computes a bounded re-alert chain for an
  unacknowledged dose reminder from `ReminderPrefs` (offsets + max count);
  deterministic and unit-tested; the chain **stops** once the dose is
  logged/acknowledged.
- **FR-25.4** — Notifications are **persistent + collapsing** (`tag` per
  occurrence, `requireInteraction` where supported); a re-alert replaces rather
  than stacks.
- **FR-25.5** — Notification **actions**: **Taken** logs the dose (via the store,
  cap-checked) as a *genuine* entry and clears the escalation chain; **Snooze**
  reschedules by a configured interval. Both work from the notification without
  opening the app where the platform allows, and fall back to deep-linking the app
  where it does not.
- **FR-25.6** — A **degradation matrix** is documented (spec + in-app help), and the
  reminders panel shows the current delivery state (permission, subscription,
  push-vs-local) and a **local** last-fired self-check.
- **FR-25.7** — Reminder preferences gain escalation controls (on/off, offsets, max
  count) with sensible defaults; existing prefs migrate with escalation **off** by
  default (no surprise behaviour change).
- **FR-25.8** — **Assume-taken is authoritative over reminder state.** An
  unacknowledged occurrence whose escalation chain is exhausted (or whose reminders
  never fired) resolves through the **same** assume-taken logic as an occurrence with
  no reminder at all: with `assumeTakenOnTime` **on** it is an assumed-taken dose
  (FR-18.6 display rules apply), with it **off** it is missed/unconfirmed as today.
  Enabling reminders, escalation, or push MUST NOT introduce a new "reminded but
  unacknowledged ⇒ not taken" state, and MUST NOT change any adherence figure
  relative to the same install with reminders off. A **genuine** log (via the
  **Taken** action or in-app) upgrades that occurrence from assumed to logged and
  stops escalation; ignoring the chain leaves the assumed default untouched.

## 5. Acceptance criteria
- **AC1** — With the VAPID key set, subscribing persists a subscription row (RLS:
  only the owner can read it); a server-sent test push arrives with the PWA closed
  (verified in the target browser); without the key the app runs local-only with no
  error.
- **AC2** — Signing out deletes the subscription row; re-signing-in re-subscribes.
- **AC3** — The escalation core produces the expected re-alert instants for a given
  prefs fixture and **halts** when the occurrence is logged (mutation-proven).
- **AC4** — A re-alert **replaces** the prior notification for the same occurrence
  (same `tag`), never stacking; it stays on screen until acted on where supported.
- **AC5** — Tapping **Taken** on the notification logs that occurrence (cap-checked,
  appears in history) and cancels further escalation; **Snooze** reschedules.
- **AC6** — The degradation matrix is documented and the panel reflects the real
  permission/subscription state; no data leaves the device for the self-check.
- **AC7** — Upgrading an existing install keeps reminders working with escalation
  off until the user opts in; `src/core` boundary intact (scheduling math is pure).
- **AC8** — With `assumeTakenOnTime` **on**, a dose whose full escalation chain is
  ignored resolves to **assumed-taken** (shown distinctly, not missed), and the
  adherence figure for that day is **byte-identical** to the same fixture with
  reminders off — proving reminders never mutate the outcome. Tapping **Taken**
  instead upgrades that same occurrence to a genuine log. Core-level, unit-tested
  and mutation-proven.

## 6. Open questions
- **iOS PWA push**: Web Push works in installed iOS PWAs (16.4+) but background
  behaviour is constrained. Document the exact supported matrix during
  implementation; the native path stays deferred (iOS track).
- **Where does escalation run** when the app is closed — server-scheduled pushes
  vs. service-worker `setTimeout` (unreliable when evicted)? Lean on
  **server-scheduled** pushes for the closed-app case (the backend can read dose
  times), with the SW handling foreground/near-term. Confirm the scheduler design
  in implementation.
