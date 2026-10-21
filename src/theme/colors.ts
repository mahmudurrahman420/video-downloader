export type ThemeMode = 'system' | 'dark' | 'light';

export interface Palette {
  background: string;
  surface: string;
  card: string;
  cardElevated: string;
  border: string;
  text: string;
  textMuted: string;
  textFaint: string;
  primary: string;
  primarySoft: string;
  onPrimary: string;
  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  danger: string;
  dangerSoft: string;
  inputBackground: string;
  tabBar: string;
}

export const darkPalette: Palette = {
  background: '#0A1120',
  surface: '#0F1A2E',
  card: '#14213A',
  cardElevated: '#1A2A48',
  border: '#22355A',
  text: '#E9EFFA',
  textMuted: '#93A3C2',
  textFaint: '#5F7194',
  primary: '#4D8DFF',
  primarySoft: 'rgba(77,141,255,0.14)',
  onPrimary: '#FFFFFF',
  success: '#34D399',
  successSoft: 'rgba(52,211,153,0.14)',
  warning: '#F5B942',
  warningSoft: 'rgba(245,185,66,0.14)',
  danger: '#F87171',
  dangerSoft: 'rgba(248,113,113,0.14)',
  inputBackground: '#0D1729',
  tabBar: '#0D1729',
};

export const lightPalette: Palette = {
  background: '#F3F6FC',
  surface: '#FFFFFF',
  card: '#FFFFFF',
  cardElevated: '#F7F9FD',
  border: '#DCE4F2',
  text: '#0B1427',
  textMuted: '#55658A',
  textFaint: '#8A97B4',
  primary: '#2563EB',
  primarySoft: 'rgba(37,99,235,0.10)',
  onPrimary: '#FFFFFF',
  success: '#059669',
  successSoft: 'rgba(5,150,105,0.10)',
  warning: '#B7791F',
  warningSoft: 'rgba(183,121,31,0.12)',
  danger: '#DC2626',
  dangerSoft: 'rgba(220,38,38,0.10)',
  inputBackground: '#F3F6FC',
  tabBar: '#FFFFFF',
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28 } as const;
export const radius = { sm: 8, md: 12, lg: 16, xl: 22, pill: 999 } as const;

export const typography = {
  display: { fontSize: 28, fontWeight: '700' as const, letterSpacing: -0.4 },
  title: { fontSize: 20, fontWeight: '700' as const, letterSpacing: -0.2 },
  heading: { fontSize: 16, fontWeight: '600' as const },
  body: { fontSize: 15, fontWeight: '400' as const, lineHeight: 21 },
  small: { fontSize: 13, fontWeight: '400' as const, lineHeight: 18 },
  caption: { fontSize: 12, fontWeight: '500' as const, letterSpacing: 0.2 },
};
