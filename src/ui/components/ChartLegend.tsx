import type { ReactNode } from 'react';

// Stage 21 (FR-21.2/21.3) — a small text-labelled swatch, shared by
// AdherenceChart and OuraCorrelationChart so a patient reading either SVG
// chart gets a legend line rather than having to decode bar/line colour by
// eye. The label is the accessible cue: colour alone never carries meaning
// here, so this also survives greyscale/print/colour-blind rendering.
export function LegendSwatch({ swatch, label }: { swatch: ReactNode; label: string }) {
  return (
    <li className="flex items-center gap-1.5">
      {swatch}
      {label}
    </li>
  );
}

/** A plain solid-colour square swatch — the common case for `LegendSwatch`. */
export function ColorSwatch({ className }: { className: string }) {
  return <span aria-hidden className={`h-2.5 w-2.5 shrink-0 rounded-[3px] ${className}`} />;
}

export function ChartLegend({ children }: { children: ReactNode }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
      {children}
    </ul>
  );
}
