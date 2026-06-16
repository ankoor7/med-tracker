// Cloud record schema + validation — the single source of truth shared by the
// client (before a write) and the backend (before persist), mirroring the
// `core/guardrails.ts` pattern. See specs/stage-4-cloud-data-and-security.md §5.
//
// The cloud is NOT zero-knowledge: a record carries a readable, typed `payload`
// (a structured object the server can parse and validate), discriminated by
// `type`. There is no client-held-only encryption. This module is pure
// TypeScript with no DOM/Node dependencies so both sides can import it.

export type RecordType = 'medication' | 'slot' | 'doseLog' | 'settings';

export const RECORD_TYPES: readonly RecordType[] = ['medication', 'slot', 'doseLog', 'settings'];

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

function validatePayload(type: RecordType, payload: Record<string, unknown>): ValidationResult {
  switch (type) {
    case 'medication':
      return validateMedication(payload);
    case 'slot':
      return validateSlot(payload);
    case 'doseLog':
      return validateDoseLog(payload);
    case 'settings':
      return validateSettings(payload);
  }
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

function validateDoseLog(p: Record<string, unknown>): ValidationResult {
  if (!isNonEmptyString(p.slotId)) return fail('doseLog.slotId required');
  if (!isNonEmptyString(p.medId)) return fail('doseLog.medId required');
  if (!isFiniteNumber(p.scheduledInstant)) return fail('doseLog.scheduledInstant required');
  if (!isFiniteNumber(p.actualInstant)) return fail('doseLog.actualInstant required');
  if (!isFiniteNumber(p.dose)) return fail('doseLog.dose required');
  if (p.status !== 'taken' && p.status !== 'skipped') return fail('doseLog.status invalid');
  return ok;
}

function validateSettings(p: Record<string, unknown>): ValidationResult {
  if (!isNonEmptyString(p.zone)) return fail('settings.zone required');
  if (!isFiniteNumber(p.adherenceWindowDays)) return fail('settings.adherenceWindowDays required');
  if (!isFiniteNumber(p.missedDayThreshold)) return fail('settings.missedDayThreshold required');
  return ok;
}
