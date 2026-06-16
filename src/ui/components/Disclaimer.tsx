// Safety disclaimer — the app originates no dose and is not a medical device.
// PRD §9 risk mitigation; cross-cutting safety concern.
export function Disclaimer() {
  return (
    <p className="border-b border-amber-900/50 bg-amber-950/40 px-4 py-2 text-xs text-amber-300/90">
      SteadyDose records and checks doses against limits you set — it does not calculate doses or
      give medical advice. Confirm your regimen with a clinician.
    </p>
  );
}
