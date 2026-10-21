import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import type { VideoMetadata } from '../types';
import { useTheme } from '../theme/ThemeContext';
import { radius, spacing, typography } from '../theme/colors';
import { formatDuration } from '../utils/format';
import { Badge, Card } from './ui';

export function VideoPreviewCard({ meta }: { meta: VideoMetadata }) {
  const { colors } = useTheme();
  const duration = formatDuration(meta.durationSeconds);
  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      <View style={[styles.thumbWrap, { backgroundColor: colors.cardElevated }]}>
        {meta.thumbnailUrl ? (
          <Image
            source={{ uri: meta.thumbnailUrl }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={200}
            accessibilityLabel={`Thumbnail for ${meta.title}`}
          />
        ) : (
          <Ionicons name="film-outline" size={40} color={colors.textFaint} />
        )}
        {duration ? (
          <View style={styles.duration}>
            <Text style={styles.durationText}>{duration}</Text>
          </View>
        ) : null}
      </View>
      <View style={{ padding: spacing.lg, gap: spacing.sm }}>
        <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
          <Badge label={meta.providerName} tone="primary" />
          {meta.downloadAllowed ? (
            <Badge label="Download permitted" tone="success" icon="checkmark-circle" />
          ) : (
            <Badge label="View only" tone="warning" icon="eye-outline" />
          )}
        </View>
        <Text style={[typography.title, { color: colors.text }]} numberOfLines={3}>
          {meta.title}
        </Text>
        {meta.author ? (
          <Text style={[typography.small, { color: colors.textMuted }]} numberOfLines={1}>
            {meta.author}
          </Text>
        ) : null}
        {meta.license ? (
          <Text style={[typography.small, { color: colors.textFaint }]} numberOfLines={2}>
            License: {meta.license}
          </Text>
        ) : null}
        {meta.description ? (
          <Text style={[typography.small, { color: colors.textMuted }]} numberOfLines={3}>
            {meta.description}
          </Text>
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  thumbWrap: { aspectRatio: 16 / 9, alignItems: 'center', justifyContent: 'center', borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, overflow: 'hidden' },
  duration: {
    position: 'absolute',
    right: spacing.sm,
    bottom: spacing.sm,
    backgroundColor: 'rgba(0,0,0,0.75)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  durationText: { color: '#fff', fontSize: 12, fontWeight: '600' },
});
