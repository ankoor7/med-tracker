import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { User } from '@react-aria/test-utils';
import { ConfirmDialog } from './ConfirmDialog';
import { openDialogWithTester } from '../../test/reactAriaDialogHelpers';

// FR-18.5 (destructive-action confirmation) preserved under the FR-19.3
// reimplementation: ConfirmDialog now renders the WAI-ARIA `alertdialog`
// pattern. A trigger harness lets the @react-aria/test-utils Dialog tester
// drive it, and confirm/cancel semantics are asserted directly.
function Harness({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      {open && (
        <ConfirmDialog
          title="Delete medication?"
          body={<p>This tombstones Lamotrigine; its history is kept.</p>}
          confirmLabel="Delete medication"
          onConfirm={() => {
            setOpen(false);
            onConfirm();
          }}
          onCancel={() => {
            setOpen(false);
            onCancel();
          }}
        />
      )}
    </>
  );
}

const testUser = new User({ interactionType: 'mouse' });

function renderHarness() {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(<Harness onConfirm={onConfirm} onCancel={onCancel} />);
  return { onConfirm, onCancel };
}

/** Click the harness's "Open" trigger and wait for the alertdialog to mount. */
async function openAlertDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Open' }));
  return screen.findByRole('alertdialog');
}

describe('ConfirmDialog (FR-18.5 / FR-19.3 / FR-19.4)', () => {
  it('opens as an alertdialog naming what is affected (Dialog tester)', async () => {
    renderHarness();
    const dialog = await openDialogWithTester(testUser);
    expect(dialog).toHaveAttribute('role', 'alertdialog');
    expect(dialog).toHaveAccessibleName('Delete medication?');
    expect(dialog).toHaveTextContent('This tombstones Lamotrigine; its history is kept.');
    // It is deliberately an alertdialog, not a plain dialog.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('the confirm button fires onConfirm and not onCancel', async () => {
    const user = userEvent.setup();
    const { onConfirm, onCancel } = renderHarness();
    await openAlertDialog(user);

    await user.click(screen.getByRole('button', { name: 'Delete medication' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('the cancel button is keyboard-operable and fires onCancel only', async () => {
    const user = userEvent.setup();
    const { onConfirm, onCancel } = renderHarness();
    await openAlertDialog(user);

    const cancel = screen.getByRole('button', { name: 'Cancel' });
    cancel.focus();
    await user.keyboard('{Enter}');
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('Escape cancels (safe default) and dismisses the alertdialog', async () => {
    const user = userEvent.setup();
    const { onCancel } = renderHarness();
    await openAlertDialog(user);

    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });
});
