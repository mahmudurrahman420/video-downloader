import React, { useRef, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as WebBrowser from 'expo-web-browser';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { AppButton, Card, Notice, Screen, SectionLabel } from '../components/ui';
import { VideoPreviewCard } from '../components/VideoPreviewCard';
import { useTheme } from '../theme/ThemeContext';
import { radius, spacing, typography } from '../theme/colors';
import { resolveLink, SUPPORTED_SOURCES } from '../services/providers';
import { AppError } from '../services/http';
import { ensureMediaPermission, permissionCanBeRequested } from '../services/downloads/mediaSaver';
import type { DownloadOption, OwnerExportGuide, VideoMetadata } from '../types';
import { useDownloads } from '../store/DownloadsContext';
import { useHistory } from '../store/HistoryContext';
import { formatBytes } from '../utils/format';
import type { TabParamList } from '../navigation/types';

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; title: string; message: string; retryable: boolean }
  | { kind: 'unsupported'; url: string; platformName?: string; reason: string }
  | { kind: 'result'; meta: VideoMetadata };

export function HomeScreen() {
  const { colors } = useTheme();
  const navigation = useNavigation<BottomTabNavigationProp<TabParamList>>();
  const { enqueue, items } = useDownloads();
  const history = useHistory();
  const [url, setUrl] = useState('');
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [queuedIds, setQueuedIds] = useState<Record<string, boolean>>({});
  const requestSeq = useRef(0);

  const analyze = async (input = url) => {
    const seq = ++requestSeq.current;
    setRightsConfirmed(false);
    setQueuedIds({});
    setState({ kind: 'loading' });
    try {
      const res = await resolveLink(input);
      if (seq !== requestSeq.current) return; // a newer request superseded this one
      if (res.type === 'invalid') {
        setState({ kind: 'error', title: 'Invalid link', message: res.reason, retryable: false });
        if (input.trim()) history.add({ url: input.trim(), outcome: 'invalid', detail: res.reason });
        return;
      }
      if (res.type === 'unsupported') {
        setState({ kind: 'unsupported', url: res.url, platformName: res.platformName, reason: res.reason });
        history.add({ url: res.url, providerName: res.platformName, outcome: res.platformName ? 'view-only' : 'error', detail: res.reason });
        return;
      }
      setState({ kind: 'result', meta: res.data });
      history.add({
        url: res.data.sourceUrl,
        title: res.data.title,
        providerName: res.data.providerName,
        thumbnailUrl: res.data.thumbnailUrl,
        outcome: res.data.downloadAllowed ? 'looked-up' : 'view-only',
        detail: res.data.downloadAllowed ? `${res.data.options.length} download option(s) available` : res.data.permissionNote,
      });
    } catch (e) {
      if (seq !== requestSeq.current) return;
      const err = e instanceof AppError ? e : new AppError('unknown', 'Something went wrong while reading this link.');
      setState({
        kind: 'error',
        title: errorTitle(err),
        message: err.message,
        retryable: err.kind === 'offline' || err.kind === 'timeout' || err.kind === 'unknown' || (err.status ?? 0) >= 500 || err.status === 429,
      });
      history.add({ url: input.trim(), outcome: 'error', detail: err.message });
    }
  };

  const onPaste = async () => {
    try {
      const text = await Clipboard.getStringAsync();
      if (!text?.trim()) {
        Alert.alert('Clipboard is empty', 'Copy a video link first, then tap Paste.');
        return;
      }
      setUrl(text.trim());
      analyze(text.trim());
    } catch {
      Alert.alert('Paste failed', 'Could not read the clipboard.');
    }
  };

  const openOfficial = async (link: string) => {
    try {
      // Opening a YouTube/Vimeo URL hands it to the official app when installed.
      const ok = await Linking.canOpenURL(link);
      if (ok) await Linking.openURL(link);
      else await WebBrowser.openBrowserAsync(link);
    } catch {
      await WebBrowser.openBrowserAsync(link).catch(() =>
        Alert.alert('Could not open link', 'No app is available to open this link.'),
      );
    }
  };

  const startDownload = async (meta: VideoMetadata, option: DownloadOption) => {
    if (meta.requiresRightsConfirmation && !rightsConfirmed) {
      Alert.alert('Confirm permission', 'Please confirm you have the right to download this file.');
      return;
    }
    // Ask for storage permission up front so the user isn't surprised at the end.
    const granted = await ensureMediaPermission().catch(() => false);
    if (!granted) {
      const canAsk = await permissionCanBeRequested().catch(() => false);
      Alert.alert(
        'Storage permission needed',
        'Video Downloader needs permission to save videos to your device (Movies folder).',
        canAsk
          ? [{ text: 'OK' }]
          : [
              { text: 'Not now', style: 'cancel' },
              { text: 'Open Settings', onPress: () => Linking.openSettings() },
            ],
      );
      return;
    }
    const duplicate = items.find(
      (i) => i.url === option.url && ['queued', 'downloading', 'paused', 'saving'].includes(i.status),
    );
    if (duplicate) {
      Alert.alert('Already downloading', 'This file is already in your download queue.', [
        { text: 'OK' },
        { text: 'View', onPress: () => navigation.navigate('Downloads') },
      ]);
      return;
    }
    enqueue(meta, option);
    setQueuedIds((q) => ({ ...q, [option.id]: true }));
  };

  return (
    <Screen title="Video Downloader" subtitle="Save videos you're allowed to keep">
      <Card style={{ gap: spacing.md }}>
        <View style={[styles.inputWrap, { backgroundColor: colors.inputBackground, borderColor: colors.border }]}>
          <Ionicons name="link-outline" size={20} color={colors.textFaint} />
          <TextInput
            value={url}
            onChangeText={setUrl}
            placeholder="Paste a video link"
            placeholderTextColor={colors.textFaint}
            style={[styles.input, { color: colors.text }]}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="go"
            onSubmitEditing={() => analyze()}
            accessibilityLabel="Video link"
          />
          {url ? (
            <Pressable
              onPress={() => {
                setUrl('');
                setState({ kind: 'idle' });
              }}
              hitSlop={10}
              accessibilityLabel="Clear link"
            >
              <Ionicons name="close-circle" size={20} color={colors.textFaint} />
            </Pressable>
          ) : null}
        </View>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <AppButton label="Paste" icon="clipboard-outline" variant="secondary" onPress={onPaste} style={{ flex: 1 }} />
          <AppButton
            label="Fetch video"
            icon="search"
            onPress={() => analyze()}
            loading={state.kind === 'loading'}
            disabled={!url.trim()}
            style={{ flex: 1.4 }}
          />
        </View>
      </Card>

      <View style={{ marginTop: spacing.lg, gap: spacing.lg }}>
        {state.kind === 'loading' && <LoadingCard />}

        {state.kind === 'error' && (
          <Card style={{ gap: spacing.md }}>
            <Notice
              tone="danger"
              icon={state.title === 'No connection' ? 'cloud-offline-outline' : 'alert-circle-outline'}
              title={state.title}
              message={state.message}
            />
            {state.retryable && <AppButton label="Try again" icon="refresh" variant="secondary" onPress={() => analyze()} />}
          </Card>
        )}

        {state.kind === 'unsupported' && (
          <Card style={{ gap: spacing.md }}>
            <Notice
              tone="warning"
              icon="information-circle-outline"
              title={state.platformName ? `${state.platformName} can't be downloaded here` : 'Unsupported link'}
              message={state.reason}
            />
            <AppButton
              label={state.platformName ? `Open in ${state.platformName}` : 'Open link'}
              icon="open-outline"
              variant="secondary"
              onPress={() => openOfficial(state.url)}
            />
          </Card>
        )}

        {state.kind === 'result' && (
          <>
            <VideoPreviewCard meta={state.meta} />
            <Notice
              tone={state.meta.downloadAllowed ? 'success' : 'warning'}
              icon={state.meta.downloadAllowed ? 'shield-checkmark-outline' : 'lock-closed-outline'}
              title={state.meta.downloadAllowed ? 'Download permitted' : 'Downloading is not permitted'}
              message={state.meta.permissionNote}
            />

            {state.meta.downloadAllowed && state.meta.requiresRightsConfirmation && (
              <Pressable
                onPress={() => setRightsConfirmed((v) => !v)}
                style={[styles.checkRow, { borderColor: colors.border, backgroundColor: colors.card }]}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: rightsConfirmed }}
              >
                <Ionicons
                  name={rightsConfirmed ? 'checkbox' : 'square-outline'}
                  size={22}
                  color={rightsConfirmed ? colors.primary : colors.textMuted}
                />
                <Text style={[typography.small, { color: colors.text, flex: 1 }]}>
                  I own this file or have permission to download it.
                </Text>
              </Pressable>
            )}

            {state.meta.downloadAllowed && state.meta.options.length > 0 && (
              <View>
                <SectionLabel>Download options</SectionLabel>
                <Card style={{ padding: 0 }}>
                  {state.meta.options.map((o, idx) => {
                    const meta = state.meta;
                    const queued = queuedIds[o.id];
                    return (
                      <View
                        key={o.id}
                        style={[
                          styles.optionRow,
                          idx > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
                        ]}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={[typography.body, { color: colors.text, fontWeight: '600' }]} numberOfLines={1}>
                            {o.label}
                          </Text>
                          <Text style={[typography.small, { color: colors.textMuted }]} numberOfLines={1}>
                            {formatBytes(o.sizeBytes)} · {o.fileName}
                          </Text>
                        </View>
                        {queued ? (
                          <AppButton compact variant="secondary" icon="list" label="View" onPress={() => navigation.navigate('Downloads')} />
                        ) : (
                          <AppButton
                            compact
                            icon="download-outline"
                            label="Download"
                            disabled={meta.requiresRightsConfirmation && !rightsConfirmed}
                            onPress={() => startDownload(meta, o)}
                          />
                        )}
                      </View>
                    );
                  })}
                </Card>
                {Object.keys(queuedIds).length > 0 && (
                  <Text style={[typography.small, { color: colors.textMuted, marginTop: spacing.sm }]}>
                    Added to your queue. Progress is shown on the Downloads tab.
                  </Text>
                )}
              </View>
            )}

            {state.meta.officialViewUrl && (
              <AppButton
                label={state.meta.officialViewLabel ?? 'Open original'}
                icon={state.meta.provider === 'youtube' ? 'logo-youtube' : 'open-outline'}
                variant={state.meta.downloadAllowed ? 'ghost' : 'primary'}
                onPress={() => openOfficial(state.meta.officialViewUrl!)}
              />
            )}

            {state.meta.ownerExport && (
              <OwnerExportCard guide={state.meta.ownerExport} onOpen={openOfficial} />
            )}
          </>
        )}

        {state.kind === 'idle' && <SupportedSources />}
      </View>
    </Screen>
  );
}

function errorTitle(err: AppError): string {
  switch (err.kind) {
    case 'offline':
      return 'No connection';
    case 'timeout':
      return 'Request timed out';
    case 'unsupported':
      return 'Not a downloadable video';
    case 'storage-permission':
      return 'Permission needed';
    case 'http':
      if (err.status === 401 || err.status === 403) return 'File is not accessible';
      if (err.status === 404 || err.status === 410) return 'File not found';
      return 'Server error';
    default:
      return "Couldn't load video";
  }
}

/** Collapsed help card: how an owner gets a downloadable copy via official tools. */
function OwnerExportCard({ guide, onOpen }: { guide: OwnerExportGuide; onOpen: (url: string) => void }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <Card style={{ gap: spacing.md }}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}
      >
        <Ionicons name="person-circle-outline" size={22} color={colors.primary} />
        <View style={{ flex: 1 }}>
          <Text style={[typography.heading, { color: colors.text }]}>Is this your video?</Text>
          <Text style={[typography.small, { color: colors.textMuted }]}>
            Get your own copy with {guide.platformName}'s official export tools
          </Text>
        </View>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textFaint} />
      </Pressable>
      {open && (
        <View style={{ gap: spacing.md }}>
          {guide.steps.map((step, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: spacing.sm }}>
              <View style={[styles.stepNum, { backgroundColor: colors.primarySoft }]}>
                <Text style={[typography.caption, { color: colors.primary }]}>{i + 1}</Text>
              </View>
              <Text style={[typography.small, { color: colors.text, flex: 1 }]}>{step}</Text>
            </View>
          ))}
          <Text style={[typography.small, { color: colors.textMuted }]}>{guide.afterExport}</Text>
          {guide.links.map((l) => (
            <AppButton key={l.url} label={l.label} icon="open-outline" variant="secondary" onPress={() => onOpen(l.url)} />
          ))}
        </View>
      )}
    </Card>
  );
}

function LoadingCard() {
  const { colors } = useTheme();
  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      <View style={{ aspectRatio: 16 / 9, backgroundColor: colors.cardElevated }} />
      <View style={{ padding: spacing.lg, gap: spacing.sm }}>
        <View style={{ height: 14, width: '40%', borderRadius: 7, backgroundColor: colors.cardElevated }} />
        <View style={{ height: 18, width: '85%', borderRadius: 9, backgroundColor: colors.cardElevated }} />
        <Text style={[typography.small, { color: colors.textMuted }]}>Checking the source’s official API…</Text>
      </View>
    </Card>
  );
}

function SupportedSources() {
  const { colors } = useTheme();
  return (
    <View>
      <SectionLabel>Supported sources</SectionLabel>
      <Card style={{ padding: 0 }}>
        {SUPPORTED_SOURCES.map((s, idx) => (
          <View
            key={s.name}
            style={[styles.sourceRow, idx > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}
          >
            <View style={[styles.sourceIcon, { backgroundColor: s.download ? colors.primarySoft : colors.warningSoft }]}>
              <Ionicons name={s.icon} size={18} color={s.download ? colors.primary : colors.warning} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[typography.body, { color: colors.text, fontWeight: '600' }]}>{s.name}</Text>
              <Text style={[typography.small, { color: colors.textMuted }]}>{s.detail}</Text>
            </View>
          </View>
        ))}
      </Card>
      <Text style={[typography.small, { color: colors.textFaint, marginTop: spacing.md }]}>
        Downloads are only offered when the source officially allows it. Platforms like YouTube are view-only and open in their official app.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    minHeight: 52,
  },
  input: { flex: 1, fontSize: 15, paddingVertical: 12 },
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  sourceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, paddingHorizontal: spacing.lg },
  stepNum: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  sourceIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
});
