import { useId } from 'react';
import type { AdherenceDay, IanaZone, ISODate, RegimenChange } from '../../core';
import { ChangeMarkers } from './ChangeMarkers';

// Hand-rolled SVG bar chart (no chart dependency — keeps the bundle small per
// NFR-Performance). One stacked bar per day: on-time (accent) + late (amber) +
// missed (red) — three distinguishable outcomes (Stage 18 FR-18.4), so a late
// dose can no longer read as visually identical to an on-time one. A skipped
// dose (FR-18.3) is deliberately excluded from adherence scoring, so it is
// drawn as a thin neutral segment on top rather than folded into the stack.
//
// Stage 18 FR-18.6: the on-time segment is itself split — the portion that is
// merely *assumed* (no real log entry; see `assumedOnTime`) is drawn with a
// diagonal-hatch pattern instead of a solid fill, so a day made up entirely of
// assumption never looks identical to a day of genuinely logged doses. The
// hatch is a shape/texture cue, not a colour one, so it survives greyscale and
// colour-blind rendering (see the accompanying legend's text labels).
//
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
  const maxExpected = Math.max(1, ...days.map((d) => d.expected + d.skipped));
  const W = 320;
  const H = 120;
  const pad = { top: 8, bottom: 18, left: 4, right: 4 };
  const plotH = H - pad.top - pad.bottom;
  const n = Math.max(1, days.length);
  const slot = (W - pad.left - pad.right) / n;
  const barW = Math.max(2, slot * 0.7);
  const hasAssumed = days.some((d) => d.assumedOnTime > 0);
  // Unique per instance so two charts rendered at once (e.g. in tests) never
  // clash over the same SVG pattern id.
  const hatchId = `assumed-hatch-${useId()}`;

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
      aria-label={`Adherence over the last ${days.length} days${hasAssumed ? ', hatched segments are assumed on time, not logged' : ''}`}
      preserveAspectRatio="none"
    >
      <defs>
        <pattern
          id={hatchId}
          width="4"
          height="4"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect width="4" height="4" className="fill-accent" />
          <line x1="0" y1="0" x2="0" y2="4" strokeWidth="1.5" className="stroke-slate-950" />
        </pattern>
      </defs>
      {days.map((d, i) => {
        const x = pad.left + i * slot + (slot - barW) / 2;
        // Real (non-assumed) on-time doses stack first, then the assumed portion
        // on top of them, so the hatch is always adjacent to "late" rather than
        // buried at the bottom of the bar.
        const genuineOnTime = d.onTime - d.assumedOnTime;
        const genuineOnTimeH = (genuineOnTime / maxExpected) * plotH;
        const assumedOnTimeH = (d.assumedOnTime / maxExpected) * plotH;
        const lateH = (d.late / maxExpected) * plotH;
        const missedH = (d.missed / maxExpected) * plotH;
        const skippedH = (d.skipped / maxExpected) * plotH;
        const genuineOnTimeY = pad.top + plotH - genuineOnTimeH;
        const assumedOnTimeY = genuineOnTimeY - assumedOnTimeH;
        const lateY = assumedOnTimeY - lateH;
        const missedY = lateY - missedH;
        const skippedY = missedY - skippedH;
        const showLabel = days.length <= 14 || i % Math.ceil(days.length / 10) === 0;
        return (
          <g key={d.date}>
            {d.expected === 0 && d.skipped === 0 ? (
              <rect
                x={x}
                y={pad.top + plotH - 1}
                width={barW}
                height={1}
                className="fill-slate-700"
              />
            ) : (
              <>
                <rect
                  x={x}
                  y={genuineOnTimeY}
                  width={barW}
                  height={genuineOnTimeH}
                  className="fill-accent"
                />
                {assumedOnTimeH > 0 && (
                  <rect
                    x={x}
                    y={assumedOnTimeY}
                    width={barW}
                    height={assumedOnTimeH}
                    fill={`url(#${hatchId})`}
                    aria-label="assumed, not logged"
                  />
                )}
                <rect x={x} y={lateY} width={barW} height={lateH} className="fill-amber-500" />
                <rect x={x} y={missedY} width={barW} height={missedH} className="fill-red-600" />
                <rect
                  x={x}
                  y={skippedY}
                  width={barW}
                  height={skippedH}
                  className="fill-slate-500"
                />
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

  const wrapped =
    !changes || changes.length === 0 || !zone ? (
      svg
    ) : (
      <div className="relative">
        {svg}
        <ChangeMarkers changes={changes} zone={zone} xForDate={xForDate} />
      </div>
    );

  if (!hasAssumed) return wrapped;
  return (
    <div className="flex flex-col gap-1">
      {wrapped}
      <p className="flex items-center gap-1 text-[11px] text-slate-500">
        <svg aria-hidden width="14" height="10" className="shrink-0 align-middle">
          <rect width="14" height="10" fill={`url(#${hatchId})`} />
        </svg>
        Hatched = assumed on time (not logged), within the solid on-time colour.
      </p>
    </div>
  );
}
