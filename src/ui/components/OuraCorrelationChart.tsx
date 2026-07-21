import type { OuraMetric, OuraOverlayPoint } from '../../core';

// Hand-rolled SVG overlay (no chart dependency — matches AdherenceChart and
// keeps the bundle small). Faint bars = daily medication
// adherence (taken/expected); the line = the selected Oura metric, so the user
// can eyeball whether health tracks adherence. Mobile-first via a viewBox.

const METRIC_LABEL: Record<OuraMetric, string> = {
  readiness: 'Readiness score',
  stress: 'High-stress minutes',
};

function metricValue(p: OuraOverlayPoint, metric: OuraMetric): number | null {
  return metric === 'readiness' ? p.readinessScore : p.stressHighMinutes;
}

export function OuraCorrelationChart({
  points,
  metric,
}: {
  points: OuraOverlayPoint[];
  metric: OuraMetric;
}) {
  const W = 320;
  const H = 140;
  const pad = { top: 10, bottom: 18, left: 4, right: 4 };
  const plotH = H - pad.top - pad.bottom;
  const plotW = W - pad.left - pad.right;
  const n = Math.max(1, points.length);
  const slot = plotW / n;
  const barW = Math.max(2, slot * 0.7);

  // Readiness uses a fixed 0-100 axis; stress scales to its own max so its line
  // is legible regardless of the user's stress range.
  const metricVals = points
    .map((p) => metricValue(p, metric))
    .filter((v): v is number => v != null);
  const metricMax = metric === 'readiness' ? 100 : Math.max(1, ...metricVals);

  const yBar = (ratio: number) => pad.top + plotH - ratio * plotH;
  const yLine = (v: number) => pad.top + plotH - (v / metricMax) * plotH;
  const xCenter = (i: number) => pad.left + i * slot + slot / 2;

  // Connect only consecutive days that both have a metric value.
  const segments: string[] = [];
  let current: string[] = [];
  points.forEach((p, i) => {
    const v = metricValue(p, metric);
    if (v == null) {
      if (current.length) segments.push(current.join(' '));
      current = [];
      return;
    }
    current.push(
      `${current.length === 0 ? 'M' : 'L'}${xCenter(i).toFixed(1)},${yLine(v).toFixed(1)}`,
    );
  });
  if (current.length) segments.push(current.join(' '));

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-36 w-full"
      role="img"
      aria-label={`${METRIC_LABEL[metric]} overlaid on medication adherence over ${points.length} days`}
      preserveAspectRatio="none"
    >
      {/* Adherence bars (background). */}
      {points.map((p, i) => {
        if (p.adherenceRatio == null) return null;
        const x = pad.left + i * slot + (slot - barW) / 2;
        const y = yBar(p.adherenceRatio);
        return (
          <rect
            key={`bar-${p.date}`}
            x={x}
            y={y}
            width={barW}
            height={pad.top + plotH - y}
            className="fill-accent/20"
          />
        );
      })}

      {/* Metric line. */}
      {segments.map((d, i) => (
        <path
          key={`seg-${i}`}
          d={d}
          className={metric === 'readiness' ? 'stroke-accent-muted' : 'stroke-amber-400'}
          fill="none"
          strokeWidth={2}
        />
      ))}
      {/* Metric points. */}
      {points.map((p, i) => {
        const v = metricValue(p, metric);
        if (v == null) return null;
        return (
          <circle
            key={`pt-${p.date}`}
            cx={xCenter(i)}
            cy={yLine(v)}
            r={1.8}
            className={metric === 'readiness' ? 'fill-accent-muted' : 'fill-amber-400'}
          />
        );
      })}

      {/* Sparse date labels. */}
      {points.map((p, i) => {
        const show = points.length <= 14 || i % Math.ceil(points.length / 10) === 0;
        if (!show) return null;
        return (
          <text
            key={`lbl-${p.date}`}
            x={xCenter(i)}
            y={H - 6}
            textAnchor="middle"
            className="fill-slate-500 text-[7px]"
          >
            {p.date.slice(5)}
          </text>
        );
      })}
    </svg>
  );
}
