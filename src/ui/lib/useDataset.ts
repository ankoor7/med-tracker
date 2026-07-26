// Subscribe to the whole syncable dataset from the store, plus the live clock.
// Several screens (History, the clinician-output reports) need the same broad
// slice; sharing one hook keeps those subscriptions in one place.

import { useStore } from '../../store/store';
import { useNow } from './useNow';

export function useDataset() {
  const now = useNow();
  const slots = useStore((s) => s.slots);
  const medications = useStore((s) => s.medications);
  const doseLog = useStore((s) => s.doseLog);
  const eventTypes = useStore((s) => s.eventTypes);
  const eventInstances = useStore((s) => s.eventInstances);
  const regimenChanges = useStore((s) => s.regimenChanges);
  const scheduleSnapshots = useStore((s) => s.scheduleSnapshots);
  const settings = useStore((s) => s.settings);
  return {
    now,
    slots,
    medications,
    doseLog,
    eventTypes,
    eventInstances,
    regimenChanges,
    scheduleSnapshots,
    settings,
  };
}
