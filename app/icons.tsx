// ============================================================================
// SAMARITAN SHIELD — Icon set
//
// Drawn on a 24px grid at 2px stroke, in one consistent style. These replace
// the emoji the interface used to use: emoji render differently on every
// platform, cannot take a brand colour, and cannot be sized reliably — which
// is why an emoji interface reads as unfinished regardless of the palette.
//
// Every icon takes `size` and `color` and inherits nothing, so a caller always
// gets exactly what it asked for.
// ============================================================================

import React from 'react';
import Svg, { Path, Circle, Rect } from 'react-native-svg';
import { color as tokens } from './theme';

export interface IconProps {
  size?: number;
  color?: string;
  strokeWidth?: number;
}

const Base: React.FC<IconProps & { children: React.ReactNode }> = ({
  size = 24,
  color = tokens.text,
  strokeWidth = 2,
  children,
}) => (
  <Svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {children}
  </Svg>
);

export const ShieldIcon: React.FC<IconProps> = (p) => (
  <Base {...p}>
    <Path d="M12 3 5 6v5.6c0 4.6 3 8 7 9.4 4-1.4 7-4.8 7-9.4V6l-7-3Z" />
  </Base>
);

export const ShieldCheckIcon: React.FC<IconProps> = (p) => (
  <Base {...p}>
    <Path d="M12 3 5 6v5.6c0 4.6 3 8 7 9.4 4-1.4 7-4.8 7-9.4V6l-7-3Z" />
    <Path d="m9.2 12 2 2 3.6-3.8" />
  </Base>
);

export const PinIcon: React.FC<IconProps> = (p) => (
  <Base {...p}>
    <Path d="M12 21s-7-5.2-7-10.6A7 7 0 0 1 19 10.4C19 15.8 12 21 12 21Z" />
    <Circle cx="12" cy="10.2" r="2.4" />
  </Base>
);

export const HospitalIcon: React.FC<IconProps> = (p) => (
  <Base {...p}>
    <Rect x="3.5" y="3.5" width="17" height="17" rx="3" />
    <Path d="M12 8v8M8 12h8" />
  </Base>
);

export const PhoneIcon: React.FC<IconProps> = (p) => (
  <Base {...p}>
    <Path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2.2 2A16 16 0 0 1 3 6.2 2 2 0 0 1 5 4Z" />
  </Base>
);

export const PulseIcon: React.FC<IconProps> = (p) => (
  <Base {...p}>
    <Path d="M3 12h3.5l2-6 3.5 12 2.5-6H21" />
  </Base>
);

export const BreathIcon: React.FC<IconProps> = (p) => (
  <Base {...p}>
    <Path d="M12 4v7" />
    <Path d="M12 11c0 4-2.5 6-5 6a3 3 0 0 1-3-3c0-3 2-5 4-6" />
    <Path d="M12 11c0 4 2.5 6 5 6a3 3 0 0 0 3-3c0-3-2-5-4-6" />
  </Base>
);

export const DropIcon: React.FC<IconProps> = (p) => (
  <Base {...p}>
    <Path d="M12 3.5s5.5 6 5.5 9.6a5.5 5.5 0 0 1-11 0C6.5 9.5 12 3.5 12 3.5Z" />
  </Base>
);

export const CheckIcon: React.FC<IconProps> = (p) => (
  <Base {...p}>
    <Circle cx="12" cy="12" r="8.5" />
    <Path d="m8.6 12 2.2 2.2 4.6-4.8" />
  </Base>
);

export const ClockIcon: React.FC<IconProps> = (p) => (
  <Base {...p}>
    <Circle cx="12" cy="12" r="8.5" />
    <Path d="M12 7.2V12l3.2 1.8" />
  </Base>
);

export const MapIcon: React.FC<IconProps> = (p) => (
  <Base {...p}>
    <Path d="M9 4 3.5 6.2v13.3L9 17.3l6 2.2 5.5-2.2V4L15 6.2 9 4Z" />
    <Path d="M9 4v13.3M15 6.2v13.3" />
  </Base>
);

export const DocumentIcon: React.FC<IconProps> = (p) => (
  <Base {...p}>
    <Path d="M13.5 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9l-5.5-5.5Z" />
    <Path d="M13.5 3.5V9H19M8.5 13.5h7M8.5 17h4.5" />
  </Base>
);

export const ScaleIcon: React.FC<IconProps> = (p) => (
  <Base {...p}>
    <Path d="M12 4v16M7 20h10" />
    <Path d="M12 7 5 9l2.6 4.6a3.4 3.4 0 0 0 4.8 0L12 7Z" />
    <Path d="m12 7 7 2-2.6 4.6a3.4 3.4 0 0 1-4.8 0" />
  </Base>
);

export const AmbulanceIcon: React.FC<IconProps> = (p) => (
  <Base {...p}>
    <Path d="M3 16V8a1.5 1.5 0 0 1 1.5-1.5h9V16" />
    <Path d="M13.5 9.5H18l3 3.5V16" />
    <Circle cx="7.5" cy="17.5" r="2" />
    <Circle cx="17" cy="17.5" r="2" />
    <Path d="M8.2 11.4h2.6M9.5 10.1v2.6" />
  </Base>
);

export const BedIcon: React.FC<IconProps> = (p) => (
  <Base {...p}>
    <Path d="M3 18v-7h13a4 4 0 0 1 4 4v3M3 13h17M3 8v5" />
    <Circle cx="7.5" cy="10" r="1.6" />
  </Base>
);

export const ArrowRightIcon: React.FC<IconProps> = (p) => (
  <Base {...p}>
    <Path d="M4.5 12h15M13 5.5l6.5 6.5L13 18.5" />
  </Base>
);

export const ChevronRightIcon: React.FC<IconProps> = (p) => (
  <Base {...p}>
    <Path d="m9 6 6 6-6 6" />
  </Base>
);

export const ChevronLeftIcon: React.FC<IconProps> = (p) => (
  <Base {...p}>
    <Path d="m15 6-6 6 6 6" />
  </Base>
);

export const CloseIcon: React.FC<IconProps> = (p) => (
  <Base {...p}>
    <Path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
  </Base>
);

export const DownloadIcon: React.FC<IconProps> = (p) => (
  <Base {...p}>
    <Path d="M12 15V4M8 8l4-4 4 4" />
    <Path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
  </Base>
);

export const LogoutIcon: React.FC<IconProps> = (p) => (
  <Base {...p}>
    <Path d="M14 5h4a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-4" />
    <Path d="M10 8 6 12l4 4M6 12h9" />
  </Base>
);

export const GridIcon: React.FC<IconProps> = (p) => (
  <Base {...p}>
    <Rect x="3.5" y="3.5" width="7" height="7" rx="1.6" />
    <Rect x="13.5" y="3.5" width="7" height="7" rx="1.6" />
    <Rect x="3.5" y="13.5" width="7" height="7" rx="1.6" />
    <Rect x="13.5" y="13.5" width="7" height="7" rx="1.6" />
  </Base>
);

export const WarningIcon: React.FC<IconProps> = (p) => (
  <Base {...p}>
    <Path d="M12 4.5 2.8 20h18.4L12 4.5Z" />
    <Path d="M12 10v4.2M12 17.2v.1" />
  </Base>
);

export const SearchIcon: React.FC<IconProps> = (p) => (
  <Base {...p}>
    <Circle cx="11" cy="11" r="7" />
    <Path d="m20 20-4.35-4.35" />
  </Base>
);

export const FilterIcon: React.FC<IconProps> = (p) => (
  <Base {...p}>
    <Path d="M4 6h16M7 12h10M10 18h4" />
  </Base>
);

export const MicIcon: React.FC<IconProps> = (p) => (
  <Base {...p}>
    <Path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
    <Path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4M8 22h8" />
  </Base>
);

export const BellIcon: React.FC<IconProps> = (p) => (
  <Base {...p}>
    <Path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <Path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </Base>
);

export const SirenIcon: React.FC<IconProps> = (p) => (
  <Base {...p}>
    <Path d="M6 18h12M7 18v-5a5 5 0 0 1 10 0v5M12 3v3M4 6l2.5 2M20 6l-2.5 2" />
  </Base>
);

export const FlameIcon: React.FC<IconProps> = (p) => (
  <Base {...p}>
    <Path d="M8.5 14.5A4.5 4.5 0 0 0 13 19a4.5 4.5 0 0 0 4.5-4.5c0-4-3.5-6-4.5-9.5-1 3.5-4.5 5.5-4.5 9.5Z" />
  </Base>
);

export const CarCrashIcon: React.FC<IconProps> = (p) => (
  <Base {...p}>
    <Path d="M4 14h11l3-4H6l-2 4ZM6 18h2M14 18h2" />
    <Path d="M18 10l3-3M21 11l2-1" />
  </Base>
);

export const RadioIcon: React.FC<IconProps> = (p) => (
  <Base {...p}>
    <Circle cx="12" cy="12" r="2" />
    <Path d="M16.24 7.76a6 6 0 0 1 0 8.49M7.76 16.24a6 6 0 0 1 0-8.49" />
    <Path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 19.07a10 10 0 0 1 0-14.14" />
  </Base>
);

export const CompassIcon: React.FC<IconProps> = (p) => (
  <Base {...p}>
    <Circle cx="12" cy="12" r="9" />
    <Path d="m14.5 9.5-5 2 2 5 3-7Z" />
  </Base>
);

export const CommunityIcon: React.FC<IconProps> = (p) => (
  <Base {...p}>
    <Circle cx="8" cy="9" r="3" />
    <Circle cx="16" cy="9" r="3" />
    <Path d="M4 19a4 4 0 0 1 8 0M12 19a4 4 0 0 1 8 0" />
  </Base>
);

export const ShareIcon: React.FC<IconProps> = (p) => (
  <Base {...p}>
    <Circle cx="18" cy="5" r="3" />
    <Circle cx="6" cy="12" r="3" />
    <Circle cx="18" cy="19" r="3" />
    <Path d="m8.59 13.51 6.83 3.98M15.41 6.51l-6.82 3.98" />
  </Base>
);

export const QrCodeIcon: React.FC<IconProps> = (p) => (
  <Base {...p}>
    <Rect x="3" y="3" width="7" height="7" rx="1.5" />
    <Rect x="5.5" y="5.5" width="2" height="2" />
    <Rect x="14" y="3" width="7" height="7" rx="1.5" />
    <Rect x="16.5" y="5.5" width="2" height="2" />
    <Rect x="3" y="14" width="7" height="7" rx="1.5" />
    <Rect x="5.5" y="16.5" width="2" height="2" />
    <Path d="M14 14h3v3h-3zM18 14h3v2h-3zM14 18h3v3h-3zM18 18h3v3h-3z" />
  </Base>
);

export const RefreshIcon: React.FC<IconProps> = (p) => (
  <Base {...p}>
    <Path d="M21 2v6h-6" />
    <Path d="M3 12a9 9 0 0 1 15.5-6.36L21 8" />
    <Path d="M3 22v-6h6" />
    <Path d="M21 12a9 9 0 0 1-15.5 6.36L3 16" />
  </Base>
);

