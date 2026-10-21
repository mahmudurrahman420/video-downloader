import React, { createContext, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { darkPalette, lightPalette, Palette } from './colors';
import { useSettings } from '../store/SettingsContext';

interface ThemeValue {
  colors: Palette;
  isDark: boolean;
}

const ThemeContext = createContext<ThemeValue>({ colors: darkPalette, isDark: true });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme();
  const { settings } = useSettings();

  const value = useMemo<ThemeValue>(() => {
    const isDark =
      settings.themeMode === 'system' ? system !== 'light' : settings.themeMode === 'dark';
    return { colors: isDark ? darkPalette : lightPalette, isDark };
  }, [settings.themeMode, system]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
