import React from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import type { DownloadItem } from '../types';
import { useTheme } from '../theme/ThemeContext';
import { radius, spacing, typography } from '../theme/colors';
import { formatBytes, formatPercent, formatRelativeTime } from '../utils/format';
import { AppButton, Badge, Card, IconButton, ProgressBar, Tone } from './ui';
import { useDownloads } from '../store/DownloadsContext';
import { assetExists, openSavedVideo } from '../services/downloads/mediaSaver';

const STATUS: Record<DownloadItem['status'], { label: string; tone: Tone; icon: React.ComponentProps<typeof Ionicons>['name'] }> = {
  queued: { label: 'Queued', tone: 'neutral', icon: 'time-outline' },
  downloading: { label: 'Downloading', tone: 'primary', icon: 'arrow-down-circle-outline' },
  paused: { label: 'Paused', tone: 'warning', icon: 'pause-circle-outline' },
  saving: { label: 'Saving to device', tone: 'primary', icon: 'save-outline' },
  completed: { label: 'Completed', tone: 'success', icon: 'checkmark-circle' },
  failed: { label: 'Failed', tone: 'danger', icon: 'alert-circle' },
  cancelled: { label: 'Cancelled', tone: 'neutral', icon: 'close-circle-outline' },
};

export function DownloadItemCard({ item }: { item: DownloadItem }) {
  const { colors } = useTheme();
  const { pause, resume, cancel, retry, remove, redownload } = useDownloads();
  const missing = item.status === 'completed' && item.fileMissing;
  const s = missing
    ? { label: 'Missing from device', tone: 'danger' as Tone, icon: 'alert-circle' as const }
    : STATUS[item.status];
  const isHls = item.kind === 'hls' && !!item.hls && item.status !== 'completed';
  const progress = isHls
    ? item.hls!.segmentsDone / Math.max(1, item.hls!.segmentCount)
    : item.totalBytes > 0
      ? item.bytesWritten / item.totalBytes
      : 0;
  const showProgress = ['downloading', 'paused', 'queued', 'saving'].includes(item.status) || (item.status === 'failed' && item.bytesWritten > 0);

  const onOpen = async () => {
    if (!item.assetId || !(await assetExists(item.assetId))) {
      Alert.alert('File not found', 'This video is no longer on your device. It may have been deleted from your gallery.');
      return;
    }
    try {
      await openSavedVideo(item.assetId, item.mimeType ?? 'video/*');
    } catch {
      Alert.alert('No video player', 'No app on this device can open this video format.');
    }
  };

  const onRemove = () => {
    if (item.status === 'completed' && item.assetId) {
      Alert.alert('Remove download', 'Remove from the list only, or also delete the video from your device?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove from list', onPress: () => remove(item.id) },
        { text: 'Delete file', style: 'destructive', onPress: () => remove(item.id, true) },
      ]);
    } else {
      remove(item.id);
    }
  };

  const sizeText = isHls
    ? `${formatBytes(item.bytesWritten)} of ~${formatBytes(item.totalBytes)} · segment ${item.hls!.segmentsDone}/${item.hls!.segmentCount}`
    : item.status === 'completed'
      ? formatBytes(item.totalBytes || item.bytesWritten)
      : item.totalBytes > 0
        ? `${formatBytes(item.bytesWritten)} of ${formatBytes(item.totalBytes)}`
        : item.bytesWritten > 0
          ? `${formatBytes(item.bytesWritten)} · size unknown`
          : 'Size unknown';

  return (
    <Card style={{ gap: spacing.md }}>
      <View style={styles.row}>
        <View style={[styles.thumb, { backgroundColor: colors.cardElevated }]}>
          {item.thumbnailUrl ? (
            <Image source={{ uri: item.thumbnailUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
          ) : (
            <Ionicons name="film-outline" size={22} color={colors.textFaint} />
          )}
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={[typography.heading, { color: colors.text }]} numberOfLines={2}>
            {item.title}
          </Text>
          <Text style={[typography.small, { color: colors.textMuted }]} numberOfLines={1}>
            {item.providerName} · {item.fileName}
          </Text>
          <Badge label={s.label} tone={s.tone} icon={s.icon} />
        </View>
        <IconButton icon="trash-outline" label="Remove" onPress={onRemove} />
      </View>

      {showProgress ? (
        <View style={{ gap: 6 }}>
          <ProgressBar
            progress={item.status === 'saving' ? 1 : progress}
            color={item.status === 'failed' ? colors.danger : item.status === 'paused' ? colors.warning : undefined}
          />
          <View style={styles.metaRow}>
            <Text style={[typography.small, { color: colors.textMuted }]}>{sizeText}</Text>
            <Text style={[typography.small, { color: colors.text, fontWeight: '600' }]}>
              {item.status === 'saving' ? 'Finishing…' : isHls ? `${Math.floor(progress * 100)}%` : formatPercent(item.bytesWritten, item.totalBytes)}
            </Text>
          </View>
        </View>
      ) : (
        <Text style={[typography.small, { color: colors.textMuted }]}>
          {sizeText}
          {item.completedAt ? ` · ${formatRelativeTime(item.completedAt)}` : ''}
        </Text>
      )}

      {item.status === 'completed' && item.savedLocation && !missing ? (
        <View style={[styles.location, { backgroundColor: colors.successSoft }]}>
          <Ionicons name="folder-open-outline" size={14} color={colors.success} />
          <Text style={[typography.small, { color: colors.text, flex: 1 }]} numberOfLines={2}>
            Saved to {item.savedLocation}
          </Text>
        </View>
      ) : null}

      {item.errorMessage && item.status !== 'completed' ? (
        <Text style={[typography.small, { color: item.status === 'failed' ? colors.danger : colors.warning }]}>
          {item.errorMessage}
        </Text>
      ) : null}

      <View style={styles.actions}>
        {item.status === 'downloading' && (
          <>
            <AppButton compact variant="secondary" icon="pause" label="Pause" onPress={() => pause(item.id)} />
            <AppButton compact variant="ghost" icon="close" label="Cancel" onPress={() => cancel(item.id)} />
          </>
        )}
        {item.status === 'queued' && (
          <AppButton compact variant="ghost" icon="close" label="Cancel" onPress={() => cancel(item.id)} />
        )}
        {item.status === 'paused' && (
          <>
            <AppButton compact icon="play" label="Resume" onPress={() => resume(item.id)} />
            <AppButton compact variant="ghost" icon="close" label="Cancel" onPress={() => cancel(item.id)} />
          </>
        )}
        {(item.status === 'failed' || item.status === 'cancelled') && (
          <AppButton compact icon="refresh" label="Retry" onPress={() => retry(item.id)} />
        )}
        {item.status === 'completed' && !missing && (
          <AppButton compact icon="play-circle-outline" label="Play" onPress={onOpen} />
        )}
        {missing && (
          <>
            <Text style={[typography.small, { color: colors.danger, flexBasis: '100%' }]}>
              This video was deleted from your device outside the app.
            </Text>
            <AppButton compact icon="refresh" label="Download again" onPress={() => redownload(item.id)} />
          </>
        )}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  thumb: { width: 72, height: 48, borderRadius: radius.sm, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between' },
  actions: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  location: { flexDirection: 'row', gap: 6, alignItems: 'center', padding: spacing.sm, borderRadius: radius.sm },
});
