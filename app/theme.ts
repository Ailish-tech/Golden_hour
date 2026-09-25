// ============================================================================
// SAMARITAN SHIELD — Modern Emergency Design System Tokens
// Inspired by clean iOS safety HUDs and modern emergency response interfaces.
// ============================================================================

import { Platform } from 'react-native';

export const color = {
  /** Page ground & surfaces */
  ground: '#F6F8FA',
  groundDeep: '#EEF2F6',
  surface: '#FFFFFF',
  surfaceMuted: '#F8FAFC',
  surfaceElevated: '#FFFFFF',

  /** Borders & dividers */
  hairline: '#E2E8F0',
  hairlineStrong: '#CBD5E1',

  /** High-contrast legible text */
  text: '#0F172A',
  textMuted: '#475569',
  textFaint: '#94A3B8',

  /** Emergency & Alert (Crimson / Coral from concept reference) */
  signal: '#FF3B5C',
  signalLift: '#FF5975',
  signalDeep: '#E11D48',
  urgent: '#FF3B5C',
  signalWash: 'rgba(255, 59, 92, 0.12)',
  signalWashDeep: 'rgba(255, 59, 92, 0.22)',

  /** Safety / Radar Palette (Mint & Emerald from reference 1) */
  radarGround: '#E2F7EB',
  radarMint: '#A7F3D0',
  radarCenter: '#6EE7B7',
  radarSweep: 'rgba(16, 185, 129, 0.35)',
  radarRing: 'rgba(16, 185, 129, 0.25)',
  confirm: '#10B981',
  confirmWash: 'rgba(16, 185, 129, 0.14)',

  /** Secondary Accents */
  amber: '#F59E0B',
  amberWash: 'rgba(245, 158, 11, 0.14)',
  blue: '#3B82F6',
  blueWash: 'rgba(59, 130, 246, 0.12)',
  purple: '#8B5CF6',
  purpleWash: 'rgba(139, 92, 246, 0.12)',

  onSignal: '#FFFFFF',
  onAmber: '#0F172A',
  onConfirm: '#FFFFFF',
} as const;

export const font = {
  display: Platform.select({
    web: "'Plus Jakarta Sans', 'Bricolage Grotesque', system-ui, -apple-system, sans-serif",
    default: 'System',
  }) as string,
  body: Platform.select({
    web: "'Plus Jakarta Sans', 'Instrument Sans', system-ui, -apple-system, sans-serif",
    default: 'System',
  }) as string,
  mono: Platform.select({
    web: "'JetBrains Mono', 'DM Mono', ui-monospace, monospace",
    default: 'monospace',
  }) as string,
} as const;

export const tracking = {
  display: -0.8,
  heading: -0.4,
  body: 0,
  label: 0.8,
} as const;

export const radius = {
  xs: 6,
  sm: 10,
  md: 14,
  lg: 18,
  xl: 24,
  xxl: 32,
  pill: 999,
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 22,
  xxl: 30,
} as const;

export const HIT = 44;

export const shadow = {
  signal: {
    shadowColor: '#FF3B5C',
    shadowOpacity: 0.35,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  card: {
    shadowColor: '#0F172A',
    shadowOpacity: 0.06,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  soft: {
    shadowColor: '#0F172A',
    shadowOpacity: 0.04,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  radar: {
    shadowColor: '#10B981',
    shadowOpacity: 0.25,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
} as const;

export const WEB_FONT_HREF =
  'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap';

