import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from './ui';

// FR-19.3 (source-compatible reimplementation over React Aria) + FR-19.4
// (keyboard-operable, visible focus, correct ARIA). Button has no dedicated
// @react-aria/test-utils pattern tester, so activation and focus are asserted
// directly per the skill's testing guide.
describe('Button (FR-19.3 / FR-19.4)', () => {
  it('renders a native <button role=button> with type=button by default', () => {
    render(<Button>Save</Button>);
    const btn = screen.getByRole('button', { name: 'Save' });
    expect(btn.tagName).toBe('BUTTON');
    expect(btn).toHaveAttribute('type', 'button');
  });

  it('is operable by mouse, Enter and Space (onClick preserved)', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Go</Button>);
    const btn = screen.getByRole('button', { name: 'Go' });

    await user.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);

    btn.focus();
    await user.keyboard('{Enter}');
    expect(onClick).toHaveBeenCalledTimes(2);

    await user.keyboard(' ');
    expect(onClick).toHaveBeenCalledTimes(3);
  });

  it('shows a visible focus ring for keyboard focus but not pointer focus', async () => {
    const user = userEvent.setup();
    render(
      <>
        <Button>First</Button>
        <Button>Second</Button>
      </>,
    );
    const first = screen.getByRole('button', { name: 'First' });

    await user.tab();
    expect(first).toHaveFocus();
    // React Aria drives the focus ring via this attribute; our token-based
    // ring style is keyed off `data-[focus-visible]`.
    expect(first).toHaveAttribute('data-focus-visible');
    // The attribute alone doesn't prove a ring is visible — assert the
    // actual ring utility classes (from FOCUS_RING in ui.tsx) are present.
    expect(first.className).toContain('data-[focus-visible]:ring-2');
    expect(first.className).toContain('data-[focus-visible]:ring-accent-muted');

    await user.click(screen.getByRole('button', { name: 'Second' }));
    expect(screen.getByRole('button', { name: 'Second' })).not.toHaveAttribute(
      'data-focus-visible',
    );
  });

  it('maps `disabled` to the native disabled state and blocks activation', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Nope
      </Button>,
    );
    const btn = screen.getByRole('button', { name: 'Nope' });
    expect(btn).toBeDisabled();
    await user.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('forwards aria-label, className and reflects the requested variant', () => {
    render(
      <Button variant="danger" aria-label="Delete forever" className="w-full">
        X
      </Button>,
    );
    const btn = screen.getByRole('button', { name: 'Delete forever' });
    expect(btn.className).toContain('bg-status-missed/90');
    expect(btn.className).toContain('w-full');
  });
});
