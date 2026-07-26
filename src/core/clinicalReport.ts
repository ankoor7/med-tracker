// Clinician outputs — pure report model (Stage 23, P0 #6 + #7).
//
// Two on-device artifacts for a doctor's visit, built entirely from recorded
// data:
//   - buildMedicationList: the patient's current active medications (P0 #7).
//   - buildPreVisitSummary: adherence + flare-ups + regimen changes over a
//     chosen period, plus a bounded, DESCRIPTIVE "what to ask" highlights block
//     (P0 #6). Implements the Stage 17 report model (specs/stage-17…).
//
// This module NEVER originates a clinical judgement or a recommendation — it
// aggregates and phrases what the user already recorded (surface, don't
// interpret). It reuses the tested adherence engine, event helpers, and regimen
// diffs; it adds no scoring of its own. No React/store/DOM imports.

import { computeAdherence, type AdherenceResult } from './adherence';
import { formatDuration, scaleRange } from './events';
import { medicationLabel } from './medicationLabel';
import { startOfDayInstant } from './startDate';
import { addDaysToIsoDate, isoDateInZone } from './time';
import type {
  Dataset,
  EventInstance,
  EventPropertyDef,
  EventType,
  Guardrails,
  IanaZone,
  ISODate,
  Instant,
  RegimenChange,
  Slot,
} from './types';

// ---- Portable medication list (P0 #7) ---------------------------------------

/** One scheduled administration of a medication: time of day + amount. */
export interface MedicationListTime {
  time: string; // HH:MM wall-clock
  label?: string; // the slot's optional label, e.g. "Morning"
  dose: number;
}

/** A current active medication as it should read on a clinician-facing list. */
export interface MedicationListEntry {
  medId: string;
  label: string; // medicationLabel: name (+ strength) (+ form)
  unit: string;
  timingSensitive: boolean;
  times: MedicationListTime[]; // sorted by time of day
  guardrails: Guardrails;
  notes?: string;
}

const live = (r: { deleted?: boolean }) => !r.deleted;

/** Slots (live) that schedule `medId`, sorted by time of day. */
function scheduledTimes(slots: Slot[], medId: string): MedicationListTime[] {
  return slots
    .filter(live)
    .flatMap((s) => {
      const item = s.items.find((i) => i.medId === medId);
      return item ? [{ time: s.time, label: s.label, dose: item.dose }] : [];
    })
    .sort((a, b) => a.time.localeCompare(b.time));
}

/**
 * The current medication list: every **active**, non-deleted medication with its
 * schedule, guardrails and notes. Deterministic order — by first scheduled time,
 * then name — so the printed list is stable. Current-state, never period-scoped
 * (FR-23.7).
 */
export function buildMedicationList(
  dataset: Pick<Dataset, 'medications' | 'slots'>,
): MedicationListEntry[] {
  return dataset.medications
    .filter((m) => live(m) && m.active)
    .map((m) => ({
      medId: m.id,
      label: medicationLabel(m),
      unit: m.unit,
      timingSensitive: m.adjustWhenLate,
      times: scheduledTimes(dataset.slots, m.id),
      guardrails: m.guardrails,
      notes: m.notes?.trim() ? m.notes.trim() : undefined,
    }))
    .sort((a, b) => {
      const at = a.times[0]?.time ?? '99:99';
      const bt = b.times[0]?.time ?? '99:99';
      return at.localeCompare(bt) || a.label.localeCompare(b.label);
    });
}

// ---- Pre-visit summary (P0 #6) ----------------------------------------------

export interface PerMedicationAdherence {
  medId: string;
  label: string;
  result: AdherenceResult;
}

/** Aggregate of one event type's instances in the period. */
export interface EventPropertyStat {
  id: string;
  name: string;
  type: EventPropertyDef['type'];
  count: number; // instances with a numeric value for this property
  min: number;
  max: number;
  avg: number;
  /** Human-formatted average, honouring the property kind (e.g. "3.4/5", "1m 30s"). */
  formattedAvg: string;
}

/** A calendar week (Mon-anchored) and how many events of the type fell in it. */
export interface WeekCluster {
  weekStart: ISODate; // Monday of the week, in the active zone
  count: number;
}

export interface EventTypeStats {
  typeId: string;
  name: string;
  color: string;
  count: number;
  properties: EventPropertyStat[];
  /** Weeks with at least one event, chronological — the raw material for "clustered". */
  weeks: WeekCluster[];
  /** The busiest single week (max count), or null when there are no events. */
  peakWeek: WeekCluster | null;
}

/**
 * A single descriptive highlight for the "what changed / what to ask" block.
 * `kind` is a stable machine tag; `text` is the human line. Never prescriptive.
 */
export interface SummaryHighlight {
  kind:
    | 'missed-doses'
    | 'late-doses'
    | 'medication-started'
    | 'medication-stopped'
    | 'event-cluster'
    | 'event-total';
  text: string;
}

export interface PreVisitSummary {
  from: ISODate;
  to: ISODate;
  days: number;
  zone: IanaZone;
  generatedAt: Instant;
  overall: AdherenceResult;
  perMedication: PerMedicationAdherence[];
  medicationCount: number; // active meds, for the "N active medications" cross-link line
  events: EventTypeStats[];
  totalEvents: number;
  /** Regimen changes whose `changedAt` falls in the period, chronological. */
  regimenChanges: RegimenChange[];
  highlights: SummaryHighlight[];
}

export interface PreVisitSummaryOptions {
  now: Instant;
  /** Period length in days, ending today (presets 30/90/180, or a custom count). */
  days: number;
}

/** Monday (ISO week start) of a local `YYYY-MM-DD` date. Pure calendar math. */
export function startOfIsoWeek(date: ISODate): ISODate {
  const [y, m, d] = date.split('-').map((n) => Number(n));
  // getUTCDay: 0=Sun..6=Sat; shift so Monday=0.
  const dow = (new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1)).getUTCDay() + 6) % 7;
  return addDaysToIsoDate(date, -dow);
}

function isNumericProperty(type: EventPropertyDef['type']): boolean {
  return type === 'number' || type === 'scale' || type === 'duration';
}

function formatStatAverage(def: EventPropertyDef, avg: number): string {
  const rounded = Math.round(avg * 10) / 10;
  switch (def.type) {
    case 'scale': {
      const [, max] = scaleRange(def);
      return `${rounded}/${max}`;
    }
    case 'duration':
      return formatDuration(avg);
    case 'number':
      return def.unit ? `${rounded}${def.unit}` : String(rounded);
    default:
      return String(rounded);
  }
}

function propertyStats(type: EventType, instances: EventInstance[]): EventPropertyStat[] {
  const stats: EventPropertyStat[] = [];
  for (const prop of type.properties) {
    if (!isNumericProperty(prop.type)) continue;
    const values: number[] = [];
    for (const inst of instances) {
      const v = inst.values[prop.id];
      if (typeof v === 'number' && Number.isFinite(v)) values.push(v);
    }
    if (values.length === 0) continue;
    const sum = values.reduce((a, b) => a + b, 0);
    const avg = sum / values.length;
    stats.push({
      id: prop.id,
      name: prop.name.trim() || prop.id,
      type: prop.type,
      count: values.length,
      min: Math.min(...values),
      max: Math.max(...values),
      avg,
      formattedAvg: formatStatAverage(prop, avg),
    });
  }
  return stats;
}

function weekClusters(instances: EventInstance[], zone: IanaZone): WeekCluster[] {
  const byWeek = new Map<ISODate, number>();
  for (const inst of instances) {
    const week = startOfIsoWeek(isoDateInZone(inst.occurredAt, zone));
    byWeek.set(week, (byWeek.get(week) ?? 0) + 1);
  }
  return [...byWeek.entries()]
    .map(([weekStart, count]) => ({ weekStart, count }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

function eventStats(
  eventTypes: EventType[],
  instances: EventInstance[],
  zone: IanaZone,
): EventTypeStats[] {
  const byType = new Map<string, EventInstance[]>();
  for (const inst of instances) {
    const list = byType.get(inst.typeId);
    if (list) list.push(inst);
    else byType.set(inst.typeId, [inst]);
  }
  const typeById = new Map(eventTypes.map((t) => [t.id, t]));

  const result: EventTypeStats[] = [];
  for (const [typeId, list] of byType) {
    const type = typeById.get(typeId);
    if (!type) continue; // orphaned instance (its type was hard-deleted) — skip
    const weeks = weekClusters(list, zone);
    const peakWeek = weeks.reduce<WeekCluster | null>(
      (peak, w) => (peak === null || w.count > peak.count ? w : peak),
      null,
    );
    result.push({
      typeId,
      name: type.name,
      color: type.color,
      count: list.length,
      properties: propertyStats(type, list),
      weeks,
      peakWeek,
    });
  }
  return result.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/**
 * The "what changed / what to ask" block: a bounded, deterministic, DESCRIPTIVE
 * list drawn only from the period's recorded data. It states facts (missed
 * counts, started/stopped medications, notable flare clusters) and originates no
 * clinical judgement or recommendation — the copy is deliberately free of
 * advice/dose language (asserted by a banned-phrase test, FR-23.3/AC2).
 */
function adherenceHighlights(overall: AdherenceResult, days: number): SummaryHighlight[] {
  const out: SummaryHighlight[] = [];
  if (overall.missed > 0) {
    out.push({
      kind: 'missed-doses',
      text: `${overall.missed} timing-sensitive ${plural(overall.missed, 'dose')} recorded as missed in the last ${days} days.`,
    });
  }
  if (overall.late > 0) {
    out.push({
      kind: 'late-doses',
      text: `${overall.late} ${plural(overall.late, 'dose')} logged outside the ${overall.onTimeWindowMinutes}-minute on-time window.`,
    });
  }
  return out;
}

function medicationChangeHighlights(changes: RegimenChange[]): SummaryHighlight[] {
  const out: SummaryHighlight[] = [];
  for (const change of changes) {
    if (change.kind === 'medication-added') {
      out.push({ kind: 'medication-started', text: `Started: ${change.summary}` });
    } else if (change.kind === 'medication-retired') {
      out.push({ kind: 'medication-stopped', text: `Stopped: ${change.summary}` });
    }
  }
  return out;
}

function eventHighlights(events: EventTypeStats[], totalEvents: number): SummaryHighlight[] {
  const out: SummaryHighlight[] = [];
  for (const type of events) {
    if (type.peakWeek && type.peakWeek.count > 1) {
      out.push({
        kind: 'event-cluster',
        text: `${type.name}: ${type.peakWeek.count} in the week of ${type.peakWeek.weekStart} (of ${type.count} in the period).`,
      });
    }
  }
  if (totalEvents > 0 && events.length > 0) {
    out.push({
      kind: 'event-total',
      text: `${totalEvents} ${plural(totalEvents, 'event')} logged across ${events.length} ${plural(events.length, 'type')}.`,
    });
  }
  return out;
}

function buildHighlights(
  overall: AdherenceResult,
  events: EventTypeStats[],
  totalEvents: number,
  changes: RegimenChange[],
  days: number,
): SummaryHighlight[] {
  return [
    ...adherenceHighlights(overall, days),
    ...medicationChangeHighlights(changes),
    ...eventHighlights(events, totalEvents),
  ];
}

function plural(n: number, word: string): string {
  return n === 1 ? word : `${word}s`;
}

/**
 * Build the pre-visit summary over the last `opts.days` days (ending today in the
 * dataset's active zone). Overall + per-timing-sensitive-medication adherence
 * come from the shared adherence engine; flare-up stats from the event helpers;
 * regimen changes are those in the period (present only when Stage 16 has been
 * recording them). Everything is descriptive.
 */
export function buildPreVisitSummary(
  dataset: Pick<
    Dataset,
    | 'medications'
    | 'slots'
    | 'doseLog'
    | 'eventTypes'
    | 'eventInstances'
    | 'regimenChanges'
    | 'scheduleSnapshots'
    | 'settings'
  >,
  opts: PreVisitSummaryOptions,
): PreVisitSummary {
  const { now, days } = opts;
  const { settings } = dataset;
  const zone = settings.zone;
  const assumeTakenOnTime = settings.assumeTakenOnTime ?? true;
  const onTimeWindowMinutes = settings.onTimeWindowMinutes;
  const windowDays = Math.max(1, Math.round(days));

  const to = isoDateInZone(now, zone);
  const from = addDaysToIsoDate(to, -(windowDays - 1));

  const overall = computeAdherence(
    dataset.slots,
    dataset.medications,
    dataset.doseLog,
    zone,
    windowDays,
    settings.missedDayThreshold,
    now,
    assumeTakenOnTime,
    dataset.scheduleSnapshots,
    onTimeWindowMinutes,
  );

  // Per-medication adherence for currently-active timing-sensitive meds — the
  // ones the overall (timing-sensitive-only) figure is built from. Flexible meds
  // carry no adherence score, so listing them would only show a misleading 100%.
  const perMedication: PerMedicationAdherence[] = dataset.medications
    .filter((m) => live(m) && m.active && m.adjustWhenLate)
    .map((m) => ({
      medId: m.id,
      label: medicationLabel(m),
      result: computeAdherence(
        dataset.slots,
        [m],
        dataset.doseLog,
        zone,
        windowDays,
        settings.missedDayThreshold,
        now,
        assumeTakenOnTime,
        dataset.scheduleSnapshots,
        onTimeWindowMinutes,
      ),
    }))
    .sort((a, b) => a.result.ratio - b.result.ratio || a.label.localeCompare(b.label));

  // Events in the period: [from 00:00, day-after-to 00:00) in the active zone.
  const fromInstant = startOfDayInstant(from, zone);
  const toExclusive = startOfDayInstant(addDaysToIsoDate(to, 1), zone);
  const periodInstances = dataset.eventInstances.filter(
    (e) => live(e) && e.occurredAt >= fromInstant && e.occurredAt < toExclusive,
  );
  const events = eventStats(dataset.eventTypes, periodInstances, zone);
  const totalEvents = periodInstances.length;

  const regimenChanges = dataset.regimenChanges
    .filter((c) => live(c) && c.changedAt >= fromInstant && c.changedAt < toExclusive)
    .sort((a, b) => a.changedAt - b.changedAt);

  const medicationCount = dataset.medications.filter((m) => live(m) && m.active).length;

  return {
    from,
    to,
    days: windowDays,
    zone,
    generatedAt: now,
    overall,
    perMedication,
    medicationCount,
    events,
    totalEvents,
    regimenChanges,
    highlights: buildHighlights(overall, events, totalEvents, regimenChanges, windowDays),
  };
}
