# Stage 6 Spec — Reminders & Notifications

| | |
|---|---|
| **Depends on** | Stage 2 |
| **Implements** | FR-REM-1..4, FR-HIS-3 (alerting surface) |
| **Milestone** | C |
| **Status** | Ready after Stage 2 |

## 1. Objective
Notify the user when **scheduled doses** are due, support follow-up timing for **adjusted doses**, and raise **missed-pattern alerts** — all zone-aware, via the PWA, with documented graceful degradation where background scheduling is limited.

## 2. Scope
**In:** notification permission UX; service-worker-driven local notifications for upcoming doses; adjusted-dose follow-up reminder; missed-pattern alert (timing-sensitive meds); per-slot reminder settings; zone-aware scheduling; degradation strategy.
**Out:** server-side push notifications (deferred — now *architecturally possible* since the backend can read dose times, but out of scope here; this stage delivers client/PWA-local notifications); SMS/WhatsApp channels (future, see note).

## 3. Prerequisites
Stage 2 (local schedule + log available offline).

## 4. Functional requirements
- FR-6.1. With permission granted, the app schedules notifications for upcoming scheduled doses in the active zone.
- FR-6.2. After logging an adjusted (late) dose, offer/schedule an appropriate follow-up reminder where relevant.
- FR-6.3. Raise a **missed-pattern** notification when missed timing-sensitive doses exceed the configured threshold over the window.
- FR-6.4. Reminders respect the **active zone**; rescheduling occurs on zone change.
- FR-6.5. Where the platform cannot fire notifications while the app is closed, **degrade gracefully** and tell the user (in-app catch-up + best-effort scheduling).

## 5. Technical approach
- **Permission flow:** explicit, contextual request; clear states (granted/denied/unsupported).
- **Scheduling:** compute next occurrences from the local schedule (reuse `core/schedule.ts`); schedule notifications via the service worker. Use the Notifications API; use **Periodic Background Sync / scheduled notifications where supported**, otherwise schedule while the tab/app is active and **catch up on next open**.
- **Adjusted-dose follow-up:** when a late dose is logged, optionally compute a follow-up reminder time (the *timing* only — never a dose value) and schedule it.
- **Missed-pattern:** reuse `core/adherence.ts`; evaluate on app open and on a periodic check; fire at most once per breach to avoid nagging.
- **Zone change:** on `Settings.zone` change, clear and reschedule pending reminders.
- **Honesty:** document platform limits (iOS/Android/desktop web differ) in-app and in `08` docs.

## 6. Tasks
1. Implement permission request + status UI.
2. Implement SW notification scheduling for upcoming doses (zone-aware).
3. Implement reschedule-on-zone-change and catch-up-on-open.
4. Implement adjusted-dose follow-up reminder (timing only).
5. Implement missed-pattern alert with debounce.
6. Add per-slot/per-med reminder toggles in settings.
7. Document degradation behaviour per platform.

## 7. Acceptance criteria
- AC1. Given permission is granted and a dose is due soon, when the time arrives, a notification fires (on supported platforms / while active).
- AC2. Given a late dose is logged with a follow-up, when its time arrives, a reminder fires.
- AC3. Given missed timing-sensitive doses exceed the threshold, when evaluated, exactly one missed-pattern alert is raised per breach.
- AC4. Given the active zone changes, when reminders are inspected, pending reminders are rescheduled to the new zone.
- AC5. Given an unsupported background scenario, when the app reopens, missed reminders are surfaced as in-app catch-up and the limitation is communicated.
- AC6. Reminders never contain or imply a dose value to take (only that a dose is due).

## 8. Test plan
- Unit: next-occurrence computation; missed-pattern debounce; zone-change reschedule.
- Integration: SW notification firing (supported env); permission-denied and unsupported paths.
- Manual: cross-platform behaviour notes captured.

## 9. Risks / decisions
- **Decision:** this stage ships **client/PWA-local** notifications only. Server-side push is now *possible* (the backend can read dose times) and is a natural future enhancement — e.g. a Lambda/EventBridge scheduler or opt-in SMS/WhatsApp channels — but is deferred and documented separately to keep this stage offline-first and self-contained.
- Background web scheduling is genuinely limited; set expectations honestly rather than over-promising.

## 10. Definition of done
All ACs pass; zone-aware reminders work on supported platforms; missed-pattern alerts fire once per breach; degradation documented; no dose values in notifications.
