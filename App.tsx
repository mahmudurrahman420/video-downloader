import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SettingsProvider } from './src/store/SettingsContext';
import { HistoryProvider } from './src/store/HistoryContext';
import { DownloadsProvider } from './src/store/DownloadsContext';
import { ThemeProvider, useTheme } from './src/theme/ThemeContext';
import { RootTabs } from './src/navigation/RootTabs';
import { installExpoNetworkChecker } from './src/services/expoNetwork';

installExpoNetworkChecker();

function ThemedApp() {
  const { colors, isDark } = useTheme();
  useEffect(() => {
    SystemUI.setBackgroundColorAsync(colors.background).catch(() => {});
  }, [colors.background]);
  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <RootTabs />
    </>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <SettingsProvider>
        <ThemeProvider>
          <HistoryProvider>
            <DownloadsProvider>
              <ThemedApp />
            </DownloadsProvider>
          </HistoryProvider>
        </ThemeProvider>
      </SettingsProvider>
    </SafeAreaProvider>
  );
}
