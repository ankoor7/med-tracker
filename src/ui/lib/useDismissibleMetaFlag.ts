import { useEffect, useState } from 'react';
import { getRepository } from '../../store/repository';

export type DismissibleFlagState = 'loading' | 'shown' | 'hidden';

/**
 * Shared load-then-show-or-hide behaviour for a per-device, dismiss-once
 * banner/prompt (`Disclaimer`, `StartDatePrompt`): reads a boolean flag from
 * the repository `meta` table on mount, then exposes a `dismiss()` that
 * persists it so the UI never reappears once acknowledged.
 *
 * Starts in `'loading'` (renders nothing) so the UI never flashes shown then
 * hidden while the async lookup is still in flight.
 */
export function useDismissibleMetaFlag(key: string): {
  state: DismissibleFlagState;
  dismiss: () => void;
} {
  const [state, setState] = useState<DismissibleFlagState>('loading');

  useEffect(() => {
    let live = true;
    void getRepository()
      .getMeta(key)
      .then((v) => {
        if (live) setState(v === 'true' ? 'hidden' : 'shown');
      })
      .catch(() => {
        if (live) setState('shown');
      });
    return () => {
      live = false;
    };
  }, [key]);

  const dismiss = () => {
    setState('hidden');
    void getRepository()
      .setMeta(key, 'true')
      .catch((e) => console.error('persist dismissal failed', key, e));
  };

  return { state, dismiss };
}
