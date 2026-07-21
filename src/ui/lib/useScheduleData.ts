import { useMemo } from 'react';
import { useStore } from '../../store/store';

/**
 * The store slices the schedule screens (Today, Calendar) all need to enumerate
 * occurrences: the active zone, the assume-taken-on-time policy, and the records
 * that feed `plannedSlotsAsOf`. Centralised so each screen reads them the same
 * way (and so the selector boilerplate lives in one place).
 *
 * `scheduleSnapshots` is included so screens enumerate against the regimen that
 * was in effect on the day being rendered rather than today's configuration
 * (Stage 18 FR-18.1). Screens should pass `regimen` straight to `plannedSlotsAsOf`.
 */
export function useScheduleData() {
  const zone = useStore((s) => s.settings.zone);
  const assumeTakenOnTime = useStore((s) => s.settings.assumeTakenOnTime ?? true);
  const medications = useStore((s) => s.medications);
  const slots = useStore((s) => s.slots);
  const doseLog = useStore((s) => s.doseLog);
  const doseOverrides = useStore((s) => s.doseOverrides);
  const scheduleSnapshots = useStore((s) => s.scheduleSnapshots);
  // Stable identity so callers can use it directly as a `useMemo` dependency.
  const regimen = useMemo(
    () => ({ medications, slots, scheduleSnapshots }),
    [medications, slots, scheduleSnapshots],
  );
  return {
    zone,
    assumeTakenOnTime,
    medications,
    slots,
    doseLog,
    doseOverrides,
    scheduleSnapshots,
    regimen,
  };
}
