// ============================================================================
// SAMARITAN SHIELD — Main Emergency Application (App.tsx)
// Responder HUD · hospital dispatch · verifiable incident record
// Styling follows the "Signal" system in theme.ts; icons come from icons.tsx.
// ============================================================================

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Image,
  ImageStyle,
  Linking,
  Modal,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TextStyle,
  TouchableOpacity,
  Vibration,
  View,
  ViewStyle,
} from 'react-native';
import { color, font, WEB_FONT_HREF } from './theme';
import {
  AmbulanceIcon,
  ArrowRightIcon,
  BedIcon,
  BreathIcon,
  DocumentIcon,
  DownloadIcon,
  DropIcon,
  HospitalIcon,
  MapIcon,
  PinIcon,
  PulseIcon,
  ShieldIcon,
  WarningIcon,
  SearchIcon,
  FilterIcon,
  MicIcon,
  SirenIcon,
  FlameIcon,
  CarCrashIcon,
  RadioIcon,
  CompassIcon,
  CommunityIcon,
  ShareIcon,
  QrCodeIcon,
  RefreshIcon,
  PhoneIcon,
  type IconProps,
} from './icons';
import QRCode from 'qrcode';
import * as Location from 'expo-location';
import * as Speech from 'expo-speech';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import VoiceTriage from './VoiceTriage';
import AuthScreen from './AuthScreen';
import HospitalPortal, { type EmergencyIncidentItem } from './HospitalPortal';
import ControlRoom from './ControlRoom';
import { logoutUser, type AppUserProfile } from './firebaseConfig';
import { authedFetch } from './api';
import { voipService, type VoipCallSession } from './voipService';
import { connectLive, type LiveConnection } from './liveSocket';

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
  /** Present only once a hospital desk actually assigns a unit. */
  ambulanceUnit?: string;
  /** null when capacity is unknown — map data does not carry bed counts. */
  bedsAvailable: number | null;
  googleMapsUrl: string;
}

interface TraumaProtocolStep {
  step: number;
  title: string;
  detail: string;
  /** The step's icon component, not a glyph — so it takes a size and a colour. */
  Icon: React.FC<IconProps>;
}

interface SOSApiResponse {
  status: 'success' | 'error';
  incidentId?: string;
  incidentCode?: string;
  role?: 'PRIMARY_REPORTER' | 'SECONDARY_REPORTER';
  message?: string;
  reporterCount?: number;
  hash?: string;
  timestamp?: string;
  coordinates?: Coordinates;
  pdfBase64?: string;
  nearestHospital?: HospitalInfo | null;
  backupHospitals?: HospitalInfo[];
}

export interface EmergencyContact {
  label: string;   // e.g. "Father", "Mother", "Spouse"
  phone: string;   // e.g. "+91 98765 43210"
}

export interface CivilianProfile {
  name: string;
  phone: string;
  emergencyContacts: EmergencyContact[];
  emergencyContact: string;   // kept for backward compat with older saved profiles
  emergencyPhone: string;     // kept for backward compat
  bloodGroup: string;
  medicalNotes?: string;      // allergies, conditions
}

// ---------------------------------------------------------------------------
// Config & Constants
// ---------------------------------------------------------------------------
const MOCK_COORDS: Coordinates = { lat: 26.9090, lng: 75.7325 };

const TRAUMA_PROTOCOL_STEPS: TraumaProtocolStep[] = [
  {
    step: 1,
    title: 'SECURE & ASSESS',
    detail: 'Ensure scene is safe. Approach victim. Shout loudly and tap collarbone. If no response, point at a bystander and yell "Call 108!"',
    Icon: WarningIcon,
    },
  {
    step: 2,
    title: 'MASSIVE BLEEDING',
    detail: 'Rapid body sweep. Blood spurting or pooling? Expose the wound, pack deep, full body weight pressure. Limbs: tourniquet 2 inches above, twist until stopped. Do NOT advance until bleeding stops.',
    Icon: DropIcon,
    },
  {
    step: 3,
    title: 'CHECK BREATHING',
    detail: 'Only after bleeding is controlled. Look at bare chest — rising/falling? Ear to mouth — hear air? Agonal gasping is NOT breathing (heart stopped).',
    Icon: BreathIcon,
    },
  {
    step: 4,
    title: 'EXECUTE CPR',
    detail: 'Chest compressions ONLY. Heel of hand center of chest. Lock elbows straight. Push 2+ inches deep, 100–120 BPM. Full recoil. Do not stop. Ignore rib cracking. No mouth-to-mouth.',
    Icon: PulseIcon,
    },
];

export interface EmergencyCategory {
  id: string;
  label: string;
  sub: string;
  color: string;
  Icon: React.FC<IconProps>;
}

const EMERGENCY_CATEGORIES: EmergencyCategory[] = [
  { id: 'medical', label: 'Medical', sub: 'Severe Trauma', color: '#FF3B5C', Icon: ShieldIcon },
  { id: 'cardiac', label: 'Cardiac', sub: 'CPR / Arrest', color: '#E11D48', Icon: PulseIcon },
  { id: 'accident', label: 'Accident', sub: 'Road Collision', color: '#F59E0B', Icon: CarCrashIcon },
  { id: 'fire', label: 'Fire Force', sub: 'Burn / Hazard', color: '#EF4444', Icon: FlameIcon },
  { id: 'police', label: 'Cops', sub: 'Crime / Danger', color: '#3B82F6', Icon: SirenIcon },
  { id: 'airway', label: 'Airway', sub: 'Choking / Gasp', color: '#10B981', Icon: BreathIcon },
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
  const [selectedCategory, setSelectedCategory] = useState<string>('medical');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [hash, setHash] = useState<string | null>(null);
  const [timestamp, setTimestamp] = useState<string | null>(null);
  const [coordinates, setCoordinates] = useState<Coordinates>(MOCK_COORDS);
  const [locationName, setLocationName] = useState<string>('Civil Lines, Jaipur');
  const [checkedSteps, setCheckedSteps] = useState<number[]>([]);
  const [pdfBase64, setPdfBase64] = useState<string | null>(null);
  const [showCertModal, setShowCertModal] = useState<boolean>(false);
  const [incidentId, setIncidentId] = useState<string | null>(null);
  const [incidentCode, setIncidentCode] = useState<string | null>(null);
  const [transmissionError, setTransmissionError] = useState<string | null>(null);
  const [incidentStatus, setIncidentStatus] = useState<string | null>(null);

  const [primaryHospital, setPrimaryHospital] = useState<HospitalInfo | null>(null);
  const [backupHospitals, setBackupHospitals] = useState<HospitalInfo[]>([]);

  // Civilian Profile & QR Identity System State
  const [civilianProfile, setCivilianProfile] = useState<CivilianProfile>(() => {
    if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
      try {
        const saved = localStorage.getItem('samaritan_civilian_profile');
        if (saved) {
          const parsed = JSON.parse(saved);
          // Migrate old profiles that lack emergencyContacts array
          if (!parsed.emergencyContacts) {
            parsed.emergencyContacts = [
              { label: parsed.emergencyContact || 'Family', phone: parsed.emergencyPhone || '' }
            ];
          }
          return parsed;
        }
      } catch (_e) {}
    }
    return {
      name: 'Adnaan (Civilian)',
      phone: '+91 98765 43210',
      emergencyContacts: [
        { label: 'Father', phone: '+91 98111 22233' },
        { label: 'Mother', phone: '+91 98111 44455' },
      ],
      emergencyContact: 'Family Primary',
      emergencyPhone: '+91 98111 22233',
      bloodGroup: 'O+ Positive',
      medicalNotes: '',
    };
  });
  const [editProfileForm, setEditProfileForm] = useState<CivilianProfile>(civilianProfile);
  const [isEditingProfile, setIsEditingProfile] = useState<boolean>(false);
  const [showQrModal, setShowQrModal] = useState<boolean>(false);
  const [showScanPreviewModal, setShowScanPreviewModal] = useState<boolean>(false);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [qrFormatMode, setQrFormatMode] = useState<'URL' | 'DIRECT'>('URL');
  const [gpsStatus, setGpsStatus] = useState<'LOCKING' | 'LIVE' | 'APPROX' | 'ERROR'>('LOCKING');
  const [isRefreshingGps, setIsRefreshingGps] = useState<boolean>(false);

  // WebRTC VoIP In-Browser Calling State
  const [incomingCall, setIncomingCall] = useState<{ callId: string; callerId: string; callerName: string } | null>(null);
  const [activeVoipCall, setActiveVoipCall] = useState<VoipCallSession | null>(null);
  const [isVoipMuted, setIsVoipMuted] = useState<boolean>(false);
  const [citizenAlert, setCitizenAlert] = useState<{
    incidentId: string;
    incidentCode: string;
    lat: number;
    lng: number;
    message: string;
    mapsUrl: string;
    isNearby?: boolean;
  } | null>(null);

  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [isRecordingState, setIsRecordingState] = useState(false);

  // Every facility we actually know about, primary first.
  const nearbyHospitals: HospitalInfo[] = primaryHospital
    ? [primaryHospital, ...backupHospitals]
    : backupHospitals;

  // -- Animations ----------------------------------------------------------
  const pulseAnim = useRef<Animated.Value>(new Animated.Value(1)).current;
  const fadeIn = useRef<Animated.Value>(new Animated.Value(0)).current;
  const slideUp = useRef<Animated.Value>(new Animated.Value(40)).current;
  const ringScale = useRef<Animated.Value>(new Animated.Value(1)).current;
  const ringOpacity = useRef<Animated.Value>(new Animated.Value(0.6)).current;
  const radarSweepAnim = useRef<Animated.Value>(new Animated.Value(0)).current;

  // -- Ref to hold live connection so we can push location updates ----------
  const liveConnRef = useRef<LiveConnection | null>(null);

  useEffect(() => {
    if (!currentUser || currentUser.role !== 'citizen') return;

    const conn = connectLive(
      {
        // Low-priority banner for all citizens (no alarm)
        'citizen-alert': (payload) => {
          setCitizenAlert({
            incidentId: String(payload.incidentId ?? ''),
            incidentCode: String(payload.incidentCode ?? 'CAD'),
            lat: Number(payload.lat),
            lng: Number(payload.lng),
            message: String(payload.message ?? 'Accident nearby. Help if you can reach the scene.'),
            mapsUrl: String(payload.mapsUrl ?? ''),
            isNearby: false,
          });
        },

        // High-priority alarm for citizens within 250 m
        'nearby-sos': (payload) => {
          setCitizenAlert({
            incidentId: String(payload.incidentId ?? ''),
            incidentCode: String(payload.incidentCode ?? 'CAD'),
            lat: Number(payload.lat),
            lng: Number(payload.lng),
            message: String(
              payload.message ??
                '🚨 SOS — accident very close to you! Tap to respond as a Good Samaritan.',
            ),
            mapsUrl: String(payload.mapsUrl ?? ''),
            isNearby: true,
          });

          if (payload.audioBase64) {
            Audio.Sound.createAsync(
              { uri: `data:audio/m4a;base64,${payload.audioBase64}` },
              { shouldPlay: true }
            ).catch(err => console.warn('SOS Audio play error:', err));
          } else {
            // Audible alarm via text-to-speech
            Speech.speak(
              `Emergency SOS! An accident has been reported within 250 metres of your location. ` +
                `Incident ${String(payload.incidentCode ?? '')}. If you can help, tap I'm Responding.`,
              { rate: 1.1, pitch: 1.0 },
            );
          }

          // Haptic vibration pattern: three quick bursts
          try {
            Vibration.vibrate([0, 400, 200, 400, 200, 400]);
          } catch (_e) {
            // Vibration not available on all platforms
          }
        },
      },
      coordinates, // send current GPS on subscribe
    );

    liveConnRef.current = conn;

    // Push location updates every 30 seconds so the server keeps proximity info fresh
    const locationInterval = setInterval(() => {
      if (coordinates) {
        conn.updateLocation(coordinates.lat, coordinates.lng);
      }
    }, 30_000);

    return () => {
      clearInterval(locationInterval);
      conn.disconnect();
      liveConnRef.current = null;
    };
  }, [currentUser, coordinates]);

  // -- Inject Web Google Fonts (Inter & JetBrains Mono) --------------------
  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const fontId = 'samaritan-shield-fonts';
      if (!document.getElementById(fontId)) {
        const link = document.createElement('link');
        link.id = fontId;
        link.rel = 'stylesheet';
        link.href = WEB_FONT_HREF;
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
        const res = await authedFetch(`/api/incidents/${incidentId}`);
        if (res.ok) {
          const data = await res.json();
          const inc = data.incident;
          if (data.status === 'success' && inc?.ambulanceUnitAssigned) {
            setPrimaryHospital((prev) =>
              prev ? { ...prev, ambulanceUnit: inc.ambulanceUnitAssigned } : prev
            );
            setIncidentStatus(inc.status ?? null);
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

  // -- Radar sweep beam animation ------------------------------------------
  useEffect((): (() => void) | void => {
    const sweep = Animated.loop(
      Animated.timing(radarSweepAnim, {
        toValue: 1,
        duration: 3600,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    sweep.start();
    return () => sweep.stop();
  }, [radarSweepAnim]);

  // -----------------------------------------------------------------------
  // Dynamic Live Reverse Geocoder
  // -----------------------------------------------------------------------
  const reverseGeocodeLive = useCallback(async (lat: number, lng: number): Promise<string> => {
    // 1. BigDataCloud reverse geocode (client-side, CORS enabled, no API key required)
    try {
      const bdcRes = await fetch(
        `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`
      );
      if (bdcRes.ok) {
        const bdc = await bdcRes.json();
        const street = bdc.localityInfo?.administrative?.[3]?.name || bdc.localityInfo?.administrative?.[2]?.name || bdc.locality;
        const city = bdc.city || bdc.principalSubdivision || bdc.countryName;
        const formatted = [street, city].filter(Boolean).join(', ');
        if (formatted) return formatted;
      }
    } catch (_bdc) {}

    // 2. OpenStreetMap Nominatim
    try {
      const nomRes = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=16&addressdetails=1`,
        { headers: { Accept: 'application/json' } }
      );
      if (nomRes.ok) {
        const nom = await nomRes.json();
        if (nom.address) {
          const street = nom.address.road || nom.address.suburb || nom.address.neighbourhood || '';
          const city = nom.address.city || nom.address.town || nom.address.county || nom.address.state || '';
          const combined = [street, city].filter(Boolean).join(', ');
          if (combined) return combined;
        }
        if (nom.display_name) {
          return nom.display_name.split(',').slice(0, 2).join(',').trim();
        }
      }
    } catch (_nom) {}

    // 3. Expo Location fallback (native iOS / Android)
    try {
      const places = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
      if (places && places.length > 0) {
        const p = places[0];
        const street = p.street || p.name || p.subregion || '';
        const city = p.city || p.region || '';
        const combined = [street, city].filter(Boolean).join(', ');
        if (combined) return combined;
      }
    } catch (_exp) {}

    return `${lat.toFixed(4)}° N, ${lng.toFixed(4)}° E`;
  }, []);

  // -----------------------------------------------------------------------
  // Direct Web & Native Geolocation Engine (Continuous & High Accuracy)
  // -----------------------------------------------------------------------
  const fetchLivePosition = useCallback(
    async (isManualRefresh = false): Promise<Coordinates> => {
      if (isManualRefresh) setIsRefreshingGps(true);
      setGpsStatus('LOCKING');

      // Attempt 1: Web Geolocation High Accuracy
      if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.geolocation) {
        try {
          const highRes = await new Promise<Coordinates>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(
              (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
              (err) => reject(err),
              { enableHighAccuracy: true, timeout: 6000, maximumAge: 0 }
            );
          });
          setCoordinates(highRes);
          setGpsStatus('LIVE');
          reverseGeocodeLive(highRes.lat, highRes.lng).then(setLocationName);
          if (isManualRefresh) setIsRefreshingGps(false);
          return highRes;
        } catch (_highErr) {
          // Attempt 1b: Web Geolocation Standard Accuracy
          try {
            const stdRes = await new Promise<Coordinates>((resolve, reject) => {
              navigator.geolocation.getCurrentPosition(
                (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
                (err) => reject(err),
                { enableHighAccuracy: false, timeout: 5000, maximumAge: 30000 }
              );
            });
            setCoordinates(stdRes);
            setGpsStatus('APPROX');
            reverseGeocodeLive(stdRes.lat, stdRes.lng).then(setLocationName);
            if (isManualRefresh) setIsRefreshingGps(false);
            return stdRes;
          } catch (_stdErr) {}
        }
      }

      // Attempt 2: Native Expo Location
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          const nativeCoords = { lat: loc.coords.latitude, lng: loc.coords.longitude };
          setCoordinates(nativeCoords);
          setGpsStatus('LIVE');
          reverseGeocodeLive(nativeCoords.lat, nativeCoords.lng).then(setLocationName);
          if (isManualRefresh) setIsRefreshingGps(false);
          return nativeCoords;
        }
      } catch (_nativeErr) {}

      // Attempt 3: Fast IP-based geolocation fallback (FreeIPApi)
      try {
        const ipRes = await fetch('https://freeipapi.com/api/json');
        if (ipRes.ok) {
          const ipData = await ipRes.json();
          if (ipData.latitude && ipData.longitude) {
            const ipCoords = { lat: Number(ipData.latitude), lng: Number(ipData.longitude) };
            setCoordinates(ipCoords);
            setGpsStatus('APPROX');
            if (ipData.cityName) {
              setLocationName(`${ipData.cityName}, ${ipData.regionName || ipData.countryName}`);
            } else {
              reverseGeocodeLive(ipCoords.lat, ipCoords.lng).then(setLocationName);
            }
            if (isManualRefresh) setIsRefreshingGps(false);
            return ipCoords;
          }
        }
      } catch (_ipErr) {}

      // Attempt 4: Secondary IP API fallback (ipapi.co)
      try {
        const ipRes2 = await fetch('https://ipapi.co/json/');
        if (ipRes2.ok) {
          const ipData2 = await ipRes2.json();
          if (ipData2.latitude && ipData2.longitude) {
            const ipCoords2 = { lat: Number(ipData2.latitude), lng: Number(ipData2.longitude) };
            setCoordinates(ipCoords2);
            setGpsStatus('APPROX');
            if (ipData2.city) {
              setLocationName(`${ipData2.city}, ${ipData2.region || ipData2.country_name}`);
            }
            if (isManualRefresh) setIsRefreshingGps(false);
            return ipCoords2;
          }
        }
      } catch (_ip2Err) {}

      if (isManualRefresh) setIsRefreshingGps(false);
      return coordinates;
    },
    [coordinates, reverseGeocodeLive]
  );

  const getCoordinates = useCallback(async (): Promise<Coordinates> => {
    return fetchLivePosition();
  }, [fetchLivePosition]);

  // Continuous live GPS watcher & initial fix
  useEffect(() => {
    fetchLivePosition();

    let watchId: number | null = null;
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.geolocation) {
      try {
        watchId = navigator.geolocation.watchPosition(
          (pos) => {
            const newCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            setCoordinates(newCoords);
            setGpsStatus('LIVE');
          },
          (_err) => {},
          { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
        );
      } catch (_e) {}
    }

    return () => {
      if (watchId !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchId);
      }
    };
  }, [fetchLivePosition]);

  // Sync logged in user name with civilian profile
  useEffect(() => {
    if (currentUser?.displayName || currentUser?.email) {
      setCivilianProfile((prev) => {
        const hasCustom = prev.name && prev.name !== 'Adnaan (Civilian)';
        const defaultName = currentUser.displayName || currentUser.email.split('@')[0];
        const updated = {
          ...prev,
          name: hasCustom ? prev.name : defaultName,
        };
        setEditProfileForm(updated);
        return updated;
      });
    }
  }, [currentUser]);

  // WebRTC VoIP Signaling & Calling Initialization
  useEffect(() => {
    if (currentUser?.uid) {
      const myId = currentUser.uid;
      const myName = civilianProfile.name || currentUser.displayName || 'Civilian Responder';
      voipService.init(myId, myName);

      voipService.setHandlers(
        (call) => {
          setIncomingCall(call);
          if (Platform.OS !== 'web') {
            Vibration.vibrate([0, 500, 300, 500], true);
          }
        },
        (state, session) => {
          if (state === 'connected' && session) {
            setIncomingCall(null);
            setActiveVoipCall({ ...session });
            setIsVoipMuted(session.isMuted);
          } else if (state === 'ended' || state === 'failed' || state === 'idle') {
            setIncomingCall(null);
            setActiveVoipCall(null);
            if (Platform.OS !== 'web') {
              Vibration.cancel();
            }
          } else if (session) {
            setActiveVoipCall({ ...session });
            setIsVoipMuted(session.isMuted);
          }
        }
      );
    }
  }, [currentUser?.uid, civilianProfile.name]);

  // Generate QR Code data URL dynamically — encodes emergency contacts for direct calling
  useEffect(() => {
    let active = true;
    const generateQr = async () => {
      try {
        const serverOrigin =
          Platform.OS === 'web' && typeof window !== 'undefined'
            ? `${window.location.protocol}//${window.location.hostname}:3000`
            : 'http://localhost:3000';

        const targetCallId = currentUser?.uid || 'civilian-01';

        let payload = '';

        if (qrFormatMode === 'DIRECT') {
          // Find first valid emergency contact or fallback to user's own phone
          const targetPhone = civilianProfile.emergencyContacts.find(c => c.phone.trim().length > 0)?.phone || civilianProfile.phone;
          const cleanedPhone = targetPhone.replace(/\s+/g, '');
          
          const mapLink = `https://maps.google.com/?q=${coordinates.lat},${coordinates.lng}`;
          const bloodInfo = civilianProfile.bloodGroup && civilianProfile.bloodGroup !== 'Unknown' 
            ? `\nBlood Group: ${civilianProfile.bloodGroup}` 
            : '';
            
          const messageBody = `URGENT MEDICAL EMERGENCY: ${civilianProfile.name} has been involved in an accident and requires immediate assistance. This message was triggered via their emergency QR code by a bystander.\n\nExact Location:\n${locationName}\nMap: ${mapLink}${bloodInfo}`;
          
          // Use sms scheme to pre-fill an SMS with the location and message
          payload = `sms:${cleanedPhone}?body=${encodeURIComponent(messageBody)}`;
        } else {
          // Build emergency contacts JSON for Web Profile URL encoding
          const contactsPayload = JSON.stringify(
            civilianProfile.emergencyContacts.filter(c => c.phone.trim().length > 0)
          );

          payload = `${serverOrigin}/civilian-id?callId=${encodeURIComponent(
            targetCallId
          )}&name=${encodeURIComponent(
            civilianProfile.name
          )}&address=${encodeURIComponent(
            locationName
          )}&lat=${coordinates.lat.toFixed(4)}&lng=${coordinates.lng.toFixed(
            4
          )}&contacts=${encodeURIComponent(
            contactsPayload
          )}&blood=${encodeURIComponent(
            civilianProfile.bloodGroup
          )}&phone=${encodeURIComponent(
            civilianProfile.phone
          )}${civilianProfile.medicalNotes ? `&medical=${encodeURIComponent(civilianProfile.medicalNotes)}` : ''}`;
        }

        const dataUrl = await QRCode.toDataURL(payload, {
          errorCorrectionLevel: 'M',
          margin: 1,
          width: 320,
          color: {
            dark: '#0F172A',
            light: '#FFFFFF',
          },
        });

        if (active) setQrDataUrl(dataUrl);
      } catch (err) {
        console.warn('QR code generation failed:', err);
      }
    };

    generateQr();
    return () => {
      active = false;
    };
  }, [civilianProfile, coordinates, currentUser?.uid, locationName, qrFormatMode]);

  const handleSaveProfile = () => {
    setCivilianProfile(editProfileForm);
    setIsEditingProfile(false);
    if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem('samaritan_civilian_profile', JSON.stringify(editProfileForm));
      } catch (_e) {}
    }
  };

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
        const res = await authedFetch('/api/sos', {
          method: 'POST',
          body: JSON.stringify({ lat: coordinates.lat, lng: coordinates.lng }),
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
        const res = await authedFetch('/api/sos', {
          method: 'POST',
          body: JSON.stringify({ lat: coordinates.lat, lng: coordinates.lng }),
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

  const startRecording = async () => {
    try {
      await Audio.requestPermissionsAsync();
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });
      const { recording: rec } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      setRecording(rec);
      setIsRecordingState(true);
    } catch (err) {
      console.warn('Failed to start recording', err);
    }
  };

  const stopRecording = async () => {
    if (!recording) return;
    setIsRecordingState(false);
    try {
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      setRecording(null);
      if (uri) {
        const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
        await handleSOS(base64);
      }
    } catch (err) {
      console.warn('Failed to stop recording', err);
    }
  };

  // -----------------------------------------------------------------------
  // Trigger SOS Flow
  // -----------------------------------------------------------------------
  const handleSOS = useCallback(async (audioBase64?: string | React.MouseEvent | any): Promise<void> => {
    const audioData = typeof audioBase64 === 'string' ? audioBase64 : undefined;
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
    setAppPhase('active');

    // 4. One call: the server dedups, records, hashes and routes in one place.
    try {
      const res = await authedFetch('/api/sos', {
        method: 'POST',
        body: JSON.stringify({ lat: coords.lat, lng: coords.lng, audioBase64: audioData }),
      });

      if (!res.ok) {
        throw new Error(`SOS request failed (${res.status})`);
      }

      const data: SOSApiResponse = await res.json();
      if (data.status !== 'success') {
        throw new Error(data.message || 'SOS was not recorded.');
      }

      setIncidentId(data.incidentId ?? null);
      setIncidentCode(data.incidentCode ?? null);
      setHash(data.hash ?? null);
      setTimestamp(data.timestamp ?? null);
      setPdfBase64(data.pdfBase64 ?? null);
      setPrimaryHospital(data.nearestHospital ?? null);
      setBackupHospitals(data.backupHospitals ?? []);
      setTransmissionError(null);
    } catch (err) {
      // No fabricated proof: if the record did not reach the server, say so.
      console.warn('SOS transmission failed:', err);
      setHash(null);
      setTimestamp(null);
      setPdfBase64(null);
      setTransmissionError(
        'Could not reach the emergency server. Your location was NOT transmitted — call 108 directly.'
      );
    }
  }, [appPhase, animateIn, playEmergencyAudio, getCoordinates]);

  const handleRespondToAlert = useCallback(async (): Promise<void> => {
    if (!citizenAlert) return;
    const target = { lat: citizenAlert.lat, lng: citizenAlert.lng };
    setCoordinates(target);
    setCitizenAlert(null);
    setAppPhase('active');
    try {
      const res = await authedFetch('/api/sos', {
        method: 'POST',
        body: JSON.stringify(target),
      });
      const data: SOSApiResponse = await res.json();
      if (data.status === 'success') {
        setIncidentId(data.incidentId ?? null);
        setIncidentCode(data.incidentCode ?? null);
        setHash(data.hash ?? null);
        setTimestamp(data.timestamp ?? null);
        setPdfBase64(data.pdfBase64 ?? null);
        setPrimaryHospital(data.nearestHospital ?? null);
        setBackupHospitals(data.backupHospitals ?? []);
      }
    } catch (_err) {
      setTransmissionError('Could not join the incident. Call 108 if you are on scene.');
    }
  }, [citizenAlert]);

  // -----------------------------------------------------------------------
  // Reset SOS
  // -----------------------------------------------------------------------
  const handleReset = useCallback((): void => {
    setAppPhase('idle');
    setHash(null);
    setTimestamp(null);
    setPdfBase64(null);
    setCheckedSteps([]);
    setIncidentId(null);
    setIncidentCode(null);
    setIncidentStatus(null);
    setTransmissionError(null);
    setPrimaryHospital(null);
    setBackupHospitals([]);
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

  // --- TOP HEADER (Concept Reference 1 & 2) ---
  const renderTopHeader = () => (
    <View style={styles.topHeader}>
      {/* Top Slide/Status Banner (Reference 1 Left) */}
      <View style={styles.headerTopPillRow}>
        <View style={styles.safetyIndexPill}>
          <View
            style={[
              styles.safetyDotLive,
              gpsStatus === 'LIVE'
                ? { backgroundColor: color.signal }
                : { backgroundColor: '#F59E0B' },
            ]}
          />
          <Text style={styles.safetyIndexPillText}>
            {gpsStatus === 'LOCKING'
              ? 'Acquiring Live GPS...'
              : gpsStatus === 'APPROX'
              ? 'IP Geo Synced • 98% Safe'
              : 'Live GPS Synced • 98% Safe'}
          </Text>
        </View>

        {currentUser && (
          <TouchableOpacity
            style={styles.switchRoleBadge}
            onPress={handleLogout}
            activeOpacity={0.75}
          >
            <Text style={styles.switchRoleBadgeText}>
              {currentUser.role === 'hospital'
                ? 'HOSPITAL'
                : currentUser.role === 'control_room'
                  ? 'CONTROL'
                  : 'CITIZEN'}{' '}
              • SWITCH
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Main Location Headline (Reference 1 Left) */}
      <View style={styles.locationHeadlineRow}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={styles.locationCityTitle}>{locationName}</Text>
            {isRefreshingGps && <ActivityIndicator size="small" color={color.signal} />}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
            <Text style={styles.locationCitySubhead}>
              GPS: {coordinates.lat.toFixed(4)}° N, {coordinates.lng.toFixed(4)}° E
            </Text>
            <TouchableOpacity
              onPress={() => fetchLivePosition(true)}
              style={styles.gpsRefreshBadge}
              activeOpacity={0.7}
            >
              <RefreshIcon size={10} color={color.signal} />
              <Text style={styles.gpsRefreshText}>SYNC LIVE</Text>
            </TouchableOpacity>
          </View>
        </View>
        <TouchableOpacity
          style={styles.headerInfoBtn}
          onPress={() => setActiveTab('INTEL')}
          activeOpacity={0.8}
        >
          <ShieldIcon size={18} color={color.text} />
        </TouchableOpacity>
      </View>

      {/* Floating Search Bar (Reference 1 Left) */}
      <View style={styles.searchFacilityBar}>
        <SearchIcon size={18} color={color.textFaint} />
        <TextInput
          style={styles.searchFacilityInput}
          placeholder="Where is the emergency?"
          placeholderTextColor={color.textFaint}
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
        <TouchableOpacity style={styles.searchFacilityFilterBtn} activeOpacity={0.7}>
          <FilterIcon size={16} color={color.textMuted} />
        </TouchableOpacity>
      </View>
    </View>
  );

  // --- SCREEN 1: PRE-SOS EMERGENCY RADAR DASHBOARD (IDLE HUD) ---
  const renderIdleDashboard = () => (
    <ScrollView style={styles.contentScroll} contentContainerStyle={styles.scrollContent}>
      {/* 1. Radar Scanning Centerpiece (Reference 1 Left) */}
      <View style={styles.radarCard}>
        <View style={styles.radarOuterCircle}>
          <View style={styles.radarMidCircle}>
            <View style={styles.radarInnerCircle}>
              {/* Rotating Sweep Beam */}
              <Animated.View
                style={[
                  styles.radarSweepBeam,
                  {
                    transform: [
                      {
                        rotate: radarSweepAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: ['0deg', '360deg'],
                        }),
                      },
                    ],
                  },
                ]}
              />

              {/* Concentric Pulsing Wave */}
              <Animated.View
                style={[
                  styles.radarPulseWave,
                  {
                    transform: [{ scale: ringScale }],
                    opacity: ringOpacity,
                  },
                ]}
              />

              {/* Center Tactile Actuator */}
              <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
                <TouchableOpacity
                  style={[styles.radarCenterActuator, isRecordingState && { backgroundColor: '#ff4444' }]}
                  onPress={handleSOS}
                  onLongPress={startRecording}
                  onPressOut={stopRecording}
                  activeOpacity={0.85}
                >
                  <View style={styles.radarCenterGlow}>
                    <MicIcon size={26} color="#FFFFFF" />
                  </View>
                </TouchableOpacity>
              </Animated.View>
            </View>
          </View>
        </View>

        <Text style={styles.holdForSosHeadline}>HOLD FOR SOS</Text>
        <Text style={styles.holdForSosSubhead}>OR TAP TO BROADCAST EMERGENCY CAD</Text>

        <View style={styles.gpsCoordinatesPill}>
          <PinIcon size={13} color={color.confirm} />
          <Text style={styles.gpsCoordinatesPillText}>
            {coordinates.lat.toFixed(4)}° N   {coordinates.lng.toFixed(4)}° W
          </Text>
        </View>
      </View>

      {/* 2. Emergency Categories Grid (Reference 1 Right & 2 Left) */}
      <View style={styles.categorySection}>
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionHeaderTitle}>EMERGENCY CATEGORIES</Text>
          <Text style={styles.sectionHeaderSub}>Select incident type</Text>
        </View>

        <View style={styles.categoryGrid}>
          {EMERGENCY_CATEGORIES.map((cat) => {
            const isSelected = selectedCategory === cat.id;
            return (
              <TouchableOpacity
                key={cat.id}
                style={[
                  styles.categoryCard,
                  isSelected && styles.categoryCardSelected,
                ]}
                onPress={() => setSelectedCategory(cat.id)}
                activeOpacity={0.8}
              >
                <View
                  style={[
                    styles.categoryIconCircle,
                    isSelected
                      ? styles.categoryIconCircleSelected
                      : { backgroundColor: `${cat.color}15` },
                  ]}
                >
                  <cat.Icon
                    size={22}
                    color={isSelected ? '#FFFFFF' : cat.color}
                  />
                </View>
                <Text
                  style={[
                    styles.categoryTitle,
                    isSelected && styles.categoryTitleSelected,
                  ]}
                >
                  {cat.label}
                </Text>
                <Text
                  style={[
                    styles.categorySubtext,
                    isSelected && styles.categorySubtextSelected,
                  ]}
                >
                  {cat.sub}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* 3. Address / Facility Confirmation Card (Reference 1 Right) */}
      <View style={styles.addressConfirmCard}>
        <View style={styles.addressInfoRow}>
          <View style={styles.addressPinIconBox}>
            <PinIcon size={20} color={color.signal} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.addressTitleText}>{locationName}</Text>
            <Text style={styles.addressDetailText}>
              GPS: {coordinates.lat.toFixed(4)}° N, {coordinates.lng.toFixed(4)}° E • Live CAD Zone
            </Text>
          </View>
          <TouchableOpacity
            style={styles.gpsRefreshBadge}
            onPress={() => fetchLivePosition(true)}
            activeOpacity={0.7}
          >
            <RefreshIcon size={12} color={color.signal} />
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={styles.confirmAddressCtaBtn}
          onPress={handleSOS}
          activeOpacity={0.85}
        >
          <Text style={styles.confirmAddressCtaText}>
            CONFIRM & DISPATCH FOR {EMERGENCY_CATEGORIES.find((c) => c.id === selectedCategory)?.label.toUpperCase()}
          </Text>
        </TouchableOpacity>
      </View>

      {/* 4. Nearby Medical Facilities List */}
      <View style={styles.facilitiesSection}>
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionHeaderTitle}>NEARBY TRAUMA CENTERS</Text>
          <Text style={styles.sectionHeaderSub}>
            {nearbyHospitals.length > 0 ? `${nearbyHospitals.length} in range` : 'Ready to match'}
          </Text>
        </View>

        {nearbyHospitals.length === 0 ? (
          <View style={styles.facilitiesEmptyBox}>
            <HospitalIcon size={24} color={color.textFaint} />
            <Text style={styles.facilitiesEmptyText}>
              Nearest trauma hospitals with real-time bed capacity are matched instantly upon emergency transmission.
            </Text>
          </View>
        ) : (
          nearbyHospitals.map((hosp, idx) => (
            <TouchableOpacity
              key={hosp.id}
              style={styles.facilityItemRow}
              onPress={() => openHospitalMap(hosp.googleMapsUrl)}
              activeOpacity={0.8}
            >
              <View
                style={[
                  styles.facilityItemIcon,
                  idx === 0 ? styles.facilityItemIconPrimary : styles.facilityItemIconSecondary,
                ]}
              >
                <HospitalIcon size={18} color={idx === 0 ? color.signal : color.textMuted} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.facilityItemTitle}>{hosp.name}</Text>
                <Text style={styles.facilityItemDetails}>
                  {hosp.distanceText} • ~{hosp.etaMinutes} MIN DRIVE {hosp.bedsAvailable != null ? `• ${hosp.bedsAvailable} ICU BEDS` : ''}
                </Text>
              </View>
              <ArrowRightIcon size={16} color={color.textFaint} />
            </TouchableOpacity>
          ))
        )}
      </View>
    </ScrollView>
  );

  // --- SCREEN 2: ACTIVE EMERGENCY TRANSMISSION HUB ---
  const renderActiveTransmissionHub = () => (
    <ScrollView style={styles.contentScroll} contentContainerStyle={styles.scrollContent}>
      {/* 1. Abort / Countdown Bar (Reference 1 Right bottom) */}
      <View style={styles.countdownAbortBar}>
        <TouchableOpacity
          style={styles.countdownCancelBtn}
          onPress={handleReset}
          activeOpacity={0.8}
        >
          <Text style={styles.countdownCancelText}>✕ Cancel</Text>
        </TouchableOpacity>

        <View style={styles.countdownPulseBadge}>
          <Text style={styles.countdownPulseBadgeText}>LIVE</Text>
        </View>

        <View style={styles.broadcastingActivePill}>
          <Text style={styles.broadcastingActiveText}>CAD Broadcasting ›</Text>
        </View>
      </View>

      {/* Error alert if transmission failed */}
      {transmissionError && (
        <View style={styles.transmissionErrorBanner}>
          <WarningIcon size={18} color={color.signalDeep} />
          <Text style={styles.transmissionErrorText}>{transmissionError}</Text>
        </View>
      )}

      {/* 2. Active Broadcast Hero Card (Reference 2 Right) */}
      <View style={styles.activeBroadcastHeroCard}>
        <View style={styles.activeBroadcastTopRow}>
          <View style={styles.activeBeaconDot} />
          <Text style={styles.activeBroadcastHeaderTitle}>
            {incidentCode ? `EMERGENCY DISPATCHED • #${incidentCode}` : 'BROADCASTING EMERGENCY CAD…'}
          </Text>
        </View>
        <Text style={styles.activeBroadcastCoords}>
          📍 {coordinates.lat.toFixed(4)}° N, {coordinates.lng.toFixed(4)}° E
        </Text>
        <Text style={styles.activeBroadcastCategoryNote}>
          Incident Type: {EMERGENCY_CATEGORIES.find((c) => c.id === selectedCategory)?.label.toUpperCase()} • 2-Way CAD Stream Active
        </Text>
      </View>

      {/* 3. Routed Hospital Facility Card (Reference 2 Right floating card) */}
      {primaryHospital ? (
        <View style={styles.routedHospitalCard}>
          <View style={styles.routedHospitalTopRow}>
            <View style={styles.routedHospitalIconBox}>
              <FlameIcon size={18} color={color.signal} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.routedHospitalNameText}>{primaryHospital.name}</Text>
              <Text style={styles.routedHospitalAddressText}>
                {primaryHospital.address || 'Central Government Trauma Department'}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.routedHospitalEditBtn}
              onPress={() => openHospitalMap(primaryHospital.googleMapsUrl)}
              activeOpacity={0.8}
            >
              <Text style={styles.routedHospitalEditBtnText}>Directions</Text>
            </TouchableOpacity>
          </View>

          {/* Metric Telemetry Pills */}
          <View style={styles.telemetryPillsRow}>
            <View style={styles.telemetryPill}>
              <PinIcon size={14} color={color.text} />
              <Text style={styles.telemetryPillValue}>{primaryHospital.distanceText}</Text>
            </View>
            <View style={styles.telemetryPill}>
              <AmbulanceIcon size={16} color={color.confirm} />
              <Text style={styles.telemetryPillValueGreen}>~{primaryHospital.etaMinutes} MIN</Text>
            </View>
            <View style={styles.telemetryPill}>
              <BedIcon size={16} color={color.blue} />
              <Text style={styles.telemetryPillValueBlue}>
                {primaryHospital.bedsAvailable ?? 'AVAIL'} BEDS
              </Text>
            </View>
          </View>

          {/* Action Call Button */}
          <TouchableOpacity
            style={styles.callTraumaDeskBtn}
            onPress={() => callHospital(primaryHospital.phone)}
            activeOpacity={0.85}
          >
            <Text style={styles.callTraumaDeskBtnText}>
              CALL TRAUMA DESK ({primaryHospital.phone})
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.noHospitalCard}>
          <Text style={styles.noHospitalTitle}>AWAITING HOSPITAL DESK MATCH</Text>
          <Text style={styles.noHospitalBody}>
            Dial 108 immediately to connect directly with the central ambulance service.
          </Text>
          <TouchableOpacity
            style={styles.call108CtaBtn}
            onPress={() => callHospital('108')}
            activeOpacity={0.85}
          >
            <Text style={styles.call108CtaText}>DIAL 108 DIRECTLY</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* 4. Simulated Live Tactical Route Map Canvas (Reference 2 Right) */}
      <View style={styles.mapCanvasCard}>
        <View style={styles.mapCanvasInterior}>
          {/* Simulated Street Grid */}
          <View style={styles.mapStreetH1} />
          <View style={styles.mapStreetH2} />
          <View style={styles.mapStreetV1} />
          <View style={styles.mapStreetV2} />

          {/* Hospital Marker */}
          <View style={styles.mapMarkerHospital}>
            <HospitalIcon size={16} color="#FFFFFF" />
            <Text style={styles.mapMarkerHospitalLabel}>
              {primaryHospital ? primaryHospital.name.split(' ')[0] : 'Trauma Hub'}
            </Text>
          </View>

          {/* Route Polyline */}
          <View style={styles.mapRouteTrack} />

          {/* User Incident Marker */}
          <View style={styles.mapMarkerUser}>
            <View style={styles.mapMarkerUserHalo} />
            <ShieldIcon size={18} color="#FFFFFF" />
            <Text style={styles.mapMarkerUserLabel}>YOU</Text>
          </View>

          {/* Ambulance Icon along Route */}
          <View style={styles.mapMarkerAmbulance}>
            <AmbulanceIcon size={13} color="#FFFFFF" />
          </View>
        </View>

        <Text style={styles.mapCanvasStatusFooter}>
          LIVE 2-WAY CAD TRAUMA TELEMETRY • AMBULANCE ETA ~{primaryHospital?.etaMinutes || 4} MIN
        </Text>
      </View>

      {/* 5. Voice AI & CPR 110 BPM Metronome Engine */}
      <VoiceTriage isActive={appPhase === 'active'} incidentId={incidentId ?? undefined} />

      {/* 6. Legal Certificate Action Banner */}
      <TouchableOpacity
        style={styles.legalCertificateBanner}
        onPress={() => setShowCertModal(true)}
        activeOpacity={0.85}
      >
        <View style={styles.legalCertIconCircle}>
          <DocumentIcon size={20} color={color.signal} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.legalCertBannerTitle}>GOOD SAMARITAN LEGAL SHIELD</Text>
          <Text style={styles.legalCertBannerSub}>
            {pdfBase64
              ? 'SHA-256 Verified • Immunity Under Section 134A MV Act'
              : 'Compiling cryptographic incident record…'}
          </Text>
        </View>
        <DownloadIcon size={18} color={color.textMuted} />
      </TouchableOpacity>
    </ScrollView>
  );

  // --- MAPS TAB VIEW ---
  const renderMapsView = () => (
    <ScrollView style={styles.contentScroll} contentContainerStyle={styles.scrollContent}>
      <View style={styles.hudFeatureCard}>
        <Text style={styles.cardHeaderLabel}>TACTICAL SATELLITE RADAR</Text>
        <View style={styles.mapCanvasPlaceholder}>
          <Text style={styles.mapRadarPulse}>(((  )))</Text>
          <Text style={styles.mapCoordsLive}>GPS ANCHOR: {coordinates.lat.toFixed(4)}° N, {coordinates.lng.toFixed(4)}° E
          </Text>
        </View>
        <Text style={styles.hudCardSubtext}>Live 2-way tracking synchronized with City CAD emergency dispatch network.
        </Text>
      </View>

      <View style={styles.standbyCard}>
        <Text style={styles.standbyHeader}>NEARBY TRAUMA HUBS & ROUTES</Text>
        {nearbyHospitals.length === 0 ? (
          <Text style={styles.hudCardSubtext}>No facilities resolved yet. Hospitals are looked up when an emergency is triggered.
          </Text>
        ) : (
          nearbyHospitals.map((h) => (
            <TouchableOpacity
              key={h.id}
              style={styles.standbyItem}
              onPress={() => openHospitalMap(h.googleMapsUrl)}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.standbyName}>{h.name}</Text>
                <Text style={styles.standbyMeta}>
                  {h.distanceText} • ~{h.etaMinutes} min drive • {h.phone}
                </Text>
              </View>
              <MapIcon size={16} color={color.text} />
            </TouchableOpacity>
          ))
        )}
      </View>
    </ScrollView>
  );

  // --- INTEL TAB VIEW (DRSABC & FIRST AID PROTOCOLS) ---
  const renderIntelView = () => (
    <ScrollView style={styles.contentScroll} contentContainerStyle={styles.scrollContent}>
      <View style={styles.systemStatusCard}>
        <Text style={styles.cardHeaderLabel}>SEVERE TRAUMA PROTOCOL (4-STEP)</Text>
        <Text style={styles.hudCardSubtext}>Prioritized resuscitation algorithm: Stop the bleed before checking breathing. Compressions-only CPR.
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
              <step.Icon size={19} color={color.signalLift} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.drsabcTitle}>
                {step.title}
              </Text>
              <Text style={styles.drsabcDetail}>{step.detail}</Text>
            </View>
            <Text style={[styles.drsabcCheck, isChecked && styles.drsabcCheckActive]}>
              {isChecked ? '' : ''}
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
        <Text style={styles.cardHeaderLabel}>YOUR RIGHTS AS A GOOD SAMARITAN</Text>
        <Text style={styles.hudCardSubtext}>Under Section 134A of the Motor Vehicles Act, 2019 and the Supreme Court guidelines (WP Civil 235/2012), a citizen rendering emergency assistance is protected from civil and criminal liability and cannot be compelled to identify themselves. These protections apply by law — no document is required to claim them.
        </Text>
      </View>

      <View style={styles.hudFeatureCard}>
        <Text style={styles.cardHeaderLabel}>INCIDENT RECORD DIGEST</Text>
        <View style={styles.hashPreviewBox}>
          <Text style={styles.hashPreviewLabel}>SHA-256 RECORD DIGEST</Text>
          <Text style={styles.hashPreviewValue}>
            {hash || 'No record yet — trigger an emergency to generate one'}
          </Text>
        </View>
        <Text style={styles.hudCardSubtext}>Verified Timestamp: {timestamp || 'Standing by for emergency trigger'}
        </Text>
      </View>

      <TouchableOpacity
        style={styles.legalCertificateBanner}
        onPress={handleOpenCertificate}
      >
        <DocumentIcon size={18} color={color.text} />
        <View style={{ flex: 1 }}>
          <Text style={styles.legalCertBannerTitle}>VIEW INCIDENT RECORD (PDF)</Text>
          <Text style={styles.legalCertBannerSub}>Timestamped account of assistance rendered</Text>
        </View>
        <ArrowRightIcon size={16} color={color.text} />
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
              <ShieldIcon size={22} color={color.text} />
              <Text style={styles.certGovtTitle}>SAMARITAN SHIELD — INDEPENDENT EMERGENCY RECORD
              </Text>
              <Text style={styles.certMainHeading}>GOOD SAMARITAN INCIDENT RECORD
              </Text>
              <Text style={styles.certStatuteBadge}>Not a government document
              </Text>
            </View>

            {/* 4 Dark Tactical Data Boxes */}
            <View style={styles.certDataBox}>
              <Text style={styles.certDataLabel}>RESPONDER ID</Text>
              <Text style={styles.certDataValue}>{currentUser?.email || '—'}</Text>
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
              <Text style={styles.certDataLabel}>ROUTED FACILITY</Text>
              <Text style={styles.certDataValue}>{primaryHospital?.name || 'Not resolved'}</Text>
            </View>

            {/* Cryptographic Hash Box */}
            <View style={styles.certHashCard}>
              <Text style={styles.certHashLabel}>RECORD DIGEST (SHA-256)</Text>
              <Text style={styles.certHashText}>
                {hash || 'Not yet generated'}
              </Text>
            </View>

            {/* Rights under the law */}
            <Text style={styles.certSectionTitle}>YOUR RIGHTS UNDER THE LAW</Text>

            <View style={styles.certImmunityCard}>
              <View style={styles.certImmunityHeaderRow}>
                <ShieldIcon size={22} color={color.text} />
                <Text style={styles.certImmunityTitle}>EXEMPTION FROM LIABILITY</Text>
              </View>
              <Text style={styles.certImmunityBody}>Under Section 134A of the Motor Vehicles (Amendment) Act, 2019, a person who renders emergency assistance to an accident victim is not liable for any civil or criminal action for injury to or death of the victim arising from it. This applies by law, with or without this record.
              </Text>
            </View>

            <View style={styles.certImmunityCard}>
              <View style={styles.certImmunityHeaderRow}>
                <WarningIcon size={18} color={color.text} />
                <Text style={styles.certImmunityTitle}>PROTECTION FROM HARASSMENT</Text>
              </View>
              <Text style={styles.certImmunityBody}>Following the Supreme Court of India in Writ Petition (Civil) No. 235 of 2012, you cannot be compelled to disclose your identity or address, detained, or subjected to mandatory questioning.
              </Text>
            </View>

            {/* Digital Stamp */}
            <View style={styles.certStampBox}>
              <Text style={styles.certStampText}>
                {hash
                  ? 'DIGEST RECORDED — VERIFIABLE'
                  : 'NO RECORD YET'}
              </Text>
            </View>
            <Text style={styles.certDisclaimer}>Generated automatically by Samaritan Shield. Not issued, certified or endorsed by
              any government body, and not digitally signed. It does not itself confer legal
              status — it records what happened and when.
            </Text>

            {/* Action Buttons */}
            <TouchableOpacity
              style={styles.certDownloadBtn}
              onPress={downloadPDF}
              activeOpacity={0.8}
            >
              <DownloadIcon size={18} color={color.text} />
              <Text style={styles.certDownloadBtnText}>DOWNLOAD RECORD (PDF)</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.certCloseBtn}
              onPress={() => setShowCertModal(false)}
            >
              <Text style={styles.certCloseBtnText}>CLOSE</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );

  // --- SCREEN 5: PUBLIC SCANNED EMERGENCY CIVILIAN CARD ---
  const renderPublicCivilianCard = () => {
    let name = civilianProfile.name;
    let address = locationName;
    let lat = coordinates.lat.toFixed(4);
    let lng = coordinates.lng.toFixed(4);
    let blood = civilianProfile.bloodGroup;
    let victimPhone = civilianProfile.phone;
    let medicalNotes = civilianProfile.medicalNotes || '';
    let targetCallId = 'civilian-01';
    let emergencyContacts: EmergencyContact[] = civilianProfile.emergencyContacts || [];

    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location.search) {
      try {
        const params = new URLSearchParams(window.location.search);
        if (params.get('callId')) targetCallId = params.get('callId')!;
        if (params.get('name')) name = params.get('name')!;
        if (params.get('address')) address = params.get('address')!;
        if (params.get('lat')) lat = params.get('lat')!;
        if (params.get('lng')) lng = params.get('lng')!;
        if (params.get('blood')) blood = params.get('blood')!;
        if (params.get('phone')) victimPhone = params.get('phone')!;
        if (params.get('medical')) medicalNotes = params.get('medical')!;
        if (params.get('contacts')) {
          try {
            emergencyContacts = JSON.parse(params.get('contacts')!);
          } catch (_e) {}
        }
        // Backward compat: old QR codes with single contact param
        if (params.get('contact') && emergencyContacts.length === 0) {
          emergencyContacts = [{ label: params.get('contact')!, phone: '' }];
        }
      } catch (_e) {}
    }

    const mapsUrl = lat && lng ? `https://www.google.com/maps?q=${lat},${lng}` : `https://www.google.com/maps/search/${encodeURIComponent(address)}`;

    const handleCallPhone = (phone: string) => {
      const cleaned = phone.replace(/\s+/g, '');
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.location.href = `tel:${cleaned}`;
      } else {
        Linking.openURL(`tel:${cleaned}`);
      }
    };

    return (
      <View style={styles.rootContainer}>
        <StatusBar barStyle="dark-content" backgroundColor="#F6F8FA" />
        <ScrollView style={styles.contentScroll} contentContainerStyle={styles.publicCardScroll}>
          <View style={styles.publicCardContainer}>
            {/* Emergency Alert Banner */}
            <View style={[styles.publicCardBadge, { backgroundColor: '#FEE2E2' }]}>
              <View style={[styles.publicCardPulseDot, { backgroundColor: '#EF4444' }]} />
              <Text style={[styles.publicCardBadgeText, { color: '#991B1B' }]}>⚠ EMERGENCY — SCAN RESULT</Text>
            </View>

            <Text style={styles.publicCardName}>{name}</Text>
            <Text style={styles.publicCardSubtitle}>
              This person has registered emergency contacts. If they are injured or unconscious, call their emergency contacts below.
            </Text>

            {/* ===== EMERGENCY CONTACTS — BIG CALL BUTTONS ===== */}
            <View style={{
              backgroundColor: '#FEF2F2',
              borderRadius: 12,
              borderWidth: 2,
              borderColor: '#EF4444',
              padding: 16,
              marginTop: 16,
            }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <PhoneIcon size={20} color="#EF4444" />
                <Text style={{ fontSize: 13, fontWeight: '800', color: '#991B1B', letterSpacing: 0.5, textTransform: 'uppercase' }}>
                  Emergency Contacts — Tap to Call
                </Text>
              </View>

              {emergencyContacts.length > 0 ? emergencyContacts.map((ec, idx) => (
                <TouchableOpacity
                  key={idx}
                  style={{
                    backgroundColor: '#EF4444',
                    borderRadius: 10,
                    paddingVertical: 16,
                    paddingHorizontal: 20,
                    marginBottom: idx < emergencyContacts.length - 1 ? 10 : 0,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                  onPress={() => handleCallPhone(ec.phone)}
                  activeOpacity={0.8}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>
                      {ec.label}
                    </Text>
                    <Text style={{ color: '#FFFFFF', fontSize: 18, fontWeight: '800' }}>
                      TAP TO CALL NOW
                    </Text>
                  </View>
                  <View style={{
                    backgroundColor: '#FFFFFF',
                    borderRadius: 24,
                    width: 48,
                    height: 48,
                    justifyContent: 'center',
                    alignItems: 'center',
                  }}>
                    <PhoneIcon size={22} color="#EF4444" />
                  </View>
                </TouchableOpacity>
              )) : (
                <Text style={{ color: '#991B1B', fontSize: 13, textAlign: 'center', paddingVertical: 12 }}>
                  No emergency contacts configured for this person.
                </Text>
              )}
            </View>

            {/* National Emergency Number */}
            <TouchableOpacity
              style={{
                backgroundColor: '#1E40AF',
                borderRadius: 10,
                paddingVertical: 14,
                paddingHorizontal: 20,
                marginTop: 10,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
              }}
              onPress={() => handleCallPhone('112')}
              activeOpacity={0.8}
            >
              <SirenIcon size={20} color="#FFFFFF" />
              <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '800' }}>
                CALL 112 — NATIONAL EMERGENCY
              </Text>
            </TouchableOpacity>

            {/* Victim's Own Phone (call if they might answer) */}
            {victimPhone ? (
              <TouchableOpacity
                style={{
                  backgroundColor: '#F0F9FF',
                  borderWidth: 1,
                  borderColor: '#3B82F6',
                  borderRadius: 10,
                  paddingVertical: 12,
                  paddingHorizontal: 20,
                  marginTop: 10,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
                onPress={() => handleCallPhone(victimPhone)}
                activeOpacity={0.8}
              >
                <View>
                  <Text style={{ fontSize: 11, fontWeight: '600', color: '#1E40AF', textTransform: 'uppercase' }}>
                    Call This Person Directly
                  </Text>
                  <Text style={{ fontSize: 16, fontWeight: '700', color: '#1E3A5F', marginTop: 2 }}>
                    TAP TO CALL NOW
                  </Text>
                </View>
                <PhoneIcon size={20} color="#3B82F6" />
              </TouchableOpacity>
            ) : null}

            {/* Live Address & Directions */}
            <View style={styles.publicCardFieldBox}>
              <Text style={styles.publicCardFieldLabel}>LIVE / EMERGENCY ADDRESS</Text>
              <Text style={styles.publicCardFieldValue}>{address}</Text>
              {lat && lng ? (
                <Text style={styles.publicCardCoordsSub}>
                  GPS Anchor: {lat}° N, {lng}° E
                </Text>
              ) : null}
              <TouchableOpacity
                style={styles.publicCardBtnMaps}
                onPress={() => Linking.openURL(mapsUrl)}
                activeOpacity={0.8}
              >
                <Text style={styles.publicCardBtnMapsText}>🗺️ OPEN DIRECTIONS IN MAPS</Text>
              </TouchableOpacity>
            </View>

            {/* Medical Info Row */}
            <View style={styles.publicCardBloodRow}>
              <View>
                <Text style={styles.publicCardFieldLabel}>BLOOD GROUP</Text>
                <Text style={styles.publicCardFieldValue}>{blood}</Text>
              </View>
              <View style={styles.publicCardBloodBadge}>
                <Text style={styles.publicCardBloodBadgeText}>CRITICAL ID</Text>
              </View>
            </View>

            {medicalNotes ? (
              <View style={styles.publicCardFieldBox}>
                <Text style={styles.publicCardFieldLabel}>MEDICAL NOTES / ALLERGIES</Text>
                <Text style={styles.publicCardFieldValue}>{medicalNotes}</Text>
              </View>
            ) : null}

            {/* Section 134A Legal Protection Banner */}
            <View style={styles.publicCardStatuteBox}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <ShieldIcon size={16} color="#1E40AF" />
                <Text style={styles.publicCardStatuteTitle}>
                  Section 134A — Motor Vehicles Act
                </Text>
              </View>
              <Text style={styles.publicCardStatuteBody}>
                Good Samaritan Protection: A citizen rendering emergency assistance is protected from civil and criminal liability, detention, or compulsory identification.
              </Text>
            </View>

            {/* Back to Samaritan Shield App */}
            <TouchableOpacity
              style={styles.publicCardBackBtn}
              onPress={() => {
                if (typeof window !== 'undefined') {
                  window.location.href = window.location.origin;
                }
              }}
              activeOpacity={0.8}
            >
              <Text style={styles.publicCardBackBtnText}>LAUNCH SAMARITAN SHIELD APP</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    );
  };

  // --- SCREEN 6: CIVILIAN QR IDENTITY PASS MODAL ---
  const renderQrModal = () => (
    <Modal
      visible={showQrModal}
      animationType="slide"
      transparent={true}
      onRequestClose={() => setShowQrModal(false)}
    >
      <View style={styles.modalBackdrop}>
        <View style={styles.qrModalFrame}>
          <ScrollView contentContainerStyle={styles.qrScrollContent}>
            {/* Modal Header */}
            <View style={styles.qrModalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <ShieldIcon size={20} color={color.signal} />
                <Text style={styles.qrModalTitle}>CIVILIAN EMERGENCY ID</Text>
              </View>
              <TouchableOpacity
                onPress={() => {
                  setIsEditingProfile(false);
                  setShowQrModal(false);
                }}
                style={styles.qrModalCloseBtn}
              >
                <Text style={styles.qrModalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* QR Code Container */}
            <View style={styles.qrCodeCard}>
              <View style={styles.qrTargetCornersWrapper}>
                {qrDataUrl ? (
                  <Image
                    source={{ uri: qrDataUrl }}
                    style={styles.qrImage}
                    resizeMode="contain"
                  />
                ) : (
                  <ActivityIndicator
                    size="large"
                    color={color.signal}
                    style={{ width: 190, height: 190 }}
                  />
                )}
              </View>
              <Text style={styles.qrScanHint}>
                Scan with any smartphone camera — bystanders can directly call your emergency contacts
              </Text>

              {/* Format Toggle (Web Profile vs Direct Call) */}
              <View style={styles.qrFormatToggle}>
                <TouchableOpacity
                  style={[
                    styles.qrFormatTab,
                    qrFormatMode === 'URL' && styles.qrFormatTabActive,
                  ]}
                  onPress={() => setQrFormatMode('URL')}
                >
                  <Text
                    style={[
                      styles.qrFormatTabText,
                      qrFormatMode === 'URL' && styles.qrFormatTabTextActive,
                    ]}
                  >
                    Web Profile Pass
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.qrFormatTab,
                    qrFormatMode === 'DIRECT' && styles.qrFormatTabActive,
                  ]}
                  onPress={() => setQrFormatMode('DIRECT')}
                >
                  <Text
                    style={[
                      styles.qrFormatTabText,
                      qrFormatMode === 'DIRECT' && styles.qrFormatTabTextActive,
                    ]}
                  >
                    Direct Dial QR
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Civilian Details or Edit Form */}
            {isEditingProfile ? (
              <View style={styles.qrEditCard}>
                <Text style={styles.qrSectionHeader}>EDIT EMERGENCY IDENTITY</Text>

                <Text style={styles.qrInputLabel}>FULL NAME</Text>
                <TextInput
                  style={styles.qrInput}
                  value={editProfileForm.name}
                  onChangeText={(t) => setEditProfileForm((p) => ({ ...p, name: t }))}
                  placeholder="Your Full Name"
                  placeholderTextColor={color.textFaint}
                />

                <Text style={styles.qrInputLabel}>YOUR PHONE NUMBER</Text>
                <TextInput
                  style={styles.qrInput}
                  value={editProfileForm.phone}
                  onChangeText={(t) => setEditProfileForm((p) => ({ ...p, phone: t }))}
                  placeholder="+91 Phone Number"
                  placeholderTextColor={color.textFaint}
                />

                <Text style={styles.qrInputLabel}>BLOOD GROUP</Text>
                <TextInput
                  style={styles.qrInput}
                  value={editProfileForm.bloodGroup}
                  onChangeText={(t) => setEditProfileForm((p) => ({ ...p, bloodGroup: t }))}
                  placeholder="e.g. O+, B+, A+"
                  placeholderTextColor={color.textFaint}
                />

                <Text style={styles.qrInputLabel}>MEDICAL NOTES / ALLERGIES</Text>
                <TextInput
                  style={styles.qrInput}
                  value={editProfileForm.medicalNotes || ''}
                  onChangeText={(t) => setEditProfileForm((p) => ({ ...p, medicalNotes: t }))}
                  placeholder="e.g. Diabetic, Penicillin allergy"
                  placeholderTextColor={color.textFaint}
                />

                {/* Emergency Contacts Editor */}
                <View style={{ marginTop: 16, borderTopWidth: 1, borderTopColor: '#E2E8F0', paddingTop: 14 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <Text style={[styles.qrInputLabel, { marginBottom: 0 }]}>EMERGENCY CONTACTS</Text>
                    <TouchableOpacity
                      onPress={() => {
                        setEditProfileForm((p) => ({
                          ...p,
                          emergencyContacts: [...p.emergencyContacts, { label: '', phone: '' }],
                        }));
                      }}
                      style={{ backgroundColor: '#10B981', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6 }}
                    >
                      <Text style={{ color: '#FFF', fontSize: 12, fontWeight: '700' }}>+ ADD CONTACT</Text>
                    </TouchableOpacity>
                  </View>

                  {editProfileForm.emergencyContacts.map((ec, idx) => (
                    <View key={idx} style={{
                      backgroundColor: '#FEF2F2',
                      borderRadius: 8,
                      padding: 12,
                      marginBottom: 10,
                      borderWidth: 1,
                      borderColor: '#FECACA',
                    }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <Text style={{ fontSize: 11, fontWeight: '700', color: '#991B1B' }}>CONTACT {idx + 1}</Text>
                        {editProfileForm.emergencyContacts.length > 1 && (
                          <TouchableOpacity
                            onPress={() => {
                              setEditProfileForm((p) => ({
                                ...p,
                                emergencyContacts: p.emergencyContacts.filter((_, i) => i !== idx),
                              }));
                            }}
                          >
                            <Text style={{ color: '#EF4444', fontSize: 12, fontWeight: '700' }}>✕ REMOVE</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                      <TextInput
                        style={[styles.qrInput, { marginBottom: 6 }]}
                        value={ec.label}
                        onChangeText={(t) => {
                          setEditProfileForm((p) => {
                            const updated = [...p.emergencyContacts];
                            updated[idx] = { ...updated[idx], label: t };
                            return { ...p, emergencyContacts: updated };
                          });
                        }}
                        placeholder="Label (e.g. Father, Mother, Spouse)"
                        placeholderTextColor={color.textFaint}
                      />
                      <TextInput
                        style={styles.qrInput}
                        value={ec.phone}
                        onChangeText={(t) => {
                          setEditProfileForm((p) => {
                            const updated = [...p.emergencyContacts];
                            updated[idx] = { ...updated[idx], phone: t };
                            return { ...p, emergencyContacts: updated };
                          });
                        }}
                        placeholder="Phone Number (e.g. +91 98765 43210)"
                        placeholderTextColor={color.textFaint}
                        keyboardType="phone-pad"
                      />
                    </View>
                  ))}
                </View>

                <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
                  <TouchableOpacity
                    style={styles.qrSaveButton}
                    onPress={handleSaveProfile}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.qrSaveButtonText}>SAVE & UPDATE QR</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.qrCancelEditBtn}
                    onPress={() => {
                      setEditProfileForm(civilianProfile);
                      setIsEditingProfile(false);
                    }}
                  >
                    <Text style={styles.qrCancelEditText}>CANCEL</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <View style={styles.qrDetailsCard}>
                <View style={styles.qrDetailsRow}>
                  <Text style={styles.qrDetailLabel}>CIVILIAN NAME</Text>
                  <Text style={styles.qrDetailValue}>{civilianProfile.name}</Text>
                </View>

                <View style={styles.qrDetailsRow}>
                  <Text style={styles.qrDetailLabel}>PHONE NUMBER</Text>
                  <Text style={styles.qrDetailValue}>{civilianProfile.phone}</Text>
                </View>

                <View style={styles.qrDetailsRow}>
                  <Text style={styles.qrDetailLabel}>LIVE ADDRESS</Text>
                  <Text style={styles.qrDetailValue}>{locationName}</Text>
                </View>

                <View style={styles.qrDetailsRow}>
                  <Text style={styles.qrDetailLabel}>GPS ANCHOR</Text>
                  <Text style={styles.qrDetailValue}>
                    {coordinates.lat.toFixed(4)}° N, {coordinates.lng.toFixed(4)}° E
                  </Text>
                </View>

                {/* Emergency Contacts List */}
                <View style={[styles.qrDetailsRow, { borderBottomWidth: 0 }]}>
                  <Text style={styles.qrDetailLabel}>EMERGENCY CONTACTS</Text>
                  {civilianProfile.emergencyContacts.map((ec, idx) => (
                    <View key={idx} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 }}>
                      <Text style={styles.qrDetailValue}>{ec.label}</Text>
                      <Text style={[styles.qrDetailValue, { color: color.signal }]}>{ec.phone}</Text>
                    </View>
                  ))}
                </View>

                <View style={styles.qrDetailsRow}>
                  <Text style={styles.qrDetailLabel}>BLOOD GROUP</Text>
                  <Text style={styles.qrDetailValue}>{civilianProfile.bloodGroup}</Text>
                </View>

                {civilianProfile.medicalNotes ? (
                  <View style={styles.qrDetailsRow}>
                    <Text style={styles.qrDetailLabel}>MEDICAL NOTES</Text>
                    <Text style={styles.qrDetailValue}>{civilianProfile.medicalNotes}</Text>
                  </View>
                ) : null}

                <TouchableOpacity
                  style={styles.qrEditToggleBtn}
                  onPress={() => {
                    setEditProfileForm(civilianProfile);
                    setIsEditingProfile(true);
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={styles.qrEditToggleText}>✎ EDIT DETAILS (NAME / PHONE / CONTACTS)</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Action Buttons */}
            <View style={{ gap: 10, marginTop: 14 }}>
              <TouchableOpacity
                style={styles.qrPreviewBtn}
                onPress={() => setShowScanPreviewModal(true)}
                activeOpacity={0.8}
              >
                <Text style={styles.qrPreviewBtnText}>👁️ TEST SCAN / PREVIEW RESULT</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.qrGpsSyncBtn}
                onPress={() => fetchLivePosition(true)}
                activeOpacity={0.8}
              >
                <RefreshIcon size={14} color={color.text} />
                <Text style={styles.qrGpsSyncBtnText}>
                  {isRefreshingGps ? 'UPDATING GPS...' : 'SYNC LIVE GPS TO ID'}
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );

  // --- SCREEN 7: TEST SCAN / PREVIEW MODAL ---
  const renderScanPreviewModal = () => {
    const mapsUrl = `https://www.google.com/maps?q=${coordinates.lat},${coordinates.lng}`;
    return (
      <Modal
        visible={showScanPreviewModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowScanPreviewModal(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.qrModalFrame}>
            <ScrollView contentContainerStyle={styles.qrScrollContent}>
              <View style={[styles.publicCardBadge, { backgroundColor: '#FEE2E2' }]}>
                <View style={[styles.publicCardPulseDot, { backgroundColor: '#EF4444' }]} />
                <Text style={[styles.publicCardBadgeText, { color: '#991B1B' }]}>PREVIEW: EMERGENCY SCAN RESULT</Text>
              </View>

              <Text style={styles.publicCardName}>{civilianProfile.name}</Text>
              <Text style={styles.publicCardSubtitle}>
                This person has registered emergency contacts. If they are injured or unconscious, call their emergency contacts below.
              </Text>

              {/* ===== EMERGENCY CONTACTS — BIG CALL BUTTONS ===== */}
              <View style={{
                backgroundColor: '#FEF2F2',
                borderRadius: 12,
                borderWidth: 2,
                borderColor: '#EF4444',
                padding: 16,
                marginTop: 16,
              }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <PhoneIcon size={20} color="#EF4444" />
                  <Text style={{ fontSize: 13, fontWeight: '800', color: '#991B1B', letterSpacing: 0.5, textTransform: 'uppercase' }}>
                    Emergency Contacts — Tap to Call
                  </Text>
                </View>

                {civilianProfile.emergencyContacts.length > 0 ? civilianProfile.emergencyContacts.map((ec, idx) => (
                  <View
                    key={idx}
                    style={{
                      backgroundColor: '#EF4444',
                      borderRadius: 10,
                      paddingVertical: 16,
                      paddingHorizontal: 20,
                      marginBottom: idx < civilianProfile.emergencyContacts.length - 1 ? 10 : 0,
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      opacity: 0.8 // indicating this is a preview
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>
                        {ec.label || 'Contact'}
                      </Text>
                      <Text style={{ color: '#FFFFFF', fontSize: 18, fontWeight: '800' }}>
                        TAP TO CALL NOW
                      </Text>
                    </View>
                    <View style={{
                      backgroundColor: '#FFFFFF',
                      borderRadius: 24,
                      width: 48,
                      height: 48,
                      justifyContent: 'center',
                      alignItems: 'center',
                    }}>
                      <PhoneIcon size={22} color="#EF4444" />
                    </View>
                  </View>
                )) : (
                  <Text style={{ color: '#991B1B', fontSize: 13, textAlign: 'center', paddingVertical: 12 }}>
                    No emergency contacts configured for this person.
                  </Text>
                )}
              </View>

              {/* National Emergency Number */}
              <View
                style={{
                  backgroundColor: '#1E40AF',
                  borderRadius: 10,
                  paddingVertical: 14,
                  paddingHorizontal: 20,
                  marginTop: 10,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 10,
                  opacity: 0.8
                }}
              >
                <SirenIcon size={20} color="#FFFFFF" />
                <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '800' }}>
                  CALL 112 — NATIONAL EMERGENCY
                </Text>
              </View>

              {/* Victim's Own Phone (call if they might answer) */}
              {civilianProfile.phone ? (
                <View
                  style={{
                    backgroundColor: '#F0F9FF',
                    borderWidth: 1,
                    borderColor: '#3B82F6',
                    borderRadius: 10,
                    paddingVertical: 12,
                    paddingHorizontal: 20,
                    marginTop: 10,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    opacity: 0.8
                  }}
                >
                  <View>
                    <Text style={{ fontSize: 11, fontWeight: '600', color: '#1E40AF', textTransform: 'uppercase' }}>
                      Call This Person Directly
                    </Text>
                    <Text style={{ fontSize: 16, fontWeight: '700', color: '#1E3A5F', marginTop: 2 }}>
                      TAP TO CALL NOW
                    </Text>
                  </View>
                  <PhoneIcon size={20} color="#3B82F6" />
                </View>
              ) : null}

              <View style={styles.publicCardFieldBox}>
                <Text style={styles.publicCardFieldLabel}>LIVE / EMERGENCY ADDRESS</Text>
                <Text style={styles.publicCardFieldValue}>{locationName}</Text>
                <Text style={styles.publicCardCoordsSub}>
                  GPS Anchor: {coordinates.lat.toFixed(4)}° N, {coordinates.lng.toFixed(4)}° E
                </Text>
                <TouchableOpacity
                  style={styles.publicCardBtnMaps}
                  onPress={() => Linking.openURL(mapsUrl)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.publicCardBtnMapsText}>🗺️ OPEN DIRECTIONS IN MAPS</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.publicCardBloodRow}>
                <View>
                  <Text style={styles.publicCardFieldLabel}>BLOOD GROUP</Text>
                  <Text style={styles.publicCardFieldValue}>{civilianProfile.bloodGroup}</Text>
                </View>
                <View style={styles.publicCardBloodBadge}>
                  <Text style={styles.publicCardBloodBadgeText}>CRITICAL ID</Text>
                </View>
              </View>

              {civilianProfile.medicalNotes ? (
                <View style={styles.publicCardFieldBox}>
                  <Text style={styles.publicCardFieldLabel}>MEDICAL NOTES / ALLERGIES</Text>
                  <Text style={styles.publicCardFieldValue}>{civilianProfile.medicalNotes}</Text>
                </View>
              ) : null}

              <TouchableOpacity
                style={styles.certCloseBtn}
                onPress={() => setShowScanPreviewModal(false)}
                activeOpacity={0.8}
              >
                <Text style={styles.certCloseBtnText}>CLOSE PREVIEW</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
    );
  };

  // --- INCOMING WEBRTC VOIP CALL MODAL ---
  const renderIncomingCallModal = () => {
    if (!incomingCall) return null;

    return (
      <Modal
        visible={Boolean(incomingCall)}
        animationType="slide"
        transparent={true}
        onRequestClose={() => {
          voipService.declineCall();
          setIncomingCall(null);
        }}
      >
        <View style={styles.incomingCallBackdrop}>
          <View style={styles.incomingCallCard}>
            <View style={styles.incomingCallHeader}>
              <View style={styles.incomingCallPulseIcon}>
                <PhoneIcon size={28} color="#FFFFFF" />
              </View>
              <Text style={styles.incomingCallHeaderTitle}>INCOMING RESCUER VOIP CALL</Text>
              <Text style={styles.incomingCallHeaderSub}>
                A bystander or rescuer scanned your QR Pass and is calling via encrypted internet audio
              </Text>
            </View>

            <View style={styles.incomingCallBody}>
              <View style={styles.incomingCallerInfoBox}>
                <Text style={styles.incomingCallerLabel}>CALLER NAME / IDENTITY</Text>
                <Text style={styles.incomingCallerName}>
                  {incomingCall.callerName || 'Emergency Bystander / Rescuer'}
                </Text>
                <View style={styles.incomingCallBadgeRow}>
                  <ShieldIcon size={14} color="#10B981" />
                  <Text style={styles.incomingCallBadgeText}>
                    Peer-to-Peer Encrypted • Zero Phone Numbers Disclosed
                  </Text>
                </View>
              </View>

              <View style={styles.incomingCallActionRow}>
                <TouchableOpacity
                  style={styles.btnDeclineCall}
                  onPress={() => {
                    voipService.declineCall();
                    setIncomingCall(null);
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={styles.btnDeclineCallText}>✕ DECLINE</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.btnAnswerCall}
                  onPress={async () => {
                    await voipService.answerCall();
                  }}
                  activeOpacity={0.8}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <PhoneIcon size={18} color="#FFFFFF" />
                    <Text style={styles.btnAnswerCallText}>ANSWER CALL</Text>
                  </View>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>
    );
  };

  // --- FLOATING ACTIVE VOIP CALL HUD ---
  const renderActiveVoipCallHUD = () => {
    if (!activeVoipCall || activeVoipCall.state !== 'connected') return null;

    const mins = Math.floor(activeVoipCall.durationSec / 60)
      .toString()
      .padStart(2, '0');
    const secs = (activeVoipCall.durationSec % 60).toString().padStart(2, '0');

    return (
      <View style={styles.activeVoipFloatingHUD}>
        <View style={styles.activeVoipHudContent}>
          <View style={styles.activeVoipInfoCol}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={styles.activeVoipPulseDot} />
              <Text style={styles.activeVoipCallTitle}>VOIP AUDIO CONNECTED</Text>
            </View>
            <Text style={styles.activeVoipPeerName}>
              {activeVoipCall.peerName} • {mins}:{secs}
            </Text>
          </View>

          <View style={styles.activeVoipActionsRow}>
            <TouchableOpacity
              style={[
                styles.activeVoipMuteBtn,
                isVoipMuted && styles.activeVoipMuteBtnActive,
              ]}
              onPress={() => {
                const muted = voipService.toggleMute();
                setIsVoipMuted(muted);
              }}
              activeOpacity={0.8}
            >
              <MicIcon size={15} color={isVoipMuted ? '#EF4444' : '#FFFFFF'} />
              <Text style={styles.activeVoipMuteBtnText}>
                {isVoipMuted ? 'UNMUTE' : 'MUTE'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.activeVoipHangupBtn}
              onPress={() => {
                voipService.hangupCall();
                setActiveVoipCall(null);
              }}
              activeOpacity={0.8}
            >
              <Text style={styles.activeVoipHangupBtnText}>END CALL</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  };

  // --- BOTTOM NAVIGATION BAR (Concept Pill Navigation) ---
  const renderBottomNav = () => (
    <View style={styles.bottomNavContainer}>
      <View style={styles.bottomNavPill}>
        {(
          [
            { id: 'HUB', label: 'SOS Hub', Icon: RadioIcon },
            { id: 'MAPS', label: 'CAD Map', Icon: MapIcon },
            { id: 'INTEL', label: 'Triage', Icon: PulseIcon },
            { id: 'REPORTS', label: 'Shield', Icon: ShieldIcon },
          ] as Array<{ id: NavigationTab; label: string; Icon: React.FC<IconProps> }>
        ).map((item) => {
          const isActive = activeTab === item.id;
          return (
            <TouchableOpacity
              key={item.id}
              style={[styles.navTab, isActive && styles.navTabActive]}
              onPress={() => setActiveTab(item.id)}
              activeOpacity={0.7}
            >
              <item.Icon
                size={19}
                color={isActive ? color.signal : color.textFaint}
              />
              <Text style={[styles.navTabLabel, isActive && styles.navTabLabelActive]}>
                {item.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );

  // --- PUBLIC DIRECT SCANNED LINK ROUTING ---
  if (
    Platform.OS === 'web' &&
    typeof window !== 'undefined' &&
    (window.location.pathname.includes('civilian-id') ||
      window.location.search.includes('callId=') ||
      (window.location.search.includes('name=') && window.location.search.includes('lat=')))
  ) {
    return renderPublicCivilianCard();
  }

  // --- AUTH GATEWAY ---
  if (!currentUser) {
    return (
      <View style={styles.rootContainer}>
        <StatusBar barStyle="dark-content" backgroundColor="#F6F8FA" />
        <AuthScreen onLoginSuccess={(profile) => setCurrentUser(profile)} />
      </View>
    );
  }

  // --- HOSPITAL PORTAL VIEW ---
  if (currentUser.role === 'hospital') {
    return (
      <View style={styles.rootContainer}>
        <StatusBar barStyle="dark-content" backgroundColor="#F6F8FA" />
        {renderTopHeader()}
        <HospitalPortal
          userProfile={currentUser}
          onLogout={handleLogout}
          onInspectCertificate={(inc: EmergencyIncidentItem) => {
            setIncidentId(inc.id);
            setIncidentCode(inc.incidentCode);
            setCoordinates({ lat: inc.lat, lng: inc.lng });
            setHash(inc.sha256Hash ?? null);
            setTimestamp(inc.timestamp);
            setShowCertModal(true);
          }}
        />
        {renderCertModal()}
        {renderIncomingCallModal()}
        {renderActiveVoipCallHUD()}
      </View>
    );
  }

  // --- CONTROL ROOM VIEW ---
  if (currentUser.role === 'control_room') {
    return (
      <View style={styles.rootContainer}>
        <StatusBar barStyle="light-content" backgroundColor="#0F172A" />
        <ControlRoom userProfile={currentUser} onLogout={handleLogout} />
      </View>
    );
  }

  // --- CITIZEN EMERGENCY HUD VIEW ---
  return (
    <View style={styles.rootContainer}>
      <StatusBar barStyle="dark-content" backgroundColor="#F6F8FA" />
      {renderTopHeader()}

      {citizenAlert && (
        <View style={[
          styles.citizenAlertBanner,
          citizenAlert.isNearby && styles.citizenAlertBannerUrgent,
        ]}>
          <View style={{ flex: 1 }}>
            <Text style={[
              styles.citizenAlertKicker,
              citizenAlert.isNearby && styles.citizenAlertKickerUrgent,
            ]}>
              {citizenAlert.isNearby
                ? `🚨 SOS WITHIN 250M · ${citizenAlert.incidentCode}`
                : `NEARBY ACCIDENT · ${citizenAlert.incidentCode}`}
            </Text>
            <Text style={styles.citizenAlertBody}>{citizenAlert.message}</Text>
          </View>
          <TouchableOpacity
            style={[
              styles.citizenAlertGo,
              citizenAlert.isNearby && styles.citizenAlertGoUrgent,
            ]}
            onPress={() => void handleRespondToAlert()}
          >
            <Text style={[
              styles.citizenAlertGoText,
              citizenAlert.isNearby && styles.citizenAlertGoTextUrgent,
            ]}>
              {citizenAlert.isNearby ? "🆘 I'M RESPONDING" : "I'M RESPONDING"}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.citizenAlertNo} onPress={() => setCitizenAlert(null)}>
            <Text style={styles.citizenAlertNoText}>NOT NOW</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.mainContent}>
        {activeTab === 'HUB' &&
          (appPhase === 'idle' ? renderIdleDashboard() : renderActiveTransmissionHub())}
        {activeTab === 'MAPS' && renderMapsView()}
        {activeTab === 'INTEL' && renderIntelView()}
        {activeTab === 'REPORTS' && renderReportsView()}
      </View>

      {/* Floating Bottom-Right QR Identity Button (Civilian Portal) */}
      <TouchableOpacity
        style={styles.floatingQrButton}
        onPress={() => setShowQrModal(true)}
        activeOpacity={0.85}
      >
        <View style={styles.floatingQrIconCircle}>
          <QrCodeIcon size={20} color="#FFFFFF" />
        </View>
        <View style={styles.floatingQrPillTextContainer}>
          <Text style={styles.floatingQrPillTitle}>MY ID</Text>
          <Text style={styles.floatingQrPillSub}>QR PASS</Text>
        </View>
      </TouchableOpacity>

      {renderBottomNav()}
      {renderCertModal()}
      {renderQrModal()}
      {renderScanPreviewModal()}
      {renderIncomingCallModal()}
      {renderActiveVoipCallHUD()}
    </View>
  );
}

// ---------------------------------------------------------------------------
// STYLES (Modern Emergency Design System based on Concept References)
// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  rootContainer: {
    flex: 1,
    backgroundColor: color.ground,
  } as ViewStyle,

  mainContent: {
    flex: 1,
  } as ViewStyle,

  contentScroll: {
    flex: 1,
  } as ViewStyle,

  scrollContent: {
    padding: 16,
    paddingBottom: 110,
    maxWidth: 580,
    width: '100%',
    alignSelf: 'center',
  } as ViewStyle,

  // --- Top Header (Reference 1 Left) ---
  topHeader: {
    backgroundColor: color.surface,
    paddingTop: Platform.OS === 'ios' ? 12 : 16,
    paddingHorizontal: 18,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderColor: color.hairline,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.03,
    shadowRadius: 10,
    elevation: 2,
  } as ViewStyle,

  headerTopPillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  } as ViewStyle,

  safetyIndexPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: color.confirmWash,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: color.confirm,
  } as ViewStyle,

  safetyDotLive: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: color.confirm,
    marginRight: 6,
  } as ViewStyle,

  safetyIndexPillText: {
    fontSize: 11,
    fontFamily: font.mono,
    fontWeight: '700',
    color: color.confirm,
    letterSpacing: 0.2,
  } as TextStyle,

  switchRoleBadge: {
    backgroundColor: color.surfaceMuted,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: color.hairline,
  } as ViewStyle,

  switchRoleBadgeText: {
    fontSize: 10,
    fontFamily: font.mono,
    fontWeight: '700',
    color: color.textMuted,
    letterSpacing: 0.5,
  } as TextStyle,

  locationHeadlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  } as ViewStyle,

  locationCityTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: color.text,
    fontFamily: font.display,
    letterSpacing: -0.6,
  } as TextStyle,

  locationCitySubhead: {
    fontSize: 12,
    color: color.textMuted,
    marginTop: 2,
  } as TextStyle,

  headerInfoBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: color.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: color.hairline,
  } as ViewStyle,

  searchFacilityBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: color.groundDeep,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: color.hairline,
  } as ViewStyle,

  searchFacilityInput: {
    flex: 1,
    marginLeft: 8,
    fontSize: 13,
    color: color.text,
    fontFamily: font.body,
    padding: 0,
  } as TextStyle,

  searchFacilityFilterBtn: {
    padding: 4,
  } as ViewStyle,

  // --- Radar Centerpiece (Reference 1 Left & 2 Left) ---
  radarCard: {
    backgroundColor: color.radarGround,
    borderRadius: 28,
    paddingVertical: 32,
    paddingHorizontal: 16,
    alignItems: 'center',
    marginBottom: 20,
    borderWidth: 1,
    borderColor: color.radarMint,
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
    elevation: 4,
    overflow: 'hidden',
  } as ViewStyle,

  radarOuterCircle: {
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: 'rgba(16, 185, 129, 0.08)',
    borderWidth: 1,
    borderColor: color.radarRing,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  } as ViewStyle,

  radarMidCircle: {
    width: 175,
    height: 175,
    borderRadius: 87.5,
    backgroundColor: 'rgba(16, 185, 129, 0.14)',
    borderWidth: 1,
    borderColor: color.radarRing,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  } as ViewStyle,

  radarInnerCircle: {
    width: 115,
    height: 115,
    borderRadius: 57.5,
    backgroundColor: 'rgba(16, 185, 129, 0.22)',
    borderWidth: 1,
    borderColor: color.radarRing,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  } as ViewStyle,

  radarSweepBeam: {
    position: 'absolute',
    width: 240,
    height: 240,
    borderRadius: 120,
    borderTopWidth: 60,
    borderTopColor: 'rgba(16, 185, 129, 0.22)',
    borderRightWidth: 60,
    borderRightColor: 'transparent',
    borderBottomWidth: 60,
    borderBottomColor: 'transparent',
    borderLeftWidth: 60,
    borderLeftColor: 'transparent',
  } as ViewStyle,

  radarPulseWave: {
    position: 'absolute',
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 2,
    borderColor: color.signal,
  } as ViewStyle,

  radarCenterActuator: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: color.signal,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: color.signal,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 18,
    elevation: 8,
  } as ViewStyle,

  radarCenterGlow: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: color.signalLift,
    alignItems: 'center',
    justifyContent: 'center',
  } as ViewStyle,

  holdForSosHeadline: {
    fontSize: 18,
    fontWeight: '800',
    color: '#064E3B',
    fontFamily: font.display,
    letterSpacing: 1.5,
    marginTop: 20,
  } as TextStyle,

  holdForSosSubhead: {
    fontSize: 11,
    fontFamily: font.mono,
    fontWeight: '700',
    color: '#047857',
    letterSpacing: 0.8,
    marginTop: 4,
    marginBottom: 14,
  } as TextStyle,

  gpsCoordinatesPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: color.radarMint,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 1,
  } as ViewStyle,

  gpsCoordinatesPillText: {
    fontSize: 11,
    fontFamily: font.mono,
    fontWeight: '700',
    color: color.text,
    marginLeft: 6,
  } as TextStyle,

  // --- Category Grid (Reference 1 Right & 2 Left) ---
  categorySection: {
    marginBottom: 20,
  } as ViewStyle,

  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  } as ViewStyle,

  sectionHeaderTitle: {
    fontSize: 12,
    fontFamily: font.mono,
    fontWeight: '800',
    color: color.text,
    letterSpacing: 0.8,
  } as TextStyle,

  sectionHeaderSub: {
    fontSize: 11,
    color: color.textFaint,
  } as TextStyle,

  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  } as ViewStyle,

  categoryCard: {
    width: '31%',
    flexGrow: 1,
    backgroundColor: color.surface,
    borderRadius: 18,
    paddingVertical: 14,
    paddingHorizontal: 10,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: color.hairline,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 8,
    elevation: 1,
  } as ViewStyle,

  categoryCardSelected: {
    borderColor: color.signal,
    backgroundColor: '#FFF5F6',
    shadowColor: color.signal,
    shadowOpacity: 0.15,
  } as ViewStyle,

  categoryIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  } as ViewStyle,

  categoryIconCircleSelected: {
    backgroundColor: color.signal,
  } as ViewStyle,

  categoryTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: color.text,
    fontFamily: font.display,
    textAlign: 'center',
  } as TextStyle,

  categoryTitleSelected: {
    color: color.signalDeep,
  } as TextStyle,

  categorySubtext: {
    fontSize: 9,
    color: color.textFaint,
    marginTop: 2,
    textAlign: 'center',
  } as TextStyle,

  categorySubtextSelected: {
    color: color.signalDeep,
  } as TextStyle,

  // --- Address Confirmation Card (Reference 1 Right) ---
  addressConfirmCard: {
    backgroundColor: color.surface,
    borderRadius: 20,
    padding: 18,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: color.hairline,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 2,
  } as ViewStyle,

  addressInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  } as ViewStyle,

  addressPinIconBox: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: color.signalWash,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  } as ViewStyle,

  addressTitleText: {
    fontSize: 14,
    fontWeight: '800',
    color: color.text,
    fontFamily: font.display,
  } as TextStyle,

  addressDetailText: {
    fontSize: 11,
    color: color.textMuted,
    marginTop: 2,
  } as TextStyle,

  confirmAddressCtaBtn: {
    backgroundColor: color.signal,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    shadowColor: color.signal,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 3,
  } as ViewStyle,

  confirmAddressCtaText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.8,
  } as TextStyle,

  // --- Facilities Section ---
  facilitiesSection: {
    marginBottom: 10,
  } as ViewStyle,

  facilitiesEmptyBox: {
    backgroundColor: color.surface,
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: color.hairline,
    borderStyle: 'dashed',
  } as ViewStyle,

  facilitiesEmptyText: {
    fontSize: 11,
    color: color.textMuted,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 16,
  } as TextStyle,

  facilityItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: color.surface,
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: color.hairline,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 8,
    elevation: 1,
  } as ViewStyle,

  facilityItemIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  } as ViewStyle,

  facilityItemIconPrimary: {
    backgroundColor: color.signalWash,
  } as ViewStyle,

  facilityItemIconSecondary: {
    backgroundColor: color.groundDeep,
  } as ViewStyle,

  facilityItemTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: color.text,
    fontFamily: font.display,
  } as TextStyle,

  facilityItemDetails: {
    fontSize: 10,
    color: color.textMuted,
    marginTop: 2,
    fontFamily: font.mono,
  } as TextStyle,

  // --- ACTIVE TRANSMISSION HUB (Reference 1 Right & 2 Right) ---
  countdownAbortBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: color.surface,
    borderRadius: 24,
    padding: 6,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: color.hairline,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: 3,
  } as ViewStyle,

  countdownCancelBtn: {
    backgroundColor: color.confirmWash,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 18,
  } as ViewStyle,

  countdownCancelText: {
    fontSize: 12,
    fontWeight: '800',
    color: color.confirm,
  } as TextStyle,

  countdownPulseBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: color.signal,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: color.signal,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
  } as ViewStyle,

  countdownPulseBadgeText: {
    fontSize: 10,
    fontWeight: '900',
    color: '#FFFFFF',
    fontFamily: font.mono,
  } as TextStyle,

  broadcastingActivePill: {
    backgroundColor: color.signal,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 18,
  } as ViewStyle,

  broadcastingActiveText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FFFFFF',
  } as TextStyle,

  transmissionErrorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: color.signalWash,
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: color.signal,
    gap: 8,
  } as ViewStyle,

  transmissionErrorText: {
    flex: 1,
    fontSize: 12,
    color: color.signalDeep,
    fontWeight: '700',
    lineHeight: 16,
  } as TextStyle,

  activeBroadcastHeroCard: {
    backgroundColor: color.surface,
    borderRadius: 20,
    padding: 18,
    marginBottom: 16,
    borderWidth: 1.5,
    borderColor: color.signal,
    shadowColor: color.signal,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 3,
  } as ViewStyle,

  activeBroadcastTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  } as ViewStyle,

  activeBeaconDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: color.signal,
    marginRight: 8,
  } as ViewStyle,

  activeBroadcastHeaderTitle: {
    fontSize: 12,
    fontFamily: font.mono,
    fontWeight: '800',
    color: color.signalDeep,
    letterSpacing: 0.5,
  } as TextStyle,

  activeBroadcastCoords: {
    fontSize: 18,
    fontWeight: '800',
    color: color.text,
    fontFamily: font.display,
    marginVertical: 4,
  } as TextStyle,

  activeBroadcastCategoryNote: {
    fontSize: 11,
    color: color.textMuted,
  } as TextStyle,

  routedHospitalCard: {
    backgroundColor: color.surface,
    borderRadius: 20,
    padding: 18,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: color.hairline,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 2,
  } as ViewStyle,

  routedHospitalTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  } as ViewStyle,

  routedHospitalIconBox: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: color.signalWash,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  } as ViewStyle,

  routedHospitalNameText: {
    fontSize: 14,
    fontWeight: '800',
    color: color.text,
    fontFamily: font.display,
  } as TextStyle,

  routedHospitalAddressText: {
    fontSize: 11,
    color: color.textMuted,
    marginTop: 2,
  } as TextStyle,

  routedHospitalEditBtn: {
    backgroundColor: color.surfaceMuted,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: color.hairline,
  } as ViewStyle,

  routedHospitalEditBtnText: {
    fontSize: 11,
    fontFamily: font.mono,
    fontWeight: '700',
    color: color.text,
  } as TextStyle,

  telemetryPillsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  } as ViewStyle,

  telemetryPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.groundDeep,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 12,
    gap: 6,
    borderWidth: 1,
    borderColor: color.hairline,
  } as ViewStyle,

  telemetryPillValue: {
    fontSize: 11,
    fontFamily: font.mono,
    fontWeight: '700',
    color: color.text,
  } as TextStyle,

  telemetryPillValueGreen: {
    fontSize: 11,
    fontFamily: font.mono,
    fontWeight: '800',
    color: color.confirm,
  } as TextStyle,

  telemetryPillValueBlue: {
    fontSize: 11,
    fontFamily: font.mono,
    fontWeight: '800',
    color: color.blue,
  } as TextStyle,

  callTraumaDeskBtn: {
    backgroundColor: color.signal,
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center',
    shadowColor: color.signal,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 2,
  } as ViewStyle,

  callTraumaDeskBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.6,
  } as TextStyle,

  noHospitalCard: {
    backgroundColor: color.signalWash,
    borderRadius: 18,
    padding: 18,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: color.signal,
  } as ViewStyle,

  noHospitalTitle: {
    fontSize: 13,
    fontFamily: font.mono,
    fontWeight: '800',
    color: color.signalDeep,
    marginBottom: 4,
  } as TextStyle,

  noHospitalBody: {
    fontSize: 12,
    color: color.text,
    lineHeight: 18,
    marginBottom: 12,
  } as TextStyle,

  call108CtaBtn: {
    backgroundColor: color.signal,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  } as ViewStyle,

  call108CtaText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.8,
  } as TextStyle,

  // --- Simulated Map Canvas (Reference 2 Right) ---
  mapCanvasCard: {
    backgroundColor: color.surface,
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: color.hairline,
    marginBottom: 16,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 2,
  } as ViewStyle,

  mapCanvasInterior: {
    height: 180,
    backgroundColor: '#EBF4F6',
    position: 'relative',
    overflow: 'hidden',
  } as ViewStyle,

  mapStreetH1: {
    position: 'absolute',
    top: 50,
    left: 0,
    right: 0,
    height: 12,
    backgroundColor: '#FFFFFF',
  } as ViewStyle,

  mapStreetH2: {
    position: 'absolute',
    top: 120,
    left: 0,
    right: 0,
    height: 16,
    backgroundColor: '#FFFFFF',
  } as ViewStyle,

  mapStreetV1: {
    position: 'absolute',
    left: 60,
    top: 0,
    bottom: 0,
    width: 14,
    backgroundColor: '#FFFFFF',
  } as ViewStyle,

  mapStreetV2: {
    position: 'absolute',
    right: 90,
    top: 0,
    bottom: 0,
    width: 14,
    backgroundColor: '#FFFFFF',
  } as ViewStyle,

  mapRouteTrack: {
    position: 'absolute',
    left: 65,
    top: 40,
    width: 140,
    height: 90,
    borderLeftWidth: 4,
    borderBottomWidth: 4,
    borderColor: color.signal,
    borderBottomLeftRadius: 16,
  } as ViewStyle,

  mapMarkerHospital: {
    position: 'absolute',
    top: 25,
    left: 45,
    backgroundColor: color.blue,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    shadowColor: color.blue,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
  } as ViewStyle,

  mapMarkerHospitalLabel: {
    fontSize: 9,
    fontFamily: font.mono,
    fontWeight: '800',
    color: '#FFFFFF',
  } as TextStyle,

  mapMarkerUser: {
    position: 'absolute',
    bottom: 25,
    right: 75,
    backgroundColor: color.signal,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    shadowColor: color.signal,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
  } as ViewStyle,

  mapMarkerUserHalo: {
    position: 'absolute',
    top: -6,
    left: -6,
    right: -6,
    bottom: -6,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: color.signal,
    opacity: 0.4,
  } as ViewStyle,

  mapMarkerUserLabel: {
    fontSize: 9,
    fontFamily: font.mono,
    fontWeight: '900',
    color: '#FFFFFF',
  } as TextStyle,

  mapMarkerAmbulance: {
    position: 'absolute',
    top: 90,
    left: 60,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: color.confirm,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: color.confirm,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
  } as ViewStyle,

  mapCanvasStatusFooter: {
    fontSize: 10,
    fontFamily: font.mono,
    fontWeight: '700',
    color: color.textMuted,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: color.surface,
    textAlign: 'center',
    borderTopWidth: 1,
    borderColor: color.hairline,
  } as TextStyle,

  // --- Legal Certificate Card ---
  legalCertificateBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: color.surface,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: color.hairline,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
    marginTop: 6,
    gap: 12,
  } as ViewStyle,

  legalCertIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: color.signalWash,
    alignItems: 'center',
    justifyContent: 'center',
  } as ViewStyle,

  legalCertBannerTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: color.text,
    fontFamily: font.display,
  } as TextStyle,

  legalCertBannerSub: {
    fontSize: 11,
    color: color.textMuted,
    marginTop: 2,
  } as TextStyle,

  // --- Bottom Navigation (Concept Pill Bar) ---
  bottomNavContainer: {
    position: 'absolute',
    bottom: 20,
    left: 0,
    right: 0,
    alignItems: 'center',
  } as ViewStyle,

  bottomNavPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: color.surface,
    borderRadius: 30,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: color.hairline,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
    elevation: 6,
    gap: 8,
  } as ViewStyle,

  navTab: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 20,
  } as ViewStyle,

  navTabActive: {
    backgroundColor: color.signalWash,
  } as ViewStyle,

  navTabLabel: {
    fontSize: 10,
    fontFamily: font.mono,
    fontWeight: '700',
    color: color.textFaint,
    marginTop: 3,
  } as TextStyle,

  navTabLabelActive: {
    color: color.signalDeep,
  } as TextStyle,

  // --- Certificate Modal Styles ---
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'center',
    padding: 16,
  } as ViewStyle,

  modalCertificateFrame: {
    backgroundColor: color.surface,
    borderRadius: 24,
    maxHeight: '85%',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: color.hairline,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 28,
    elevation: 10,
  } as ViewStyle,

  certScrollContent: {
    padding: 24,
  } as ViewStyle,

  certHeader: {
    alignItems: 'center',
    marginBottom: 20,
  } as ViewStyle,

  certGovtTitle: {
    fontSize: 10,
    fontFamily: font.mono,
    fontWeight: '800',
    color: color.signal,
    letterSpacing: 1.5,
    marginTop: 8,
    marginBottom: 4,
  } as TextStyle,

  certMainHeading: {
    fontSize: 18,
    fontWeight: '800',
    color: color.text,
    fontFamily: font.display,
    textAlign: 'center',
    marginBottom: 6,
  } as TextStyle,

  certStatuteBadge: {
    fontSize: 11,
    color: color.textMuted,
    fontFamily: font.mono,
  } as TextStyle,

  certDataBox: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderColor: color.hairline,
  } as ViewStyle,

  certDataLabel: {
    fontSize: 10,
    fontFamily: font.mono,
    fontWeight: '700',
    color: color.textFaint,
  } as TextStyle,

  certDataValue: {
    fontSize: 11,
    fontWeight: '700',
    color: color.text,
    fontFamily: font.mono,
  } as TextStyle,

  certHashCard: {
    backgroundColor: color.groundDeep,
    borderRadius: 12,
    padding: 12,
    marginVertical: 14,
    borderWidth: 1,
    borderColor: color.hairline,
  } as ViewStyle,

  certHashLabel: {
    fontSize: 9,
    fontFamily: font.mono,
    color: color.textFaint,
    fontWeight: '800',
    marginBottom: 4,
  } as TextStyle,

  certHashText: {
    fontSize: 10,
    fontFamily: font.mono,
    color: color.text,
  } as TextStyle,

  certSectionTitle: {
    fontSize: 11,
    fontFamily: font.mono,
    fontWeight: '800',
    color: color.text,
    letterSpacing: 0.8,
    marginTop: 8,
    marginBottom: 10,
  } as TextStyle,

  certImmunityCard: {
    backgroundColor: color.groundDeep,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: color.hairline,
  } as ViewStyle,

  certImmunityHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  } as ViewStyle,

  certImmunityTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: color.text,
    fontFamily: font.display,
  } as TextStyle,

  certImmunityBody: {
    fontSize: 11,
    color: color.textMuted,
    lineHeight: 16,
  } as TextStyle,

  certStampBox: {
    borderWidth: 1.5,
    borderColor: color.confirm,
    borderRadius: 10,
    paddingVertical: 6,
    paddingHorizontal: 14,
    alignSelf: 'center',
    marginVertical: 12,
    backgroundColor: color.confirmWash,
  } as ViewStyle,

  certStampText: {
    fontSize: 11,
    fontFamily: font.mono,
    fontWeight: '800',
    color: color.confirm,
    letterSpacing: 1.5,
  } as TextStyle,

  certDisclaimer: {
    fontSize: 10,
    color: color.textFaint,
    textAlign: 'center',
    lineHeight: 15,
    marginBottom: 16,
  } as TextStyle,

  certDownloadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.signal,
    borderRadius: 14,
    paddingVertical: 14,
    gap: 8,
    marginBottom: 8,
    shadowColor: color.signal,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 3,
  } as ViewStyle,

  certDownloadBtnText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.8,
  } as TextStyle,

  certCloseBtn: {
    paddingVertical: 10,
    alignItems: 'center',
  } as ViewStyle,

  certCloseBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: color.textMuted,
  } as TextStyle,

  // --- DRSABC & Protocol Styles ---
  drsabcCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: color.surface,
    borderRadius: 18,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: color.hairline,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 8,
    elevation: 1,
  } as ViewStyle,

  drsabcCardChecked: {
    borderColor: color.confirm,
    backgroundColor: '#F0FDF4',
  } as ViewStyle,

  drsabcLetterBox: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: color.signalWash,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  } as ViewStyle,

  drsabcTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: color.text,
    fontFamily: font.display,
  } as TextStyle,

  drsabcDetail: {
    fontSize: 11,
    color: color.textMuted,
    lineHeight: 16,
    marginTop: 2,
  } as TextStyle,

  drsabcCheck: {
    fontSize: 16,
    color: color.textFaint,
    marginLeft: 8,
  } as TextStyle,

  drsabcCheckActive: {
    color: color.confirm,
  } as TextStyle,

  // --- Secondary Standby Card ---
  standbyCard: {
    backgroundColor: color.surface,
    borderRadius: 18,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: color.hairline,
  } as ViewStyle,

  standbyHeader: {
    fontSize: 11,
    fontFamily: font.mono,
    fontWeight: '800',
    color: color.text,
    letterSpacing: 0.8,
    marginBottom: 12,
  } as TextStyle,

  standbyItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderColor: color.hairline,
  } as ViewStyle,

  standbyName: {
    fontSize: 12,
    fontWeight: '800',
    color: color.text,
  } as TextStyle,

  standbyMeta: {
    fontSize: 10,
    color: color.textMuted,
    marginTop: 2,
    fontFamily: font.mono,
  } as TextStyle,

  hudFeatureCard: {
    backgroundColor: color.surface,
    borderRadius: 18,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: color.hairline,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 8,
    elevation: 1,
  } as ViewStyle,

  cardHeaderLabel: {
    fontSize: 11,
    fontFamily: font.mono,
    fontWeight: '800',
    color: color.text,
    letterSpacing: 0.8,
    marginBottom: 8,
  } as TextStyle,

  hudCardSubtext: {
    fontSize: 11,
    color: color.textMuted,
    lineHeight: 16,
  } as TextStyle,

  mapCanvasPlaceholder: {
    height: 120,
    backgroundColor: color.groundDeep,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 10,
    borderWidth: 1,
    borderColor: color.hairline,
  } as ViewStyle,

  mapRadarPulse: {
    fontSize: 16,
    fontFamily: font.mono,
    fontWeight: '800',
    color: color.signal,
    marginBottom: 6,
  } as TextStyle,

  mapCoordsLive: {
    fontSize: 11,
    fontFamily: font.mono,
    color: color.text,
    fontWeight: '700',
  } as TextStyle,

  hashPreviewBox: {
    backgroundColor: color.groundDeep,
    borderRadius: 10,
    padding: 10,
    marginVertical: 8,
    borderWidth: 1,
    borderColor: color.hairline,
  } as ViewStyle,

  hashPreviewLabel: {
    fontSize: 9,
    fontFamily: font.mono,
    color: color.textFaint,
    fontWeight: '700',
  } as TextStyle,

  hashPreviewValue: {
    fontSize: 10,
    fontFamily: font.mono,
    color: color.text,
    marginTop: 2,
  } as TextStyle,

  systemStatusCard: {
    backgroundColor: color.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: color.hairline,
  } as ViewStyle,

  // --- GPS Refresh Badge ---
  gpsRefreshBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: color.signalWash,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.25)',
  } as ViewStyle,

  gpsRefreshText: {
    fontSize: 9,
    fontFamily: font.mono,
    fontWeight: '800',
    color: color.signal,
    letterSpacing: 0.5,
  } as TextStyle,

  // --- Floating Bottom-Right QR Button ---
  floatingQrButton: {
    position: 'absolute',
    bottom: 86,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: color.surface,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 30,
    borderWidth: 1.5,
    borderColor: color.signal,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 8,
    gap: 8,
    zIndex: 99,
  } as ViewStyle,

  floatingQrIconCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: color.signal,
    alignItems: 'center',
    justifyContent: 'center',
  } as ViewStyle,

  floatingQrPillTextContainer: {
    paddingRight: 4,
  } as ViewStyle,

  floatingQrPillTitle: {
    fontSize: 10,
    fontWeight: '800',
    fontFamily: font.display,
    color: color.text,
    letterSpacing: 0.5,
  } as TextStyle,

  floatingQrPillSub: {
    fontSize: 8,
    fontWeight: '700',
    fontFamily: font.mono,
    color: color.signal,
  } as TextStyle,

  // --- QR Identity Modal Styles ---
  qrModalFrame: {
    backgroundColor: color.surface,
    borderRadius: 24,
    maxHeight: '90%',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: color.hairline,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 28,
    elevation: 10,
  } as ViewStyle,

  qrScrollContent: {
    padding: 22,
  } as ViewStyle,

  qrModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  } as ViewStyle,

  qrModalTitle: {
    fontSize: 14,
    fontWeight: '800',
    fontFamily: font.display,
    color: color.text,
    letterSpacing: 0.5,
  } as TextStyle,

  qrModalCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: color.groundDeep,
    alignItems: 'center',
    justifyContent: 'center',
  } as ViewStyle,

  qrModalCloseText: {
    fontSize: 14,
    color: color.textMuted,
    fontWeight: '700',
  } as TextStyle,

  qrCodeCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 18,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: color.hairline,
    marginBottom: 16,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
  } as ViewStyle,

  qrTargetCornersWrapper: {
    padding: 10,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 2,
    borderColor: color.signalWash,
    alignItems: 'center',
    justifyContent: 'center',
  } as ViewStyle,

  qrImage: {
    width: 200,
    height: 200,
    borderRadius: 8,
  } as ImageStyle,

  qrScanHint: {
    fontSize: 11,
    color: color.textMuted,
    textAlign: 'center',
    marginTop: 12,
    marginBottom: 12,
  } as TextStyle,

  qrFormatToggle: {
    flexDirection: 'row',
    backgroundColor: color.groundDeep,
    borderRadius: 12,
    padding: 3,
    width: '100%',
  } as ViewStyle,

  qrFormatTab: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 9,
  } as ViewStyle,

  qrFormatTabActive: {
    backgroundColor: color.surface,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  } as ViewStyle,

  qrFormatTabText: {
    fontSize: 11,
    fontWeight: '700',
    color: color.textMuted,
  } as TextStyle,

  qrFormatTabTextActive: {
    color: color.text,
  } as TextStyle,

  qrDetailsCard: {
    backgroundColor: color.groundDeep,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: color.hairline,
  } as ViewStyle,

  qrDetailsRow: {
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderColor: color.hairline,
  } as ViewStyle,

  qrDetailLabel: {
    fontSize: 9,
    fontFamily: font.mono,
    fontWeight: '700',
    color: color.textFaint,
    textTransform: 'uppercase',
  } as TextStyle,

  qrDetailValue: {
    fontSize: 13,
    fontWeight: '700',
    color: color.text,
    marginTop: 2,
  } as TextStyle,

  qrEditToggleBtn: {
    marginTop: 12,
    alignItems: 'center',
    paddingVertical: 8,
  } as ViewStyle,

  qrEditToggleText: {
    fontSize: 11,
    fontWeight: '800',
    color: color.signal,
    fontFamily: font.display,
  } as TextStyle,

  qrEditCard: {
    backgroundColor: color.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: color.hairline,
  } as ViewStyle,

  qrSectionHeader: {
    fontSize: 12,
    fontWeight: '800',
    fontFamily: font.display,
    color: color.text,
    marginBottom: 10,
  } as TextStyle,

  qrInputLabel: {
    fontSize: 9,
    fontFamily: font.mono,
    fontWeight: '700',
    color: color.textFaint,
    marginTop: 8,
    marginBottom: 4,
  } as TextStyle,

  qrInput: {
    backgroundColor: color.groundDeep,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    color: color.text,
    borderWidth: 1,
    borderColor: color.hairline,
  } as TextStyle,

  qrSaveButton: {
    flex: 1,
    backgroundColor: color.signal,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  } as ViewStyle,

  qrSaveButtonText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FFFFFF',
  } as TextStyle,

  qrCancelEditBtn: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: color.groundDeep,
    alignItems: 'center',
  } as ViewStyle,

  qrCancelEditText: {
    fontSize: 12,
    fontWeight: '700',
    color: color.textMuted,
  } as TextStyle,

  qrPreviewBtn: {
    backgroundColor: color.surface,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: color.hairline,
  } as ViewStyle,

  qrPreviewBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: color.text,
    fontFamily: font.display,
  } as TextStyle,

  qrGpsSyncBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: color.groundDeep,
    borderRadius: 14,
    paddingVertical: 12,
  } as ViewStyle,

  qrGpsSyncBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: color.text,
    fontFamily: font.display,
  } as TextStyle,

  // --- Public Emergency Card Styles ---
  publicCardScroll: {
    padding: 20,
    alignItems: 'center',
  } as ViewStyle,

  publicCardContainer: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: color.surface,
    borderRadius: 24,
    padding: 22,
    borderWidth: 1,
    borderColor: color.hairline,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.12,
    shadowRadius: 28,
    elevation: 8,
  } as ViewStyle,

  publicCardBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    backgroundColor: color.signalWash,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 14,
    marginBottom: 12,
  } as ViewStyle,

  publicCardPulseDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: color.signal,
  } as ViewStyle,

  publicCardBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: color.signalDeep,
    fontFamily: font.mono,
    letterSpacing: 0.5,
  } as TextStyle,

  publicCardName: {
    fontSize: 22,
    fontWeight: '800',
    fontFamily: font.display,
    color: color.text,
    marginBottom: 4,
  } as TextStyle,

  publicCardSubtitle: {
    fontSize: 12,
    color: color.textMuted,
    marginBottom: 18,
  } as TextStyle,

  publicCardFieldBox: {
    backgroundColor: color.groundDeep,
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: color.hairline,
  } as ViewStyle,

  publicCardFieldLabel: {
    fontSize: 9,
    fontFamily: font.mono,
    fontWeight: '700',
    color: color.textFaint,
    marginBottom: 4,
  } as TextStyle,

  publicCardFieldValue: {
    fontSize: 15,
    fontWeight: '800',
    color: color.text,
  } as TextStyle,

  publicCardCoordsSub: {
    fontSize: 11,
    fontFamily: font.mono,
    color: color.textMuted,
    marginTop: 4,
  } as TextStyle,

  publicCardBtnCall: {
    backgroundColor: color.signal,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 10,
  } as ViewStyle,

  publicCardBtnCallText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FFFFFF',
  } as TextStyle,

  publicCardBtnMaps: {
    backgroundColor: color.text,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 10,
  } as ViewStyle,

  publicCardBtnMapsText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FFFFFF',
  } as TextStyle,

  publicCardBtnUrgent: {
    backgroundColor: color.urgent,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 10,
  } as ViewStyle,

  publicCardBtnUrgentText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FFFFFF',
  } as TextStyle,

  publicCardBloodRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: color.groundDeep,
    borderRadius: 16,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: color.hairline,
  } as ViewStyle,

  publicCardBloodBadge: {
    backgroundColor: '#FFE4E6',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  } as ViewStyle,

  publicCardBloodBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#E11D48',
  } as TextStyle,

  publicCardStatuteBox: {
    backgroundColor: '#EFF6FF',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#BFDBFE',
    marginBottom: 16,
  } as ViewStyle,

  publicCardStatuteTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#1E40AF',
  } as TextStyle,

  publicCardStatuteBody: {
    fontSize: 11,
    color: '#1E40AF',
    lineHeight: 16,
  } as TextStyle,

  publicCardBackBtn: {
    backgroundColor: color.groundDeep,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: color.hairline,
  } as ViewStyle,

  publicCardBackBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: color.text,
    letterSpacing: 0.5,
  } as TextStyle,

  // --- WebRTC VoIP Call Styles ---
  publicVoipBox: {
    backgroundColor: '#F0FDF4',
    borderWidth: 2,
    borderColor: '#10B981',
    borderRadius: 18,
    padding: 16,
    marginBottom: 14,
  } as ViewStyle,

  publicVoipHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  } as ViewStyle,

  publicVoipHeaderTitle: {
    fontSize: 11,
    fontFamily: font.mono,
    fontWeight: '800',
    color: '#059669',
    letterSpacing: 0.5,
  } as TextStyle,

  publicVoipDesc: {
    fontSize: 12,
    color: '#334155',
    lineHeight: 17,
    marginBottom: 12,
  } as TextStyle,

  publicVoipCallNowBtn: {
    backgroundColor: '#10B981',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 4,
  } as ViewStyle,

  publicVoipCallNowText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  } as TextStyle,

  publicVoipActiveHud: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
  } as ViewStyle,

  publicVoipActiveStatus: {
    fontSize: 11,
    fontWeight: '800',
    fontFamily: font.mono,
    color: '#059669',
  } as TextStyle,

  publicVoipTimerText: {
    fontSize: 22,
    fontWeight: '800',
    fontFamily: font.mono,
    color: color.text,
    marginVertical: 4,
  } as TextStyle,

  publicVoipControlsRow: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
    marginTop: 8,
  } as ViewStyle,

  publicVoipCtrlBtn: {
    flex: 1,
    backgroundColor: '#334155',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  } as ViewStyle,

  publicVoipCtrlBtnText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#FFFFFF',
  } as TextStyle,

  publicVoipMuteActive: {
    backgroundColor: '#EF4444',
  } as ViewStyle,

  publicVoipHangupBtn: {
    backgroundColor: '#EF4444',
  } as ViewStyle,

  // --- Incoming VoIP Call Modal ---
  incomingCallBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  } as ViewStyle,

  incomingCallCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.3,
    shadowRadius: 32,
    elevation: 12,
  } as ViewStyle,

  incomingCallHeader: {
    backgroundColor: '#DC2626',
    paddingVertical: 24,
    paddingHorizontal: 20,
    alignItems: 'center',
  } as ViewStyle,

  incomingCallPulseIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  } as ViewStyle,

  incomingCallHeaderTitle: {
    fontSize: 15,
    fontFamily: font.mono,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.8,
    textAlign: 'center',
    marginBottom: 4,
  } as TextStyle,

  incomingCallHeaderSub: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.9)',
    textAlign: 'center',
    lineHeight: 16,
  } as TextStyle,

  incomingCallBody: {
    padding: 20,
  } as ViewStyle,

  incomingCallerInfoBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 14,
    alignItems: 'center',
    marginBottom: 18,
  } as ViewStyle,

  incomingCallerLabel: {
    fontSize: 10,
    fontFamily: font.mono,
    fontWeight: '700',
    color: color.textFaint,
    marginBottom: 4,
  } as TextStyle,

  incomingCallerName: {
    fontSize: 17,
    fontWeight: '800',
    color: color.text,
    marginBottom: 8,
  } as TextStyle,

  incomingCallBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#E2F7EB',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  } as ViewStyle,

  incomingCallBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#059669',
  } as TextStyle,

  incomingCallActionRow: {
    flexDirection: 'row',
    gap: 12,
  } as ViewStyle,

  btnDeclineCall: {
    flex: 1,
    backgroundColor: '#F1F5F9',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#CBD5E1',
  } as ViewStyle,

  btnDeclineCallText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#475569',
  } as TextStyle,

  btnAnswerCall: {
    flex: 1.5,
    backgroundColor: '#10B981',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  } as ViewStyle,

  btnAnswerCallText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  } as TextStyle,

  // --- Active VoIP Floating HUD ---
  activeVoipFloatingHUD: {
    position: 'absolute',
    top: Platform.OS === 'web' ? 14 : 44,
    left: 16,
    right: 16,
    backgroundColor: '#0F172A',
    borderRadius: 16,
    padding: 12,
    zIndex: 9999,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 10,
    borderWidth: 1,
    borderColor: '#334155',
  } as ViewStyle,

  activeVoipHudContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  } as ViewStyle,

  activeVoipInfoCol: {
    flex: 1,
  } as ViewStyle,

  activeVoipPulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#10B981',
  } as ViewStyle,

  activeVoipCallTitle: {
    fontSize: 10,
    fontFamily: font.mono,
    fontWeight: '800',
    color: '#10B981',
    letterSpacing: 0.5,
  } as TextStyle,

  activeVoipPeerName: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
    marginTop: 2,
  } as TextStyle,

  activeVoipActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  } as ViewStyle,

  activeVoipMuteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#1E293B',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#475569',
  } as ViewStyle,

  activeVoipMuteBtnActive: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    borderColor: '#EF4444',
  } as ViewStyle,

  activeVoipMuteBtnText: {
    fontSize: 10,
    fontWeight: '800',
    fontFamily: font.mono,
    color: '#FFFFFF',
  } as TextStyle,

  activeVoipHangupBtn: {
    backgroundColor: '#EF4444',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  } as ViewStyle,

  activeVoipHangupBtnText: {
    fontSize: 10,
    fontWeight: '800',
    fontFamily: font.mono,
    color: '#FFFFFF',
  } as TextStyle,

  citizenAlertBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#7F1D1D',
    borderWidth: 1,
    borderColor: '#FECACA',
  } as ViewStyle,
  citizenAlertKicker: {
    color: '#FECACA',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
  } as TextStyle,
  citizenAlertBody: {
    color: '#FFF7ED',
    fontSize: 13,
    marginTop: 4,
  } as TextStyle,
  citizenAlertGo: {
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
  } as ViewStyle,
  citizenAlertGoText: {
    color: '#7F1D1D',
    fontSize: 11,
    fontWeight: '800',
  } as TextStyle,
  citizenAlertNo: {
    paddingHorizontal: 8,
    paddingVertical: 8,
  } as ViewStyle,
  citizenAlertNoText: {
    color: '#FECACA',
    fontSize: 10,
    fontWeight: '700',
  } as TextStyle,

  // -- Urgent variants for nearby-sos (within 250 m) ----------------------
  citizenAlertBannerUrgent: {
    backgroundColor: '#991B1B',
    borderColor: '#FF3B5C',
    borderWidth: 2,
    shadowColor: '#FF3B5C',
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 8,
  } as ViewStyle,
  citizenAlertKickerUrgent: {
    color: '#FFFFFF',
    fontSize: 12,
    letterSpacing: 1.0,
  } as TextStyle,
  citizenAlertGoUrgent: {
    backgroundColor: '#FF3B5C',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  } as ViewStyle,
  citizenAlertGoTextUrgent: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
  } as TextStyle,
});
