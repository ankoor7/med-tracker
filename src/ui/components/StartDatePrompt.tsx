// One-off upgrade prompt (Stage 18 FR-18.1 piece 3): asks when each medication
// missing a `startedAt` was first prescribed, so widening the adherence window
// stops fabricating history that predates the regimen (AC3). A fresh install
// never sees this — seed data stamps `startedAt` on every medication — it only
// fires for a dataset written before the field existed.
//
// Skippable per medication: leave a date blank and that medication keeps the
// "always existed" semantics (`needsStartDatePrompt`/`core/startDate.ts`) —
// nothing breaks. Dismissible as a whole via "Skip for now", persisted
// per-device (`useDismissibleMetaFlag`, same channel as `Disclaimer`) so it
// does not re-ask on every launch; any medication left blank is still
// editable later from the Meds screen.

import { useState } from 'react';
import { medicationsMissingStartDate, startOfDayInstant } from '../../core';
import { useStore } from '../../store/store';
import { useDismissibleMetaFlag } from '../lib/useDismissibleMetaFlag';
import { Button } from './ui';
import { Modal } from './Modal';
import { StartDateField } from './StartDateField';

const DISMISS_KEY = 'startDatePromptDismissed';

export function StartDatePrompt() {
  const medications = useStore((s) => s.medications);
  const doseLog = useStore((s) => s.doseLog);
  const zone = useStore((s) => s.settings.zone);
  const updateMedication = useStore((s) => s.updateMedication);
  const { state, dismiss } = useDismissibleMetaFlag(DISMISS_KEY);
  const [dates, setDates] = useState<Record<string, string>>({});

  const pending = medicationsMissingStartDate(medications);

  if (state !== 'shown' || pending.length === 0) return null;

  const save = () => {
    for (const med of pending) {
      const dateStr = dates[med.id];
      if (!dateStr) continue; // left blank — skip this one, semantics unchanged
      updateMedication(med.id, { startedAt: startOfDayInstant(dateStr, zone) });
    }
    dismiss();
  };

  return (
    <Modal title="When did you start each medication?" onClose={dismiss}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-slate-400">
          This keeps adherence history accurate — days before a medication started won&apos;t count
          against it. Leave any blank to skip; you can add it later from Meds.
        </p>
        {pending.map((med) => (
          <StartDateField
            key={med.id}
            label={med.name}
            ariaLabel={`${med.name} start date`}
            value={dates[med.id] ?? ''}
            onChange={(value) => setDates((d) => ({ ...d, [med.id]: value }))}
            zone={zone}
            doseLog={doseLog}
            medId={med.id}
          />
        ))}
        <div className="mt-1 flex justify-end gap-2">
          <Button variant="ghost" onClick={dismiss}>
            Skip for now
          </Button>
          <Button onClick={save}>Save</Button>
        </div>
      </div>
    </Modal>
  );
}
