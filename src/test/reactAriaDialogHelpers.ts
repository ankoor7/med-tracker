import { screen } from '@testing-library/react';
import type { User } from '@react-aria/test-utils';

/**
 * Open a Dialog-pattern harness (a button labelled "Open" that mounts a
 * `Modal`/`ConfirmDialog`) via the `@react-aria/test-utils` Dialog tester
 * and return the resulting dialog element. Shared by Modal.test.tsx and
 * ConfirmDialog.test.tsx (Stage 19 FR-19.3) — both harnesses use the same
 * "Open" trigger convention, so the tester setup is identical.
 */
export async function openDialogWithTester(testUser: User): Promise<HTMLElement | null> {
  const tester = testUser.createTester('Dialog', {
    root: screen.getByRole('button', { name: 'Open' }),
    overlayType: 'modal',
  });
  await tester.open();
  return tester.getDialog();
}
