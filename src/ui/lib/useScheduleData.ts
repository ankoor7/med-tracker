import { useStore } from '../../store/store';

/**
 * The store slices the schedule screens (Today, Calendar) all need to enumerate
 * occurrences: the active zone, the assume-taken-on-time policy, and the records
 * that feed `plannedSlotsForDate`. Centralised so each screen reads them the same
 * way (and so the selector boilerplate lives in one place).
 */
export function useScheduleData() {
  const zone = useStore((s) => s.settings.zone);
  const assumeTakenOnTime = useStore((s) => s.settings.assumeTakenOnTime ?? true);
  const medications = useStore((s) => s.medications);
  const slots = useStore((s) => s.slots);
  const doseLog = useStore((s) => s.doseLog);
  const doseOverrides = useStore((s) => s.doseOverrides);
  return { zone, assumeTakenOnTime, medications, slots, doseLog, doseOverrides };
}
