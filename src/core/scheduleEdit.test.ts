import { describe, expect, it } from 'vitest';
import type { Slot } from './types';
import {
  coScheduledAtTime,
  duplicateTimes,
  planSlotOps,
  type MedTimeRow,
  rowsForMedication,
  slotsForMedication,
} from './scheduleEdit';
import { slot } from '../test/fixtures';

const morning = slot({
  id: 's-am',
  time: '08:00',
  items: [
    { medId: 'lam', dose: 150 },
    { medId: 'lev', dose: 1000 },
  ],
});
const evening = slot({ id: 's-pm', time: '20:00', items: [{ medId: 'lam', dose: 100 }] });
const slots = [evening, morning];

describe('rowsForMedication / slotsForMedication', () => {
  it('projects a medication onto its slots in time order, carrying that slot’s own dose', () => {
    expect(rowsForMedication(slots, 'lam')).toEqual([
      { slotId: 's-am', time: '08:00', dose: 150 },
      { slotId: 's-pm', time: '20:00', dose: 100 },
    ]);
  });

  it('ignores tombstoned slots', () => {
    const gone = slot({
      id: 's-x',
      time: '12:00',
      items: [{ medId: 'lam', dose: 50 }],
      deleted: true,
    });
    expect(slotsForMedication([...slots, gone], 'lam').map((s) => s.id)).toEqual(['s-am', 's-pm']);
  });
});

describe('planSlotOps', () => {
  it('emits nothing when nothing changed', () => {
    expect(planSlotOps('lam', rowsForMedication(slots, 'lam'), slots)).toEqual([]);
  });

  it('a dose-only edit patches just that slot’s items, preserving co-scheduled medications', () => {
    const rows = rowsForMedication(slots, 'lam');
    rows[0]!.dose = 200;
    expect(planSlotOps('lam', rows, slots)).toEqual([
      {
        kind: 'update-slot',
        slotId: 's-am',
        patch: {
          items: [
            { medId: 'lam', dose: 200 },
            { medId: 'lev', dose: 1000 },
          ],
        },
      },
    ]);
  });

  it('a time-only edit patches just the time', () => {
    const rows = rowsForMedication(slots, 'lam');
    rows[1]!.time = '21:00';
    expect(planSlotOps('lam', rows, slots)).toEqual([
      { kind: 'update-slot', slotId: 's-pm', patch: { time: '21:00' } },
    ]);
  });

  it('a combined time+dose edit is one operation, not two', () => {
    const rows = rowsForMedication(slots, 'lam');
    rows[1]!.time = '21:00';
    rows[1]!.dose = 125;
    const ops = planSlotOps('lam', rows, slots);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toEqual({
      kind: 'update-slot',
      slotId: 's-pm',
      patch: { time: '21:00', items: [{ medId: 'lam', dose: 125 }] },
    });
  });

  it('a new time creates a slot when nothing else is scheduled then', () => {
    const rows = [...rowsForMedication(slots, 'lam'), { time: '13:00', dose: 50 }];
    expect(planSlotOps('lam', rows, slots)).toEqual([
      { kind: 'add-slot', time: '13:00', item: { medId: 'lam', dose: 50 } },
    ]);
  });

  it('a new time joins the existing slot at that wall-clock time', () => {
    const rows = [...rowsForMedication(slots, 'lev'), { time: '20:00', dose: 500 }];
    expect(planSlotOps('lev', rows, slots)).toEqual([
      {
        kind: 'update-slot',
        slotId: 's-pm',
        patch: {
          items: [
            { medId: 'lam', dose: 100 },
            { medId: 'lev', dose: 500 },
          ],
        },
      },
    ]);
  });

  it('removing a time detaches the medication but keeps a shared slot alive', () => {
    const rows = rowsForMedication(slots, 'lam').filter((r) => r.slotId !== 's-am');
    expect(planSlotOps('lam', rows, slots)).toEqual([
      { kind: 'update-slot', slotId: 's-am', patch: { items: [{ medId: 'lev', dose: 1000 }] } },
    ]);
  });

  it('removing the last medication from a slot tombstones the slot', () => {
    const rows = rowsForMedication(slots, 'lam').filter((r) => r.slotId !== 's-pm');
    expect(planSlotOps('lam', rows, slots)).toEqual([{ kind: 'delete-slot', slotId: 's-pm' }]);
  });

  it('drops rows that are not yet usable rather than writing a zero dose', () => {
    const rows = [
      { time: '08:00', dose: 0 },
      { time: '', dose: 10 },
      { time: '25:00', dose: 10 },
    ];
    expect(planSlotOps('new', rows, [])).toEqual([]);
  });

  it('schedules a brand-new medication from an empty slot set', () => {
    const rows = [
      { time: '08:00', dose: 150 },
      { time: '20:00', dose: 100 },
    ];
    expect(planSlotOps('new', rows, [])).toEqual([
      { kind: 'add-slot', time: '08:00', item: { medId: 'new', dose: 150 } },
      { kind: 'add-slot', time: '20:00', item: { medId: 'new', dose: 100 } },
    ]);
  });
});

describe('duplicateTimes', () => {
  it('flags a time entered twice and passes distinct times', () => {
    expect(
      duplicateTimes([
        { time: '08:00', dose: 1 },
        { time: '08:00', dose: 2 },
      ]),
    ).toEqual(['08:00']);
    expect(
      duplicateTimes([
        { time: '08:00', dose: 1 },
        { time: '20:00', dose: 2 },
      ]),
    ).toEqual([]);
  });
});

describe('coScheduledAtTime', () => {
  it('names the other medications already sharing a row’s own slot', () => {
    expect(coScheduledAtTime(slots, { slotId: 's-am', time: '08:00' }, 'lam')).toEqual({
      medIds: ['lev'],
      joining: false,
    });
  });

  it('returns nothing when the medication is alone in the slot', () => {
    expect(coScheduledAtTime(slots, { slotId: 's-pm', time: '20:00' }, 'lam')).toEqual({
      medIds: [],
      joining: false,
    });
  });

  it('matches a not-yet-saved row by the time it will join, flagged as joining', () => {
    expect(coScheduledAtTime(slots, { time: '08:00' }, 'new')).toEqual({
      medIds: ['lam', 'lev'],
      joining: true,
    });
    expect(coScheduledAtTime(slots, { time: '13:00' }, 'new')).toEqual({
      medIds: [],
      joining: false,
    });
  });

  it('reports the destination, not the source, when a row is being retimed onto an occupied slot', () => {
    const pair = [
      slot({ id: 's1', time: '08:00', items: [{ medId: 'lam', dose: 150 }] }),
      slot({ id: 's2', time: '20:00', items: [{ medId: 'lev', dose: 1000 }] }),
    ];
    // lam's own 08:00 row, retimed to 20:00 where only lev sits today.
    expect(coScheduledAtTime(pair, { slotId: 's1', time: '20:00' }, 'lam')).toEqual({
      medIds: ['lev'],
      joining: true,
    });
    // …and back at its own time it is alone, with nothing to disclose.
    expect(coScheduledAtTime(pair, { slotId: 's1', time: '08:00' }, 'lam')).toEqual({
      medIds: [],
      joining: false,
    });
  });

  it('ignores tombstoned slots when matching by time', () => {
    const gone = slot({
      id: 's-gone',
      time: '13:00',
      items: [{ medId: 'lam', dose: 5 }],
      deleted: true,
    });
    expect(coScheduledAtTime([...slots, gone], { time: '13:00' }, 'new')).toEqual({
      medIds: [],
      joining: false,
    });
  });
});

describe('planSlotOps — retiming onto a time another slot already occupies', () => {
  // The bug this covers: patching the source slot's time forked a second live
  // slot at the same wall-clock time, splitting a group the user sees as one.
  const lamOnly = slot({ id: 's1', time: '08:00', items: [{ medId: 'lam', dose: 150 }] });
  const levOnly = slot({ id: 's2', time: '20:00', items: [{ medId: 'lev', dose: 1000 }] });

  /** Apply a plan to a slot set, so invariants can be asserted on the result. */
  function apply(before: Slot[], ops: ReturnType<typeof planSlotOps>): Slot[] {
    let out = [...before];
    for (const op of ops) {
      if (op.kind === 'add-slot') {
        out.push(slot({ id: `added-${op.time}`, time: op.time, items: [op.item] }));
      } else if (op.kind === 'delete-slot') {
        out = out.map((s) => (s.id === op.slotId ? { ...s, deleted: true } : s));
      } else {
        out = out.map((s) => (s.id === op.slotId ? { ...s, ...op.patch } : s));
      }
    }
    return out;
  }

  const liveSlots = (ss: Slot[]) => ss.filter((s) => !s.deleted);

  it('moves the medication into the occupant and tombstones an emptied source', () => {
    const before = [lamOnly, levOnly];
    const ops = planSlotOps('lam', [{ slotId: 's1', time: '20:00', dose: 150 }], before);

    expect(ops).toEqual([
      { kind: 'delete-slot', slotId: 's1' },
      {
        kind: 'update-slot',
        slotId: 's2',
        patch: {
          items: [
            { medId: 'lev', dose: 1000 },
            { medId: 'lam', dose: 150 },
          ],
        },
      },
    ]);

    const after = liveSlots(apply(before, ops));
    expect(after).toHaveLength(1);
    expect(after[0]!.time).toBe('20:00');
    expect(after[0]!.items.map((i) => i.medId).sort()).toEqual(['lam', 'lev']);
  });

  it('leaves the source alive when other medications remain in it', () => {
    const shared = slot({
      id: 's1',
      time: '08:00',
      items: [
        { medId: 'lam', dose: 150 },
        { medId: 'vit', dose: 1000 },
      ],
    });
    const before = [shared, levOnly];
    const ops = planSlotOps('lam', [{ slotId: 's1', time: '20:00', dose: 150 }], before);

    expect(ops[0]).toEqual({
      kind: 'update-slot',
      slotId: 's1',
      patch: { items: [{ medId: 'vit', dose: 1000 }] },
    });

    const after = liveSlots(apply(before, ops));
    expect(after.map((s) => [s.time, s.items.map((i) => i.medId)])).toEqual([
      ['08:00', ['vit']],
      ['20:00', ['lev', 'lam']],
    ]);
  });

  it('handles both source and destination being shared', () => {
    const src = slot({
      id: 's1',
      time: '08:00',
      items: [
        { medId: 'lam', dose: 150 },
        { medId: 'vit', dose: 1000 },
      ],
    });
    const dst = slot({
      id: 's2',
      time: '20:00',
      items: [
        { medId: 'lev', dose: 1000 },
        { medId: 'zon', dose: 50 },
      ],
    });
    const before = [src, dst];
    const after = liveSlots(
      apply(before, planSlotOps('lam', [{ slotId: 's1', time: '20:00', dose: 125 }], before)),
    );

    expect(after).toHaveLength(2);
    expect(after.find((s) => s.time === '08:00')!.items).toEqual([{ medId: 'vit', dose: 1000 }]);
    expect(after.find((s) => s.time === '20:00')!.items).toEqual([
      { medId: 'lev', dose: 1000 },
      { medId: 'zon', dose: 50 },
      { medId: 'lam', dose: 125 },
    ]);
  });

  it('carries a simultaneous dose change onto the destination', () => {
    const before = [lamOnly, levOnly];
    const after = liveSlots(
      apply(before, planSlotOps('lam', [{ slotId: 's1', time: '20:00', dose: 75 }], before)),
    );
    expect(after[0]!.items).toContainEqual({ medId: 'lam', dose: 75 });
  });

  it('never leaves two live slots at the same wall-clock time', () => {
    const cases: Array<[Slot[], MedTimeRow[]]> = [
      [[lamOnly, levOnly], [{ slotId: 's1', time: '20:00', dose: 150 }]],
      [
        [lamOnly, levOnly],
        [
          { time: '20:00', dose: 10 },
          { slotId: 's1', time: '08:00', dose: 150 },
        ],
      ],
      [
        [lamOnly, levOnly],
        [
          { slotId: 's1', time: '20:00', dose: 150 },
          { time: '08:00', dose: 25 },
        ],
      ],
    ];
    for (const [before, rows] of cases) {
      const after = liveSlots(apply(before, planSlotOps('lam', rows, before)));
      const times = after.map((s) => s.time);
      expect(new Set(times).size).toBe(times.length);
    }
  });

  it('swapping two of the same medication’s own times stays two in-place retimes', () => {
    const am = slot({ id: 's1', time: '08:00', items: [{ medId: 'lam', dose: 150 }] });
    const pm = slot({ id: 's2', time: '20:00', items: [{ medId: 'lam', dose: 100 }] });
    const ops = planSlotOps(
      'lam',
      [
        { slotId: 's1', time: '20:00', dose: 150 },
        { slotId: 's2', time: '08:00', dose: 100 },
      ],
      [am, pm],
    );
    // Neither row may merge into the other — they are the same medication.
    expect(ops).toEqual([
      { kind: 'update-slot', slotId: 's1', patch: { time: '20:00' } },
      { kind: 'update-slot', slotId: 's2', patch: { time: '08:00' } },
    ]);
  });

  it('still retimes in place when the destination time is free', () => {
    const before = [lamOnly, levOnly];
    expect(planSlotOps('lam', [{ slotId: 's1', time: '09:00', dose: 150 }], before)).toEqual([
      { kind: 'update-slot', slotId: 's1', patch: { time: '09:00' } },
    ]);
  });
});
