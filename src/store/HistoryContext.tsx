import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { HistoryEntry } from '../types';
import { loadJSON, saveJSON } from '../services/persistence';
import { makeId } from '../utils/format';
import { useSettings } from './SettingsContext';

const MAX_ENTRIES = 300;

interface HistoryValue {
  entries: HistoryEntry[];
  add: (entry: Omit<HistoryEntry, 'id' | 'timestamp'>) => void;
  remove: (id: string) => void;
  clear: () => void;
}

const HistoryContext = createContext<HistoryValue>({
  entries: [],
  add: () => {},
  remove: () => {},
  clear: () => {},
});

export function HistoryProvider({ children }: { children: React.ReactNode }) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const { settings } = useSettings();
  const keepRef = useRef(settings.keepHistory);
  keepRef.current = settings.keepHistory;

  useEffect(() => {
    loadJSON<HistoryEntry[]>('history', []).then(setEntries);
  }, []);

  const commit = useCallback((updater: (prev: HistoryEntry[]) => HistoryEntry[]) => {
    setEntries((prev) => {
      const next = updater(prev);
      saveJSON('history', next);
      return next;
    });
  }, []);

  const add = useCallback(
    (entry: Omit<HistoryEntry, 'id' | 'timestamp'>) => {
      if (!keepRef.current) return;
      commit((prev) => [{ ...entry, id: makeId(), timestamp: Date.now() }, ...prev].slice(0, MAX_ENTRIES));
    },
    [commit],
  );

  const remove = useCallback((id: string) => commit((prev) => prev.filter((e) => e.id !== id)), [commit]);
  const clear = useCallback(() => commit(() => []), [commit]);

  return <HistoryContext.Provider value={{ entries, add, remove, clear }}>{children}</HistoryContext.Provider>;
}

export const useHistory = () => useContext(HistoryContext);
