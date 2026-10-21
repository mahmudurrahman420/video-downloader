import React from 'react';
import { DarkTheme, DefaultTheme, NavigationContainer, Theme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { HomeScreen } from '../screens/HomeScreen';
import { DownloadsScreen } from '../screens/DownloadsScreen';
import { HistoryScreen } from '../screens/HistoryScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { useDownloads } from '../store/DownloadsContext';
import type { TabParamList } from './types';

const Tab = createBottomTabNavigator<TabParamList>();

const ICONS: Record<keyof TabParamList, [React.ComponentProps<typeof Ionicons>['name'], React.ComponentProps<typeof Ionicons>['name']]> = {
  Home: ['home', 'home-outline'],
  Downloads: ['cloud-download', 'cloud-download-outline'],
  History: ['time', 'time-outline'],
  Settings: ['settings', 'settings-outline'],
};

export function RootTabs() {
  const { colors, isDark } = useTheme();
  const { items } = useDownloads();
  const active = items.filter((i) => ['queued', 'downloading', 'saving'].includes(i.status)).length;

  const base = isDark ? DarkTheme : DefaultTheme;
  const navTheme: Theme = {
    ...base,
    colors: {
      ...base.colors,
      primary: colors.primary,
      background: colors.background,
      card: colors.tabBar,
      text: colors.text,
      border: colors.border,
    },
  };

  return (
    <NavigationContainer theme={navTheme}>
      <Tab.Navigator
        screenOptions={({ route }) => ({
          headerShown: false,
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.textFaint,
          tabBarStyle: { backgroundColor: colors.tabBar, borderTopColor: colors.border, height: 64, paddingTop: 6 },
          tabBarLabelStyle: { fontSize: 11, fontWeight: '600', marginBottom: 6 },
          tabBarIcon: ({ focused, color, size }) => (
            <Ionicons name={ICONS[route.name][focused ? 0 : 1]} size={size} color={color} />
          ),
        })}
      >
        <Tab.Screen name="Home" component={HomeScreen} />
        <Tab.Screen
          name="Downloads"
          component={DownloadsScreen}
          options={{ tabBarBadge: active > 0 ? active : undefined, tabBarBadgeStyle: { backgroundColor: colors.primary } }}
        />
        <Tab.Screen name="History" component={HistoryScreen} />
        <Tab.Screen name="Settings" component={SettingsScreen} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
