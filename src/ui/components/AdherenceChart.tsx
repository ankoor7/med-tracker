import type { AdherenceDay, IanaZone, ISODate, RegimenChange } from '../../core';
import { ChangeMarkers } from './ChangeMarkers';

// Hand-rolled SVG bar chart (no chart dependency — keeps the bundle small per
// NFR-Performance). One stacked bar per day: taken (accent) over missed (red).
// Mobile-first: scales to its container width via a viewBox. Optionally overlays
// regimen-change markers placed by day (Stage 16).
export function AdherenceChart({
  days,
  changes,
  zone,
}: {
  days: AdherenceDay[];
  changes?: RegimenChange[];
  zone?: IanaZone;
}) {
  const maxExpected = Math.max(1, ...days.map((d) => d.expected));
  const W = 320;
  const H = 120;
  const pad = { top: 8, bottom: 18, left: 4, right: 4 };
  const plotH = H - pad.top - pad.bottom;
  const n = Math.max(1, days.length);
  const slot = (W - pad.left - pad.right) / n;
  const barW = Math.max(2, slot * 0.7);

  // Place a marker at the centre of its day's bar, as a % of the chart width.
  const xForDate = (date: ISODate): number | null => {
    const i = days.findIndex((d) => d.date === date);
    return i < 0 ? null : ((pad.left + i * slot + slot / 2) / W) * 100;
  };

  const svg = (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-32 w-full"
      role="img"
      aria-label={`Adherence over the last ${days.length} days`}
      preserveAspectRatio="none"
    >
      {days.map((d, i) => {
        const x = pad.left + i * slot + (slot - barW) / 2;
        const takenH = (d.taken / maxExpected) * plotH;
        const missedH = (d.missed / maxExpected) * plotH;
        const takenY = pad.top + plotH - takenH;
        const missedY = takenY - missedH;
        const showLabel = days.length <= 14 || i % Math.ceil(days.length / 10) === 0;
        return (
          <g key={d.date}>
            {d.expected === 0 ? (
              <rect
                x={x}
                y={pad.top + plotH - 1}
                width={barW}
                height={1}
                className="fill-slate-700"
              />
            ) : (
              <>
                <rect x={x} y={takenY} width={barW} height={takenH} className="fill-accent" />
                <rect x={x} y={missedY} width={barW} height={missedH} className="fill-red-600" />
              </>
            )}
            {showLabel && (
              <text
                x={x + barW / 2}
                y={H - 6}
                textAnchor="middle"
                className="fill-slate-500 text-[7px]"
              >
                {d.date.slice(5)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );

  if (!changes || changes.length === 0 || !zone) return svg;
  return (
    <div className="relative">
      {svg}
      <ChangeMarkers changes={changes} zone={zone} xForDate={xForDate} />
    </div>
  );
}
