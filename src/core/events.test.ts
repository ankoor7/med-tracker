import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EVENT_PROPERTIES,
  EVENT_PROPERTY_TYPES,
  formatDuration,
  formatPropertyValue,
  newPropertyDef,
  scaleRange,
  summarizeInstance,
  validateEventInstanceValues,
  validateEventTypeShape,
} from './events';
import type { EventType } from './types';

const seizureType = (): EventType => ({
  id: 't1',
  name: 'Seizure',
  color: '#9333ea',
  properties: [
    { id: 'severity', name: 'Severity', type: 'scale', min: 1, max: 5 },
    { id: 'duration', name: 'Duration', type: 'duration' },
    { id: 'aura', name: 'Aura', type: 'text' },
  ],
  updatedAt: 0,
});

describe('property defaults', () => {
  it('seeds a Severity scale (1–5) and a Duration', () => {
    const props = DEFAULT_EVENT_PROPERTIES();
    expect(props.map((p) => p.id)).toEqual(['severity', 'duration']);
    expect(scaleRange(props[0]!)).toEqual([1, 5]);
    expect(props[1]!.type).toBe('duration');
  });

  it('newPropertyDef gives a scale a default range', () => {
    expect(scaleRange(newPropertyDef('x', 'scale'))).toEqual([1, 5]);
    expect(newPropertyDef('y', 'number').min).toBeUndefined();
  });

  it('exposes the four property types', () => {
    expect([...EVENT_PROPERTY_TYPES]).toEqual(['number', 'text', 'scale', 'duration']);
  });
});

describe('validateEventTypeShape', () => {
  it('accepts a well-formed type', () => {
    expect(validateEventTypeShape(seizureType())).toEqual([]);
  });

  it('requires a name', () => {
    expect(validateEventTypeShape({ name: '  ', properties: [] })).toContain('Name is required.');
  });

  it('rejects a property without a name', () => {
    const errors = validateEventTypeShape({
      name: 'X',
      properties: [{ id: 'p1', name: '', type: 'number' }],
    });
    expect(errors.some((e) => /missing a name/.test(e))).toBe(true);
  });

  it('rejects duplicate property ids', () => {
    const errors = validateEventTypeShape({
      name: 'X',
      properties: [
        { id: 'dup', name: 'A', type: 'number' },
        { id: 'dup', name: 'B', type: 'number' },
      ],
    });
    expect(errors.some((e) => /Duplicate property id/.test(e))).toBe(true);
  });

  it('rejects a scale whose min is not below max', () => {
    const errors = validateEventTypeShape({
      name: 'X',
      properties: [{ id: 's', name: 'S', type: 'scale', min: 5, max: 5 }],
    });
    expect(errors.some((e) => /min < max/.test(e))).toBe(true);
  });
});

describe('validateEventInstanceValues', () => {
  const type = seizureType();

  it('accepts valid values', () => {
    expect(
      validateEventInstanceValues(type, { severity: 4, duration: 90, aura: 'tingling' }),
    ).toEqual([]);
  });

  it('flags a missing required property', () => {
    const t: EventType = {
      ...type,
      properties: [
        { id: 'severity', name: 'Severity', type: 'scale', min: 1, max: 5, required: true },
      ],
    };
    expect(validateEventInstanceValues(t, {})).toContain('Severity is required.');
  });

  it('allows an absent optional property', () => {
    expect(validateEventInstanceValues(type, { severity: 3 })).toEqual([]);
  });

  it('rejects a scale value out of range', () => {
    const errors = validateEventInstanceValues(type, { severity: 9 });
    expect(errors.some((e) => /whole number from 1 to 5/.test(e))).toBe(true);
  });

  it('rejects a non-integer scale value', () => {
    expect(validateEventInstanceValues(type, { severity: 2.5 }).length).toBeGreaterThan(0);
  });

  it('rejects a negative duration', () => {
    const errors = validateEventInstanceValues(type, { duration: -5 });
    expect(errors.some((e) => /duration ≥ 0/.test(e))).toBe(true);
  });
});

describe('display helpers', () => {
  it('formats durations', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(90)).toBe('1m 30s');
    expect(formatDuration(3661)).toBe('1h 1m 1s');
    expect(formatDuration(-1)).toBe('—');
  });

  it('formats property values per type', () => {
    const [severity, duration] = seizureType().properties;
    expect(formatPropertyValue(severity!, 4)).toBe('4/5');
    expect(formatPropertyValue(duration!, 90)).toBe('1m 30s');
    expect(formatPropertyValue({ id: 'n', name: 'N', type: 'number', unit: 'mg' }, 10)).toBe(
      '10mg',
    );
  });

  it('summarises an instance in property order, skipping empties', () => {
    const summary = summarizeInstance(seizureType(), {
      id: 'i1',
      typeId: 't1',
      occurredAt: 0,
      zone: 'Europe/London',
      values: { severity: 4, duration: 90 },
      updatedAt: 0,
    });
    expect(summary).toBe('Severity 4/5 · Duration 1m 30s');
  });
});
