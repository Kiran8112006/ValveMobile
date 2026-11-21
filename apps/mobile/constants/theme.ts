export const colors = {
  background: '#F3F7F7',
  surface: '#FFFFFF',
  surfaceMuted: '#EAF1F1',
  ink: '#0F2B2F',
  muted: '#5B7275',
  faint: '#8CA0A2',
  primary: '#0B6E75',
  primaryPressed: '#08575C',
  primarySoft: '#DCEFEF',
  accent: '#1C9AA1',
  danger: '#B23A2E',
  dangerSoft: '#F8E5E2',
  success: '#1D7A4C',
  successSoft: '#DDF0E5',
  warning: '#9C6B12',
  warningSoft: '#F7EDD8',
  border: '#DCE7E7',
  disabled: '#B7C5C5',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
} as const;

export const radius = {
  sm: 10,
  md: 14,
  lg: 20,
  xl: 28,
  pill: 999,
} as const;

export const typography = {
  display: 40,
  title: 26,
  heading: 20,
  body: 16,
  small: 14,
  tiny: 12,
} as const;
