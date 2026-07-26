// Stage 18 FR-18.12 — the merged Meds tab.
//
// Medications and their schedule used to be two tabs, and nothing signalled
// which one owned a dose amount. This screen owns both. It offers two
// projections of the same slots:
//
//   By medication (default) — "when do I take my Lamotrigine, and how much?"
//     A card per medication showing identity, guardrails and every time it is
//     taken, all editable in one form.
//   By time — "what do I take at 8am?"
//     A card per time-slot, listing everything taken then.
//
// Both write through the same store actions, so Stage 16 change records are
// unaffected by which view an edit was made from.

import { useState } from 'react';
import {
  isoDateInZone,
  medicationLabel,
  slotsForMedication,
  type Medication,
  type Slot,
} from '../../core';
import { useStore } from '../../store/store';
import { Button, Card, ColorDot, UNKNOWN_MED_NAME } from '../components/ui';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { MedicationEditor } from './MedicationEditor';
import { SlotEditor } from './SlotEditor';

type View = 'medication' | 'time';

export function MedsScreen() {
  const [view, setView] = useState<View>('medication');

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-2xl font-semibold tracking-tight">Medications &amp; schedule</h2>
      </div>

      <div
        role="group"
        aria-label="View regimen by"
        className="inline-flex w-fit gap-1 rounded-full border border-white/10 bg-slate-900/70 p-1"
      >
        <ViewButton current={view} value="medication" onSelect={setView}>
          By medication
        </ViewButton>
        <ViewButton current={view} value="time" onSelect={setView}>
          By time
        </ViewButton>
      </div>

      {view === 'medication' ? <MedicationView /> : <TimeView />}
    </div>
  );
}

function ViewButton({
  current,
  value,
  onSelect,
  children,
}: {
  current: View;
  value: View;
  onSelect: (v: View) => void;
  children: string;
}) {
  const active = current === value;
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => onSelect(value)}
      className={
        'rounded-full px-4 py-1.5 text-sm font-medium transition-colors ' +
        (active ? 'bg-accent/15 text-accent-muted' : 'text-slate-400 hover:text-slate-200')
      }
    >
      {children}
    </button>
  );
}

/** The "add" affordance plus the empty state, shared by both projections. */
function ViewToolbar({
  addLabel,
  onAdd,
  empty,
  emptyText,
}: {
  addLabel: string;
  onAdd: () => void;
  empty: boolean;
  emptyText: string;
}) {
  return (
    <>
      <div className="flex justify-end">
        <Button onClick={onAdd}>{addLabel}</Button>
      </div>
      {empty && (
        <Card>
          <p className="text-sm text-slate-400">{emptyText}</p>
        </Card>
      )}
    </>
  );
}

// ---- By medication ---------------------------------------------------------

function MedicationView() {
  const medications = useStore((s) => s.medications);
  const slots = useStore((s) => s.slots);
  const updateMedication = useStore((s) => s.updateMedication);
  const deleteMedication = useStore((s) => s.deleteMedication);
  const zone = useStore((s) => s.settings.zone);
  const [editing, setEditing] = useState<Medication | 'new' | null>(null);
  // Stage 18 FR-18.5: Delete is destructive-in-appearance (it isn't, at the
  // storage layer — see below) and MUST be confirmed. "Stop taking" is the
  // safe, reversible alternative and is offered first so a patient reaching
  // for Delete to mean "I've stopped this" finds the correct action before
  // the drastic-looking one.
  const [confirmDelete, setConfirmDelete] = useState<Medication | null>(null);

  const visible = medications.filter((m) => !m.deleted);

  return (
    <>
      <ViewToolbar
        addLabel="Add medication"
        onAdd={() => setEditing('new')}
        empty={visible.length === 0}
        emptyText="No medications yet."
      />

      {visible.map((med) => {
        const medSlots = slotsForMedication(slots, med.id);
        return (
          <Card key={med.id}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <ColorDot color={med.color} />
                  <h3 className="font-medium">{medicationLabel(med)}</h3>
                  {!med.active && <span className="text-xs text-slate-500">(inactive)</span>}
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  Half-life {med.halfLifeHours}h (time for half the dose to clear) ·{' '}
                  {med.adjustWhenLate ? 'timing-sensitive' : 'flexible'}
                  {med.startedAt != null && <> · Started {isoDateInZone(med.startedAt, zone)}</>}
                </p>
                <p className="text-xs text-slate-500">
                  Caps: single {fmt(med.guardrails.maxSingleDose, med.unit)}, daily{' '}
                  {fmt(med.guardrails.maxDailyDose, med.unit)}, min interval{' '}
                  {med.guardrails.minIntervalHours == null
                    ? '—'
                    : `${med.guardrails.minIntervalHours}h`}
                </p>

                {/* The schedule, on the medication itself — the whole point of
                    the merge. A medication with no times says so rather than
                    silently doing nothing (the seam FR-18.7 builds on). */}
                {medSlots.length === 0 ? (
                  <p className="mt-2 text-xs text-status-due">
                    Not scheduled — it will not appear on Today until you add a time.
                  </p>
                ) : (
                  <ul className="mt-2 flex flex-col gap-0.5" aria-label={`${med.name} schedule`}>
                    {medSlots.map((s) => (
                      <li key={s.id} className="text-sm text-slate-300">
                        <span className="font-medium tabular-nums">{s.time}</span>
                        {s.label && <span className="text-slate-400"> {s.label}</span>}
                        <span className="text-slate-400">
                          {' · '}
                          {s.items.find((i) => i.medId === med.id)?.dose}
                          {med.unit}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                {med.notes && <p className="mt-1 text-xs text-slate-400">{med.notes}</p>}
              </div>
              <div className="flex shrink-0 flex-col gap-1">
                <Button variant="secondary" onClick={() => setEditing(med)}>
                  Edit
                </Button>
                {med.active && (
                  <Button
                    variant="secondary"
                    className="border border-amber-700/60 text-amber-300 hover:bg-amber-900/30"
                    onClick={() => updateMedication(med.id, { active: false })}
                  >
                    Stop taking
                  </Button>
                )}
                <Button variant="danger" onClick={() => setConfirmDelete(med)}>
                  Delete
                </Button>
              </div>
            </div>
          </Card>
        );
      })}

      {editing && (
        <MedicationEditor
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete ${confirmDelete.name}?`}
          confirmLabel="Delete medication"
          body={
            <>
              <p>
                This removes <strong>{confirmDelete.name}</strong> from your medication list and any
                schedule slots it appears in.
              </p>
              <p className="mt-2 text-slate-400">
                Its dose history is retained — nothing already logged is deleted. If you only want
                to pause it, use <strong>Stop taking</strong> instead; it can be reactivated later
                from Edit.
              </p>
            </>
          }
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => {
            deleteMedication(confirmDelete.id);
            setConfirmDelete(null);
          }}
        />
      )}
    </>
  );
}

function fmt(v: number | null, unit: string): string {
  return v == null ? '—' : `${v}${unit}`;
}

// ---- By time ---------------------------------------------------------------

function TimeView() {
  const slots = useStore((s) => s.slots);
  const deleteSlot = useStore((s) => s.deleteSlot);
  const medications = useStore((s) => s.medications);
  const [editing, setEditing] = useState<Slot | 'new' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Slot | null>(null);

  const medById = new Map(medications.map((m) => [m.id, m]));
  const visible = [...slots.filter((s) => !s.deleted)].sort((a, b) => a.time.localeCompare(b.time));

  return (
    <>
      <ViewToolbar
        addLabel="Add time-slot"
        onAdd={() => setEditing('new')}
        empty={visible.length === 0}
        emptyText="No time-slots yet."
      />

      {visible.map((slot) => (
        <Card key={slot.id}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold tabular-nums">{slot.time}</h3>
                {slot.label && <span className="text-sm text-slate-400">{slot.label}</span>}
              </div>
              <ul className="mt-2 flex flex-col gap-1">
                {slot.items.map((item) => {
                  const med = medById.get(item.medId);
                  return (
                    <li key={item.medId} className="flex items-center gap-2 text-sm">
                      <ColorDot color={med?.color ?? '#64748b'} />
                      <span>{med?.name ?? UNKNOWN_MED_NAME}</span>
                      <span className="text-xs text-slate-400">
                        {item.dose}
                        {med?.unit ?? ''}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
            <div className="flex shrink-0 flex-col gap-1">
              <Button variant="secondary" onClick={() => setEditing(slot)}>
                Edit
              </Button>
              <Button variant="danger" onClick={() => setConfirmDelete(slot)}>
                Delete
              </Button>
            </div>
          </div>
        </Card>
      ))}

      {editing && (
        <SlotEditor initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete the ${confirmDelete.time} time-slot?`}
          confirmLabel="Delete time-slot"
          body={
            <>
              <p>
                This removes the {confirmDelete.time}
                {confirmDelete.label ? ` (${confirmDelete.label})` : ''} slot and stops scheduling{' '}
                {confirmDelete.items
                  .map((i) => medById.get(i.medId)?.name ?? UNKNOWN_MED_NAME)
                  .join(', ') || 'its medications'}{' '}
                at this time.
              </p>
              <p className="mt-2 text-slate-400">
                Doses already logged for this slot are retained.
              </p>
            </>
          }
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => {
            deleteSlot(confirmDelete.id);
            setConfirmDelete(null);
          }}
        />
      )}
    </>
  );
}
