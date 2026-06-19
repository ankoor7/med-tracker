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
  clampInstant,
  dayEndInstant,
  dayStartInstant,
  instantToDayY,
  isoDateInZone,
  plannedSlotsForDate,
  resolveDraggedInstant,
  roundInstantToStep,
  wallTimeInZone,
  type Instant,
  type Medication,
  type OccurrenceStatus,
} from '../../core';
import { useStore } from '../../store/store';
import { Card } from '../components/ui';
import { DoseLogger, type LoggerTarget } from '../components/DoseLogger';
import { useNow } from '../lib/useNow';

const PX_PER_HOUR = DEFAULT_PX_PER_HOUR;
const BLOCK_HEIGHT = 38; // visual height of a dose block, in px
const MOVE_THRESHOLD = 3; // px before a press counts as a drag, not a tap

// One draggable dose event on the day axis. Taken doses anchor at the time they
// were actually taken; untaken occurrences anchor at their scheduled time.
interface CalendarBlock {
  key: string;
  slotId: string;
  medId: string;
  scheduledInstant: Instant;
  anchorInstant: Instant;
  dose: number;
  status: OccurrenceStatus;
  overridden: boolean;
  logEntryId?: string;
  med?: Medication;
  lane: number;
  laneCount: number;
}

export function CalendarScreen() {
  const now = useNow();
  const zone = useStore((s) => s.settings.zone);
  const medications = useStore((s) => s.medications);
  const slots = useStore((s) => s.slots);
  const doseLog = useStore((s) => s.doseLog);
  const doseOverrides = useStore((s) => s.doseOverrides);
  const adjustDoseTime = useStore((s) => s.adjustDoseTime);

  const [target, setTarget] = useState<LoggerTarget | null>(null);

  const today = isoDateInZone(now, zone);
  const dayStart = useMemo(() => dayStartInstant(today, zone), [today, zone]);
  const dayEnd = useMemo(() => dayEndInstant(today, zone), [today, zone]);

  const medById = useMemo(() => new Map(medications.map((m) => [m.id, m])), [medications]);

  const blocks = useMemo<CalendarBlock[]>(() => {
    const planned = plannedSlotsForDate(
      today,
      slots,
      medications,
      doseLog,
      zone,
      now,
      doseOverrides,
    );
    const raw: Omit<CalendarBlock, 'lane' | 'laneCount'>[] = [];
    for (const slot of planned) {
      for (const occ of slot.occurrences) {
        let anchor = occ.scheduledInstant;
        if (occ.status === 'taken' && occ.logEntryId) {
          const entry = doseLog.find((e) => e.id === occ.logEntryId);
          if (entry) anchor = entry.actualInstant;
        }
        raw.push({
          key: `${occ.slotId}:${occ.medId}`,
          slotId: occ.slotId,
          medId: occ.medId,
          scheduledInstant: occ.scheduledInstant,
          anchorInstant: anchor,
          dose: occ.dose,
          status: occ.status,
          overridden: occ.overridden ?? false,
          logEntryId: occ.logEntryId,
          med: medById.get(occ.medId),
        });
      }
    }
    return assignLanes(raw);
  }, [today, slots, medications, doseLog, zone, now, doseOverrides, medById]);

  const onRetime = (block: CalendarBlock, instant: Instant) => {
    if (block.logEntryId) adjustDoseTime(block.logEntryId, instant);
  };
  const onLog = (block: CalendarBlock, instant?: Instant) => {
    setTarget({
      slotId: block.slotId,
      medId: block.medId,
      scheduledInstant: block.scheduledInstant,
      normalDose: block.dose,
      ...(instant != null ? { actualInstant: instant } : {}),
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-2xl font-semibold tracking-tight">Day calendar</h2>
        <span className="text-xs text-slate-400">{today}</span>
      </div>

      <p className="text-xs text-slate-400">
        Drag a dose up or down to change its time (snaps to 5 minutes). Taken doses re-time in
        place; tap an upcoming dose to log it.
      </p>

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
            {blocks.map((block) => (
              <DoseBlock
                key={block.key}
                block={block}
                dayStart={dayStart}
                dayEnd={dayEnd}
                now={now}
                zone={zone}
                onRetime={onRetime}
                onLog={onLog}
              />
            ))}
          </div>
        </div>
      </Card>

      {target && <DoseLogger target={target} onClose={() => setTarget(null)} />}
    </div>
  );
}

function DoseBlock({
  block,
  dayStart,
  dayEnd,
  now,
  zone,
  onRetime,
  onLog,
}: {
  block: CalendarBlock;
  dayStart: Instant;
  dayEnd: Instant;
  now: Instant;
  zone: string;
  onRetime: (block: CalendarBlock, instant: Instant) => void;
  onLog: (block: CalendarBlock, instant?: Instant) => void;
}) {
  const [preview, setPreview] = useState<Instant | null>(null);
  const dragRef = useRef<{ startY: number; origin: Instant; moved: boolean } | null>(null);

  // A taken dose can be re-timed but not into the future; an upcoming dose can be
  // dragged anywhere in the day (the logger then clamps "time taken" to ≤ now).
  const maxInstant = block.logEntryId ? clampInstant(now, dayStart, dayEnd) : dayEnd;

  const displayInstant = preview ?? block.anchorInstant;
  const top = instantToDayY(displayInstant, dayStart, PX_PER_HOUR);
  const wall = wallTimeInZone(displayInstant, zone);
  const med = block.med;
  const taken = block.status === 'taken';

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { startY: e.clientY, origin: block.anchorInstant, moved: false };
    setPreview(block.anchorInstant);
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
        max: maxInstant,
      }),
    );
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    dragRef.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    const committed = preview ?? block.anchorInstant;
    setPreview(null);
    if (!d) return;
    if (d.moved) {
      if (block.logEntryId) onRetime(block, committed);
      else onLog(block, committed);
    } else if (!block.logEntryId) {
      onLog(block); // tap an upcoming dose → open the logger
    }
  };
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    // Keyboard re-timing for taken doses (a11y alternative to dragging).
    if (!block.logEntryId) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onLog(block);
      }
      return;
    }
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const delta = e.key === 'ArrowUp' ? -TIME_STEP_MS : TIME_STEP_MS;
    const next = clampInstant(
      roundInstantToStep(block.anchorInstant + delta),
      dayStart,
      maxInstant,
    );
    onRetime(block, next);
  };

  const color = med?.color ?? '#64748b';
  const lateOrEarly = taken && block.anchorInstant !== block.scheduledInstant;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${med?.name ?? block.medId} ${block.dose}${med?.unit ?? ''} at ${wall}, ${block.status}. Drag or use arrow keys to change the time.`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onKeyDown={onKeyDown}
      data-status={block.status}
      className={`absolute flex touch-none select-none flex-col justify-center overflow-hidden rounded-md border px-2 text-xs shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-muted ${
        preview != null ? 'z-20 cursor-grabbing ring-2 ring-accent-muted' : 'cursor-grab'
      } ${taken ? 'border-transparent text-slate-950' : 'border-dashed bg-slate-900/80 text-slate-100'}`}
      style={{
        top,
        height: BLOCK_HEIGHT,
        left: `${(block.lane / block.laneCount) * 100}%`,
        width: `calc(${(1 / block.laneCount) * 100}% - 4px)`,
        backgroundColor: taken ? color : undefined,
        borderColor: taken ? undefined : color,
      }}
    >
      <span className="flex items-center gap-1 truncate font-medium">
        <span className="tabular-nums">{wall}</span>
        <span className="truncate">{med?.name ?? block.medId}</span>
      </span>
      <span className="truncate opacity-80">
        {block.dose}
        {med?.unit ?? ''}
        {block.overridden ? ' · adjusted' : ''}
        {lateOrEarly && preview == null ? ' · moved' : ''}
      </span>
    </div>
  );
}

/**
 * Greedy lane packing so time-overlapping blocks sit side by side instead of on
 * top of each other. Pure layout (presentation only). Blocks are laid out from
 * their anchor instants; the dragged block floats above the rest transiently.
 */
function assignLanes(raw: Omit<CalendarBlock, 'lane' | 'laneCount'>[]): CalendarBlock[] {
  const sorted = [...raw].sort((a, b) => a.anchorInstant - b.anchorInstant);
  const laneEndY: number[] = []; // last occupied bottom-Y per lane
  const placed: CalendarBlock[] = [];
  for (const b of sorted) {
    const topY = b.anchorInstant; // relative ordering is all that matters here
    let lane = laneEndY.findIndex((end) => end <= topY);
    if (lane === -1) {
      lane = laneEndY.length;
      laneEndY.push(0);
    }
    // Reserve roughly BLOCK_HEIGHT worth of time so near-simultaneous doses split.
    laneEndY[lane] = topY + (BLOCK_HEIGHT / PX_PER_HOUR) * 3_600_000;
    placed.push({ ...b, lane, laneCount: 1 });
  }
  const laneCount = Math.max(1, laneEndY.length);
  return placed.map((b) => ({ ...b, laneCount }));
}
