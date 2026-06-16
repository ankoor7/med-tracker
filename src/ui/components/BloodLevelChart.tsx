import type { LevelSeries } from '../../core';

// Renders ONLY the predicted level series supplied by the pharmacology extension
// (FR-7.3). The app never synthesises a curve: when the extension returns null,
// the parent shows an explanatory empty state instead of calling this (AC4).
export function BloodLevelChart({
  series,
  doseMarkers,
}: {
  series: LevelSeries;
  doseMarkers: number[]; // dose instants, drawn as ticks
}) {
  const W = 320;
  const H = 140;
  const pad = { top: 8, bottom: 18, left: 4, right: 4 };
  const plotH = H - pad.top - pad.bottom;
  const plotW = W - pad.left - pad.right;

  const pts = series.points;
  if (pts.length === 0) {
    return <p className="text-sm text-slate-400">The extension returned an empty series.</p>;
  }

  const tMin = pts[0]!.t;
  const tMax = pts[pts.length - 1]!.t;
  const tSpan = Math.max(1, tMax - tMin);
  const levels = pts.map((p) => p.level);
  const band = series.targetBand;
  const yMax = Math.max(...levels, band?.high ?? 0) * 1.1 || 1;

  const x = (t: number) => pad.left + ((t - tMin) / tSpan) * plotW;
  const y = (v: number) => pad.top + plotH - (v / yMax) * plotH;

  const path = pts
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.t).toFixed(1)},${y(p.level).toFixed(1)}`)
    .join(' ');

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-36 w-full"
      role="img"
      aria-label="Predicted blood level over time"
      preserveAspectRatio="none"
    >
      {band && (
        <rect
          x={pad.left}
          y={y(band.high)}
          width={plotW}
          height={Math.max(0, y(band.low) - y(band.high))}
          className="fill-accent/15"
        />
      )}
      {doseMarkers
        .filter((t) => t >= tMin && t <= tMax)
        .map((t, i) => (
          <line
            key={i}
            x1={x(t)}
            x2={x(t)}
            y1={pad.top}
            y2={pad.top + plotH}
            className="stroke-slate-700"
            strokeWidth={1}
            strokeDasharray="2 2"
          />
        ))}
      <path d={path} className="fill-none stroke-accent-muted" strokeWidth={2} />
      {series.unit && (
        <text x={pad.left + 2} y={pad.top + 8} className="fill-slate-500 text-[8px]">
          {series.unit}
        </text>
      )}
    </svg>
  );
}
