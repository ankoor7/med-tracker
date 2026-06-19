import { useRef, useState } from 'react';
import { useStore } from '../../store/store';
import { exportCSV, exportJSON, parseImport, type ImportMode } from '../../store/transfer';
import { Button, Card } from './ui';

function download(filename: string, mime: string, text: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Export (JSON round-trippable + CSV log) and validated import with a
// replace/merge choice (Stage 7). Warns that exports are unencrypted (AC7).
export function DataTransferPanel() {
  const store = useStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<ImportMode>('merge');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dataset = () => ({
    medications: store.medications,
    slots: store.slots,
    doseLog: store.doseLog,
    doseOverrides: store.doseOverrides,
    eventTypes: store.eventTypes,
    eventInstances: store.eventInstances,
    settings: store.settings,
  });

  const stamp = () => new Date().toISOString().slice(0, 10);

  const onImportFile = async (file: File) => {
    setError(null);
    setMessage(null);
    const result = parseImport(await file.text());
    if (!result.ok) {
      setError(`Import failed — ${result.reason}`);
      return;
    }
    store.importData(result.data, mode);
    setMessage(
      `Imported ${result.data.medications.length} meds, ${result.data.slots.length} slots, ${result.data.doseLog.length} log entries (${mode}).`,
    );
  };

  return (
    <Card>
      <h3 className="mb-2 text-sm font-medium">Export &amp; import</h3>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          onClick={() =>
            download(`steadydose-${stamp()}.json`, 'application/json', exportJSON(dataset()))
          }
        >
          Export JSON
        </Button>
        <Button
          variant="secondary"
          onClick={() =>
            download(`steadydose-log-${stamp()}.csv`, 'text/csv', exportCSV(dataset()))
          }
        >
          Export CSV
        </Button>
      </div>
      <p className="mt-2 text-xs text-status-due">
        ⚠ Exported files are <strong>unencrypted</strong> plain text — anyone with the file can read
        your medication data. Store and share them carefully.
      </p>

      <div className="mt-4 border-t border-slate-800 pt-3">
        <p className="mb-2 text-xs text-slate-400">Import a previously exported JSON file.</p>
        <div className="mb-2 flex gap-4 text-sm">
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              name="import-mode"
              checked={mode === 'merge'}
              onChange={() => setMode('merge')}
            />
            <span>Merge (keep newer per record)</span>
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              name="import-mode"
              checked={mode === 'replace'}
              onChange={() => setMode('replace')}
            />
            <span>Replace all</span>
          </label>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void onImportFile(file);
            e.target.value = '';
          }}
        />
        <Button variant="secondary" onClick={() => fileRef.current?.click()}>
          Choose file…
        </Button>
      </div>

      {message && <p className="mt-2 text-xs text-status-taken">{message}</p>}
      {error && <p className="mt-2 text-xs text-status-missed">{error}</p>}
    </Card>
  );
}
