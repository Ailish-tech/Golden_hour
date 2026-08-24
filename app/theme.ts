// ============================================================================
// SAMARITAN SHIELD — "Signal" design tokens
//
// One source for colour, type and spacing. Values are literal rather than
// derived so they survive a copy into a mockup or a spec, and they are the
// same numbers the design canvas uses.
//
// Colours were mixed in oklch and converted to hex here: React Native's
// StyleSheet does not accept oklch(), and the web build has to match native.
// ============================================================================

import { Platform } from 'react-native';

export const color = {
  /** Page ground — warm near-black, not neutral slate. */
  ground: '#231512',
  groundDeep: '#1d1110',
  /** Raised surfaces: cards, inputs, list rows. */
  surface: '#33211c',
  surfaceMuted: '#2b1b17',
  /** Borders. Hairline is the default; strong marks a focused element. */
  hairline: '#4d332b',
  hairlineStrong: '#5f4038',

  text: '#f7ece6',
  textMuted: '#c0a99f',
  textFaint: '#9b857c',

  /** The one signal colour. `signal` for fills, `signalLift` for gradient tops. */
  signal: '#e0442b',
  signalLift: '#f4643f',
  signalDeep: '#a8321f',
  signalWash: 'rgba(224, 68, 43, 0.14)',

  /** Secondary accent — data, progress, the affirmative action on dark. */
  amber: '#f2a03d',
  amberWash: 'rgba(242, 160, 61, 0.13)',
  confirm: '#4ade9a',
  confirmWash: 'rgba(74, 222, 154, 0.13)',

  onSignal: '#ffffff',
  onAmber: '#231512',
} as const;

export const font = {
  /** Headlines and numerals that carry a screen. */
  display: Platform.select({
    web: "'Bricolage Grotesque', 'Helvetica Neue', sans-serif",
    default: 'System',
  }) as string,
  /** Body copy and controls. */
  body: Platform.select({
    web: "'Instrument Sans', 'Helvetica Neue', sans-serif",
    default: 'System',
  }) as string,
  /** Anything numeric: hashes, coordinates, counts, ETAs. */
  mono: Platform.select({
    web: "'DM Mono', ui-monospace, monospace",
    default: 'monospace',
  }) as string,
} as const;

/** Tracking is part of the type, not decoration — display type is tight. */
export const tracking = {
  display: -1.2,
  heading: -0.5,
  body: 0,
  label: 1.4,
} as const;

export const radius = {
  sm: 9,
  md: 13,
  lg: 15,
  xl: 19,
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

/** Minimum touch target. Non-negotiable: this is used one-handed under stress. */
export const HIT = 44;

export const shadow = {
  signal: {
    shadowColor: '#e0442b',
    shadowOpacity: 0.5,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 14 },
    elevation: 12,
  },
  card: {
    shadowColor: '#000000',
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 5,
  },
} as const;

/** Google Fonts for the web build; native falls back to the system face. */
export const WEB_FONT_HREF =
  'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700;12..96,800&family=Instrument+Sans:wght@400;500;600;700&family=DM+Mono:wght@400;500&display=swap';
