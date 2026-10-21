import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { AppSettings } from '../types';
import { loadJSON, saveJSON } from '../services/persistence';

export const DEFAULT_SETTINGS: AppSettings = {
  themeMode: 'dark',
  wifiOnly: false,
  maxConcurrent: 2,
  keepHistory: true,
};

interface SettingsValue {
  settings: AppSettings;
  loaded: boolean;
  update: (patch: Partial<AppSettings>) => void;
}

const SettingsContext = createContext<SettingsValue>({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  update: () => {},
});

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    loadJSON<Partial<AppSettings>>('settings', {}).then((stored) => {
      setSettings({ ...DEFAULT_SETTINGS, ...stored });
      setLoaded(true);
    });
  }, []);

  const update = useCallback((patch: Partial<AppSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveJSON('settings', next);
      return next;
    });
  }, []);

  return (
    <SettingsContext.Provider value={{ settings, loaded, update }}>
      {children}
    </SettingsContext.Provider>
  );
}

export const useSettings = () => useContext(SettingsContext);
