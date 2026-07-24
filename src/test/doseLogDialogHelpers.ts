// Shared interactions with the DoseLogger / ConfirmDialog modals, used by
// Today and History's dose-correction tests (Stage 18 FR-18.2). Extracted so
// the same click sequences aren't duplicated across the two screens' tests.
import { fireEvent, screen, within } from '@testing-library/react';

/** Submit the currently-open "Log dose" DoseLogger modal as-is. */
export function submitLogDose(): void {
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /log dose/i }));
}

/** Click a row's "Edit" action and return the opened DoseLogger dialog. */
export function openEditDialog(row: HTMLElement): HTMLElement {
  fireEvent.click(within(row).getByRole('button', { name: 'Edit' }));
  return screen.getByRole('dialog');
}

/** Set the "Dose" field's value in an open DoseLogger dialog. */
export function setDoseValue(dialog: HTMLElement, value: string): void {
  fireEvent.change(within(dialog).getByLabelText('Dose'), { target: { value } });
}

/**
 * Click a row's "Delete" action and return the confirmation dialog. The
 * ConfirmDialog renders as role="alertdialog" (Stage 19 FR-19.3), the WAI-ARIA
 * pattern for a consequential-action confirmation, distinct from the plain
 * role="dialog" of the DoseLogger/editor modals.
 */
export function openDeleteConfirm(row: HTMLElement): HTMLElement {
  fireEvent.click(within(row).getByRole('button', { name: 'Delete' }));
  return screen.getByRole('alertdialog');
}

/** Dismiss an open confirmation dialog without confirming. */
export function cancelDialog(dialog: HTMLElement): void {
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
}

/** Confirm an open "delete this logged dose" confirmation dialog. */
export function confirmDeleteDose(dialog: HTMLElement): void {
  fireEvent.click(within(dialog).getByRole('button', { name: 'Delete dose' }));
}
