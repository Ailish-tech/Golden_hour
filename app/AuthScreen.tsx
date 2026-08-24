// ============================================================================
// SAMARITAN SHIELD — Authentication Portal (AuthScreen.tsx)
//
// The portal tab below is a statement of intent, not a grant. Hospital access
// exposes live victim coordinates, so it is provisioned by an administrator
// against the staff allowlist; the backend returns the role it actually holds.
// ============================================================================

import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Platform,
  ActivityIndicator,
  ViewStyle,
  TextStyle,
} from 'react-native';
import { AUTH_MODE } from './config';
import {
  loginWithEmail,
  registerWithEmail,
  loginWithGoogle,
  type UserRole,
  type AppUserProfile,
} from './firebaseConfig';

interface AuthScreenProps {
  onLoginSuccess: (profile: AppUserProfile) => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({ onLoginSuccess }) => {
  const [selectedRole, setSelectedRole] = useState<UserRole>('citizen');
  const [isSignUp, setIsSignUp] = useState<boolean>(false);
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [gpsStatus, setGpsStatus] = useState<string>('ACQUIRING...');

  // ---------------------------------------------------------------------------
  // Capture GPS on mount — needed for hospital nearest-resolution
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserCoords({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          });
          setGpsStatus('LOCKED');
        },
        (_err) => {
          // Fallback to Jaipur coords for demo
          setUserCoords({ lat: 26.9090, lng: 75.7325 });
          setGpsStatus('FALLBACK');
        },
        { enableHighAccuracy: true, timeout: 8000 }
      );
    } else {
      // Non-web or no geolocation — use fallback
      setUserCoords({ lat: 26.9090, lng: 75.7325 });
      setGpsStatus('FALLBACK');
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Auth Flow — the backend resolves role; the tab above only sets expectation
  // ---------------------------------------------------------------------------
  const applyProfile = (profile: AppUserProfile) => {
    if (selectedRole === 'hospital' && profile.role !== 'hospital') {
      setErrorMsg(
        'This account does not have hospital CAD access. An administrator must ' +
          'grant it before you can view the live incident feed. Signing you in as a citizen responder.'
      );
    }
    onLoginSuccess(profile);
  };

  const runAuth = async (action: () => Promise<AppUserProfile>) => {
    setErrorMsg('');
    setLoading(true);
    try {
      applyProfile(await action());
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!email || !password) {
      setErrorMsg('Please enter both email and password.');
      return;
    }
    if (password.length < 6) {
      setErrorMsg('Password must be at least 6 characters.');
      return;
    }
    const coords = userCoords || undefined;
    await runAuth(() =>
      isSignUp ? registerWithEmail(email, password, coords) : loginWithEmail(email, password, coords)
    );
  };

  const handleGoogleLogin = async () => {
    if (Platform.OS !== 'web') {
      setErrorMsg('Google Sign-In is only supported on web in this configuration.');
      return;
    }
    await runAuth(() => loginWithGoogle(userCoords || undefined));
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      {/* Top Identity Header */}
      <View style={styles.header}>
        <View style={styles.logoBadge}>
          <Text style={styles.logoEmoji}>🛡️</Text>
        </View>
        <Text style={styles.appTitle}>SAMARITAN_SHIELD</Text>
        <Text style={styles.appSubtitle}>
          National Emergency CAD & Good Samaritan Legal Protection System
        </Text>
      </View>

      {AUTH_MODE === 'local' && (
        <View style={styles.localAuthBanner}>
          <Text style={styles.localAuthTitle}>LOCAL SIGN-IN MODE</Text>
          <Text style={styles.localAuthText}>
            Firebase is not configured, so passwords are not checked and identities are not
            verified. Sign in with any email and a 6+ character password.
          </Text>
        </View>
      )}

      {/* GPS Status Indicator */}
      <View style={styles.gpsCard}>
        <View style={styles.gpsRow}>
          <View style={[styles.gpsDot, gpsStatus === 'LOCKED' ? styles.gpsDotGreen : styles.gpsDotYellow]} />
          <Text style={styles.gpsText}>
            GPS: {gpsStatus === 'LOCKED' ? `LOCKED (${userCoords?.lat.toFixed(4)}°N, ${userCoords?.lng.toFixed(4)}°E)` :
                  gpsStatus === 'FALLBACK' ? 'DEMO MODE (Jaipur)' : 'ACQUIRING SATELLITE FIX...'}
          </Text>
        </View>
      </View>

      {/* Role Selector Tabs */}
      <View style={styles.roleCard}>
        <Text style={styles.roleCardTitle}>SELECT YOUR ACCESS PORTAL</Text>
        <View style={styles.roleTabsRow}>
          {/* Citizen Tab */}
          <TouchableOpacity
            style={[styles.roleTab, selectedRole === 'citizen' && styles.roleTabActiveCitizen]}
            onPress={() => {
              setSelectedRole('citizen');
              setErrorMsg('');
            }}
            activeOpacity={0.8}
          >
            <Text style={styles.roleTabEmoji}>🚨</Text>
            <Text
              style={[
                styles.roleTabText,
                selectedRole === 'citizen' && styles.roleTabTextActiveCitizen,
              ]}
            >
              CITIZEN
            </Text>
            <Text style={styles.roleTabSub}>First-Responder</Text>
          </TouchableOpacity>

          {/* Hospital Dispatcher Tab */}
          <TouchableOpacity
            style={[styles.roleTab, selectedRole === 'hospital' && styles.roleTabActiveHospital]}
            onPress={() => {
              setSelectedRole('hospital');
              setErrorMsg('');
            }}
            activeOpacity={0.8}
          >
            <Text style={styles.roleTabEmoji}>🏥</Text>
            <Text
              style={[
                styles.roleTabText,
                selectedRole === 'hospital' && styles.roleTabTextActiveHospital,
              ]}
            >
              HOSPITAL CAD
            </Text>
            <Text style={styles.roleTabSub}>Trauma Dispatch</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Hospital access is provisioned, not selected */}
      {selectedRole === 'hospital' && (
        <View style={styles.hospitalPickerCard}>
          <Text style={styles.fieldLabel}>HOSPITAL CAD ACCESS</Text>
          <Text style={styles.hospitalAutoNote}>
            🔒 Access to the live incident feed is granted by an administrator against your
            hospital's staff allowlist, and your desk is bound to that hospital. Sign in with
            the account that was allowlisted — there is nothing to select here.
          </Text>
        </View>
      )}

      {/* Credentials Input Card */}
      <View style={styles.authCard}>
        <Text style={styles.authCardTitle}>
          {isSignUp ? 'CREATE ENCRYPTED ACCOUNT' : 'AUTHENTICATE ACCESS'}
        </Text>

        {errorMsg ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>⚠️ {errorMsg}</Text>
          </View>
        ) : null}

        {/* Email Field */}
        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>
            {selectedRole === 'hospital' ? 'OFFICIAL HOSPITAL / GOVT EMAIL' : 'EMAIL ADDRESS'}
          </Text>
          <TextInput
            style={styles.textInput}
            value={email}
            onChangeText={setEmail}
            placeholder={
              selectedRole === 'hospital'
                ? 'trauma.cad@hospital.org'
                : 'responder@example.com'
            }
            placeholderTextColor="#475569"
            keyboardType="email-address"
            autoCapitalize="none"
          />
        </View>

        {/* Password Field */}
        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>PASSWORD</Text>
          <TextInput
            style={styles.textInput}
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••••••"
            placeholderTextColor="#475569"
            secureTextEntry
          />
        </View>

        {/* Submit Button */}
        <TouchableOpacity
          style={[
            styles.submitBtn,
            selectedRole === 'hospital' ? styles.submitBtnHospital : styles.submitBtnCitizen,
          ]}
          onPress={handleSubmit}
          disabled={loading}
          activeOpacity={0.8}
        >
          {loading ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.submitBtnText}>
              {isSignUp ? 'CREATE ACCOUNT & ENTER' : 'SIGN IN SECURELY ➔'}
            </Text>
          )}
        </TouchableOpacity>

        {/* Google Sign-In Button (Web Only) */}
        {Platform.OS === 'web' && (
          <TouchableOpacity
            style={styles.googleBtn}
            onPress={handleGoogleLogin}
            disabled={loading}
            activeOpacity={0.8}
          >
            <Text style={styles.googleBtnText}>🌐 SIGN IN WITH GOOGLE</Text>
          </TouchableOpacity>
        )}

        {/* Toggle Sign In / Sign Up */}
        <TouchableOpacity
          style={styles.toggleAuthRow}
          onPress={() => {
            setIsSignUp(!isSignUp);
            setErrorMsg('');
          }}
        >
          <Text style={styles.toggleAuthText}>
            {isSignUp
              ? 'Already have credentials? Sign In'
              : "Don't have an account yet? Sign Up"}
          </Text>
        </TouchableOpacity>
      </View>

    </ScrollView>
  );
};

export default AuthScreen;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a14',
  } as ViewStyle,
  scrollContent: {
    padding: 20,
    paddingBottom: 50,
    maxWidth: 540,
    width: '100%',
    alignSelf: 'center',
  } as ViewStyle,

  header: {
    alignItems: 'center',
    marginBottom: 20,
    marginTop: 10,
  } as ViewStyle,
  logoBadge: {
    width: 60,
    height: 60,
    borderRadius: 16,
    backgroundColor: '#0f172a',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#38bdf8',
    marginBottom: 10,
    shadowColor: '#38bdf8',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
  } as ViewStyle,
  logoEmoji: {
    fontSize: 30,
  } as TextStyle,
  appTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: '#8ed5ff',
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
    letterSpacing: 2,
    marginBottom: 4,
  } as TextStyle,
  appSubtitle: {
    fontSize: 11,
    color: '#94a3b8',
    textAlign: 'center',
    lineHeight: 16,
  } as TextStyle,

  // GPS Status Card
  localAuthBanner: {
    backgroundColor: '#3b2405',
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1.5,
    borderColor: '#eab308',
  } as ViewStyle,
  localAuthTitle: {
    fontSize: 11,
    fontWeight: '900',
    color: '#facc15',
    letterSpacing: 1,
    marginBottom: 5,
  } as TextStyle,
  localAuthText: {
    fontSize: 11,
    color: '#fde68a',
    lineHeight: 16,
  } as TextStyle,

  gpsCard: {
    backgroundColor: '#0f172a',
    borderRadius: 10,
    padding: 10,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#1e293b',
  } as ViewStyle,
  gpsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  } as ViewStyle,
  gpsDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  } as ViewStyle,
  gpsDotGreen: {
    backgroundColor: '#22c55e',
  } as ViewStyle,
  gpsDotYellow: {
    backgroundColor: '#eab308',
  } as ViewStyle,
  gpsText: {
    fontSize: 10,
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
    fontWeight: '800',
    color: '#94a3b8',
    letterSpacing: 0.5,
  } as TextStyle,

  // Role Selector Card
  roleCard: {
    backgroundColor: '#111827',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1.5,
    borderColor: '#1e293b',
  } as ViewStyle,
  roleCardTitle: {
    fontSize: 11,
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
    fontWeight: '800',
    color: '#8ed5ff',
    letterSpacing: 1,
    marginBottom: 12,
    textAlign: 'center',
  } as TextStyle,
  roleTabsRow: {
    flexDirection: 'row',
    gap: 12,
  } as ViewStyle,
  roleTab: {
    flex: 1,
    backgroundColor: '#0a0f1d',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#1e293b',
  } as ViewStyle,
  roleTabActiveCitizen: {
    backgroundColor: '#261215',
    borderColor: '#ef4444',
  } as ViewStyle,
  roleTabActiveHospital: {
    backgroundColor: '#0c2438',
    borderColor: '#38bdf8',
  } as ViewStyle,
  roleTabEmoji: {
    fontSize: 24,
    marginBottom: 4,
  } as TextStyle,
  roleTabText: {
    fontSize: 13,
    fontWeight: '900',
    color: '#94a3b8',
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
    letterSpacing: 1,
  } as TextStyle,
  roleTabTextActiveCitizen: {
    color: '#f87171',
  } as TextStyle,
  roleTabTextActiveHospital: {
    color: '#38bdf8',
  } as TextStyle,
  roleTabSub: {
    fontSize: 10,
    color: '#64748b',
    marginTop: 2,
  } as TextStyle,

  // Hospital Picker Card
  hospitalPickerCard: {
    backgroundColor: '#0f172a',
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1.5,
    borderColor: '#253b5e',
  } as ViewStyle,
  fieldLabel: {
    fontSize: 10,
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
    fontWeight: '800',
    color: '#38bdf8',
    letterSpacing: 1,
    marginBottom: 6,
  } as TextStyle,
  hospitalAutoNote: {
    fontSize: 10,
    color: '#94a3b8',
    marginBottom: 10,
    lineHeight: 14,
  } as TextStyle,
  hospitalList: {
    gap: 8,
  } as ViewStyle,
  hospitalItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#162032',
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: '#24344d',
  } as ViewStyle,
  hospitalItemActive: {
    backgroundColor: '#102a45',
    borderColor: '#38bdf8',
  } as ViewStyle,
  hospitalName: {
    fontSize: 12,
    fontWeight: '800',
    color: '#cbd5e1',
  } as TextStyle,
  hospitalNameActive: {
    color: '#ffffff',
  } as TextStyle,
  hospitalCity: {
    fontSize: 10,
    color: '#64748b',
    marginTop: 2,
  } as TextStyle,
  radioIcon: {
    fontSize: 16,
    color: '#475569',
    marginLeft: 8,
  } as TextStyle,
  radioIconActive: {
    color: '#38bdf8',
  } as TextStyle,

  // Credentials Auth Card
  authCard: {
    backgroundColor: '#111827',
    borderRadius: 16,
    padding: 18,
    marginBottom: 16,
    borderWidth: 1.5,
    borderColor: '#1e293b',
  } as ViewStyle,
  authCardTitle: {
    fontSize: 13,
    fontWeight: '900',
    color: '#ffffff',
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
    letterSpacing: 1,
    marginBottom: 14,
    textAlign: 'center',
  } as TextStyle,
  errorBanner: {
    backgroundColor: '#3b1216',
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#ef4444',
  } as ViewStyle,
  errorText: {
    fontSize: 11,
    color: '#fca5a5',
    fontWeight: '700',
  } as TextStyle,

  inputGroup: {
    marginBottom: 14,
  } as ViewStyle,
  inputLabel: {
    fontSize: 10,
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
    fontWeight: '800',
    color: '#94a3b8',
    letterSpacing: 0.8,
    marginBottom: 6,
  } as TextStyle,
  textInput: {
    backgroundColor: '#0a0f1d',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#ffffff',
    fontSize: 14,
    borderWidth: 1,
    borderColor: '#1e293b',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
  } as TextStyle,

  submitBtn: {
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 12,
  } as ViewStyle,
  submitBtnCitizen: {
    backgroundColor: '#b91c1c',
  } as ViewStyle,
  submitBtnHospital: {
    backgroundColor: '#0369a1',
  } as ViewStyle,
  submitBtnText: {
    fontSize: 13,
    fontWeight: '900',
    color: '#ffffff',
    letterSpacing: 1.5,
  } as TextStyle,

  googleBtn: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#38bdf8',
  } as ViewStyle,
  googleBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#38bdf8',
    letterSpacing: 1,
  } as TextStyle,

  toggleAuthRow: {
    alignItems: 'center',
    paddingVertical: 4,
  } as ViewStyle,
  toggleAuthText: {
    fontSize: 11,
    color: '#38bdf8',
    fontWeight: '600',
  } as TextStyle,

  // Demo Card
  demoCard: {
    backgroundColor: '#0c1322',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#1e293b',
  } as ViewStyle,
  demoCardTitle: {
    fontSize: 10,
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
    fontWeight: '800',
    color: '#facc15',
    letterSpacing: 1,
    marginBottom: 10,
    textAlign: 'center',
  } as TextStyle,
  demoButtonsRow: {
    gap: 8,
  } as ViewStyle,
  demoCitizenBtn: {
    backgroundColor: '#1f1317',
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#ef4444',
  } as ViewStyle,
  demoHospitalBtn: {
    backgroundColor: '#0f1f2e',
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#38bdf8',
  } as ViewStyle,
  demoBtnText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: 1,
  } as TextStyle,
});
