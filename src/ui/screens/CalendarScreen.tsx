import {
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  DEFAULT_PX_PER_HOUR,
  HOURS_IN_DAY,
  TIME_STEP_MS,
  addDaysToIsoDate,
  clampInstant,
  dayEndInstant,
  dayStartInstant,
  groupChangesByDay,
  instantToDayY,
  isoDateInZone,
  plannedSlotsAsOf,
  resolveDraggedInstant,
  roundInstantToStep,
  wallTimeInZone,
  type Instant,
  type Medication,
  type OccurrenceStatus,
} from '../../core';
import { useStore } from '../../store/store';
import { Button, Card, ColorDot } from '../components/ui';
import { ChangeDetail } from '../components/ChangeMarkers';
import { DoseLogger, type LoggerTarget } from '../components/DoseLogger';
import { GroupLogger, type GroupLoggerTarget } from '../components/GroupLogger';
import { useNow } from '../lib/useNow';
import { useScheduleData } from '../lib/useScheduleData';

const PX_PER_HOUR = DEFAULT_PX_PER_HOUR;
const GROUP_HEIGHT = 46; // visual height of a dose-group block, in px
const MOVE_THRESHOLD = 3; // px before a press counts as a drag, not a tap
const SWIPE_THRESHOLD = 60; // horizontal px before a swipe changes the day

// One medication within a slot-group on the day axis. Taken doses anchor at the
// time they were actually taken; untaken occurrences anchor at their scheduled
// time.
interface GroupMember {
  medId: string;
  med?: Medication;
  scheduledInstant: Instant;
  anchorInstant: Instant;
  dose: number;
  status: OccurrenceStatus;
  logEntryId?: string;
  overridden: boolean;
  // Stage 18 FR-18.6: "taken" from the assume-on-time policy, not a real log
  // entry. Without this, an assumed dose and a genuinely-logged one were
  // indistinguishable on the calendar; it also shares no state with `missed`
  // or `upcoming`, which is what made all three render as the same dashed
  // block (the FR-18.6 defect this closes).
  assumed: boolean;
}

// A scheduled slot rendered as a single draggable group. Dragging moves every
// member by the same time delta; the amounts stay with each dose (the app never
// originates a value).
interface CalendarGroup {
  key: string;
  slotId: string;
  label?: string;
  scheduledInstant: Instant;
  anchorInstant: Instant; // representative position (earliest member)
  members: GroupMember[];
  hasLogged: boolean; // at least one member has a real log entry
  hasAssumed: boolean; // at least one member is "taken" only by assumption (Stage 18 FR-18.6)
  lane: number;
  laneCount: number;
}

export function CalendarScreen() {
  const now = useNow();
  const { zone, assumeTakenOnTime, medications, doseLog, doseOverrides, regimen } =
    useScheduleData();
  const adjustDoseTime = useStore((s) => s.adjustDoseTime);
  const regimenChanges = useStore((s) => s.regimenChanges);

  const [target, setTarget] = useState<LoggerTarget | null>(null);
  const [groupTarget, setGroupTarget] = useState<GroupLoggerTarget | null>(null);
  const [showChanges, setShowChanges] = useState(false);

  // The day being viewed/adjusted. Defaults to today but can be moved back or
  // forward (prev/next buttons or a horizontal swipe) so a dose missed late in a
  // day can be logged the next morning.
  const todayDate = isoDateInZone(now, zone);
  const [selectedDate, setSelectedDate] = useState(todayDate);
  const isToday = selectedDate === todayDate;
  const goToDay = (delta: number) => setSelectedDate((d) => addDaysToIsoDate(d, delta));

  const dayStart = useMemo(() => dayStartInstant(selectedDate, zone), [selectedDate, zone]);
  const dayEnd = useMemo(() => dayEndInstant(selectedDate, zone), [selectedDate, zone]);

  // Regimen changes recorded on the viewed day (Stage 16) — surfaced as a header
  // chip that opens the same detail popover as the chart markers.
  const changeGroup = useMemo(
    () => groupChangesByDay(regimenChanges, zone).find((g) => g.date === selectedDate) ?? null,
    [regimenChanges, zone, selectedDate],
  );

  const dayLabel = useMemo(() => {
    if (isToday) return 'Today';
    if (selectedDate === addDaysToIsoDate(todayDate, -1)) return 'Yesterday';
    if (selectedDate === addDaysToIsoDate(todayDate, 1)) return 'Tomorrow';
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      timeZone: zone,
    }).format(dayStart);
  }, [isToday, selectedDate, todayDate, zone, dayStart]);

  // Horizontal swipe on the day track changes the day. Gestures that start on a
  // dose group (vertical re-time drags) are ignored, as are vertical-dominant
  // moves, so group dragging and day swiping never fight each other.
  const swipeRef = useRef<{ x: number; y: number; skip: boolean } | null>(null);
  const onTrackPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    swipeRef.current = {
      x: e.clientX,
      y: e.clientY,
      skip: Boolean((e.target as HTMLElement).closest('[data-block="true"]')),
    };
  };
  const onTrackPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = swipeRef.current;
    swipeRef.current = null;
    if (!s || s.skip) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.abs(dx) < SWIPE_THRESHOLD || Math.abs(dx) <= Math.abs(dy)) return;
    goToDay(dx < 0 ? 1 : -1); // swipe left → next day, swipe right → previous day
  };

  const medById = useMemo(() => new Map(medications.map((m) => [m.id, m])), [medications]);

  const groups = useMemo<CalendarGroup[]>(() => {
    // Resolve against the regimen in effect on the *selected* day: the calendar
    // is the main surface where a past day is rendered (Stage 18 FR-18.1).
    const planned = plannedSlotsAsOf(
      regimen,
      selectedDate,
      doseLog,
      zone,
      now,
      doseOverrides,
      assumeTakenOnTime,
    );
    const raw: Omit<CalendarGroup, 'lane' | 'laneCount'>[] = [];
    for (const slot of planned) {
      const members: GroupMember[] = slot.occurrences.map((occ) => {
        let anchor = occ.scheduledInstant;
        if (occ.status === 'taken' && occ.logEntryId) {
          const entry = doseLog.find((e) => e.id === occ.logEntryId);
          if (entry) anchor = entry.actualInstant;
        }
        return {
          medId: occ.medId,
          med: medById.get(occ.medId),
          scheduledInstant: occ.scheduledInstant,
          anchorInstant: anchor,
          dose: occ.dose,
          status: occ.status,
          logEntryId: occ.logEntryId,
          overridden: occ.overridden ?? false,
          assumed: occ.assumed ?? false,
        };
      });
      if (members.length === 0) continue;
      raw.push({
        key: `${slot.slotId}:${slot.scheduledInstant}`,
        slotId: slot.slotId,
        label: slot.label,
        scheduledInstant: slot.scheduledInstant,
        anchorInstant: Math.min(...members.map((m) => m.anchorInstant)),
        members,
        hasLogged: members.some((m) => m.logEntryId),
        hasAssumed: members.some((m) => m.status === 'taken' && m.assumed),
      });
    }
    return assignLanes(raw);
  }, [selectedDate, regimen, doseLog, zone, now, doseOverrides, assumeTakenOnTime, medById]);

  // Re-time every logged member of a group by the same delta (drag / arrow keys).
  const onRetimeGroup = (group: CalendarGroup, delta: number) => {
    const ceil = clampInstant(now, dayStart, dayEnd);
    for (const m of group.members) {
      if (!m.logEntryId) continue;
      const next = clampInstant(roundInstantToStep(m.anchorInstant + delta), dayStart, ceil);
      adjustDoseTime(m.logEntryId, next);
    }
  };

  // Open a logger for the not-yet-taken members of a group. A single med keeps
  // the richer DoseLogger (with adjust-next); ≥2 use the group logger so amounts
  // can be set per medication.
  const onLogGroup = (group: CalendarGroup, instant?: Instant) => {
    const untaken = group.members.filter((m) => !m.logEntryId);
    if (untaken.length === 0) return;
    const groupLabel = group.label ?? `${wallTimeInZone(group.scheduledInstant, zone)} group`;
    if (untaken.length === 1) {
      const m = untaken[0]!;
      setTarget({
        slotId: group.slotId,
        medId: m.medId,
        scheduledInstant: m.scheduledInstant,
        normalDose: m.dose,
        ...(instant != null ? { actualInstant: instant } : {}),
      });
      return;
    }
    setGroupTarget({
      slotId: group.slotId,
      scheduledInstant: group.scheduledInstant,
      label: groupLabel,
      members: untaken.map((m) => ({ medId: m.medId, normalDose: m.dose })),
      ...(instant != null ? { actualInstant: instant } : {}),
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => goToDay(-1)}
          aria-label="Previous day"
          className="rounded-full px-3 py-1 text-xl leading-none text-slate-400 hover:bg-slate-800 hover:text-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-muted"
        >
          ‹
        </button>
        <div className="flex flex-col items-center">
          <h2 className="text-lg font-semibold tracking-tight">{dayLabel}</h2>
          <span className="text-xs tabular-nums text-slate-400">{selectedDate}</span>
          {changeGroup && (
            <div className="relative mt-1">
              <button
                type="button"
                className="rounded-full border border-amber-700 bg-amber-950/40 px-2 py-0.5 text-[11px] text-amber-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-muted"
                aria-label={`${changeGroup.changes.length} regimen change${
                  changeGroup.changes.length > 1 ? 's' : ''
                } on this day`}
                aria-expanded={showChanges}
                onClick={() => setShowChanges((v) => !v)}
              >
                ⚙ {changeGroup.changes.length} regimen change
                {changeGroup.changes.length > 1 ? 's' : ''}
              </button>
              {showChanges && (
                <ChangeDetail group={changeGroup} onClose={() => setShowChanges(false)} />
              )}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => goToDay(1)}
          aria-label="Next day"
          className="rounded-full px-3 py-1 text-xl leading-none text-slate-400 hover:bg-slate-800 hover:text-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-muted"
        >
          ›
        </button>
      </div>

      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-slate-400">
          Drag a group up or down to re-time the whole group (snaps to 5 minutes); tap an upcoming
          group to log it and adjust each amount. Swipe left/right to change day.
        </p>
        {!isToday && (
          <Button
            variant="secondary"
            onClick={() => setSelectedDate(todayDate)}
            className="shrink-0 px-2 py-1 text-xs"
          >
            Today
          </Button>
        )}
      </div>

      <div onPointerDown={onTrackPointerDown} onPointerUp={onTrackPointerUp}>
        <Card className="overflow-hidden p-0">
          <div className="flex" style={{ height: HOURS_IN_DAY * PX_PER_HOUR }}>
            {/* Hour gutter */}
            <div className="relative w-12 shrink-0 border-r border-slate-800">
              {Array.from({ length: HOURS_IN_DAY }, (_, h) => (
                <div
                  key={h}
                  className="absolute right-1 -translate-y-1/2 text-[10px] tabular-nums text-slate-500"
                  style={{ top: h * PX_PER_HOUR }}
                >
                  {String(h).padStart(2, '0')}:00
                </div>
              ))}
            </div>

            {/* Track */}
            <div className="relative flex-1">
              {Array.from({ length: HOURS_IN_DAY }, (_, h) => (
                <div
                  key={h}
                  className="absolute inset-x-0 border-t border-slate-800/60"
                  style={{ top: h * PX_PER_HOUR }}
                />
              ))}
              {/* "Now" marker */}
              {now >= dayStart && now <= dayEnd && (
                <div
                  className="absolute inset-x-0 z-10 border-t border-accent-muted/70"
                  style={{ top: instantToDayY(now, dayStart, PX_PER_HOUR) }}
                  aria-hidden
                />
              )}
              {groups.map((group) => (
                <DoseGroup
                  key={group.key}
                  group={group}
                  dayStart={dayStart}
                  dayEnd={dayEnd}
                  now={now}
                  zone={zone}
                  onRetimeGroup={onRetimeGroup}
                  onLogGroup={onLogGroup}
                />
              ))}
            </div>
          </div>
        </Card>
      </div>

      {target && <DoseLogger target={target} onClose={() => setTarget(null)} />}
      {groupTarget && <GroupLogger target={groupTarget} onClose={() => setGroupTarget(null)} />}
    </div>
  );
}

function DoseGroup({
  group,
  dayStart,
  dayEnd,
  now,
  zone,
  onRetimeGroup,
  onLogGroup,
}: {
  group: CalendarGroup;
  dayStart: Instant;
  dayEnd: Instant;
  now: Instant;
  zone: string;
  onRetimeGroup: (group: CalendarGroup, delta: number) => void;
  onLogGroup: (group: CalendarGroup, instant?: Instant) => void;
}) {
  const [preview, setPreview] = useState<Instant | null>(null); // previewed group anchor
  const dragRef = useRef<{ startY: number; origin: Instant; moved: boolean } | null>(null);

  // The drag range for the group anchor: it can move to the day start, and down
  // until the first member hits its own ceiling (a logged dose can't move into
  // the future; an upcoming one is free to the day end — the logger re-clamps).
  const memberCeil = (m: GroupMember) =>
    m.logEntryId ? clampInstant(now, dayStart, dayEnd) : dayEnd;
  const maxDelta = Math.max(
    0,
    Math.min(...group.members.map((m) => memberCeil(m) - m.anchorInstant)),
  );
  const groupMax = group.anchorInstant + maxDelta;

  const displayAnchor = preview ?? group.anchorInstant;
  const delta = displayAnchor - group.anchorInstant;
  const top = instantToDayY(displayAnchor, dayStart, PX_PER_HOUR);
  const wall = wallTimeInZone(displayAnchor, zone);
  const moved = delta !== 0 && preview != null;
  const anyMissed = group.members.some((m) => m.status === 'missed');

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { startY: e.clientY, origin: group.anchorInstant, moved: false };
    setPreview(group.anchorInstant);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const deltaY = e.clientY - d.startY;
    if (Math.abs(deltaY) > MOVE_THRESHOLD) d.moved = true;
    setPreview(
      resolveDraggedInstant({
        originalInstant: d.origin,
        deltaY,
        pxPerHour: PX_PER_HOUR,
        min: dayStart,
        max: groupMax,
      }),
    );
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    dragRef.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    const committedAnchor = preview ?? group.anchorInstant;
    const committedDelta = committedAnchor - group.anchorInstant;
    setPreview(null);
    if (!d) return;
    if (d.moved) {
      if (group.hasLogged) onRetimeGroup(group, committedDelta);
      else onLogGroup(group, committedAnchor);
    } else if (!group.hasLogged) {
      onLogGroup(group); // tap an upcoming group → open the logger
    }
  };
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!group.hasLogged) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onLogGroup(group);
      }
      return;
    }
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    onRetimeGroup(group, e.key === 'ArrowUp' ? -TIME_STEP_MS : TIME_STEP_MS);
  };

  const summary = group.members
    .map((m) => `${m.med?.name ?? m.medId} ${m.dose}${m.med?.unit ?? ''}`)
    .join(', ');

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${group.label ?? wall} group at ${wall}: ${summary}. Drag or use arrow keys to re-time the group.`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onKeyDown={onKeyDown}
      data-block="true"
      className={`absolute flex touch-none select-none flex-col gap-0.5 overflow-hidden rounded-md border bg-slate-900/85 px-2 py-1 text-xs shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-muted ${
        preview != null ? 'z-20 cursor-grabbing ring-2 ring-accent-muted' : 'cursor-grab'
      } ${groupBorderClass(group)}`}
      style={{
        top,
        height: GROUP_HEIGHT,
        left: `${(group.lane / group.laneCount) * 100}%`,
        width: `calc(${(1 / group.laneCount) * 100}% - 4px)`,
      }}
    >
      <span className="flex items-center gap-1 font-medium text-slate-100">
        <span className="tabular-nums">{wall}</span>
        {group.label && <span className="truncate text-slate-300">{group.label}</span>}
        {group.members.length > 1 && (
          <span className="text-[10px] text-slate-500">· {group.members.length} meds</span>
        )}
        {moved && <span className="text-[10px] text-accent-muted">· moving</span>}
        <GroupStatusChip group={group} anyMissed={anyMissed} moved={moved} />
      </span>
      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 overflow-hidden">
        {group.members.map((m) => (
          <GroupMemberChip key={m.medId} m={m} />
        ))}
      </span>
    </div>
  );
}

// Stage 18 FR-18.6: three visually distinct border treatments, not one dashed
// style shared by assumed/missed/upcoming. A real log entry gets a solid
// border; an assumed-taken group keeps a dashed border but tinted with the
// "taken" colour (plus the "· assumed" label and the per-member glyph below —
// never colour alone); anything still unresolved (missed/upcoming) keeps the
// original neutral dashed style. Extracted so `DoseGroup`'s own branching
// stays flat.
function groupBorderClass(group: CalendarGroup): string {
  if (group.hasLogged) return 'border-slate-700';
  if (group.hasAssumed) return 'border-dashed border-status-taken/50';
  return 'border-dashed border-slate-600';
}

// The "· missed"/"· assumed" chip next to a group's time — mutually
// exclusive, and both suppressed once the group is genuinely logged or being
// dragged. Extracted from `DoseGroup` to keep its own branching flat.
function GroupStatusChip({
  group,
  anyMissed,
  moved,
}: {
  group: CalendarGroup;
  anyMissed: boolean;
  moved: boolean;
}) {
  if (group.hasLogged || moved) return null;
  if (anyMissed) return <span className="text-[10px] text-status-missed">· missed</span>;
  if (group.hasAssumed) {
    return (
      <span
        className="text-[10px] text-status-taken/80"
        title="Assumed taken on time — not a real log entry"
      >
        · assumed
      </span>
    );
  }
  return null;
}

// One medication within a group block: colour dot, name, dose, and a
// logged/assumed/adjusted glyph. Extracted from `DoseGroup` to keep its own
// branching flat — pure rendering, no behaviour of its own.
function GroupMemberChip({ m }: { m: GroupMember }) {
  return (
    <span className="inline-flex items-center gap-1 truncate text-[11px]">
      <ColorDot color={m.med?.color ?? '#64748b'} />
      <span className={m.logEntryId ? 'text-slate-300' : 'text-slate-200'}>
        {m.med?.name ?? m.medId}
      </span>
      <span className="tabular-nums opacity-70">
        {m.dose}
        {m.med?.unit ?? ''}
      </span>
      <MemberStatusGlyph m={m} />
      {m.overridden && <span className="text-[10px] text-amber-400">·adj</span>}
    </span>
  );
}

// Stage 18 FR-18.6: a real log entry gets "✓"; "taken" that is only the
// assume-on-time policy's fill-in gets a distinct glyph, "◇" — never the same
// mark, never colour alone. Extracted from `GroupMemberChip` to keep both
// functions' branching flat.
function MemberStatusGlyph({ m }: { m: GroupMember }) {
  if (m.logEntryId) {
    return (
      <span
        className="text-[10px] text-status-taken"
        title="Logged by you"
        aria-label="Logged by you"
      >
        ✓
      </span>
    );
  }
  if (m.status === 'taken' && m.assumed) {
    return (
      <span
        className="text-[10px] text-status-taken/70"
        title="Assumed taken on time — not a real log entry"
        aria-label="Assumed taken on time, not a real log entry"
      >
        ◇
      </span>
    );
  }
  return null;
}

/**
 * Greedy lane packing so time-overlapping groups sit side by side instead of on
 * top of each other. Pure layout (presentation only). Groups are laid out from
 * their anchor instants; the dragged group floats above the rest transiently.
 */
function assignLanes(raw: Omit<CalendarGroup, 'lane' | 'laneCount'>[]): CalendarGroup[] {
  const sorted = [...raw].sort((a, b) => a.anchorInstant - b.anchorInstant);
  const laneEndY: number[] = []; // last occupied bottom-Y per lane
  const placed: CalendarGroup[] = [];
  for (const g of sorted) {
    const topY = g.anchorInstant; // relative ordering is all that matters here
    let lane = laneEndY.findIndex((end) => end <= topY);
    if (lane === -1) {
      lane = laneEndY.length;
      laneEndY.push(0);
    }
    // Reserve roughly GROUP_HEIGHT worth of time so near-simultaneous groups split.
    laneEndY[lane] = topY + (GROUP_HEIGHT / PX_PER_HOUR) * 3_600_000;
    placed.push({ ...g, lane, laneCount: 1 });
  }
  const laneCount = Math.max(1, laneEndY.length);
  return placed.map((g) => ({ ...g, laneCount }));
}
