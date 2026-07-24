import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { User } from '@react-aria/test-utils';
import { Modal } from './Modal';
import { openDialogWithTester } from '../../test/reactAriaDialogHelpers';

// FR-19.3 (Modal reimplemented over React Aria's ModalOverlay/Modal/Dialog) +
// FR-19.4 (focus trap, visible focus, Escape/outside dismissal). The Modal is
// controlled by its parent's mount, so a small trigger harness lets the
// @react-aria/test-utils Dialog tester drive it.
function Harness({ onClose }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      {open && (
        <Modal
          title="Edit medication"
          onClose={() => {
            setOpen(false);
            onClose?.();
          }}
        >
          <p>Body content</p>
          <label>
            Name <input aria-label="Name" />
          </label>
        </Modal>
      )}
    </>
  );
}

const testUser = new User({ interactionType: 'mouse' });

/** Render the harness, open the modal via its "Open" trigger, and return the user + onClose spy. */
async function renderOpenModal() {
  const onClose = vi.fn();
  const user = userEvent.setup();
  render(<Harness onClose={onClose} />);
  await user.click(screen.getByRole('button', { name: 'Open' }));
  await screen.findByRole('dialog');
  return { onClose, user };
}

describe('Modal (FR-19.3 / FR-19.4)', () => {
  it('opens as a title-labelled dialog and moves focus inside it (Dialog tester)', async () => {
    render(<Harness />);
    const dialog = await openDialogWithTester(testUser);
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute('role', 'dialog');
    expect(dialog).toHaveAccessibleName('Edit medication');
    // React Aria contains focus within the dialog once it opens.
    await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement));
  });

  it('closes on Escape and calls onClose', async () => {
    const { onClose, user } = await renderOpenModal();

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('closes when the ✕ button is activated and calls onClose', async () => {
    const { onClose, user } = await renderOpenModal();

    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
