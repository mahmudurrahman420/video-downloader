import React from 'react';
import { Alert, Linking, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { Card, Screen, SectionLabel, SegmentedControl } from '../components/ui';
import { useSettings } from '../store/SettingsContext';
import { useHistory } from '../store/HistoryContext';
import { useDownloads } from '../store/DownloadsContext';
import { useTheme } from '../theme/ThemeContext';
import { spacing, typography } from '../theme/colors';
import type { ThemeMode } from '../theme/colors';
import { ALBUM_NAME } from '../services/downloads/mediaSaver';

export function SettingsScreen() {
  const { colors } = useTheme();
  const { settings, update } = useSettings();
  const history = useHistory();
  const { clearFinished } = useDownloads();

  return (
    <Screen title="Settings">
      <SectionLabel>Appearance</SectionLabel>
      <Card>
        <Text style={[typography.body, { color: colors.text, fontWeight: '600', marginBottom: spacing.md }]}>Theme</Text>
        <SegmentedControl<ThemeMode>
          value={settings.themeMode}
          onChange={(themeMode) => update({ themeMode })}
          options={[
            { value: 'dark', label: 'Dark' },
            { value: 'light', label: 'Light' },
            { value: 'system', label: 'System' },
          ]}
        />
      </Card>

      <SectionLabel style={{ marginTop: spacing.xl }}>Downloads</SectionLabel>
      <Card style={{ padding: 0 }}>
        <Row
          icon="wifi-outline"
          title="Download over Wi-Fi only"
          subtitle="Avoid using mobile data"
          right={
            <Switch
              value={settings.wifiOnly}
              onValueChange={(wifiOnly) => update({ wifiOnly })}
              trackColor={{ true: colors.primary, false: colors.border }}
              thumbColor="#fff"
            />
          }
        />
        <Divider />
        <View style={{ padding: spacing.lg, gap: spacing.md }}>
          <Text style={[typography.body, { color: colors.text, fontWeight: '600' }]}>Simultaneous downloads</Text>
          <SegmentedControl<string>
            value={String(settings.maxConcurrent)}
            onChange={(v) => update({ maxConcurrent: Number(v) })}
            options={[
              { value: '1', label: '1' },
              { value: '2', label: '2' },
              { value: '3', label: '3' },
            ]}
          />
        </View>
        <Divider />
        <Row
          icon="folder-outline"
          title="Save location"
          subtitle={`Movies/${ALBUM_NAME} — visible in Gallery and Files`}
        />
        <Divider />
        <Row icon="checkmark-done-outline" title="Clear completed & cancelled" subtitle="Files stay on your device" onPress={clearFinished} />
      </Card>

      <SectionLabel style={{ marginTop: spacing.xl }}>Privacy</SectionLabel>
      <Card style={{ padding: 0 }}>
        <Row
          icon="time-outline"
          title="Keep history"
          subtitle="Remember links you look up"
          right={
            <Switch
              value={settings.keepHistory}
              onValueChange={(keepHistory) => update({ keepHistory })}
              trackColor={{ true: colors.primary, false: colors.border }}
              thumbColor="#fff"
            />
          }
        />
        <Divider />
        <Row
          icon="trash-outline"
          title="Clear history"
          danger
          onPress={() =>
            Alert.alert('Clear history', 'Remove all history entries?', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Clear', style: 'destructive', onPress: history.clear },
            ])
          }
        />
        <Divider />
        <Row icon="settings-outline" title="App permissions" subtitle="Open Android settings for this app" onPress={() => Linking.openSettings()} />
      </Card>

      <SectionLabel style={{ marginTop: spacing.xl }}>About</SectionLabel>
      <Card style={{ gap: spacing.sm }}>
        <Text style={[typography.body, { color: colors.text, fontWeight: '600' }]}>
          Video Downloader {Constants.expoConfig?.version ?? ''}
        </Text>
        <Text style={[typography.small, { color: colors.textMuted }]}>
          This app only downloads videos when the source officially allows it: public Internet Archive items,
          freely licensed Wikimedia Commons files, and direct file links you have rights to. YouTube, Vimeo and other
          platforms are view-only and open in their official apps. No DRM or platform protections are bypassed.
        </Text>
      </Card>
    </Screen>
  );
}

function Divider() {
  const { colors } = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 56 }} />;
}

function Row({
  icon,
  title,
  subtitle,
  right,
  onPress,
  danger,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  onPress?: () => void;
  danger?: boolean;
}) {
  const { colors } = useTheme();
  const content = (
    <View style={styles.row}>
      <Ionicons name={icon} size={20} color={danger ? colors.danger : colors.primary} style={{ width: 24 }} />
      <View style={{ flex: 1 }}>
        <Text style={[typography.body, { color: danger ? colors.danger : colors.text, fontWeight: '500' }]}>{title}</Text>
        {subtitle ? <Text style={[typography.small, { color: colors.textMuted }]}>{subtitle}</Text> : null}
      </View>
      {right ?? (onPress ? <Ionicons name="chevron-forward" size={18} color={colors.textFaint} /> : null)}
    </View>
  );
  return onPress ? (
    <Pressable onPress={onPress} android_ripple={{ color: colors.primarySoft }} accessibilityRole="button">
      {content}
    </Pressable>
  ) : (
    content
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, minHeight: 56 },
});
