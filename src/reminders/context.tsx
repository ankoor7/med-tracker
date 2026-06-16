// Shares one reminder-engine instance app-wide. The engine must run regardless
// of which tab is open (so notifications fire from anywhere), while the settings
// panel and catch-up banner read the same prefs/permission/catch-up state.

import type { ReactNode } from 'react';
import { useReminders } from './useReminders';
import { RemindersContext } from './reminderContext';

export function RemindersProvider({ children }: { children: ReactNode }) {
  const value = useReminders();
  return <RemindersContext.Provider value={value}>{children}</RemindersContext.Provider>;
}
