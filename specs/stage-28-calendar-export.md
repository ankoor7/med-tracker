# Stage 28 Spec — Calendar Export (iCalendar / `.ics`)

| | |
|---|---|
| **Depends on** | Stage 2 (dataset), Stage 6 (reminder model), Stage 25 (delivery posture), Stage 27 (primary consumer) |
| **Implements** | FR-28.1 … FR-28.10 (**provisional**) · proposes PRD **FR-CAL-1…3** |
| **Milestone** | Unscheduled — supporting capability, not a P0/P1 feature line |
| **Status** | **Draft — NOT ready for implementation.** See §10 for what must be settled first. |
| **Do not** | Hand this to the Implement→Validate→Review loop in its current state. |

## 1. Objective

Let the user put a SteadyDose date into **their own calendar** — Apple Calendar,
Google Calendar, Outlook — as a standard iCalendar event, generated entirely
on-device.

There are two reasons this is worth a stage rather than a footnote:

1. **It is a delivery channel that does not depend on web push.** An event's
   `VALARM` is fired by the operating system's calendar, not by a service worker.
   It survives the PWA being closed, the service worker being evicted, and the
   platform's background-execution limits — the exact failure mode Stage 25 §6
   flags as an open question on iOS. For **date-scale** reminders (collect your
   prescription on the 15th; the pharmacy owes you tablets, back on Friday) a
   calendar alarm is plausibly *more* reliable than push, at zero infrastructure
   cost.
2. **It costs nothing in privacy.** The `.ics` is built in pure core, handed to the
   share sheet or a download, and never touches a network. Unlike a Google Calendar
   or Outlook "add event" URL, no medication name reaches a third party.

Stage 27 is the immediate consumer; the mechanism is deliberately generic.

## 2. What the web platform actually allows

This section is the constraint the design lives inside, and the reason the scope is
one-directional.

**There is no calendar API in any shipping browser.** No `navigator.calendar`, no
permission prompt, no read access. A PWA cannot see the user's calendar and cannot
write to it silently. The only available shape is: **the app produces an event, the
user accepts it.**

| Route | Apple Calendar | Google Calendar | Outlook | Network / account | Verdict |
|---|---|---|---|---|---|
| **`.ics` file** (share sheet or download) | ✅ | ✅ | ✅ | none | **Chosen** |
| Provider "add event" URL | ❌ (no web equivalent) | ✅ | ✅ | required, plus the med name goes to Google/Microsoft | Rejected — §7 |
| CalDAV / Calendar API / MS Graph (two-way) | ✅ | ✅ | ✅ | OAuth + a server holding refresh tokens; CalDAV blocked by CORS | Rejected — §3 |
| Native calendar access (EventKit) | ✅ read+write | — | — | native shell | Deferred with the iOS track |

**Reading** the calendar — e.g. "you have a GP appointment on Thursday, request your
repeat now" — is impossible on the web by any route. It requires the native shell
and is out of scope here.

## 3. Scope

**In:**
- A pure-core **RFC 5545 serialiser** (`core/icalendar.ts`) producing a valid
  `text/calendar` document from a typed event draft.
- An **"Add to calendar"** action on the events worth externalising — initially
  Stage 27's prescription-collection and owed-item dates.
- Delivery via `navigator.share({ files })` where available, falling back to a
  `Blob` download, reusing the patterns already in `src/ui/lib/shareReport.ts` and
  the `download()` helper in `DataTransferPanel.tsx` (extract and share it).
- **Discreet-by-default** event titles (§7).

**Out:**
- **Two-way sync of any kind.** Google Calendar API, Microsoft Graph, and CalDAV all
  require OAuth with a server-held refresh token; CalDAV additionally cannot be
  reached from a browser at all (CORS). Any of them means a backend transacting with
  Google or Microsoft on the user's behalf, which contradicts the BYO-Supabase,
  no-third-party architecture (`NFR-Privacy`, PRD N3). Not a scheduling decision —
  a rejected design.
- **Reading** the user's calendar (impossible on the web; see §2).
- **Recurring dose events.** A four-times-daily regimen would emit ~1,460 events a
  year into the user's calendar, duplicating the in-app reminders and making the
  calendar unusable. Dose reminders stay in-app. Only sparse, date-scale,
  administrative events are exported.
- Provider "add event" URLs (§7).
- Appointment tracking as a feature (P2 in `research/03` §6); this stage only
  provides a mechanism it could later use.

## 4. Core API (provisional)

```ts
// src/core/icalendar.ts — pure. No DOM, no network, no store.

export interface CalendarAlarm {
  /** Minutes before `start`. 0 = at the event time. */
  minutesBefore: number;
  description: string;
}

export interface CalendarEventDraft {
  /** Stable, app-derived, reused across revisions of the same real-world event. */
  uid: string;
  start: Instant;
  /** Omit for a default duration; the app has no all-day events yet (§11 Q3). */
  end?: Instant;
  summary: string;
  description?: string;
  alarms?: CalendarAlarm[];
  /** Bumped on each re-issue of the same `uid`. */
  sequence?: number;
  /** `cancel` emits METHOD:CANCEL + STATUS:CANCELLED to withdraw a prior event. */
  method?: 'publish' | 'cancel';
}

export function buildICalendar(events: CalendarEventDraft[], now: Instant): string;
```

Serialisation details that are requirements, not implementation trivia — each is a
common source of silently-broken `.ics` files and each gets a test:

- **CRLF** line endings throughout; **line folding** at 75 octets with a leading
  space on continuations (long medication names and descriptions will exceed it).
- **Escaping** of `\`, `;`, `,`, and newlines in `SUMMARY`/`DESCRIPTION`. Medication
  names and user notes are free text and will contain commas.
- **UTC timestamps** (`DTSTART:20260815T090000Z`). The app stores every event as a
  UTC `Instant` already, so emitting UTC avoids embedding a `VTIMEZONE` block
  entirely — a genuine simplification that falls out of the existing time rule. The
  user's calendar renders it in their own zone, which is the correct behaviour
  across the flight/DST cases the app already handles.
- Required properties: `VERSION:2.0`, a `PRODID`, and per event `UID`, `DTSTAMP`,
  `DTSTART`, `SUMMARY`. `VALARM` requires `ACTION`, `TRIGGER`, and `DESCRIPTION`.

## 5. Functional requirements (provisional — see §10)

- **FR-28.1** — `buildICalendar` is pure, deterministic given `now`, and emits a
  document that validates against RFC 5545. No React, no store, no I/O.
- **FR-28.2** — Output imports successfully into Apple Calendar, Google Calendar,
  and Outlook, with the summary, time, and alarm intact. **Verified on real
  clients, not only against a validator** (§10 B1).
- **FR-28.3** — An "Add to calendar" action offers the event via
  `navigator.share({ files })` when `navigator.canShare({ files })` is true, and
  falls back to a `Blob` download named `steadydose-<slug>.ics` with MIME
  `text/calendar`.
- **FR-28.4** — Event `uid`s are **derived and stable** — same real-world event,
  same `uid` across re-issues and across devices (e.g. `<recordId>@steadydose`),
  never random per invocation.
- **FR-28.5** — Re-issuing an event after its date changes increments `sequence`.
  Whether this reliably *updates* rather than *duplicates* is unresolved and is a
  blocker (§10 B2); the fallback is `method: 'cancel'` followed by a fresh publish.
- **FR-28.6** — Event titles are **discreet by default** (§7): no medication name in
  `SUMMARY` unless the user opts in per §7.
- **FR-28.7** — Stage 27 exposes the action on an outstanding prescription
  (collection due) and on an owed item (return due). Nothing is exported
  automatically or in bulk — one deliberate user action per event.
- **FR-28.8** — Calendar export **never** replaces or suppresses an in-app reminder
  unless the duplicate-alert policy in §10 B3 says otherwise; until that is settled,
  the calendar copy is strictly additive.
- **FR-28.9** — Nothing leaves the device. No network call, no third-party URL, no
  telemetry on export.
- **FR-28.10** — Export works fully offline.

## 6. Consumers

| Consumer | Event | Why the calendar earns its place |
|---|---|---|
| **Stage 27** collection due | `expectedReadyAt` | The pharmacy's SMS is unreliable; this is the trip to make |
| **Stage 27** owed item | `expectedBackAt` | Days later, unprompted — the classic forgotten return |
| **Stage 25** (possible) | any date-scale alert | An OS-fired alarm sidesteps iOS PWA background limits |
| Appointments (future, P2) | — | Mechanism only; not built here |

Dose times are deliberately absent (§3).

## 7. Privacy

**A calendar event is a broadcast.** Once accepted it syncs to every device on that
account, renders on a lock screen, may appear on a shared family calendar, and lands
on a work laptop signed into the same Google or Microsoft account. "Collect
Levetiracetam" is a disclosure of a neurological diagnosis to anyone glancing at a
phone. For a product whose differentiator is that the user owns their data, exporting
medication names into Google's or Microsoft's cloud by default would be incoherent.

Therefore:
- Default `SUMMARY` is **discreet**: "SteadyDose — prescription collection", with no
  medication name and no quantity.
- Including names is a **per-export opt-in** with the exposure stated plainly at the
  point of choice, not buried in settings.
- **Provider "add event" URLs are rejected** on the same grounds: they transmit the
  event content to Google or Microsoft as URL parameters before the user has agreed
  to anything. The `.ics` route reaches the same three calendars without that step,
  so there is no capability being traded away.

## 8. The update problem

An exported event is a **snapshot**; the app's state is live. Stage 27's flow moves
dates routinely — "not ready yet" pushes the ETA out, the pharmacy names a new day
for an owing.

RFC 5545 handles this with `UID` + `SEQUENCE`: re-issue the same `UID` with a higher
`SEQUENCE` and the client should revise the existing event. In practice Google
Calendar and Outlook honour this reasonably; **Apple Calendar importing a plain file
tends to create a second event rather than revise the first.** An unverified
assumption here produces duplicate and contradictory reminders about medication — a
worse outcome than no calendar integration at all.

Until §10 B2 is settled, the working position is: **the in-app reminder is the source
of truth and the calendar entry is a courtesy copy**, and the UI must not imply the
calendar will keep itself current.

## 9. Acceptance criteria (provisional)

- **AC1** — `buildICalendar` output passes an RFC 5545 validator, with correct CRLF,
  folding at 75 octets, and escaping of `\ ; ,` and newlines. Property-tested against
  medication names containing commas and multi-line notes.
- **AC2** — A generated event imports into Apple Calendar, Google Calendar, and
  Outlook with summary, start time, and alarm intact — **verified manually on real
  clients**, recorded as a matrix in this spec.
- **AC3** — On a device supporting file share, the action opens the share sheet with
  Calendar offered; elsewhere it downloads a `.ics` that opens the OS handler.
- **AC4** — `uid` for the same prescription is identical across repeated exports and
  across two devices; `sequence` increments on re-issue.
- **AC5** — Default export contains no medication name; opting in adds it and the
  opt-in states the exposure.
- **AC6** — No network request is made during export (asserted in the E2E-mocked
  suite, which already intercepts all traffic).
- **AC7** — Export works with the app offline.
- **AC8** — `src/core` boundary intact: serialisation is pure; only delivery lives
  in `src/ui`.
- **AC9** — Whatever §10 B3 settles about duplicate alerts is implemented and tested.

## 10. Why this is not ready for implementation

Four things must be resolved **before** this stage is handed to the build loop. Each
is listed with what would clear it.

**B1 — The delivery path is unverified on every target.** No one has confirmed that
a `text/calendar` Blob shared via `navigator.share({ files })` actually offers
Calendar in an **installed iOS PWA** (as opposed to Safari), or that a `.ics`
download in an installed Android Chrome PWA reaches Google Calendar rather than
landing inertly in Downloads. If the delivery path does not work on iOS, the stage's
main justification — a push-independent channel where push is weakest — collapses,
and the remaining value is small. **Clear it by:** building a throwaway page that
emits one hard-coded `.ics` and testing it on installed iOS and Android PWAs plus
desktop Safari/Chrome/Firefox. Record the matrix here. This is a half-day spike and
everything else is contingent on it.

**B2 — Update semantics are unknown on the clients that matter (§8).** The same
spike must re-issue an event with a bumped `SEQUENCE` and record, per client, whether
it revises or duplicates. The outcome picks one of three designs: `SEQUENCE` updates,
cancel-then-republish, or fire-and-forget with the UI stating the calendar copy is a
snapshot. **Clear it by:** the B1 spike, extended.

**B3 — The relationship to Stage 25 is undecided, and it changes the design.** Is
calendar export a **supplement** to push (both fire; the user gets two alerts for one
event — annoying, and annoying reminders get muted, which is the failure mode Stage
25 exists to prevent) or a **substitute** on platforms where push is unreliable
(one alert, but the app must then trust a channel it cannot observe — it can never
know whether the user kept, moved, or deleted the event)? A third option is
user-choice per channel. **Clear it by:** deciding it in this spec, after B1 shows
which platforms actually need the fallback.

**B4 — Stage 27 is itself a Draft.** The primary consumer's own IA is unsettled
(Stage 27 §9 Q1: dedicated Supply screen vs. Today card), and that determines where
the "Add to calendar" action lives and whether it is per-item or per-request.
**Clear it by:** Stage 27 reaching Ready.

Additionally, this stage is **unscheduled**: it is not a P0 or a P1 line, it depends
on a Draft stage, and Stages 24–26 are still ahead of it. Sequencing is a separate
decision from readiness, and neither has been made.

## 11. Open questions

1. **Alarm lead time.** Default a `VALARM` at the event time, or the morning of, or
   both? A collection reminder is useful at 09:00, not at midnight. Probably an
   all-day-style event at a fixed morning hour rather than a timed one — interacts
   with Q3.
2. **Bulk export.** Should "Add all upcoming supply dates" exist, or is one
   deliberate event per action the right ceiling? Leaning one-at-a-time: bulk export
   makes the §8 update problem combinatorially worse.
3. **All-day vs timed events.** `DTSTART;VALUE=DATE` (all-day) matches "collect
   sometime on Thursday" semantically, but all-day events carry no time-of-day alarm
   in some clients. Resolve alongside Q1 in the B1 spike.
4. **`PRODID` and calendar identity.** Worth emitting an `X-WR-CALNAME` so an
   imported set groups under a "SteadyDose" calendar the user can hide or delete in
   one action? Only meaningful if bulk export (Q2) happens.
5. **Does this belong in Stage 27 after all?** If B1 shows the mechanism only works
   in one place and B3 makes it a supplement, a single FR inside Stage 27 may be the
   honest size, and this spec should be folded in and deleted rather than built as
   its own stage.

## 12. PRD amendment (proposed, contingent on §10)

- **FR-CAL-1.** The app can export a scheduled date as a standard iCalendar
  (`.ics`) event, generated on-device, for the user to add to their own calendar.
- **FR-CAL-2.** Calendar export is one-directional and local: the app never reads
  the user's calendar and never transmits event content to a calendar provider.
- **FR-CAL-3.** Exported events are discreet by default; including medication names
  is an explicit per-export opt-in.
