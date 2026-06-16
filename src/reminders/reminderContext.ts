// The reminder context object + consumer hook, kept in a non-component module so
// the Provider's .tsx file can export only a component (React Fast Refresh).

import { createContext, useContext } from 'react';
import type { UseReminders } from './useReminders';

export const RemindersContext = createContext<UseReminders | null>(null);

export function useRemindersContext(): UseReminders {
  const ctx = useContext(RemindersContext);
  if (!ctx) throw new Error('useRemindersContext must be used within a RemindersProvider');
  return ctx;
}
