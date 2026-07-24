// Stage 20 Unit 4 — shared modal-form tail: the validation error list plus
// the Cancel/Save footer. `TypeEditor` and `EventLogger` in
// `screens/EventsScreen.tsx` both render this exact pair (an `errors.length
// > 0` alert list, then a right-aligned Cancel/Save row); this component
// collapses that structural duplication into one place. Presentation only —
// callers own their own validation and save logic and just pass the result.

import { Button } from './ui';

/** `role="alert"` error list, styled with the shared `status-missed` token. */
export function FormErrorList({ errors }: { errors: string[] }) {
  if (errors.length === 0) return null;
  return (
    <ul role="alert" className="text-xs text-status-missed">
      {errors.map((msg) => (
        <li key={msg}>⚠ {msg}</li>
      ))}
    </ul>
  );
}

/** Right-aligned Cancel/Save footer for a modal form. */
export function ModalFormActions({
  onCancel,
  onSave,
  canSave,
}: {
  onCancel: () => void;
  onSave: () => void;
  canSave: boolean;
}) {
  return (
    <div className="mt-1 flex justify-end gap-2">
      <Button variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
      <Button onClick={onSave} disabled={!canSave}>
        Save
      </Button>
    </div>
  );
}
