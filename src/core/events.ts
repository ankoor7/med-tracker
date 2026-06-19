// Health-condition event tracking — pure domain core (Stage 13).
//
// Event types carry a user-defined schema of custom properties; event instances
// fill in values for that schema. This module owns:
//   - the property-type vocabulary + the seeded defaults for a new type;
//   - shape validation of a type's schema;
//   - validation of an instance's values *against its type* (the cross-record
//     check SQL can't do — it sees one record at a time, like guardrails);
//   - display helpers (duration / value / instance summary).
//
// Like `core/guardrails.ts`, the value validators return human-readable message
// lists (empty = valid) and never originate a value; the UI blocks save on them.
// No React/store/DOM imports — this is portable, unit-tested core.

import type {
  EventInstance,
  EventPropertyDef,
  EventPropertyType,
  EventPropertyValue,
  EventType,
} from './types';

export const EVENT_PROPERTY_TYPES: readonly EventPropertyType[] = [
  'number',
  'text',
  'scale',
  'duration',
];

/** Default inclusive bounds for a `scale` property. */
export const DEFAULT_SCALE_MIN = 1;
export const DEFAULT_SCALE_MAX = 5;

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** The inclusive [min, max] of a scale property, falling back to the defaults. */
export function scaleRange(def: EventPropertyDef): [number, number] {
  const min = isFiniteNumber(def.min) ? def.min : DEFAULT_SCALE_MIN;
  const max = isFiniteNumber(def.max) ? def.max : DEFAULT_SCALE_MAX;
  return [min, max];
}

/** A fresh property definition of `type`, with sensible defaults for its kind. */
export function newPropertyDef(id: string, type: EventPropertyType = 'number'): EventPropertyDef {
  const base: EventPropertyDef = { id, name: '', type };
  if (type === 'scale') return { ...base, min: DEFAULT_SCALE_MIN, max: DEFAULT_SCALE_MAX };
  return base;
}

/**
 * The properties a brand-new event type starts with (FR-13.1): a Severity scale
 * (1–5) and a Duration. Both are ordinary, fully editable/removable properties —
 * there is nothing special about them beyond being seeded.
 */
export function DEFAULT_EVENT_PROPERTIES(): EventPropertyDef[] {
  return [
    {
      id: 'severity',
      name: 'Severity',
      type: 'scale',
      min: DEFAULT_SCALE_MIN,
      max: DEFAULT_SCALE_MAX,
    },
    { id: 'duration', name: 'Duration', type: 'duration' },
  ];
}

// ---- Validation --------------------------------------------------------------

/**
 * Validate an event type's *shape* (not its instances): a non-empty name, unique
 * non-empty property ids/names, a known property type, and a coherent scale
 * range. Returns a list of messages; empty means valid.
 */
export function validateEventTypeShape(type: {
  name: string;
  properties: EventPropertyDef[];
}): string[] {
  const errors: string[] = [];
  if (!type.name.trim()) errors.push('Name is required.');

  const seenIds = new Set<string>();
  for (const prop of type.properties) {
    const label = prop.name.trim() || prop.id || '(unnamed)';
    if (!prop.id) errors.push(`Property "${label}" is missing an id.`);
    else if (seenIds.has(prop.id)) errors.push(`Duplicate property id "${prop.id}".`);
    else seenIds.add(prop.id);

    if (!prop.name.trim()) errors.push(`A property is missing a name.`);
    if (!EVENT_PROPERTY_TYPES.includes(prop.type)) {
      errors.push(`Property "${label}" has an unknown type.`);
    }
    if (prop.type === 'scale') {
      const [min, max] = scaleRange(prop);
      if (!(min < max)) errors.push(`Property "${label}" needs min < max.`);
    }
  }
  return errors;
}

/**
 * Validate an instance's `values` against its type's property definitions
 * (FR-13.4). Required properties must be present; numbers/durations must be
 * finite (durations ≥ 0); scales must be integers in range; text must be a
 * string. Empty list = valid.
 */
export function validateEventInstanceValues(
  type: EventType,
  values: Record<string, EventPropertyValue>,
): string[] {
  const errors: string[] = [];
  for (const prop of type.properties) {
    const label = prop.name.trim() || prop.id;
    const raw = values[prop.id];
    const present = raw !== undefined && raw !== '' && raw !== null;

    if (!present) {
      if (prop.required) errors.push(`${label} is required.`);
      continue;
    }

    switch (prop.type) {
      case 'text':
        if (typeof raw !== 'string') errors.push(`${label} must be text.`);
        break;
      case 'number':
        if (!isFiniteNumber(raw)) errors.push(`${label} must be a number.`);
        break;
      case 'duration':
        if (!isFiniteNumber(raw) || raw < 0) errors.push(`${label} must be a duration ≥ 0.`);
        break;
      case 'scale': {
        const [min, max] = scaleRange(prop);
        if (!isFiniteNumber(raw) || !Number.isInteger(raw) || raw < min || raw > max) {
          errors.push(`${label} must be a whole number from ${min} to ${max}.`);
        }
        break;
      }
    }
  }
  return errors;
}

// ---- Display helpers ---------------------------------------------------------

/** Human duration from seconds, e.g. 90 → "1m 30s", 0 → "0s", 3661 → "1h 1m 1s". */
export function formatDuration(seconds: number): string {
  if (!isFiniteNumber(seconds) || seconds < 0) return '—';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const parts = [h > 0 ? `${h}h` : '', m > 0 ? `${m}m` : '', s > 0 ? `${s}s` : ''].filter(Boolean);
  return parts.join(' ') || '0s';
}

/** Render one filled property value for display, per its definition. */
export function formatPropertyValue(def: EventPropertyDef, value: EventPropertyValue): string {
  switch (def.type) {
    case 'scale': {
      const [, max] = scaleRange(def);
      return `${value}/${max}`;
    }
    case 'duration':
      return formatDuration(Number(value));
    case 'number':
      return def.unit ? `${value}${def.unit}` : String(value);
    case 'text':
    default:
      return String(value);
  }
}

/**
 * A compact readable summary of an instance's filled values, in the type's
 * property order, e.g. "Severity 4/5 · Duration 1m 30s". Skips empty values.
 */
export function summarizeInstance(type: EventType, instance: EventInstance): string {
  const parts: string[] = [];
  for (const prop of type.properties) {
    const v = instance.values[prop.id];
    if (v === undefined || v === '' || v === null) continue;
    parts.push(`${prop.name.trim() || prop.id} ${formatPropertyValue(prop, v)}`);
  }
  return parts.join(' · ');
}
