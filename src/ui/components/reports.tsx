// Clinician outputs UI (Stage 23, P0 #6 + #7). Presentation only — every number
// and line comes from the pure `core/clinicalReport` model; these components
// lay it out on a print-ready "paper" sheet and drive Print / Share / Close.
//
// Print: an `@media print` rule (ui/index.css) isolates the `.sd-print-region`
// sheet and hides the toolbar (`.sd-no-print`) and app chrome, so the browser's
// Print → Save as PDF captures just the report — offline, zero-dependency.

import { useMemo, useState, type ReactNode } from 'react';
import { ModalOverlay, Modal as RACModal, Dialog } from 'react-aria-components';
import {
  adherenceTimeline,
  buildMedicationList,
  buildPreVisitSummary,
  formatDateTimeWithZone,
  type AdherenceDay,
  type Guardrails,
  type MedicationListEntry,
  type PreVisitSummary,
} from '../../core';
import { useDataset } from '../lib/useDataset';
import { shareReport } from '../lib/shareReport';
import { Button, Card } from './ui';
import { AdherenceChart } from './AdherenceChart';

const DISCLAIMER =
  'SteadyDose records and summarises what you entered. It does not give medical advice or calculate doses. Discuss any changes with your clinician.';

const PERIOD_PRESETS = [30, 90, 180] as const;

// --- Overlay ----------------------------------------------------------------

// Built on React Aria's overlay primitives: they portal to <body> (so
// `position: fixed` escapes the app's blurred/transformed ancestors), and add a
// focus trap, scroll-lock and Escape-to-close. The paper sheet carries
// `.sd-print-region` so Print → PDF captures only it (ui/index.css).
function ReportOverlay({
  title,
  shareText,
  onClose,
  children,
}: {
  title: string;
  shareText: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <ModalOverlay
      isOpen
      isDismissable
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      className="fixed inset-0 z-40 flex justify-center overflow-y-auto bg-black/60 p-0 sm:p-8"
    >
      {/* Literal colours (not the theme's inverted slate tokens): a clinician
          document must read the same light-on-white regardless of the app's
          theme, and print legibly. */}
      <RACModal className="sd-print-region h-fit min-h-full w-full max-w-3xl bg-white text-[#0f172a] shadow-soft outline-none sm:min-h-0 sm:rounded-lg">
        <Dialog aria-label={title} className="outline-none">
          <div className="sd-no-print sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-[#e2e8f0] bg-white/95 px-4 py-2 backdrop-blur sm:rounded-t-lg">
            <span className="text-sm font-medium text-[#64748b]">{title}</span>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => shareReport(title, shareText)}>
                Share
              </Button>
              <Button variant="secondary" onClick={() => window.print()}>
                Print / PDF
              </Button>
              <Button variant="ghost" onClick={onClose} aria-label="Close report">
                Close
              </Button>
            </div>
          </div>
          <div className="px-6 py-6 sm:px-8">{children}</div>
        </Dialog>
      </RACModal>
    </ModalOverlay>
  );
}

/** Section heading on the paper sheet. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-6 first:mt-0">
      <h3 className="mb-2 border-b border-[#e2e8f0] pb-1 text-sm font-semibold uppercase tracking-wide text-[#64748b]">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Disclaimer() {
  return <p className="mt-6 text-xs italic text-[#64748b]">{DISCLAIMER}</p>;
}

function guardrailText(g: Guardrails, unit: string): string {
  const parts = [
    g.maxSingleDose != null ? `single ≤ ${g.maxSingleDose}${unit}` : null,
    g.maxDailyDose != null ? `daily ≤ ${g.maxDailyDose}${unit}` : null,
    g.minIntervalHours != null ? `≥ ${g.minIntervalHours}h apart` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : 'none set';
}

// --- Medication list report (P0 #7) -----------------------------------------

function MedicationListReport({
  list,
  generatedAt,
  zone,
}: {
  list: MedicationListEntry[];
  generatedAt: number;
  zone: string;
}) {
  return (
    <div>
      <h2 className="text-xl font-semibold">Current medications</h2>
      <p className="mt-0.5 text-xs text-[#64748b]">
        Generated {formatDateTimeWithZone(generatedAt, zone)}
      </p>
      {list.length === 0 ? (
        <p className="mt-4 text-sm text-[#475569]">No active medications.</p>
      ) : (
        <ul className="mt-4 flex flex-col divide-y divide-[#e2e8f0]">
          {list.map((m) => (
            <li key={m.medId} className="py-3">
              <p className="font-medium">
                {m.label}
                {m.timingSensitive && (
                  <span className="ml-2 text-xs font-normal text-[#64748b]">timing-sensitive</span>
                )}
              </p>
              <p className="mt-0.5 text-sm text-[#475569]">
                {m.times.length === 0
                  ? 'No scheduled times.'
                  : m.times
                      .map((t) => `${t.time}${t.label ? ` (${t.label})` : ''} — ${t.dose}${m.unit}`)
                      .join(' · ')}
              </p>
              <p className="mt-0.5 text-xs text-[#64748b]">
                Caps: {guardrailText(m.guardrails, m.unit)}
              </p>
              {m.notes && <p className="mt-0.5 text-xs italic text-[#64748b]">“{m.notes}”</p>}
            </li>
          ))}
        </ul>
      )}
      <Disclaimer />
    </div>
  );
}

// --- Pre-visit summary report (P0 #6) ---------------------------------------

function pct(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

function PreVisitSummaryReport({
  summary,
  timeline,
}: {
  summary: PreVisitSummary;
  timeline: AdherenceDay[];
}) {
  const { overall } = summary;
  return (
    <div>
      <h2 className="text-xl font-semibold">Pre-visit summary</h2>
      <p className="mt-0.5 text-xs text-[#64748b]">
        {summary.from} to {summary.to} ({summary.days} days) · generated{' '}
        {formatDateTimeWithZone(summary.generatedAt, summary.zone)} · {summary.medicationCount}{' '}
        active medications
      </p>

      {summary.highlights.length > 0 && (
        <Section title="What changed / what to ask">
          <ul className="list-disc pl-5 text-sm">
            {summary.highlights.map((h, i) => (
              <li key={`${h.kind}-${i}`}>{h.text}</li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Adherence (timing-sensitive)">
        <p className="text-sm">
          <span className="text-2xl font-semibold tabular-nums">{pct(overall.ratio)}</span> on time
          — {overall.onTime} on time
          {overall.assumedOnTime > 0 && ` (${overall.assumedOnTime} assumed)`}, {overall.late} late,{' '}
          {overall.missed} missed of {overall.expected} expected.
        </p>
        {overall.assumedOnTime > 0 && (
          <p className="mt-1 text-xs text-[#64748b]">
            {overall.assumedOnTime} of the on-time doses are assumed from the schedule (not
            confirmed by logging).
          </p>
        )}
        {summary.perMedication.length > 0 && (
          <table className="mt-3 w-full text-left text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-[#64748b]">
                <th className="pb-1 font-medium">Medication</th>
                <th className="pb-1 text-right font-medium">On time</th>
                <th className="pb-1 text-right font-medium">Late</th>
                <th className="pb-1 text-right font-medium">Missed</th>
              </tr>
            </thead>
            <tbody>
              {summary.perMedication.map((m) => (
                <tr key={m.medId} className="border-t border-[#f1f5f9]">
                  <td className="py-1">{m.label}</td>
                  <td className="py-1 text-right tabular-nums">{pct(m.result.ratio)}</td>
                  <td className="py-1 text-right tabular-nums">{m.result.late}</td>
                  <td className="py-1 text-right tabular-nums">{m.result.missed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {/* The trend chart is designed for the dark theme; keep it on a dark
            figure so it reads, and force its colours to print. */}
        <div className="mt-3 rounded-lg bg-slate-950 p-3 text-slate-100 [print-color-adjust:exact] [-webkit-print-color-adjust:exact]">
          <AdherenceChart days={timeline} changes={summary.regimenChanges} zone={summary.zone} />
        </div>
      </Section>

      <Section title="Flare-ups">
        {summary.totalEvents === 0 ? (
          <p className="text-sm text-[#475569]">No events logged in this period.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {summary.events.map((e) => (
              <li key={e.typeId}>
                <span className="font-medium">
                  {e.name}: {e.count}
                </span>
                {e.properties.length > 0 && (
                  <span className="text-[#475569]">
                    {' '}
                    — {e.properties.map((p) => `${p.name} avg ${p.formattedAvg}`).join(', ')}
                  </span>
                )}
                {e.peakWeek && e.peakWeek.count > 1 && (
                  <span className="text-[#64748b]">
                    {' '}
                    · most ({e.peakWeek.count}) in the week of {e.peakWeek.weekStart}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {summary.regimenChanges.length > 0 && (
        <Section title="Regimen changes">
          <ul className="flex flex-col gap-1 text-sm">
            {summary.regimenChanges.map((c) => (
              <li key={c.id}>
                <span className="tabular-nums text-[#64748b]">
                  {formatDateTimeWithZone(c.changedAt, c.zone).split(',')[0]}
                </span>{' '}
                — {c.summary}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Disclaimer />
    </div>
  );
}

// --- Plain-text serialisers (for Share / mailto) ----------------------------

function medListToText(list: MedicationListEntry[]): string {
  const lines = list.map((m) => {
    const times = m.times.map((t) => `${t.time} ${t.dose}${m.unit}`).join(', ');
    return `- ${m.label}${times ? ` — ${times}` : ''}`;
  });
  return ['Current medications', ...lines, '', DISCLAIMER].join('\n');
}

function summaryToText(s: PreVisitSummary): string {
  const lines = [
    `Pre-visit summary (${s.from} to ${s.to})`,
    `Adherence: ${pct(s.overall.ratio)} on time — ${s.overall.missed} missed of ${s.overall.expected}.`,
  ];
  if (s.highlights.length > 0) {
    lines.push('', 'What to ask:', ...s.highlights.map((h) => `- ${h.text}`));
  }
  if (s.totalEvents > 0) {
    lines.push(
      '',
      'Flare-ups:',
      ...s.events.map(
        (e) =>
          `- ${e.name}: ${e.count}${e.properties.length ? ` (${e.properties.map((p) => `${p.name} avg ${p.formattedAvg}`).join(', ')})` : ''}`,
      ),
    );
  }
  lines.push('', DISCLAIMER);
  return lines.join('\n');
}

// --- Entry point (rendered in History) --------------------------------------

type OpenView = 'summary' | 'meds' | null;
type DatasetSlices = ReturnType<typeof useDataset>;

// Each overlay owns its own report build, so the card itself carries no
// report-computation branches — it just chooses which one to mount.
function SummaryOverlay({
  data,
  days,
  onClose,
}: {
  data: DatasetSlices;
  days: number;
  onClose: () => void;
}) {
  const summary = useMemo(() => buildPreVisitSummary(data, { now: data.now, days }), [data, days]);
  const timeline = useMemo(
    () =>
      adherenceTimeline(
        data.slots,
        data.medications,
        data.doseLog,
        data.settings.zone,
        Math.max(1, days),
        data.now,
        data.settings.assumeTakenOnTime ?? true,
        data.scheduleSnapshots,
        data.settings.onTimeWindowMinutes,
      ),
    [data, days],
  );
  return (
    <ReportOverlay title="Pre-visit summary" shareText={summaryToText(summary)} onClose={onClose}>
      <PreVisitSummaryReport summary={summary} timeline={timeline} />
    </ReportOverlay>
  );
}

function MedListOverlay({ data, onClose }: { data: DatasetSlices; onClose: () => void }) {
  const list = useMemo(() => buildMedicationList(data), [data]);
  return (
    <ReportOverlay title="Medication list" shareText={medListToText(list)} onClose={onClose}>
      <MedicationListReport list={list} generatedAt={data.now} zone={data.settings.zone} />
    </ReportOverlay>
  );
}

/**
 * The single "Clinician outputs" entry point (FR-23.9): opens either the
 * pre-visit summary (period-scoped) or the current medication list.
 */
export function ClinicalOutputsCard() {
  const [view, setView] = useState<OpenView>(null);
  const [days, setDays] = useState<number>(90);
  const data = useDataset();
  const close = () => setView(null);

  return (
    <Card>
      <h3 className="mb-1 text-sm font-medium">Clinician outputs</h3>
      <p className="mb-3 text-xs text-slate-500">
        Prepare for a visit: a one-page summary of adherence and flare-ups, or a shareable list of
        your current medications. Generated on this device.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-400" htmlFor="report-period">
            Period
          </label>
          <select
            id="report-period"
            className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            aria-label="Summary period in days"
          >
            {PERIOD_PRESETS.map((d) => (
              <option key={d} value={d}>
                Last {d} days
              </option>
            ))}
          </select>
        </div>
        <Button variant="secondary" onClick={() => setView('summary')}>
          Pre-visit summary
        </Button>
        <Button variant="secondary" onClick={() => setView('meds')}>
          Medication list
        </Button>
      </div>

      {view === 'summary' && <SummaryOverlay data={data} days={days} onClose={close} />}
      {view === 'meds' && <MedListOverlay data={data} onClose={close} />}
    </Card>
  );
}
