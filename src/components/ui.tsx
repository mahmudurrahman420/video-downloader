import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { radius, spacing, typography } from '../theme/colors';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

export function Screen({
  title,
  subtitle,
  right,
  children,
  scroll = true,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  scroll?: boolean;
}) {
  const { colors } = useTheme();
  const header = (
    <View style={styles.header}>
      <View style={{ flex: 1 }}>
        <Text style={[typography.display, { color: colors.text }]}>{title}</Text>
        {subtitle ? (
          <Text style={[typography.small, { color: colors.textMuted, marginTop: 2 }]}>{subtitle}</Text>
        ) : null}
      </View>
      {right}
    </View>
  );
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.background }}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {header}
          {children}
        </ScrollView>
      ) : (
        <View style={{ flex: 1 }}>
          <View style={{ paddingHorizontal: spacing.lg }}>{header}</View>
          {children}
        </View>
      )}
    </SafeAreaView>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }, style]}>
      {children}
    </View>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function AppButton({
  label,
  onPress,
  icon,
  variant = 'primary',
  disabled,
  loading,
  compact,
  style,
}: {
  label: string;
  onPress: () => void;
  icon?: IconName;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const palette: Record<ButtonVariant, { bg: string; fg: string; border: string }> = {
    primary: { bg: colors.primary, fg: colors.onPrimary, border: colors.primary },
    secondary: { bg: colors.primarySoft, fg: colors.primary, border: 'transparent' },
    ghost: { bg: 'transparent', fg: colors.text, border: colors.border },
    danger: { bg: colors.dangerSoft, fg: colors.danger, border: 'transparent' },
  };
  const p = palette[variant];
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!inactive }}
      onPress={onPress}
      disabled={inactive}
      android_ripple={{ color: 'rgba(255,255,255,0.12)' }}
      style={({ pressed }) => [
        styles.button,
        compact && styles.buttonCompact,
        { backgroundColor: p.bg, borderColor: p.border, opacity: inactive ? 0.5 : pressed ? 0.85 : 1 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={p.fg} />
      ) : icon ? (
        <Ionicons name={icon} size={compact ? 16 : 18} color={p.fg} />
      ) : null}
      <Text style={[styles.buttonLabel, compact && { fontSize: 13 }, { color: p.fg }]}>{label}</Text>
    </Pressable>
  );
}

export function IconButton({
  icon,
  onPress,
  label,
  color,
}: {
  icon: IconName;
  onPress: () => void;
  label: string;
  color?: string;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [
        styles.iconButton,
        { backgroundColor: colors.cardElevated, opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <Ionicons name={icon} size={18} color={color ?? colors.textMuted} />
    </Pressable>
  );
}

export function ProgressBar({ progress, color }: { progress: number; color?: string }) {
  const { colors } = useTheme();
  const pct = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  return (
    <View style={[styles.progressTrack, { backgroundColor: colors.cardElevated }]}>
      <View
        style={[styles.progressFill, { width: `${pct * 100}%`, backgroundColor: color ?? colors.primary }]}
      />
    </View>
  );
}

export type Tone = 'primary' | 'success' | 'warning' | 'danger' | 'neutral';

export function Badge({ label, tone = 'neutral', icon }: { label: string; tone?: Tone; icon?: IconName }) {
  const { colors } = useTheme();
  const map: Record<Tone, { bg: string; fg: string }> = {
    primary: { bg: colors.primarySoft, fg: colors.primary },
    success: { bg: colors.successSoft, fg: colors.success },
    warning: { bg: colors.warningSoft, fg: colors.warning },
    danger: { bg: colors.dangerSoft, fg: colors.danger },
    neutral: { bg: colors.cardElevated, fg: colors.textMuted },
  };
  const t = map[tone];
  return (
    <View style={[styles.badge, { backgroundColor: t.bg }]}>
      {icon ? <Ionicons name={icon} size={12} color={t.fg} /> : null}
      <Text style={[typography.caption, { color: t.fg }]}>{label}</Text>
    </View>
  );
}

export function EmptyState({ icon, title, message }: { icon: IconName; title: string; message: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.empty}>
      <View style={[styles.emptyIcon, { backgroundColor: colors.primarySoft }]}>
        <Ionicons name={icon} size={28} color={colors.primary} />
      </View>
      <Text style={[typography.heading, { color: colors.text, marginTop: spacing.md }]}>{title}</Text>
      <Text style={[typography.small, { color: colors.textMuted, textAlign: 'center', marginTop: 4 }]}>
        {message}
      </Text>
    </View>
  );
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.segment, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(o.value)}
            style={[styles.segmentItem, active && { backgroundColor: colors.primary }]}
          >
            <Text
              style={[
                typography.caption,
                { color: active ? colors.onPrimary : colors.textMuted, fontSize: 13 },
              ]}
            >
              {o.label}
              {o.count !== undefined ? ` · ${o.count}` : ''}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function SectionLabel({ children, style }: { children: string; style?: StyleProp<TextStyle> }) {
  const { colors } = useTheme();
  return (
    <Text
      style={[
        typography.caption,
        { color: colors.textFaint, textTransform: 'uppercase', marginBottom: spacing.sm },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

export function Notice({
  tone,
  icon,
  title,
  message,
}: {
  tone: Exclude<Tone, 'neutral'>;
  icon: IconName;
  title: string;
  message?: string;
}) {
  const { colors } = useTheme();
  const map = {
    primary: [colors.primarySoft, colors.primary],
    success: [colors.successSoft, colors.success],
    warning: [colors.warningSoft, colors.warning],
    danger: [colors.dangerSoft, colors.danger],
  } as const;
  const [bg, fg] = map[tone];
  return (
    <View style={[styles.notice, { backgroundColor: bg }]}>
      <Ionicons name={icon} size={20} color={fg} style={{ marginTop: 1 }} />
      <View style={{ flex: 1 }}>
        <Text style={[typography.heading, { color: fg, fontSize: 14 }]}>{title}</Text>
        {message ? (
          <Text style={[typography.small, { color: colors.text, marginTop: 2 }]}>{message}</Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.md,
  },
  scrollContent: { paddingHorizontal: spacing.lg, paddingBottom: 40 },
  card: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, padding: spacing.lg },
  button: {
    minHeight: 48,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    overflow: 'hidden',
  },
  buttonCompact: { minHeight: 36, paddingHorizontal: spacing.md, borderRadius: radius.sm },
  buttonLabel: { fontSize: 15, fontWeight: '600' },
  iconButton: { width: 36, height: 36, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  progressTrack: { height: 6, borderRadius: radius.pill, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: radius.pill },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  empty: { alignItems: 'center', paddingVertical: 48, paddingHorizontal: spacing.xl },
  emptyIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  segment: { flexDirection: 'row', borderRadius: radius.md, padding: 4, borderWidth: StyleSheet.hairlineWidth },
  segmentItem: { flex: 1, paddingVertical: 8, borderRadius: radius.sm, alignItems: 'center' },
  notice: { flexDirection: 'row', gap: spacing.md, padding: spacing.md, borderRadius: radius.md },
});
