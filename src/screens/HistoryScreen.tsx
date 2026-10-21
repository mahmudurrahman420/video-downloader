import React, { useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { Badge, Card, EmptyState, IconButton, Screen, Tone } from '../components/ui';
import { useHistory } from '../store/HistoryContext';
import { useTheme } from '../theme/ThemeContext';
import { radius, spacing, typography } from '../theme/colors';
import { formatRelativeTime } from '../utils/format';
import type { HistoryEntry, HistoryOutcome } from '../types';

const OUTCOME: Record<HistoryOutcome, { label: string; tone: Tone }> = {
  'looked-up': { label: 'Looked up', tone: 'primary' },
  queued: { label: 'Download started', tone: 'primary' },
  downloaded: { label: 'Downloaded', tone: 'success' },
  'download-failed': { label: 'Download failed', tone: 'danger' },
  'view-only': { label: 'View only', tone: 'warning' },
  invalid: { label: 'Invalid link', tone: 'neutral' },
  error: { label: 'Error', tone: 'danger' },
};

export function HistoryScreen() {
  const { colors } = useTheme();
  const { entries, clear, remove } = useHistory();
  const [query, setQuery] = useState('');

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) =>
      [e.title, e.url, e.providerName].some((f) => f?.toLowerCase().includes(q)),
    );
  }, [entries, query]);

  const onClear = () =>
    Alert.alert('Clear history', 'Remove all history entries? Downloaded files are not affected.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: clear },
    ]);

  const onCopy = async (e: HistoryEntry) => {
    await Clipboard.setStringAsync(e.url);
    Alert.alert('Link copied', 'Paste it on the Home tab to look it up again.');
  };

  return (
    <Screen
      title="History"
      subtitle={`${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}`}
      scroll={false}
      right={entries.length ? <IconButton icon="trash-outline" label="Clear history" onPress={onClear} /> : undefined}
    >
      {entries.length > 0 && (
        <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.md }}>
          <View style={[styles.search, { backgroundColor: colors.inputBackground, borderColor: colors.border }]}>
            <Ionicons name="search" size={18} color={colors.textFaint} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search history"
              placeholderTextColor={colors.textFaint}
              style={{ flex: 1, color: colors.text, fontSize: 15, paddingVertical: 10 }}
              autoCapitalize="none"
            />
          </View>
        </View>
      )}
      <FlatList
        data={visible}
        keyExtractor={(e) => e.id}
        contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: 32, gap: spacing.sm, flexGrow: 1 }}
        ListEmptyComponent={
          <EmptyState
            icon="time-outline"
            title={query ? 'No matches' : 'No history yet'}
            message={query ? 'Try a different search.' : 'Links you look up and download will be listed here.'}
          />
        }
        renderItem={({ item }) => {
          const o = OUTCOME[item.outcome];
          return (
            <Pressable onPress={() => onCopy(item)} onLongPress={() => remove(item.id)}>
              <Card style={{ flexDirection: 'row', gap: spacing.md, padding: spacing.md }}>
                <View style={[styles.thumb, { backgroundColor: colors.cardElevated }]}>
                  {item.thumbnailUrl ? (
                    <Image source={{ uri: item.thumbnailUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
                  ) : (
                    <Ionicons name="link" size={18} color={colors.textFaint} />
                  )}
                </View>
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={[typography.body, { color: colors.text, fontWeight: '600' }]} numberOfLines={1}>
                    {item.title ?? item.url}
                  </Text>
                  <Text style={[typography.small, { color: colors.textMuted }]} numberOfLines={1}>
                    {item.providerName ? `${item.providerName} · ` : ''}
                    {formatRelativeTime(item.timestamp)}
                  </Text>
                  {item.detail ? (
                    <Text style={[typography.small, { color: colors.textFaint }]} numberOfLines={2}>
                      {item.detail}
                    </Text>
                  ) : null}
                  <Badge label={o.label} tone={o.tone} />
                </View>
              </Card>
            </Pressable>
          );
        }}
        ListFooterComponent={
          visible.length ? (
            <Text style={[typography.small, { color: colors.textFaint, textAlign: 'center', marginTop: spacing.md }]}>
              Tap to copy a link · long-press to remove
            </Text>
          ) : undefined
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md },
  thumb: { width: 56, height: 56, borderRadius: radius.sm, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
});
