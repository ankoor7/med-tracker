// Cloud record schema + validation — the single source of truth shared by the
// client (before a write) and the backend (before persist), mirroring the
// `core/guardrails.ts` pattern. See specs/stage-4-cloud-data-and-security.md §5.
//
// The cloud is NOT zero-knowledge: a record carries a readable, typed `payload`
// (a structured object the server can parse and validate), discriminated by
// `type`. There is no client-held-only encryption. This module is pure
// TypeScript with no DOM/Node dependencies so both sides can import it.

export type RecordType =
  | 'medication'
  | 'slot'
  | 'doseLog'
  | 'doseOverride'
  | 'eventType'
  | 'eventInstance'
  | 'regimenChange'
  | 'scheduleSnapshot'
  | 'settings';

export const RECORD_TYPES: readonly RecordType[] = [
  'medication',
  'slot',
  'doseLog',
  'doseOverride',
  'eventType',
  'eventInstance',
  'regimenChange',
  'scheduleSnapshot',
  'settings',
];

/**
 * Coarse regimen-change kinds, mirrored from core/types.ts (RegimenChangeKind)
 * for envelope validation. Kept in lock-step with the SQL validate_record.
 */
const REGIMEN_CHANGE_KIND_NAMES: readonly string[] = [
  'medication-added',
  'medication-reactivated',
  'medication-updated',
  'medication-retired',
  'slot-added',
  'slot-updated',
  'slot-removed',
];

/**
 * The event property-type vocabulary, mirrored from core/events.ts for envelope
 * validation. Kept in lock-step with EVENT_PROPERTY_TYPES (and validate_record).
 */
const EVENT_PROPERTY_TYPE_NAMES: readonly string[] = ['number', 'text', 'scale', 'duration'];

/**
 * A readable, typed record as stored in the cloud and moved by the sync engine
 * (Stage 5). `payload` is a native object keyed by `type`; never ciphertext.
 */
export interface SyncRecord {
  id: string;
  type: RecordType;
  updatedAt: number; // epoch ms; pull cursor + LWW key
  version: number; // monotonic per record; idempotency + version guard
  deleted?: boolean; // tombstone
  payload: object; // readable entity fields, typed by `type`
}

/**
 * Per-record size ceiling. A single medication/slot/log/settings entity is tiny;
 * this bounds abuse and matches DynamoDB's friendly item-size envelope. The
 * server rejects anything larger (AC3).
 */
export const MAX_RECORD_BYTES = 64 * 1024; // 64 KiB

export type ValidationResult = { ok: true } | { ok: false; reason: string };

const ok: ValidationResult = { ok: true };
const fail = (reason: string): ValidationResult => ({ ok: false, reason });

/** UTF-8 byte length, available in both browser and Node 20. */
function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

/**
 * Validate a record's envelope and (unless it's a tombstone) its typed payload.
 * Used client-side before push and server-side before persist — the same code on
 * both ends guarantees a single contract.
 */
export function validateSyncRecord(rec: unknown): ValidationResult {
  if (!isPlainObject(rec)) return fail('record must be an object');
  if (!isNonEmptyString(rec.id)) return fail('missing id');
  if (typeof rec.type !== 'string' || !RECORD_TYPES.includes(rec.type as RecordType)) {
    return fail(`unknown type: ${String(rec.type)}`);
  }
  if (!isFiniteNumber(rec.updatedAt)) return fail('missing updatedAt');
  if (!isFiniteNumber(rec.version)) return fail('missing version');
  if ('deleted' in rec && rec.deleted !== undefined && typeof rec.deleted !== 'boolean') {
    return fail('deleted must be a boolean');
  }
  if (!isPlainObject(rec.payload)) return fail('payload must be an object');

  // Size guard (whole record, since the payload dominates it).
  if (byteLength(JSON.stringify(rec)) > MAX_RECORD_BYTES) {
    return fail('record too large');
  }

  // Tombstones may carry a minimal payload; skip deep field validation.
  if (rec.deleted === true) return ok;

  return validatePayload(rec.type as RecordType, rec.payload);
}

/**
 * Dispatch table, one entry per `RecordType`. A `Record<RecordType, ...>` (rather
 * than a switch) makes an unhandled type a compile error instead of a runtime
 * branch, and keeps `validatePayload` itself a single lookup.
 */
const PAYLOAD_VALIDATORS: Record<
  RecordType,
  (payload: Record<string, unknown>) => ValidationResult
> = {
  medication: validateMedication,
  slot: validateSlot,
  doseLog: validateDoseLog,
  doseOverride: validateDoseOverride,
  eventType: validateEventType,
  eventInstance: validateEventInstance,
  regimenChange: validateRegimenChange,
  scheduleSnapshot: validateScheduleSnapshot,
  settings: validateSettings,
};

function validatePayload(type: RecordType, payload: Record<string, unknown>): ValidationResult {
  return PAYLOAD_VALIDATORS[type](payload);
}

function validateGuardrails(v: unknown): boolean {
  if (!isPlainObject(v)) return false;
  const fields = ['maxSingleDose', 'maxDailyDose', 'minIntervalHours'];
  return fields.every((f) => v[f] === null || isFiniteNumber(v[f]));
}

function validateMedication(p: Record<string, unknown>): ValidationResult {
  if (!isNonEmptyString(p.name)) return fail('medication.name required');
  if (!isNonEmptyString(p.unit)) return fail('medication.unit required');
  if (!isFiniteNumber(p.halfLifeHours)) return fail('medication.halfLifeHours required');
  if (typeof p.active !== 'boolean') return fail('medication.active required');
  if (!validateGuardrails(p.guardrails)) return fail('medication.guardrails invalid');
  return ok;
}

function validateSlot(p: Record<string, unknown>): ValidationResult {
  if (typeof p.time !== 'string' || !/^\d{2}:\d{2}$/.test(p.time)) {
    return fail('slot.time must be HH:MM');
  }
  if (!Array.isArray(p.items) || p.items.length === 0) return fail('slot.items required');
  for (const item of p.items) {
    if (!isPlainObject(item) || !isNonEmptyString(item.medId) || !isFiniteNumber(item.dose)) {
      return fail('slot.items entry invalid');
    }
  }
  return ok;
}

// One required-field check per doseLog property plus the Stage 18 FR-18.3
// optional-skipReason branch; each guard clause is covered in
// cloudRecord.test.ts and mirrored 1:1 in supabase/tests/records_test.sql
// (parity is the point — see that file).
function validateDoseLog(p: Record<string, unknown>): ValidationResult {
  if (!isNonEmptyString(p.slotId)) return fail('doseLog.slotId required');
  if (!isNonEmptyString(p.medId)) return fail('doseLog.medId required');
  if (!isFiniteNumber(p.scheduledInstant)) return fail('doseLog.scheduledInstant required');
  if (!isFiniteNumber(p.actualInstant)) return fail('doseLog.actualInstant required');
  if (!isFiniteNumber(p.dose)) return fail('doseLog.dose required');
  if (p.status !== 'taken' && p.status !== 'skipped') return fail('doseLog.status invalid');
  // Optional free-text reason for a skip (Stage 18 FR-18.3) — never required,
  // but must be a string when present.
  if (!isValidOptionalString(p, 'skipReason')) return fail('doseLog.skipReason must be a string');
  return ok;
}

function validateDoseOverride(p: Record<string, unknown>): ValidationResult {
  if (!isNonEmptyString(p.slotId)) return fail('doseOverride.slotId required');
  if (!isNonEmptyString(p.medId)) return fail('doseOverride.medId required');
  if (!isFiniteNumber(p.scheduledInstant)) return fail('doseOverride.scheduledInstant required');
  if (!isNonEmptyString(p.zone)) return fail('doseOverride.zone required');
  if (!isFiniteNumber(p.dose)) return fail('doseOverride.dose required');
  return ok;
}

function validateEventType(p: Record<string, unknown>): ValidationResult {
  if (!isNonEmptyString(p.name)) return fail('eventType.name required');
  if (!Array.isArray(p.properties)) return fail('eventType.properties required');
  for (const prop of p.properties) {
    if (
      !isPlainObject(prop) ||
      !isNonEmptyString(prop.id) ||
      !isNonEmptyString(prop.name) ||
      typeof prop.type !== 'string' ||
      !EVENT_PROPERTY_TYPE_NAMES.includes(prop.type)
    ) {
      return fail('eventType.properties entry invalid');
    }
  }
  return ok;
}

function validateEventInstance(p: Record<string, unknown>): ValidationResult {
  if (!isNonEmptyString(p.typeId)) return fail('eventInstance.typeId required');
  if (!isFiniteNumber(p.occurredAt)) return fail('eventInstance.occurredAt required');
  if (!isNonEmptyString(p.zone)) return fail('eventInstance.zone required');
  if (!isPlainObject(p.values)) return fail('eventInstance.values required');
  return ok;
}

/** A typed diff value: `string | number | boolean | null` (Stage 18). */
function isFieldValue(v: unknown): boolean {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return true;
  return isFiniteNumber(v);
}

/**
 * A diff entry. The display layer — `{ field, from, to }` with string-or-null
 * `from`/`to` — is required. The Stage 18 machine layer (`key`, `medId`,
 * `slotId`, `fromValue`, `toValue`) is optional, because records written before
 * it existed omit it; when present each part must be well-formed.
 *
 * `key` is deliberately validated as any non-empty string rather than against a
 * fixed vocabulary: a newer client must be able to sync a key this build does
 * not yet know about without the server rejecting the write.
 */
/** An absent field is fine; a present one must satisfy `check`. */
function isOptionally(v: unknown, check: (v: unknown) => boolean): boolean {
  return v === undefined || check(v);
}

/**
 * True when `key` on `p` is absent, explicitly `undefined`, or a string — the
 * shared shape for every optional free-text field on a payload (`doseLog.
 * skipReason`, `regimenChange.note`). Extracted so `validateDoseLog` doesn't
 * carry this 3-condition check inline as its own branching.
 */
function isValidOptionalString(p: Record<string, unknown>, key: string): boolean {
  return !(key in p) || p[key] === undefined || typeof p[key] === 'string';
}

/** The optional Stage 18 machine layer: identity strings + typed values. */
function hasValidMachineLayer(c: Record<string, unknown>): boolean {
  return (
    isOptionally(c.key, isNonEmptyString) &&
    isOptionally(c.medId, isNonEmptyString) &&
    isOptionally(c.slotId, isNonEmptyString) &&
    isOptionally(c.fromValue, isFieldValue) &&
    isOptionally(c.toValue, isFieldValue)
  );
}

function isValidFieldChange(c: unknown): boolean {
  const isStrOrNull = (v: unknown) => v === null || typeof v === 'string';
  if (!isPlainObject(c)) return false;
  if (!isNonEmptyString(c.field) || !isStrOrNull(c.from) || !isStrOrNull(c.to)) return false;
  return hasValidMachineLayer(c);
}

function validateRegimenChange(p: Record<string, unknown>): ValidationResult {
  if (!isFiniteNumber(p.changedAt)) return fail('regimenChange.changedAt required');
  if (!isNonEmptyString(p.zone)) return fail('regimenChange.zone required');
  if (typeof p.kind !== 'string' || !REGIMEN_CHANGE_KIND_NAMES.includes(p.kind)) {
    return fail('regimenChange.kind invalid');
  }
  if (!isNonEmptyString(p.summary)) return fail('regimenChange.summary required');
  if (!Array.isArray(p.changes) || p.changes.length === 0) {
    return fail('regimenChange.changes required');
  }
  if (!p.changes.every(isValidFieldChange)) return fail('regimenChange.changes entry invalid');
  if (!isValidOptionalString(p, 'note')) return fail('regimenChange.note must be a string');
  return ok;
}

/**
 * Validate every entry of `arr` against `validate` after confirming each carries
 * a non-empty `id` — the shape a snapshot's nested medications/slots share with
 * their standalone records. Shared by `validateScheduleSnapshot`'s two array
 * fields so the id/shape check isn't duplicated per field.
 */
function validateIdentifiedEntries(
  arr: unknown,
  label: string,
  validate: (v: Record<string, unknown>) => ValidationResult,
): ValidationResult {
  if (!Array.isArray(arr)) return fail(`${label} required`);
  for (const entry of arr) {
    if (!isPlainObject(entry) || !isNonEmptyString(entry.id)) {
      return fail(`${label} entry invalid`);
    }
    const result = validate(entry);
    if (!result.ok) return fail(`${label} entry invalid: ${result.reason}`);
  }
  return ok;
}

/**
 * An effective-dated regimen snapshot (Stage 18 FR-18.1): when it took effect,
 * the zone it was captured in, and full copies of the medications and slots. The
 * nested entities are validated with the same rules as their standalone records,
 * so a snapshot can never carry a shape the top-level types would reject.
 */
function validateScheduleSnapshot(p: Record<string, unknown>): ValidationResult {
  if (!isFiniteNumber(p.effectiveFrom)) return fail('scheduleSnapshot.effectiveFrom required');
  if (!isNonEmptyString(p.zone)) return fail('scheduleSnapshot.zone required');
  const meds = validateIdentifiedEntries(
    p.medications,
    'scheduleSnapshot.medications',
    validateMedication,
  );
  if (!meds.ok) return meds;
  return validateIdentifiedEntries(p.slots, 'scheduleSnapshot.slots', validateSlot);
}

function validateSettings(p: Record<string, unknown>): ValidationResult {
  if (!isNonEmptyString(p.zone)) return fail('settings.zone required');
  if (!isFiniteNumber(p.adherenceWindowDays)) return fail('settings.adherenceWindowDays required');
  if (!isFiniteNumber(p.missedDayThreshold)) return fail('settings.missedDayThreshold required');
  // Global on-time window (Stage 18 FR-18.4) — optional for back-compat with
  // settings written before this field existed, but must be a positive number
  // when present.
  if ('onTimeWindowMinutes' in p && p.onTimeWindowMinutes !== undefined) {
    if (!isFiniteNumber(p.onTimeWindowMinutes) || p.onTimeWindowMinutes <= 0) {
      return fail('settings.onTimeWindowMinutes must be a positive number');
    }
  }
  return ok;
}

/** The fields the LWW ordering compares — a structural subset of a record. */
export interface RecordOrder {
  updatedAt: number;
  version: number;
}

/**
 * Last-write-wins ordering, shared by the server write guard and the client
 * merge so both ends resolve conflicts identically (Stage 5 FR-5.3/FR-5.4).
 *
 * `incoming` is newer when its `updatedAt` is greater, or — for the same
 * `updatedAt` — its `version` is greater. The version tie-break makes
 * re-applying an identical record a no-op, which is what keeps sync idempotent
 * (re-pushed/re-pulled records change nothing).
 */
export function isNewerRecord(incoming: RecordOrder, existing: RecordOrder | undefined): boolean {
  if (!existing) return true;
  if (incoming.updatedAt !== existing.updatedAt) return incoming.updatedAt > existing.updatedAt;
  return incoming.version > existing.version;
}
