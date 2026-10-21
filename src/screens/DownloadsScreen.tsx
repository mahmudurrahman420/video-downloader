import React, { useMemo, useState } from 'react';
import { FlatList, View } from 'react-native';
import { EmptyState, IconButton, Screen, SegmentedControl } from '../components/ui';
import { DownloadItemCard } from '../components/DownloadItemCard';
import { useDownloads } from '../store/DownloadsContext';
import { spacing } from '../theme/colors';
import type { DownloadItem } from '../types';

type Filter = 'pending' | 'completed' | 'failed';

const groups: Record<Filter, DownloadItem['status'][]> = {
  pending: ['queued', 'downloading', 'paused', 'saving'],
  completed: ['completed'],
  failed: ['failed', 'cancelled'],
};

const EMPTY: Record<Filter, { title: string; message: string; icon: 'cloud-download-outline' | 'checkmark-done-outline' | 'alert-circle-outline' }> = {
  pending: { title: 'Nothing downloading', message: 'Paste a link on the Home tab to start a download.', icon: 'cloud-download-outline' },
  completed: { title: 'No completed downloads', message: 'Finished videos are saved to Movies/Video Downloader.', icon: 'checkmark-done-outline' },
  failed: { title: 'No failed downloads', message: 'Downloads that fail or are cancelled appear here so you can retry.', icon: 'alert-circle-outline' },
};

export function DownloadsScreen() {
  const { items, clearFinished } = useDownloads();
  const [filter, setFilter] = useState<Filter>('pending');

  const counts = useMemo(
    () => ({
      pending: items.filter((i) => groups.pending.includes(i.status)).length,
      completed: items.filter((i) => groups.completed.includes(i.status)).length,
      failed: items.filter((i) => groups.failed.includes(i.status)).length,
    }),
    [items],
  );
  const visible = useMemo(() => items.filter((i) => groups[filter].includes(i.status)), [items, filter]);

  return (
    <Screen
      title="Downloads"
      subtitle={`${counts.pending} active · ${counts.completed} saved`}
      scroll={false}
      right={
        counts.completed > 0 ? <IconButton icon="checkmark-done" label="Clear completed" onPress={clearFinished} /> : undefined
      }
    >
      <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.md }}>
        <SegmentedControl<Filter>
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'pending', label: 'Pending', count: counts.pending },
            { value: 'completed', label: 'Completed', count: counts.completed },
            { value: 'failed', label: 'Failed', count: counts.failed },
          ]}
        />
      </View>
      <FlatList
        data={visible}
        keyExtractor={(i) => i.id}
        renderItem={({ item }) => <DownloadItemCard item={item} />}
        contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: 32, gap: spacing.md, flexGrow: 1 }}
        ListEmptyComponent={<EmptyState {...EMPTY[filter]} />}
      />
    </Screen>
  );
}
