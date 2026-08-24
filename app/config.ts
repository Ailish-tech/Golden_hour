// ============================================================================
// SAMARITAN SHIELD — Client Configuration
// ============================================================================

import { Platform } from 'react-native';

/**
 * Backend base URL.
 *
 * Set EXPO_PUBLIC_API_URL for device and deployed builds — a physical phone
 * cannot reach the bundler host's `localhost`, so this must point at a LAN IP
 * or a real hostname. The localhost default only serves web development.
 */
export const API_BASE: string =
  process.env.EXPO_PUBLIC_API_URL ||
  (Platform.OS === 'web' ? 'http://localhost:3000' : '');

/**
 * Run without Firebase, using a local stand-in identity.
 *
 * The server has a matching opt-in (ALLOW_INSECURE_NO_AUTH); with both set,
 * the whole product runs locally with no Firebase project configured. Neither
 * side verifies anything, so this is for development only.
 */
export const LOCAL_DEV_AUTH: boolean =
  process.env.EXPO_PUBLIC_ALLOW_INSECURE_NO_AUTH === 'true';

export function assertApiConfigured(): void {
  if (!API_BASE) {
    throw new Error(
      'EXPO_PUBLIC_API_URL is not set. A device build cannot reach localhost — ' +
        'point it at your machine\'s LAN address or a deployed backend.'
    );
  }
}
