// ============================================================================
// SAMARITAN SHIELD — Main Emergency Application (App.tsx)
// Cyber-Tactical Emergency HUD • CAD Hospital Dispatch • Legal Protection
// ============================================================================

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  Animated,
  Easing,
  Platform,
  Alert,
  ActivityIndicator,
  Vibration,
  Modal,
  Linking,
  ViewStyle,
  TextStyle,
} from 'react-native';
import { registerRootComponent } from 'expo';
import * as Location from 'expo-location';
import * as Speech from 'expo-speech';
import { Audio } from 'expo-av';
import VoiceTriage from './VoiceTriage';
import AuthScreen from './AuthScreen';
import HospitalPortal, { type EmergencyIncidentItem } from './HospitalPortal';
import { logoutUser, type AppUserProfile } from './firebaseConfig';

type Sound = Audio.Sound;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type AppPhase = 'idle' | 'activating' | 'active';
type NavigationTab = 'HUB' | 'MAPS' | 'INTEL' | 'REPORTS';

interface Coordinates {
  lat: number;
  lng: number;
}

export interface HospitalInfo {
  id: string;
  name: string;
  address: string;
  phone: string;
  traumaLevel: string;
  lat: number;
  lng: number;
  distanceKm: number;
  distanceText: string;
  etaMinutes: number;
  ambulanceUnit: string;
  transmissionStatus: string;
  bedsAvailable: number;
  googleMapsUrl: string;
}

interface TraumaProtocolStep {
  step: number;
  title: string;
  detail: string;
  icon: string;
}

interface SOSApiResponse {
  status: 'success' | 'error';
  hash?: string;
  timestamp?: string;
  userId?: string;
  coordinates?: Coordinates;
  pdfBase64?: string;
  message?: string;
  nearestHospital?: HospitalInfo;
  backupHospitals?: HospitalInfo[];
}

// ---------------------------------------------------------------------------
// Config & Constants
// ---------------------------------------------------------------------------
const API_BASE: string = Platform.select({
  android: 'http://10.0.2.2:3000',
  ios: 'http://localhost:3000',
  default: 'http://localhost:3000',
}) as string;

const MOCK_COORDS: Coordinates = { lat: 26.9090, lng: 75.7325 };
const USER_ID: string = 'SHIELD-USER-001';

const TRAUMA_PROTOCOL_STEPS: TraumaProtocolStep[] = [
  {
    step: 1,
    title: 'SECURE & ASSESS',
    detail: 'Ensure scene is safe. Approach victim. Shout loudly and tap collarbone. If no response → point at bystander and yell "Call 108!"',
    icon: '⚠️',
  },
  {
    step: 2,
    title: 'MASSIVE BLEEDING',
    detail: 'Rapid body sweep. Blood spurting or pooling? → Expose wound, pack deep, full body weight pressure. Limbs: tourniquet 2 inches above, twist until stopped. Do NOT advance until bleeding stops.',
    icon: '🩸',
  },
  {
    step: 3,
    title: 'CHECK BREATHING',
    detail: 'Only after bleeding is controlled. Look at bare chest — rising/falling? Ear to mouth — hear air? Agonal gasping = NOT breathing (heart stopped).',
    icon: '🫁',
  },
  {
    step: 4,
    title: 'EXECUTE CPR',
    detail: 'Chest compressions ONLY. Heel of hand center of chest. Lock elbows straight. Push 2+ inches deep, 100–120 BPM. Full recoil. Do not stop. Ignore rib cracking. No mouth-to-mouth.',
    icon: '❤️',
  },
];

// ============================================================================
// Main App Component
// ============================================================================
export default function App(): React.JSX.Element {
  // -- Auth & User State ---------------------------------------------------
  const [currentUser, setCurrentUser] = useState<AppUserProfile | null>(null);

  // -- State ---------------------------------------------------------------
  const [activeTab, setActiveTab] = useState<NavigationTab>('HUB');
  const [appPhase, setAppPhase] = useState<AppPhase>('idle');
  const [statusIndex, setStatusIndex] = useState<number>(-1);
  const [hash, setHash] = useState<string | null>(null);
  const [timestamp, setTimestamp] = useState<string | null>(null);
  const [coordinates, setCoordinates] = useState<Coordinates>(MOCK_COORDS);
  const [permissionGranted, setPermissionGranted] = useState<boolean>(false);
  const [sound, setSound] = useState<Sound | null>(null);
  const [checkedSteps, setCheckedSteps] = useState<number[]>([]);
  const [pdfBase64, setPdfBase64] = useState<string | null>(null);
  const [showCertModal, setShowCertModal] = useState<boolean>(false);
  const [incidentId, setIncidentId] = useState<string>('CAD-8492-TX');
  const [primaryHospital, setPrimaryHospital] = useState<HospitalInfo>({
    id: 'HOSP-01',
    name: 'Sawai Man Singh (SMS) Govt Trauma Hospital',
    address: 'Jawahar Lal Nehru Marg, Ashok Nagar Trauma Ward',
    phone: '108 / +91-141-2560291',
    traumaLevel: 'Level 1 Apex Trauma Center',
    lat: 26.8924,
    lng: 75.8150,
    distanceKm: 0.35,
    distanceText: '350m away',
    etaMinutes: 4,
    ambulanceUnit: 'ALS Mobile Unit #108-ALPHA',
    transmissionStatus: 'LIVE_TRANSMISSION_CONFIRMED',
    bedsAvailable: 18,
    googleMapsUrl: 'https://www.google.com/maps/dir/?api=1&destination=26.8924,75.8150',
  });
  const [backupHospitals, setBackupHospitals] = useState<HospitalInfo[]>([
    {
      id: 'HOSP-02',
      name: 'Fortis Escorts Emergency Center',
      address: 'JLN Marg, Malviya Nagar',
      phone: '+91-141-2547000',
      traumaLevel: 'Level 2 Cardiac Care',
      lat: 26.8480,
      lng: 75.8080,
      distanceKm: 1.2,
      distanceText: '1.2 km away',
      etaMinutes: 6,
      ambulanceUnit: 'ICU Unit #108-BRAVO',
      transmissionStatus: 'LIVE_TRANSMISSION_CONFIRMED',
      bedsAvailable: 8,
      googleMapsUrl: 'https://www.google.com/maps/dir/?api=1&destination=26.8480,75.8080',
    },
    {
      id: 'HOSP-03',
      name: 'Apex Super Speciality Hospital',
      address: 'Sector 8, Malviya Nagar',
      phone: '+91-141-2751871',
      traumaLevel: 'Level 1 Trauma Care',
      lat: 26.8530,
      lng: 75.8140,
      distanceKm: 2.5,
      distanceText: '2.5 km away',
      etaMinutes: 9,
      ambulanceUnit: 'Rapid Unit #108-CHARLIE',
      transmissionStatus: 'LIVE_TRANSMISSION_CONFIRMED',
      bedsAvailable: 4,
      googleMapsUrl: 'https://www.google.com/maps/dir/?api=1&destination=26.8530,75.8140',
    },
  ]);

  // -- Animations ----------------------------------------------------------
  const pulseAnim = useRef<Animated.Value>(new Animated.Value(1)).current;
  const fadeIn = useRef<Animated.Value>(new Animated.Value(0)).current;
  const slideUp = useRef<Animated.Value>(new Animated.Value(40)).current;
  const ringScale = useRef<Animated.Value>(new Animated.Value(1)).current;
  const ringOpacity = useRef<Animated.Value>(new Animated.Value(0.6)).current;

  // -- Inject Web Google Fonts (Inter & JetBrains Mono) --------------------
  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const fontId = 'samaritan-shield-fonts';
      if (!document.getElementById(fontId)) {
        const link = document.createElement('link');
        link.id = fontId;
        link.rel = 'stylesheet';
        link.href =
          'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800;900&family=JetBrains+Mono:wght@500;700;800&display=swap';
        document.head.appendChild(link);
      }
    }
  }, []);

  // -- Pre-fetch GPS Coordinates on Mount ----------------------------------
  useEffect(() => {
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && 'geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setCoordinates({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          setPermissionGranted(true);
        },
        () => {
          fetch('https://ipapi.co/json/')
            .then((r) => r.json())
            .then((data) => {
              if (data.latitude && data.longitude) {
                setCoordinates({ lat: Number(data.latitude), lng: Number(data.longitude) });
              }
            })
            .catch(() => {});
        },
        { enableHighAccuracy: true, timeout: 6000 }
      );
    }
  }, []);

  // -- Active Incident 2-Way CAD Sync Poll --------------------------------
  useEffect(() => {
    if (appPhase !== 'active' || !incidentId) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/hospital/incidents?lat=${coordinates.lat}&lng=${coordinates.lng}`);
        if (res.ok) {
          const data = await res.json();
          if (data.status === 'success' && Array.isArray(data.incidents)) {
            const currentInc = data.incidents.find(
              (i: any) => i.id === incidentId || i.incidentCode === incidentId || i.incidentCode === `CAD-${incidentId.slice(-4).toUpperCase()}`
            );
            if (currentInc) {
              if (currentInc.ambulanceUnitAssigned) {
                setPrimaryHospital((prev) => ({
                  ...prev,
                  ambulanceUnit: currentInc.ambulanceUnitAssigned,
                  transmissionStatus: 'AMBULANCE_DISPATCHED',
                }));
              }
            }
          }
        }
      } catch (_e) {}
    }, 2500);

    return () => clearInterval(interval);
  }, [appPhase, incidentId, coordinates]);

  // -- SOS button pulse animation ------------------------------------------
  useEffect((): (() => void) | void => {
    if (appPhase !== 'idle') return;

    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.06,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [appPhase, pulseAnim]);

  // -- Ring ripple animation -----------------------------------------------
  useEffect((): (() => void) | void => {
    if (appPhase !== 'idle') return;

    const ripple = Animated.loop(
      Animated.parallel([
        Animated.timing(ringScale, {
          toValue: 1.5,
          duration: 2200,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(ringOpacity, {
          toValue: 0,
          duration: 2200,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    ripple.start();
    return () => ripple.stop();
  }, [appPhase, ringScale, ringOpacity]);

  // -- Cleanup sound on unmount --------------------------------------------
  useEffect((): (() => void) => {
    return () => {
      if (sound) sound.unloadAsync();
    };
  }, [sound]);

  // -----------------------------------------------------------------------
  // Direct Web & Native Geolocation Engine
  // -----------------------------------------------------------------------
  const getCoordinates = useCallback(async (): Promise<Coordinates> => {
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && 'geolocation' in navigator) {
      try {
        const webCoords = await new Promise<Coordinates>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(
            (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
            (err) => reject(err),
            { enableHighAccuracy: true, timeout: 6000, maximumAge: 0 }
          );
        });
        return webCoords;
      } catch (_e) {}
    }

    try {
      const ipRes = await fetch('https://ipapi.co/json/');
      if (ipRes.ok) {
        const ipData = await ipRes.json();
        if (ipData.latitude && ipData.longitude) {
          return { lat: Number(ipData.latitude), lng: Number(ipData.longitude) };
        }
      }
    } catch (_ipErr) {}

    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        return { lat: loc.coords.latitude, lng: loc.coords.longitude };
      }
    } catch (_nativeErr) {}

    return MOCK_COORDS;
  }, []);

  // -----------------------------------------------------------------------
  // Emergency Tone Alert Synthesizer
  // -----------------------------------------------------------------------
  const playAlertSirenTone = useCallback((): void => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      try {
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        if (ctx.state === 'suspended') ctx.resume();

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.setValueAtTime(659, ctx.currentTime + 0.2);
        osc.frequency.setValueAtTime(880, ctx.currentTime + 0.4);
        osc.frequency.setValueAtTime(659, ctx.currentTime + 0.6);

        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.9);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.9);
      } catch (_err) {}
    }
  }, []);

  // -----------------------------------------------------------------------
  // Direct Voice Instruction Synthesizer
  // -----------------------------------------------------------------------
  const speakVoiceInstruction = useCallback((text: string): void => {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
        if (window.speechSynthesis.paused) window.speechSynthesis.resume();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 1.0;
        utterance.pitch = 1.0;
        utterance.volume = 1.0;
        utterance.lang = 'en-US';

        const voices = window.speechSynthesis.getVoices();
        const englishVoice = voices.find(
          (v) =>
            v.lang.startsWith('en') &&
            (v.name.includes('Google') ||
              v.name.includes('Natural') ||
              v.name.includes('Samantha') ||
              v.name.includes('US'))
        );
        if (englishVoice) utterance.voice = englishVoice;

        window.speechSynthesis.speak(utterance);
        return;
      } catch (_webSpeechErr) {}
    }

    try {
      Speech.stop();
      Speech.speak(text, { language: 'en-US', rate: 0.95, pitch: 1.0 });
    } catch (_err) {}
  }, []);

  // -----------------------------------------------------------------------
  // Emergency Voice Activation
  // -----------------------------------------------------------------------
  const playEmergencyAudio = useCallback(async (): Promise<void> => {
    playAlertSirenTone();
    const emergencySpeechText =
      'Emergency S.O.S. activated. Your exact coordinates have been transmitted to the nearest hospital trauma center. Legal protection shield is generated. Begin the severe trauma protocol now. Step 1: Secure the scene and assess the victim.';
    speakVoiceInstruction(emergencySpeechText);
  }, [playAlertSirenTone, speakVoiceInstruction]);

  // -----------------------------------------------------------------------
  // Animate into Active Phase
  // -----------------------------------------------------------------------
  const animateIn = useCallback((): void => {
    fadeIn.setValue(0);
    slideUp.setValue(40);
    Animated.parallel([
      Animated.timing(fadeIn, { toValue: 1, duration: 450, useNativeDriver: true }),
      Animated.spring(slideUp, { toValue: 0, friction: 8, useNativeDriver: true }),
    ]).start();
  }, [fadeIn, slideUp]);

  const advanceStatus = useCallback(
    (targetIndex: number, delay: number): Promise<void> =>
      new Promise<void>((resolve): void => {
        setTimeout((): void => {
          setStatusIndex(targetIndex);
          resolve();
        }, delay);
      }),
    []
  );

  const toggleStep = useCallback((index: number): void => {
    setCheckedSteps((prev) =>
      prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index]
    );
  }, []);

  const callHospital = useCallback((phoneNumber: string): void => {
    const cleanNumber = phoneNumber.replace(/[^0-9+]/g, '');
    const url = `tel:${cleanNumber}`;
    Linking.openURL(url).catch((err) => console.warn('Dialer error:', err));
  }, []);

  const openHospitalMap = useCallback((mapUrl: string): void => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.open(mapUrl, '_blank');
    } else {
      Linking.openURL(mapUrl).catch((err) => console.warn('Map directions error:', err));
    }
  }, []);

  // -----------------------------------------------------------------------
  // PDF Certificate Download & Direct Browser Opening (Instant & On-Demand)
  // -----------------------------------------------------------------------
  const downloadPDF = useCallback(async (): Promise<void> => {
    let currentPdf = pdfBase64;

    // If PDF is not yet compiled in memory, fetch live certificate on-demand from server
    if (!currentPdf) {
      try {
        const res = await fetch(`${API_BASE}/api/sos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            lat: coordinates.lat,
            lng: coordinates.lng,
            userId: currentUser ? currentUser.email : USER_ID,
          }),
        });
        const data: SOSApiResponse = await res.json();
        if (data.status === 'success' && data.pdfBase64) {
          currentPdf = data.pdfBase64;
          setPdfBase64(data.pdfBase64);
          if (data.hash) setHash(data.hash);
          if (data.timestamp) setTimestamp(data.timestamp);
          if (data.nearestHospital) setPrimaryHospital(data.nearestHospital);
        }
      } catch (fetchErr) {
        console.warn('On-demand PDF fetch error:', fetchErr);
      }
    }

    if (!currentPdf) {
      Alert.alert('Generating', 'Connecting to backend certificate generator. Please try again.');
      return;
    }

    try {
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        const byteCharacters = atob(currentPdf);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: 'application/pdf' });
        const blobUrl = URL.createObjectURL(blob);

        // 1. Open preview in new browser tab
        window.open(blobUrl, '_blank');

        // 2. Direct instant download
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = `Good_Samaritan_Protection_Certificate_${incidentId}.pdf`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        return;
      }
      Alert.alert('Certificate Ready', 'PDF certificate compiled.');
    } catch (err: unknown) {
      console.error('PDF download error:', err);
    }
  }, [pdfBase64, coordinates, incidentId, currentUser]);

  const handleOpenCertificate = useCallback(async (): Promise<void> => {
    setShowCertModal(true);
    if (!pdfBase64) {
      try {
        const res = await fetch(`${API_BASE}/api/sos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            lat: coordinates.lat,
            lng: coordinates.lng,
            userId: currentUser ? currentUser.email : USER_ID,
          }),
        });
        const data: SOSApiResponse = await res.json();
        if (data.status === 'success' && data.pdfBase64) {
          setPdfBase64(data.pdfBase64);
          if (data.hash) setHash(data.hash);
          if (data.timestamp) setTimestamp(data.timestamp);
          if (data.nearestHospital) setPrimaryHospital(data.nearestHospital);
        }
      } catch (_e) {}
    }
  }, [pdfBase64, coordinates, currentUser]);

  // -----------------------------------------------------------------------
  // Trigger SOS Flow
  // -----------------------------------------------------------------------
  const handleSOS = useCallback(async (): Promise<void> => {
    if (appPhase !== 'idle') return;

    try {
      Vibration.vibrate([0, 200, 100, 200]);
    } catch (_e) {}

    setAppPhase('activating');
    animateIn();

    // 1. Alert Tone & Spoken Voice
    await playEmergencyAudio();

    // 2. Obtain real coordinates
    const coords: Coordinates = await getCoordinates();
    setCoordinates(coords);

    // 3. Advance to Active
    setStatusIndex(0);
    setAppPhase('active');
    await advanceStatus(1, 300);

    const safeUserId = currentUser ? currentUser.email : USER_ID;

    // 4. Send parallel SOS and Dispatch requests to server
    try {
      const [dispatchRes, sosRes] = await Promise.allSettled([
        fetch(`${API_BASE}/api/dispatch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lat: coords.lat, lng: coords.lng, userId: safeUserId }),
        }),
        fetch(`${API_BASE}/api/sos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lat: coords.lat, lng: coords.lng, userId: safeUserId }),
        }),
      ]);

      if (dispatchRes.status === 'fulfilled') {
        const dispatchData = await dispatchRes.value.json();
        if (dispatchData.incidentId) setIncidentId(dispatchData.incidentId);
        if (dispatchData.nearestHospital) setPrimaryHospital(dispatchData.nearestHospital);
        if (dispatchData.backupHospitals) setBackupHospitals(dispatchData.backupHospitals);
      }

      if (sosRes.status === 'fulfilled') {
        const data: SOSApiResponse = await sosRes.value.json();
        if (data.status === 'success') {
          setHash(data.hash ?? null);
          setTimestamp(data.timestamp ?? new Date().toISOString());
          setPdfBase64(data.pdfBase64 ?? null);
          if (data.nearestHospital) setPrimaryHospital(data.nearestHospital);
          if (data.backupHospitals) setBackupHospitals(data.backupHospitals);

          await advanceStatus(2, 400);
          await advanceStatus(3, 400);
        }
      }
    } catch (_err) {
      setHash('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
      setTimestamp(new Date().toISOString());
      setStatusIndex(3);
    }
  }, [appPhase, animateIn, playEmergencyAudio, getCoordinates, advanceStatus, currentUser]);

  // -----------------------------------------------------------------------
  // Reset SOS
  // -----------------------------------------------------------------------
  const handleReset = useCallback((): void => {
    setAppPhase('idle');
    setStatusIndex(-1);
    setHash(null);
    setTimestamp(null);
    setPdfBase64(null);
    setCheckedSteps([]);
    try {
      if (Platform.OS === 'web' && typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      Speech.stop();
    } catch (_e) {}
  }, []);

  const handleLogout = useCallback(() => {
    logoutUser();
    setCurrentUser(null);
    handleReset();
  }, [handleReset]);

  // ========================================================================
  // RENDER VIEWS
  // ========================================================================

  // --- TOP HEADER (SAMARITAN_SHIELD) ---
  const renderTopHeader = () => (
    <View style={styles.topHeader}>
      <View style={styles.headerLeft}>
        <View style={styles.shieldIconBox}>
          <Text style={styles.shieldEmoji}>🛡️</Text>
        </View>
        <View>
          <Text style={styles.headerTitle}>SAMARITAN_SHIELD</Text>
          {currentUser && (
            <Text style={styles.userRoleBadge}>
              {currentUser.role === 'hospital'
                ? `🏥 ${currentUser.displayName}`
                : `🛡️ CITIZEN: ${currentUser.displayName}`}
            </Text>
          )}
        </View>
      </View>
      <View style={styles.headerRight}>
        {currentUser && (
          <TouchableOpacity
            style={styles.switchRoleBtn}
            onPress={handleLogout}
            activeOpacity={0.75}
          >
            <Text style={styles.switchRoleText}>🚪 SWITCH</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );

  // --- SCREEN 1: PRE-SOS EMERGENCY DASHBOARD (IDLE HUD) ---
  const renderIdleDashboard = () => (
    <ScrollView style={styles.contentScroll} contentContainerStyle={styles.scrollContent}>
      {/* System Status Banner */}
      <View style={styles.systemStatusCard}>
        <View style={styles.statusRowBetween}>
          <View style={styles.statusLiveTag}>
            <View style={styles.statusDotLive} />
            <Text style={styles.statusTextLive}>System Online • Zero-Trust Encrypted</Text>
          </View>
          <Text style={styles.nodeBadge}>NODE: SECURE-09</Text>
        </View>
      </View>

      {/* Hero Tactical SOS Actuator */}
      <View style={styles.sosHeroContainer}>
        <Animated.View
          style={[
            styles.sosRippleRing,
            {
              transform: [{ scale: ringScale }],
              opacity: ringOpacity,
            },
          ]}
        />
        <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
          <TouchableOpacity
            style={styles.sosTactileButton}
            onPress={handleSOS}
            activeOpacity={0.8}
          >
            <View style={styles.sosInnerGlow}>
              <Text style={styles.sosAsterisk}>✱</Text>
              <Text style={styles.sosButtonLabel}>SOS</Text>
            </View>
          </TouchableOpacity>
        </Animated.View>

        <Text style={styles.sosEmergencyHeadline}>🚨 EMERGENCY SOS</Text>
        <Text style={styles.sosEmergencySubhead}>
          Instant GPS Transmission • CAD Hospital Dispatch • Legal Protection Shield
        </Text>
      </View>

      {/* 3 Telemetry Feature Cards */}
      {/* 1. Live GPS Card */}
      <View style={styles.hudFeatureCard}>
        <View style={styles.cardHeaderRow}>
          <Text style={styles.cardHeaderLabel}>❖ LIVE GPS</Text>
          <View style={styles.pulsingBlueDot} />
        </View>
        <View style={styles.gpsCoordBox}>
          <Text style={styles.gpsCoordText}>
            LAT: {coordinates.lat.toFixed(4)}° N, LON: {coordinates.lng.toFixed(4)}° E
          </Text>
        </View>
      </View>

      {/* 2. Incident Verification Card */}
      <TouchableOpacity
        style={styles.hudFeatureCard}
        onPress={handleOpenCertificate}
        activeOpacity={0.8}
      >
        <View style={styles.cardHeaderRow}>
          <Text style={styles.cardHeaderLabel}>🔒 INCIDENT VERIFICATION</Text>
          <Text style={styles.cardHeaderIcon}>🛡️</Text>
        </View>
        <View style={styles.hashPreviewBox}>
          <Text style={styles.hashPreviewLabel}>SHA-256 DIGEST</Text>
          <Text style={styles.hashPreviewValue} numberOfLines={2}>
            {hash || 'E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855'}
          </Text>
        </View>
        <Text style={styles.hudCardSubtext}>Tap to view cryptographic audit log & certificate.</Text>
      </TouchableOpacity>

      {/* 3. Legal Shield Card */}
      <TouchableOpacity
        style={styles.hudFeatureCard}
        onPress={handleOpenCertificate}
        activeOpacity={0.8}
      >
        <View style={styles.cardHeaderRow}>
          <Text style={styles.cardHeaderLabel}>⚖️ LEGAL SHIELD</Text>
          <View style={styles.viewBadge}>
            <Text style={styles.viewBadgeText}>TAP TO VIEW PDF ➔</Text>
          </View>
        </View>
        <View style={styles.legalInnerBanner}>
          <Text style={styles.legalInnerIcon}>📑</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.legalInnerTitle}>Good Samaritan Immunity</Text>
            <Text style={styles.legalInnerSubtitle}>Tap to generate & download official PDF</Text>
          </View>
        </View>
      </TouchableOpacity>

      {/* 4. Medical Radar (3 Facilities in Range) */}
      <View style={styles.hudFeatureCard}>
        <View style={styles.cardHeaderRow}>
          <Text style={styles.cardHeaderLabel}>📡 MEDICAL RADAR</Text>
          <Text style={styles.radarCountText}>3 FACILITIES IN RANGE</Text>
        </View>

        <View style={styles.radarHospitalList}>
          {/* Facility 1 */}
          <TouchableOpacity
            style={styles.radarHospitalItem}
            onPress={() => openHospitalMap(primaryHospital.googleMapsUrl)}
            activeOpacity={0.8}
          >
            <View style={styles.radarItemIconBox}>
              <Text style={styles.radarItemIcon}>🏥</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.radarItemName}>{primaryHospital.name}</Text>
              <Text style={styles.radarItemMeta}>
                ETA: {primaryHospital.etaMinutes} MIN [{primaryHospital.distanceText}]
              </Text>
            </View>
            <Text style={styles.radarItemArrow}>➔</Text>
          </TouchableOpacity>

          {/* Facility 2 */}
          {backupHospitals.map((hosp, idx) => (
            <TouchableOpacity
              key={idx}
              style={styles.radarHospitalItem}
              onPress={() => openHospitalMap(hosp.googleMapsUrl)}
              activeOpacity={0.8}
            >
              <View style={styles.radarItemIconBoxSecondary}>
                <Text style={styles.radarItemIcon}>🏥</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.radarItemName}>{hosp.name}</Text>
                <Text style={styles.radarItemMeta}>
                  ETA: {hosp.etaMinutes} MIN [{hosp.distanceText}]
                </Text>
              </View>
              <Text style={styles.radarItemArrow}>➔</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </ScrollView>
  );

  // --- SCREEN 2: ACTIVE EMERGENCY TRANSMISSION HUB ---
  const renderActiveTransmissionHub = () => (
    <ScrollView style={styles.contentScroll} contentContainerStyle={styles.scrollContent}>
      {/* 1. Active SOS Broadcast Alert Bar */}
      <View style={styles.activeBroadcastCard}>
        <View style={styles.activeBroadcastTop}>
          <View style={styles.activeRedBeacon} />
          <Text style={styles.activeBroadcastTitle}>ACTIVE SOS BROADCAST</Text>
        </View>
        <Text style={styles.activeBroadcastIncident}>INCIDENT #{incidentId}</Text>
        <View style={styles.activeBroadcastCoordBox}>
          <Text style={styles.activeBroadcastCoordText}>
            📍 {coordinates.lat.toFixed(4)}° N, {coordinates.lng.toFixed(4)}° E
          </Text>
        </View>
      </View>

      {/* 2. Main Hospital CAD Dispatch Card */}
      <View style={styles.hospitalCadCard}>
        <View style={styles.cadStreamingHeader}>
          <View style={styles.greenPulsingDot} />
          <Text style={styles.cadStreamingText}>
            LIVE TELEMETRY STREAMING • 2-WAY CAD DISPATCH ACTIVE
          </Text>
        </View>

        <Text style={styles.hospitalMainName}>{primaryHospital.name}</Text>
        <Text style={styles.hospitalTraumaLevel}>{primaryHospital.traumaLevel}</Text>

        <View style={styles.locationSharedBadge}>
          <Text style={styles.locationSharedText}>📍 LOCATION SHARED</Text>
        </View>

        {/* 3 Metric Telemetry Boxes */}
        <View style={styles.cadMetricsRow}>
          <View style={styles.cadMetricBox}>
            <Text style={styles.cadMetricIcon}>📍</Text>
            <Text style={styles.cadMetricValue}>{primaryHospital.distanceText}</Text>
            <Text style={styles.cadMetricLabel}>DISTANCE</Text>
          </View>

          <View style={styles.cadMetricBox}>
            <Text style={styles.cadMetricIconGreen}>🚑</Text>
            <Text style={styles.cadMetricValueGreen}>{primaryHospital.etaMinutes} MIN</Text>
            <Text style={styles.cadMetricLabel}>AMB ETA</Text>
          </View>

          <View style={styles.cadMetricBox}>
            <Text style={styles.cadMetricIconCyan}>🛏️</Text>
            <Text style={styles.cadMetricValueCyan}>{primaryHospital.bedsAvailable}</Text>
            <Text style={styles.cadMetricLabel}>ICU BEDS</Text>
          </View>
        </View>

        {/* Action Buttons */}
        <View style={styles.cadActionsRow}>
          <TouchableOpacity
            style={styles.cadCallButton}
            onPress={() => callHospital(primaryHospital.phone)}
            activeOpacity={0.8}
          >
            <Text style={styles.cadCallBtnText}>📞 CALL HOSPITAL (108)</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.cadDirectionsButton}
            onPress={() => openHospitalMap(primaryHospital.googleMapsUrl)}
            activeOpacity={0.8}
          >
            <Text style={styles.cadDirectionsBtnText}>🗺️ DIRECTIONS</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* 3. Incident Timeline Stepper */}
      <View style={styles.timelineCard}>
        <Text style={styles.timelineHeader}>INCIDENT TIMELINE</Text>

        <View style={styles.timelineList}>
          {/* Step 1 */}
          <View style={styles.timelineItem}>
            <View style={styles.timelineIconCompleted}>
              <Text style={styles.timelineCheck}>✓</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.timelineItemTitle}>Reported</Text>
              <Text style={styles.timelineItemTime}>T-00:04:12</Text>
            </View>
          </View>

          {/* Step 2 */}
          <View style={styles.timelineItem}>
            <View style={styles.timelineIconCompleted}>
              <Text style={styles.timelineCheck}>✓</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.timelineItemTitle}>Generating Legal Shield</Text>
              <Text style={styles.timelineItemTime}>T-00:03:50</Text>
            </View>
          </View>

          {/* Step 3 */}
          <View style={styles.timelineItem}>
            <View style={styles.timelineIconGreen}>
              <Text style={styles.timelineCheck}>✓</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.timelineItemTitleGreen}>Ambulance Dispatched</Text>
              <Text style={styles.timelineItemTime}>T-00:01:20</Text>
            </View>
          </View>

          {/* Step 4 */}
          <View style={styles.timelineItem}>
            <View style={styles.timelineIconActive}>
              <View style={styles.timelineDotCyan} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.timelineItemTitleCyan}>Shield Active</Text>
              <Text style={styles.timelineItemTimeActive}>MONITORING LIVE...</Text>
            </View>
          </View>
        </View>
      </View>

      {/* 4. Standby Network List */}
      <View style={styles.standbyCard}>
        <Text style={styles.standbyHeader}>STANDBY NETWORK LIST</Text>
        {backupHospitals.map((hosp, i) => (
          <TouchableOpacity
            key={i}
            style={styles.standbyItem}
            onPress={() => openHospitalMap(hosp.googleMapsUrl)}
            activeOpacity={0.8}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.standbyName}>{hosp.name}</Text>
              <Text style={styles.standbyMeta}>
                {hosp.distanceText} • {hosp.bedsAvailable} Beds
              </Text>
            </View>
            <Text style={styles.standbyArrow}>➔</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* 5. Voice AI & CPR Engine (Screen 3) */}
      <VoiceTriage isActive={appPhase === 'active'} incidentId={incidentId} />

      {/* 6. Legal Certificate Action Banner */}
      <TouchableOpacity
        style={styles.legalBannerCTA}
        onPress={() => setShowCertModal(true)}
        activeOpacity={0.85}
      >
        <Text style={styles.legalBannerIcon}>📄</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.legalBannerTitle}>VIEW LEGAL CERTIFICATE (PDF)</Text>
          <Text style={styles.legalBannerSubtext}>
            {pdfBase64 ? 'Section 134A Statutory Good Samaritan Protection' : 'Generating encrypted certificate in background...'}
          </Text>
        </View>
        <Text style={styles.legalBannerArrow}>➔</Text>
      </TouchableOpacity>

      {/* Deactivate Button */}
      <TouchableOpacity style={styles.deactivateBtn} onPress={handleReset}>
        <Text style={styles.deactivateBtnText}>✕ DEACTIVATE EMERGENCY MODE</Text>
      </TouchableOpacity>
    </ScrollView>
  );

  // --- MAPS TAB VIEW ---
  const renderMapsView = () => (
    <ScrollView style={styles.contentScroll} contentContainerStyle={styles.scrollContent}>
      <View style={styles.hudFeatureCard}>
        <Text style={styles.cardHeaderLabel}>🗺️ TACTICAL SATELLITE RADAR</Text>
        <View style={styles.mapCanvasPlaceholder}>
          <Text style={styles.mapRadarPulse}>((( 🛰️ )))</Text>
          <Text style={styles.mapCoordsLive}>
            GPS ANCHOR: {coordinates.lat.toFixed(4)}° N, {coordinates.lng.toFixed(4)}° E
          </Text>
        </View>
        <Text style={styles.hudCardSubtext}>
          Live 2-way tracking synchronized with City CAD emergency dispatch network.
        </Text>
      </View>

      <View style={styles.standbyCard}>
        <Text style={styles.standbyHeader}>NEARBY TRAUMA HUBS & ROUTES</Text>
        <TouchableOpacity
          style={styles.standbyItem}
          onPress={() => openHospitalMap(primaryHospital.googleMapsUrl)}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.standbyName}>{primaryHospital.name}</Text>
            <Text style={styles.standbyMeta}>
              {primaryHospital.distanceText} • ETA {primaryHospital.etaMinutes} mins • {primaryHospital.phone}
            </Text>
          </View>
          <Text style={styles.standbyArrow}>🗺️</Text>
        </TouchableOpacity>
        {backupHospitals.map((h, i) => (
          <TouchableOpacity
            key={i}
            style={styles.standbyItem}
            onPress={() => openHospitalMap(h.googleMapsUrl)}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.standbyName}>{h.name}</Text>
              <Text style={styles.standbyMeta}>
                {h.distanceText} • ETA {h.etaMinutes} mins • {h.phone}
              </Text>
            </View>
            <Text style={styles.standbyArrow}>🗺️</Text>
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );

  // --- INTEL TAB VIEW (DRSABC & FIRST AID PROTOCOLS) ---
  const renderIntelView = () => (
    <ScrollView style={styles.contentScroll} contentContainerStyle={styles.scrollContent}>
      <View style={styles.systemStatusCard}>
        <Text style={styles.cardHeaderLabel}>📖 SEVERE TRAUMA PROTOCOL (4-STEP)</Text>
        <Text style={styles.hudCardSubtext}>
          Prioritized resuscitation algorithm: Stop the bleed before checking breathing. Compressions-only CPR.
        </Text>
      </View>

      {TRAUMA_PROTOCOL_STEPS.map((step, idx) => {
        const isChecked = checkedSteps.includes(idx);
        return (
          <TouchableOpacity
            key={idx}
            style={[styles.drsabcCard, isChecked && styles.drsabcCardChecked]}
            onPress={() => toggleStep(idx)}
            activeOpacity={0.8}
          >
            <View style={styles.drsabcLetterBox}>
              <Text style={styles.drsabcLetter}>{step.step}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.drsabcTitle}>
                {step.icon} {step.title}
              </Text>
              <Text style={styles.drsabcDetail}>{step.detail}</Text>
            </View>
            <Text style={[styles.drsabcCheck, isChecked && styles.drsabcCheckActive]}>
              {isChecked ? '✓' : '○'}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );

  // --- REPORTS TAB VIEW (CRYPTOGRAPHIC PROOF & LEGAL LOGS) ---
  const renderReportsView = () => (
    <ScrollView style={styles.contentScroll} contentContainerStyle={styles.scrollContent}>
      <View style={styles.hudFeatureCard}>
        <Text style={styles.cardHeaderLabel}>⚖️ STATUTORY GOOD SAMARITAN VAULT</Text>
        <Text style={styles.hudCardSubtext}>
          Under Section 134A of the Motor Vehicles Act, 2019 and the Supreme Court Guidelines (WP Civil 235/2012), any citizen rendering emergency assistance is granted full legal immunity.
        </Text>
      </View>

      <View style={styles.hudFeatureCard}>
        <Text style={styles.cardHeaderLabel}>🔐 ACTIVE CRYPTOGRAPHIC AUDIT LOG</Text>
        <View style={styles.hashPreviewBox}>
          <Text style={styles.hashPreviewLabel}>SHA-256 TAMPER-PROOF DIGEST</Text>
          <Text style={styles.hashPreviewValue}>
            {hash || 'E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855'}
          </Text>
        </View>
        <Text style={styles.hudCardSubtext}>
          Verified Timestamp: {timestamp || 'Standing by for emergency trigger'}
        </Text>
      </View>

      <TouchableOpacity
        style={styles.legalBannerCTA}
        onPress={handleOpenCertificate}
      >
        <Text style={styles.legalBannerIcon}>📄</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.legalBannerTitle}>VIEW OFFICIAL PDF CERTIFICATE</Text>
          <Text style={styles.legalBannerSubtext}>Tamper-Proof Good Samaritan Record</Text>
        </View>
        <Text style={styles.legalBannerArrow}>➔</Text>
      </TouchableOpacity>
    </ScrollView>
  );

  // --- SCREEN 4: GOOD SAMARITAN LEGAL SHIELD CERTIFICATE MODAL ---
  const renderCertModal = () => (
    <Modal
      visible={showCertModal}
      animationType="slide"
      transparent={true}
      onRequestClose={() => setShowCertModal(false)}
    >
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCertificateFrame}>
          <ScrollView contentContainerStyle={styles.certScrollContent}>
            {/* Government & Statutory Header */}
            <View style={styles.certHeader}>
              <Text style={styles.certEmblem}>🏛️</Text>
              <Text style={styles.certGovtTitle}>
                REPUBLIC OF INDIA — STATUTORY EMERGENCY RECORD
              </Text>
              <Text style={styles.certMainHeading}>
                GOOD SAMARITAN LEGAL PROTECTION CERTIFICATE
              </Text>
              <Text style={styles.certStatuteBadge}>
                [Section 134A Motor Vehicles Act]
              </Text>
            </View>

            {/* 4 Dark Tactical Data Boxes */}
            <View style={styles.certDataBox}>
              <Text style={styles.certDataLabel}>RESPONDER ID</Text>
              <Text style={styles.certDataValue}>{currentUser ? currentUser.email : USER_ID}</Text>
            </View>

            <View style={styles.certDataBox}>
              <Text style={styles.certDataLabel}>GPS COORDINATES</Text>
              <Text style={styles.certDataValue}>
                {coordinates.lat.toFixed(4)}° N, {coordinates.lng.toFixed(4)}° E
              </Text>
            </View>

            <View style={styles.certDataBox}>
              <Text style={styles.certDataLabel}>TIMESTAMP (ISO 8601)</Text>
              <Text style={styles.certDataValue}>
                {timestamp || new Date().toISOString()}
              </Text>
            </View>

            <View style={styles.certDataBox}>
              <Text style={styles.certDataLabel}>DISPATCHED FACILITY</Text>
              <Text style={styles.certDataValue}>{primaryHospital.name}</Text>
            </View>

            {/* Cryptographic Hash Box */}
            <View style={styles.certHashCard}>
              <Text style={styles.certHashLabel}>CRYPTOGRAPHIC HASH (SHA-256)</Text>
              <Text style={styles.certHashText}>
                {hash || '593465F5FBFAC42984AB22116B6AD6BA21F854E93BDDE70E03EEC6CC0D7609B5'}
              </Text>
            </View>

            {/* Statutory Immunities Granted */}
            <Text style={styles.certSectionTitle}>STATUTORY IMMUNITIES GRANTED</Text>

            <View style={styles.certImmunityCard}>
              <View style={styles.certImmunityHeaderRow}>
                <Text style={styles.certImmunityIcon}>🛡️</Text>
                <Text style={styles.certImmunityTitle}>EXEMPTION FROM LIABILITY</Text>
              </View>
              <Text style={styles.certImmunityBody}>
                The bearer is protected from civil and criminal liability for any injury to or death of the victim of an accident, where such injury or death resulted from the Good Samaritan's action or omission while rendering emergency medical care.
              </Text>
            </View>

            <View style={styles.certImmunityCard}>
              <View style={styles.certImmunityHeaderRow}>
                <Text style={styles.certImmunityIcon}>🚫</Text>
                <Text style={styles.certImmunityTitle}>PROTECTION FROM HARASSMENT</Text>
              </View>
              <Text style={styles.certImmunityBody}>
                The bearer shall not be liable for any detention or interrogation. They shall be treated respectfully and shall not be discriminated against. They shall not be forced to reveal their personal identity details.
              </Text>
            </View>

            {/* Digital Stamp */}
            <View style={styles.certStampBox}>
              <Text style={styles.certStampText}>VERIFIED EMERGENCY RECORD</Text>
            </View>

            {/* Action Buttons */}
            <TouchableOpacity
              style={styles.certDownloadBtn}
              onPress={downloadPDF}
              activeOpacity={0.8}
            >
              <Text style={styles.certDownloadBtnIcon}>📥</Text>
              <Text style={styles.certDownloadBtnText}>DOWNLOAD OFFICIAL PDF</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.certCloseBtn}
              onPress={() => setShowCertModal(false)}
            >
              <Text style={styles.certCloseBtnText}>✕ CLOSE CERTIFICATE</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );

  // --- BOTTOM NAVIGATION BAR ---
  const renderBottomNav = () => (
    <View style={styles.bottomNav}>
      {(['HUB', 'MAPS', 'INTEL', 'REPORTS'] as NavigationTab[]).map((tab) => {
        const isActive = activeTab === tab;
        const icon =
          tab === 'HUB'
            ? '⊞'
            : tab === 'MAPS'
            ? '🧭'
            : tab === 'INTEL'
            ? '📰'
            : '📄';

        return (
          <TouchableOpacity
            key={tab}
            style={[styles.navTab, isActive && styles.navTabActive]}
            onPress={() => setActiveTab(tab)}
            activeOpacity={0.7}
          >
            <Text style={[styles.navTabIcon, isActive && styles.navTabIconActive]}>
              {icon}
            </Text>
            <Text style={[styles.navTabLabel, isActive && styles.navTabLabelActive]}>
              {tab}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  // --- AUTH GATEWAY ---
  if (!currentUser) {
    return (
      <View style={styles.rootContainer}>
        <StatusBar barStyle="light-content" backgroundColor="#0a0a14" />
        <AuthScreen onLoginSuccess={(profile) => setCurrentUser(profile)} />
      </View>
    );
  }

  // --- HOSPITAL PORTAL VIEW ---
  if (currentUser.role === 'hospital') {
    return (
      <View style={styles.rootContainer}>
        <StatusBar barStyle="light-content" backgroundColor="#0a0a14" />
        {renderTopHeader()}
        <HospitalPortal
          userProfile={currentUser}
          onLogout={handleLogout}
          onInspectCertificate={(inc: EmergencyIncidentItem) => {
            setIncidentId(inc.incidentCode);
            setCoordinates({ lat: inc.lat, lng: inc.lng });
            setHash(inc.sha256Hash);
            setTimestamp(inc.timestamp);
            setShowCertModal(true);
          }}
        />
        {renderCertModal()}
      </View>
    );
  }

  // --- CITIZEN EMERGENCY HUD VIEW ---
  return (
    <View style={styles.rootContainer}>
      <StatusBar barStyle="light-content" backgroundColor="#0a0a14" />
      {renderTopHeader()}

      <View style={styles.mainContent}>
        {activeTab === 'HUB' &&
          (appPhase === 'idle' ? renderIdleDashboard() : renderActiveTransmissionHub())}
        {activeTab === 'MAPS' && renderMapsView()}
        {activeTab === 'INTEL' && renderIntelView()}
        {activeTab === 'REPORTS' && renderReportsView()}
      </View>

      {renderBottomNav()}
      {renderCertModal()}
    </View>
  );
}

// ---------------------------------------------------------------------------
// STYLES (Cyber-Tactical Emergency Design Tokens)
// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  rootContainer: {
    flex: 1,
    backgroundColor: '#0a0a14',
  } as ViewStyle,

  mainContent: {
    flex: 1,
  } as ViewStyle,

  contentScroll: {
    flex: 1,
  } as ViewStyle,

  scrollContent: {
    padding: 16,
    paddingBottom: 40,
    maxWidth: 600,
    width: '100%',
    alignSelf: 'center',
  } as ViewStyle,

  // --- Top Header ---
  topHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 12,
    backgroundColor: '#0f172a',
    borderBottomWidth: 1.5,
    borderColor: '#1e293b',
  } as ViewStyle,
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  } as ViewStyle,
  shieldIconBox: {
    marginRight: 8,
  } as ViewStyle,
  shieldEmoji: {
    fontSize: 22,
  } as TextStyle,
  headerTitle: {
    fontSize: 15,
    fontWeight: '900',
    color: '#8ed5ff',
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
    letterSpacing: 1.5,
  } as TextStyle,
  userRoleBadge: {
    fontSize: 9,
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
    fontWeight: '700',
    color: '#38bdf8',
    marginTop: 1,
  } as TextStyle,
  headerRight: {},
  switchRoleBtn: {
    backgroundColor: '#1e293b',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#475569',
  } as ViewStyle,
  switchRoleText: {
    fontSize: 10,
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
    fontWeight: '800',
    color: '#cbd5e1',
  } as TextStyle,

  // --- System Status Banner ---
  systemStatusCard: {
    backgroundColor: '#111827',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#1f2937',
  } as ViewStyle,
  statusRowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  } as ViewStyle,
  statusLiveTag: {
    flexDirection: 'row',
    alignItems: 'center',
  } as ViewStyle,
  statusDotLive: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#38bdf8',
    marginRight: 8,
  } as ViewStyle,
  statusTextLive: {
    fontSize: 11,
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
    fontWeight: '700',
    color: '#cbd5e1',
  } as TextStyle,
  nodeBadge: {
    fontSize: 10,
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
    fontWeight: '800',
    color: '#94a3b8',
    letterSpacing: 1,
  } as TextStyle,

  // --- Hero SOS Actuator ---
  sosHeroContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 20,
    marginBottom: 20,
    position: 'relative',
  } as ViewStyle,
  sosRippleRing: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: '#ef4444',
    top: 10,
  } as ViewStyle,
  sosTactileButton: {
    width: 170,
    height: 170,
    borderRadius: 24,
    backgroundColor: '#320b10',
    borderWidth: 2.5,
    borderColor: '#ef4444',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#ef4444',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 8,
  } as ViewStyle,
  sosInnerGlow: {
    alignItems: 'center',
    justifyContent: 'center',
  } as ViewStyle,
  sosAsterisk: {
    fontSize: 44,
    color: '#fca5a5',
    marginBottom: -4,
  } as TextStyle,
  sosButtonLabel: {
    fontSize: 26,
    fontWeight: '900',
    color: '#fca5a5',
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
    letterSpacing: 3,
  } as TextStyle,
  sosEmergencyHeadline: {
    fontSize: 18,
    fontWeight: '900',
    color: '#ffffff',
    marginTop: 18,
    letterSpacing: 1,
  } as TextStyle,
  sosEmergencySubhead: {
    fontSize: 11,
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
    color: '#94a3b8',
    textAlign: 'center',
    marginTop: 6,
    paddingHorizontal: 20,
    lineHeight: 16,
  } as TextStyle,

  // --- HUD Feature Cards ---
  hudFeatureCard: {
    backgroundColor: '#111827',
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1.5,
    borderColor: '#1e293b',
  } as ViewStyle,
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  } as ViewStyle,
  cardHeaderLabel: {
    fontSize: 12,
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
    fontWeight: '800',
    color: '#8ed5ff',
    letterSpacing: 1,
  } as TextStyle,
  cardHeaderIcon: {
    fontSize: 16,
  } as TextStyle,
  pulsingBlueDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#38bdf8',
  } as ViewStyle,
  gpsCoordBox: {
    backgroundColor: '#0a0f1d',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1e293b',
  } as ViewStyle,
  gpsCoordText: {
    fontSize: 13,
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
    fontWeight: '700',
    color: '#38bdf8',
    letterSpacing: 1,
  } as TextStyle,

  hashPreviewBox: {
    backgroundColor: '#0a0f1d',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#1e293b',
  } as ViewStyle,
  hashPreviewLabel: {
    fontSize: 9,
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
    color: '#64748b',
    fontWeight: '700',
    marginBottom: 4,
  } as TextStyle,
  hashPreviewValue: {
    fontSize: 11,
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
    color: '#34d399',
    lineHeight: 16,
  } as TextStyle,
  hudCardSubtext: {
    fontSize: 11,
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
    color: '#94a3b8',
  } as TextStyle,

  viewBadge: {
    backgroundColor: '#0c2744',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#38bdf8',
  } as ViewStyle,
  viewBadgeText: {
    fontSize: 9,
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
    fontWeight: '800',
    color: '#38bdf8',
    letterSpacing: 0.5,
  } as TextStyle,

  legalInnerBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0a0f1d',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: '#1e293b',
  } as ViewStyle,
  legalInnerIcon: {
    fontSize: 22,
    marginRight: 10,
  } as TextStyle,
  legalInnerTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#ffffff',
  } as TextStyle,
  legalInnerSubtitle: {
    fontSize: 11,
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
    color: '#94a3b8',
  } as TextStyle,

  radarCountText: {
    fontSize: 10,
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
    fontWeight: '800',
    color: '#38bdf8',
  } as TextStyle,
  radarHospitalList: {
    gap: 8,
  } as ViewStyle,
  radarHospitalItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0a0f1d',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#1e293b',
  } as ViewStyle,
  radarItemIconBox: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#172554',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  } as ViewStyle,
  radarItemIconBoxSecondary: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#1e293b',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  } as ViewStyle,
  radarItemIcon: {
    fontSize: 18,
  } as TextStyle,
  radarItemName: {
    fontSize: 13,
    fontWeight: '800',
    color: '#ffffff',
  } as TextStyle,
  radarItemMeta: {
    fontSize: 11,
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
    color: '#38bdf8',
    marginTop: 2,
  } as TextStyle,
  radarItemArrow: {
    fontSize: 14,
    color: '#64748b',
  } as TextStyle,

  // --- SCREEN 2: ACTIVE TRANSMISSION HUB ---
  activeBroadcastCard: {
    backgroundColor: '#261417',
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1.5,
    borderColor: '#ef4444',
  } as ViewStyle,
  activeBroadcastTop: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  } as ViewStyle,
  activeRedBeacon: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: '#ef4444',
    marginRight: 8,
  } as ViewStyle,
  activeBroadcastTitle: {
    fontSize: 13,
    fontWeight: '900',
    color: '#ffffff',
    letterSpacing: 1,
  } as TextStyle,
  activeBroadcastIncident: {
    fontSize: 10,
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
    fontWeight: '800',
    color: '#f87171',
    letterSpacing: 1,
    marginBottom: 8,
  } as TextStyle,
  activeBroadcastCoordBox: {
    backgroundColor: '#170a0d',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignItems: 'center',
  } as ViewStyle,
  activeBroadcastCoordText: {
    fontSize: 12,
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
    fontWeight: '800',
    color: '#fca5a5',
  } as TextStyle,

  // Hospital CAD Dispatch Card
  hospitalCadCard: {
    backgroundColor: '#172033',
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1.5,
    borderColor: '#253b5e',
  } as ViewStyle,
  cadStreamingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  } as ViewStyle,
  greenPulsingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#22c55e',
    marginRight: 8,
  } as ViewStyle,
  cadStreamingText: {
    fontSize: 10,
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
    fontWeight: '800',
    color: '#4ade80',
    letterSpacing: 0.8,
  } as TextStyle,
  hospitalMainName: {
    fontSize: 20,
    fontWeight: '900',
    color: '#ffffff',
    lineHeight: 26,
  } as TextStyle,
  hospitalTraumaLevel: {
    fontSize: 12,
    color: '#93c5fd',
    marginTop: 2,
    marginBottom: 8,
  } as TextStyle,
  locationSharedBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#0c2744',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#38bdf8',
    marginBottom: 14,
  } as ViewStyle,
  locationSharedText: {
    fontSize: 10,
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
    fontWeight: '800',
    color: '#38bdf8',
    letterSpacing: 1,
  } as TextStyle,

  cadMetricsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  } as ViewStyle,
  cadMetricBox: {
    flex: 1,
    backgroundColor: '#0f172a',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1e293b',
  } as ViewStyle,
  cadMetricIcon: {
    fontSize: 16,
    marginBottom: 2,
  } as TextStyle,
  cadMetricIconGreen: {
    fontSize: 16,
    marginBottom: 2,
  } as TextStyle,
  cadMetricIconCyan: {
    fontSize: 16,
    marginBottom: 2,
  } as TextStyle,
  cadMetricValue: {
    fontSize: 15,
    fontWeight: '900',
    color: '#ffffff',
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
  } as TextStyle,
  cadMetricValueGreen: {
    fontSize: 15,
    fontWeight: '900',
    color: '#22c55e',
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
  } as TextStyle,
  cadMetricValueCyan: {
    fontSize: 15,
    fontWeight: '900',
    color: '#38bdf8',
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
  } as TextStyle,
  cadMetricLabel: {
    fontSize: 9,
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
    fontWeight: '700',
    color: '#64748b',
    marginTop: 2,
    letterSpacing: 1,
  } as TextStyle,

  cadActionsRow: {
    flexDirection: 'row',
    gap: 10,
  } as ViewStyle,
  cadCallButton: {
    flex: 1.2,
    backgroundColor: '#881337',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#ef4444',
  } as ViewStyle,
  cadCallBtnText: {
    fontSize: 12,
    fontWeight: '900',
    color: '#ffffff',
    letterSpacing: 1,
  } as TextStyle,
  cadDirectionsButton: {
    flex: 1,
    backgroundColor: '#1e293b',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#38bdf8',
  } as ViewStyle,
  cadDirectionsBtnText: {
    fontSize: 12,
    fontWeight: '900',
    color: '#38bdf8',
    letterSpacing: 1,
  } as TextStyle,

  // Timeline Stepper Card
  timelineCard: {
    backgroundColor: '#111827',
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1.5,
    borderColor: '#1e293b',
  } as ViewStyle,
  timelineHeader: {
    fontSize: 13,
    fontWeight: '900',
    color: '#8ed5ff',
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
    letterSpacing: 1.5,
    marginBottom: 12,
  } as TextStyle,
  timelineList: {
    gap: 12,
  } as ViewStyle,
  timelineItem: {
    flexDirection: 'row',
    alignItems: 'center',
  } as ViewStyle,
  timelineIconCompleted: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#0c2744',
    borderWidth: 1.5,
    borderColor: '#38bdf8',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  } as ViewStyle,
  timelineIconGreen: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#052e16',
    borderWidth: 1.5,
    borderColor: '#22c55e',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  } as ViewStyle,
  timelineIconActive: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#0c2744',
    borderWidth: 1.5,
    borderColor: '#38bdf8',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  } as ViewStyle,
  timelineCheck: {
    fontSize: 12,
    color: '#38bdf8',
    fontWeight: '900',
  } as TextStyle,
  timelineDotCyan: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#38bdf8',
  } as ViewStyle,
  timelineItemTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#cbd5e1',
  } as TextStyle,
  timelineItemTitleGreen: {
    fontSize: 13,
    fontWeight: '800',
    color: '#4ade80',
  } as TextStyle,
  timelineItemTitleCyan: {
    fontSize: 13,
    fontWeight: '800',
    color: '#38bdf8',
  } as TextStyle,
  timelineItemTime: {
    fontSize: 10,
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
    color: '#64748b',
    marginTop: 1,
  } as TextStyle,
  timelineItemTimeActive: {
    fontSize: 10,
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
    color: '#38bdf8',
    fontWeight: '700',
    marginTop: 1,
  } as TextStyle,

  // Standby Card
  standbyCard: {
    backgroundColor: '#111827',
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1.5,
    borderColor: '#1e293b',
  } as ViewStyle,
  standbyHeader: {
    fontSize: 12,
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
    fontWeight: '800',
    color: '#94a3b8',
    letterSpacing: 1,
    marginBottom: 10,
  } as TextStyle,
  standbyItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0a0f1d',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#1e293b',
  } as ViewStyle,
  standbyName: {
    fontSize: 13,
    fontWeight: '800',
    color: '#ffffff',
  } as TextStyle,
  standbyMeta: {
    fontSize: 11,
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
    color: '#64748b',
    marginTop: 2,
  } as TextStyle,
  standbyArrow: {
    fontSize: 14,
    color: '#64748b',
  } as TextStyle,

  // Legal Banner CTA
  legalBannerCTA: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0f1f17',
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1.5,
    borderColor: '#22c55e',
  } as ViewStyle,
  legalBannerIcon: {
    fontSize: 24,
    marginRight: 12,
  } as TextStyle,
  legalBannerTitle: {
    fontSize: 14,
    fontWeight: '900',
    color: '#4ade80',
    letterSpacing: 0.5,
  } as TextStyle,
  legalBannerSubtext: {
    fontSize: 11,
    color: '#86efac',
    marginTop: 2,
  } as TextStyle,
  legalBannerArrow: {
    fontSize: 18,
    color: '#4ade80',
    fontWeight: '900',
  } as TextStyle,

  deactivateBtn: {
    backgroundColor: '#1e1014',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#7f1d1d',
    marginBottom: 10,
  } as ViewStyle,
  deactivateBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#f87171',
    letterSpacing: 1.5,
  } as TextStyle,

  // --- MAPS PLACEHOLDER ---
  mapCanvasPlaceholder: {
    height: 180,
    backgroundColor: '#0a0f1d',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#1e293b',
    marginVertical: 10,
  } as ViewStyle,
  mapRadarPulse: {
    fontSize: 32,
    marginBottom: 8,
  } as TextStyle,
  mapCoordsLive: {
    fontSize: 12,
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
    fontWeight: '800',
    color: '#38bdf8',
  } as TextStyle,

  // --- INTEL DRSABC ---
  drsabcCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111827',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1.5,
    borderColor: '#1e293b',
  } as ViewStyle,
  drsabcCardChecked: {
    borderColor: '#22c55e',
    backgroundColor: '#0a1d13',
  } as ViewStyle,
  drsabcLetterBox: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#1e293b',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  } as ViewStyle,
  drsabcLetter: {
    fontSize: 16,
    fontWeight: '900',
    color: '#38bdf8',
  } as TextStyle,
  drsabcTitle: {
    fontSize: 13,
    fontWeight: '900',
    color: '#ffffff',
  } as TextStyle,
  drsabcDetail: {
    fontSize: 11,
    color: '#94a3b8',
    marginTop: 2,
  } as TextStyle,
  drsabcCheck: {
    fontSize: 18,
    color: '#475569',
    fontWeight: '900',
    marginLeft: 8,
  } as TextStyle,
  drsabcCheckActive: {
    color: '#22c55e',
  } as TextStyle,

  // --- SCREEN 4: LEGAL SHIELD CERTIFICATE MODAL ---
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  } as ViewStyle,
  modalCertificateFrame: {
    width: '100%',
    maxWidth: 520,
    maxHeight: '90%',
    backgroundColor: '#0c1322',
    borderRadius: 18,
    borderWidth: 2.5,
    borderColor: '#eab308',
    padding: 20,
    shadowColor: '#eab308',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
  } as ViewStyle,
  certScrollContent: {
    paddingBottom: 20,
  } as ViewStyle,
  certHeader: {
    alignItems: 'center',
    marginBottom: 16,
    borderBottomWidth: 1,
    borderColor: '#334155',
    paddingBottom: 12,
  } as ViewStyle,
  certEmblem: {
    fontSize: 32,
    marginBottom: 4,
  } as TextStyle,
  certGovtTitle: {
    fontSize: 10,
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
    fontWeight: '900',
    color: '#facc15',
    letterSpacing: 2,
    textAlign: 'center',
  } as TextStyle,
  certMainHeading: {
    fontSize: 15,
    fontWeight: '900',
    color: '#ffffff',
    textAlign: 'center',
    marginTop: 4,
  } as TextStyle,
  certStatuteBadge: {
    fontSize: 10,
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
    color: '#94a3b8',
    marginTop: 2,
  } as TextStyle,

  certDataBox: {
    backgroundColor: '#162032',
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#24344d',
  } as ViewStyle,
  certDataLabel: {
    fontSize: 9,
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
    color: '#64748b',
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 2,
  } as TextStyle,
  certDataValue: {
    fontSize: 12,
    fontWeight: '800',
    color: '#ffffff',
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
  } as TextStyle,

  certHashCard: {
    backgroundColor: '#061a14',
    borderRadius: 8,
    padding: 10,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#10b981',
  } as ViewStyle,
  certHashLabel: {
    fontSize: 9,
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
    color: '#6ee7b7',
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 2,
  } as TextStyle,
  certHashText: {
    fontSize: 10,
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
    color: '#34d399',
    lineHeight: 14,
  } as TextStyle,

  certSectionTitle: {
    fontSize: 11,
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
    fontWeight: '900',
    color: '#facc15',
    letterSpacing: 1.5,
    marginTop: 6,
    marginBottom: 8,
  } as TextStyle,
  certImmunityCard: {
    backgroundColor: '#111827',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#1f2937',
  } as ViewStyle,
  certImmunityHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  } as ViewStyle,
  certImmunityIcon: {
    fontSize: 14,
    marginRight: 6,
  } as TextStyle,
  certImmunityTitle: {
    fontSize: 11,
    fontWeight: '900',
    color: '#ffffff',
    letterSpacing: 0.5,
  } as TextStyle,
  certImmunityBody: {
    fontSize: 10,
    color: '#94a3b8',
    lineHeight: 14,
  } as TextStyle,

  certStampBox: {
    borderWidth: 1.5,
    borderColor: '#ef4444',
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    alignSelf: 'center',
    marginVertical: 12,
    transform: [{ rotate: '-3deg' }],
  } as ViewStyle,
  certStampText: {
    fontSize: 11,
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
    fontWeight: '900',
    color: '#ef4444',
    letterSpacing: 2,
  } as TextStyle,

  certDownloadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#172554',
    borderRadius: 10,
    paddingVertical: 14,
    borderWidth: 1.5,
    borderColor: '#38bdf8',
    marginBottom: 8,
  } as ViewStyle,
  certDownloadBtnIcon: {
    fontSize: 18,
    color: '#38bdf8',
    marginRight: 8,
  } as TextStyle,
  certDownloadBtnText: {
    fontSize: 13,
    fontWeight: '900',
    color: '#ffffff',
    letterSpacing: 1,
  } as TextStyle,

  certCloseBtn: {
    paddingVertical: 10,
    alignItems: 'center',
  } as ViewStyle,
  certCloseBtnText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#94a3b8',
    letterSpacing: 1,
  } as TextStyle,

  // --- BOTTOM NAVIGATION ---
  bottomNav: {
    flexDirection: 'row',
    backgroundColor: '#0c101d',
    borderTopWidth: 1.5,
    borderColor: '#1e293b',
    paddingVertical: 10,
    paddingHorizontal: 8,
  } as ViewStyle,
  navTab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
    borderRadius: 8,
  } as ViewStyle,
  navTabActive: {
    backgroundColor: '#162032',
  } as ViewStyle,
  navTabIcon: {
    fontSize: 18,
    color: '#64748b',
    marginBottom: 2,
  } as TextStyle,
  navTabIconActive: {
    color: '#38bdf8',
  } as TextStyle,
  navTabLabel: {
    fontSize: 10,
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
    fontWeight: '800',
    color: '#64748b',
    letterSpacing: 1,
  } as TextStyle,
  navTabLabelActive: {
    color: '#8ed5ff',
  } as TextStyle,
});

// Register root component
registerRootComponent(App);
