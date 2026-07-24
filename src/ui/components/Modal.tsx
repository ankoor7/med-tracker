import { type ReactNode } from 'react';
import {
  ModalOverlay,
  Modal as RACModal,
  Dialog,
  Heading,
  Button as RACButton,
} from 'react-aria-components';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /**
   * ARIA role for the underlying dialog. Defaults to 'dialog'; ConfirmDialog
   * passes 'alertdialog' for the safety-critical confirmation pattern
   * (Stage 18 FR-18.5). Additive — the {title, onClose, children} call
   * contract is unchanged.
   */
  role?: 'dialog' | 'alertdialog';
}

/**
 * Accessible modal built on React Aria Components (Stage 19 FR-19.3). React
 * Aria supplies the focus trap, scroll-lock, Escape-to-dismiss and
 * outside-click behaviour the hand-rolled version used to carry; `onClose`
 * is wired to both explicit dismissal (the ✕) and `onOpenChange`
 * (Escape / backdrop), preserving the previous behaviour.
 */
export function Modal({ title, onClose, children, role = 'dialog' }: ModalProps) {
  return (
    <ModalOverlay
      isOpen
      isDismissable
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 data-[entering]:animate-none sm:items-center sm:p-4"
    >
      <RACModal className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl border border-white/10 bg-slate-900/95 p-5 shadow-soft outline-none backdrop-blur-md sm:rounded-3xl">
        <Dialog role={role} className="outline-none">
          <div className="mb-4 flex items-center justify-between">
            <Heading slot="title" className="text-lg font-semibold">
              {title}
            </Heading>
            <RACButton
              onPress={onClose}
              aria-label="Close"
              className="rounded-full px-2 py-1 text-slate-400 outline-none data-[focus-visible]:ring-2 data-[focus-visible]:ring-accent-muted data-[hovered]:bg-slate-800 data-[hovered]:text-slate-100"
            >
              ✕
            </RACButton>
          </div>
          {children}
        </Dialog>
      </RACModal>
    </ModalOverlay>
  );
}
