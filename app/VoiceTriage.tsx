// ============================================================================
// SAMARITAN SHIELD — Voice Triage Assistant (VoiceTriage.tsx)
// 4-Step Severe Trauma Protocol Engine with Web Speech STT, TTS,
// CPR 110 BPM Metronome Audio Tone (Compressions Only), and Live CAD
// Server Telemetry Sync.
// ============================================================================

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Platform,
  Vibration,
  Animated,
  Easing,
  Image,
  ViewStyle,
  TextStyle,
  ImageStyle,
} from 'react-native';
import { color, font } from './theme';
import {
  PulseIcon,
} from './icons';
import * as Speech from 'expo-speech';
import * as Haptics from 'expo-haptics';

import { authedFetch } from './api';
import {
  TriageTree,
  INITIAL_NODE_ID,
  type TriageNode,
  type TriageAction,
} from './TriageTree';

// ---------------------------------------------------------------------------
// Types & Config
// ---------------------------------------------------------------------------
interface VoiceTriageProps {
  onDismiss?: () => void;
  isActive: boolean;
  incidentId?: string;
}

const CPR_BPM = 110;
const CPR_INTERVAL_MS = Math.round((60 / CPR_BPM) * 1000); // ~545ms
const VOICE_LOCALE = 'en-US';

// ---------------------------------------------------------------------------
// Native speech recognition — loaded lazily and optionally
//
// expo-speech-recognition resolves a native module at import time, and that
// module does not exist in Expo Go. Importing it at module scope crashes the
// entire app on a client that simply cannot provide it, taking down SOS,
// dispatch and the CPR metronome along with it. Voice input is an enhancement;
// it must not be able to do that.
// ---------------------------------------------------------------------------
interface SpeechRecognitionApi {
  ExpoSpeechRecognitionModule: {
    requestPermissionsAsync: () =>Promise<{ granted: boolean }>;
    start: (options: { lang: string; interimResults: boolean; continuous: boolean }) => void;
    abort: () => void;
  };
  addSpeechRecognitionListener: (
    event: string,
    listener: (payload: { results?: Array<{ transcript?: string }> }) => void
  ) => { remove: () => void };
}

let cachedSpeechApi: SpeechRecognitionApi | null | undefined;

/** The native speech API, or null when this client cannot provide it. */
function getSpeechApi(): SpeechRecognitionApi | null {
  if (cachedSpeechApi !== undefined) return cachedSpeechApi;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    cachedSpeechApi = require('expo-speech-recognition') as SpeechRecognitionApi;
  } catch (_e) {
    // Expo Go, or a build without the module. Fall back to the on-screen buttons.
    cachedSpeechApi = null;
  }
  return cachedSpeechApi;
}

// Web Speech Recognition Type Definition
interface IWebSpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: () => void;
  onresult: (event: { results: { [key: number]: { [key: number]: { transcript: string } } } }) => void;
  onerror: (event: unknown) => void;
  onend: () => void;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

// ============================================================================
// VoiceTriage Component
// ============================================================================
export const VoiceTriage: React.FC<VoiceTriageProps> = ({ onDismiss, isActive, incidentId }) => {
  // -- State ---------------------------------------------------------------
  const [currentNodeId, setCurrentNodeId] = useState<string>(INITIAL_NODE_ID);
  // Bumped on every transition so re-entering the same node (a "no" that loops
  // back to itself) still re-speaks and re-opens the mic.
  const [visitToken, setVisitToken] = useState<number>(0);
  const [isListening, setIsListening] = useState<boolean>(false);
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [heardText, setHeardText] = useState<string>('');
  const [cprActive, setCprActive] = useState<boolean>(false);
  const [beatCount, setBeatCount] = useState<number>(0);
  const [setCount, setSetCount] = useState<number>(1);

  // -- Refs ----------------------------------------------------------------
  const cprIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const webRecognitionRef = useRef<IWebSpeechRecognition | null>(null);
  const isMountedRef = useRef<boolean>(true);
  // Counters live in refs so the metronome callback never has to be rebuilt
  // mid-run: a changing identity used to retrigger the speak effect.
  const beatRef = useRef<number>(0);
  const setRef = useRef<number>(1);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // -- Animations ----------------------------------------------------------
  const pulseAnim = useRef<Animated.Value>(new Animated.Value(1)).current;

  // Current Node
  const currentNode: TriageNode = TriageTree[currentNodeId] || TriageTree[INITIAL_NODE_ID];

  // Whether this client can listen at all. Web uses the browser's Speech
  // Recognition API; native needs the optional module, which Expo Go lacks.
  const voiceAvailable: boolean =
    Platform.OS === 'web'
      ? typeof window !== 'undefined' &&
        !!((window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition ||
           (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition)
      : getSpeechApi() !== null;

  // -----------------------------------------------------------------------
  // Live Backend Telemetry Sync Helper
  // -----------------------------------------------------------------------
  const syncTelemetry = useCallback(
    (victimCondition: string, compressions?: number, sets?: number) => {
      // Guard against syncing telemetry to the placeholder mock ID
      if (!incidentId || incidentId === 'INC-8492' || incidentId === 'CAD-8492-TX') return;
      authedFetch(`/api/incidents/${incidentId}/triage`, {
        method: 'PATCH',
        body: JSON.stringify({
          victimCondition,
          ...(typeof compressions === 'number' && { cprCompressions: compressions }),
          ...(typeof sets === 'number' && { cprSets: sets }),
        }),
      }).catch(() => {});
    },
    [incidentId]
  );

  // -----------------------------------------------------------------------
  // Web Audio CPR Metronome Tone (110 BPM Click)
  // -----------------------------------------------------------------------
  /**
   * One AudioContext for the whole session. Constructing one per click (every
   * ~545ms) hit the browser's concurrent-context cap after roughly 30 seconds,
   * so the metronome went silent partway into CPR.
   */
  const getAudioContext = useCallback((): AudioContext | null => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
    if (audioCtxRef.current) {
      if (audioCtxRef.current.state === 'suspended') audioCtxRef.current.resume();
      return audioCtxRef.current;
    }
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;
    audioCtxRef.current = new AudioCtx();
    return audioCtxRef.current;
  }, []);

  const playMetronomeClick = useCallback((): void => {
    {
      try {
        const ctx = getAudioContext();
        if (!ctx) return;

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(800, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(300, ctx.currentTime + 0.08);

        gain.gain.setValueAtTime(0.4, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.08);
      } catch (_e) {}
    }
  }, [getAudioContext]);

  // -----------------------------------------------------------------------
  // CPR Metronome Loop (110 BPM, 30 Compressions / 2 Breaths)
  // -----------------------------------------------------------------------
  /**
   * Compressions-only CPR at 110 BPM, in sets of 30.
   *
   * Counters live in refs so this callback keeps a stable identity for the
   * whole run. Previously setSetCount rebuilt it at the end of every set,
   * which retriggered the speak effect: the node re-spoke its full text and
   * restarted the metronome, while a setTimeout restarted it again 1.2s later.
   * The two paths fought, resetting the beat count early and doubling the
   * coaching audio.
   */
  const startCPRMetronome = useCallback((): void => {
    if (cprIntervalRef.current) clearInterval(cprIntervalRef.current);

    beatRef.current = 0;
    setBeatCount(0);
    setCprActive(true);
    syncTelemetry('CPR_ACTIVE', 0, setRef.current);

    cprIntervalRef.current = setInterval(() => {
      if (!isMountedRef.current) return;

      beatRef.current += 1;
      const beat = beatRef.current;
      setBeatCount(beat);
      playMetronomeClick();

      if (Platform.OS !== 'web') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
      }

      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.2, duration: 60, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1.0, duration: 120, useNativeDriver: true }),
      ]).start();

      if (beat % 5 === 0) {
        syncTelemetry('CPR_ACTIVE', beat, setRef.current);
      }

      // End of a set: roll straight into the next one. No pause for breaths —
      // this protocol is compressions only.
      if (beat >= 30) {
        beatRef.current = 0;
        setRef.current += 1;
        setSetCount(setRef.current);
        syncTelemetry('CPR_ACTIVE', 30, setRef.current);

        if (Platform.OS === 'web' && typeof window !== 'undefined' && 'speechSynthesis' in window) {
          const utterance = new SpeechSynthesisUtterance('Keep going. Do not stop.');
          utterance.rate = 1.1;
          window.speechSynthesis.speak(utterance);
        }
      }
    }, CPR_INTERVAL_MS);
  }, [playMetronomeClick, pulseAnim, syncTelemetry]);

  const stopCPRMetronome = useCallback((): void => {
    if (cprIntervalRef.current) {
      clearInterval(cprIntervalRef.current);
      cprIntervalRef.current = null;
    }
    setCprActive(false);
  }, []);

  /** Resume from where the current set left off, rather than restarting at 1. */
  const resumeCPRMetronome = useCallback((): void => {
    if (cprIntervalRef.current) return;
    setCprActive(true);
    cprIntervalRef.current = setInterval(() => {
      if (!isMountedRef.current) return;
      beatRef.current = beatRef.current >= 30 ? 1 : beatRef.current + 1;
      setBeatCount(beatRef.current);
      playMetronomeClick();
    }, CPR_INTERVAL_MS);
  }, [playMetronomeClick]);

  // -----------------------------------------------------------------------
  // Node Navigation & Triage Transition
  // -----------------------------------------------------------------------
  const handleTransition = useCallback(
    (choice: 'yes' | 'no'): void => {
      const node = TriageTree[currentNodeId];
      if (!node) return;

      const nextNodeId = choice === 'yes' ? node.onYes : node.onNo;

      let telemetryState: string | undefined = nextNodeId && TriageTree[nextNodeId] ? TriageTree[nextNodeId].label : undefined;

      // Sync strict medical states for specific critical nodes
      if (node.id === 'check_response' && choice === 'no') telemetryState = 'CRITICAL_UNCONSCIOUS';
      if (node.id === 'check_massive_bleeding' && choice === 'yes') telemetryState = 'BLEEDING_TRAUMA';
      if ((node.id === 'control_bleeding' || node.id === 'control_bleeding_persist') && choice === 'yes') telemetryState = 'BLEEDING_CONTROLLED';
      if (node.id === 'check_breathing') {
        if (choice === 'no') telemetryState = 'CPR_ACTIVE';
        if (choice === 'yes') telemetryState = 'RECOVERY_POSITION';
      }

      if (telemetryState) {
        syncTelemetry(telemetryState);
      }

      if (nextNodeId && TriageTree[nextNodeId]) {
        // A node whose "no" branch points at itself (bleeding not yet
        // controlled, not yet in CPR position) sets the same id, which React
        // bails out on. The token makes the effect re-run so the instruction
        // is repeated and the mic reopens.
        setCurrentNodeId(nextNodeId);
        setVisitToken((t) => t + 1);
      }
    },
    [currentNodeId, syncTelemetry]
  );

  // -----------------------------------------------------------------------
  // Speech Recognition (keyword spotting)
  // -----------------------------------------------------------------------

  /** Maps a heard phrase onto a yes/no branch. Returns false if it matched neither. */
  const applyTranscript = useCallback(
    (raw: string): boolean => {
      const transcript = raw.toLowerCase().trim();
      setHeardText(transcript);

      // Check "no" first: "no" is a substring of words like "nope" but also of
      // "know", so require word-ish boundaries on both sides.
      if (/\b(no|nope|negative|not)\b/.test(transcript)) {
        handleTransition('no');
        return true;
      }
      if (/\b(yes|yeah|yep|yup|ok|okay|ready|done|affirmative)\b/.test(transcript)) {
        handleTransition('yes');
        return true;
      }
      return false;
    },
    [handleTransition]
  );

  const startListening = useCallback((): void => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const SpeechRec =
        (window as unknown as { SpeechRecognition?: new () =>IWebSpeechRecognition }).SpeechRecognition ||
        (window as unknown as { webkitSpeechRecognition?: new () =>IWebSpeechRecognition }).webkitSpeechRecognition;

      if (SpeechRec) {
        try {
          const rec = new SpeechRec();
          rec.continuous = false;
          rec.interimResults = false;
          rec.lang = VOICE_LOCALE;

          rec.onstart = () => {
            if (isMountedRef.current) setIsListening(true);
          };

          rec.onresult = (event) => {
            if (!isMountedRef.current) return;
            applyTranscript(event.results[0][0].transcript);
          };

          rec.onerror = () => { if (isMountedRef.current) setIsListening(false); };
          rec.onend = () => { if (isMountedRef.current) setIsListening(false); };

          webRecognitionRef.current = rec;
          rec.start();
        } catch (_e) {
          // Mic unavailable — the on-screen YES/NO buttons remain the path.
        }
      }
      return;
    }

    // Native: previously nothing listened here at all, so "hands-free" triage
    // only ever worked in a browser.
    const api = getSpeechApi();
    if (!api) return; // no native speech on this client — buttons remain

    (async () => {
      try {
        const perm = await api.ExpoSpeechRecognitionModule.requestPermissionsAsync();
        if (!perm.granted) return;
        api.ExpoSpeechRecognitionModule.start({
          lang: VOICE_LOCALE,
          interimResults: false,
          continuous: false,
        });
      } catch (_e) {
        // Fall back to the on-screen buttons.
      }
    })();
  }, [applyTranscript]);

  // -----------------------------------------------------------------------
  // Speak Current Node
  // -----------------------------------------------------------------------
  const speakCurrentNode = useCallback(
    (node: TriageNode): void => {
      setIsSpeaking(true);

      if (Platform.OS === 'web' && typeof window !== 'undefined' && 'speechSynthesis' in window) {
        try {
          window.speechSynthesis.cancel();
          const utterance = new SpeechSynthesisUtterance(node.text);
          utterance.rate = 1.0;
          utterance.pitch = 1.0;
          utterance.lang = VOICE_LOCALE;

          utterance.onend = () => {
            if (!isMountedRef.current) return;
            setIsSpeaking(false);
            if (!node.isTerminal && (node.onYes || node.onNo)) {
              startListening();
            }
          };

          window.speechSynthesis.speak(utterance);
          return;
        } catch (_e) {}
      }

      try {
        Speech.stop();
        Speech.speak(node.text, {
          language: VOICE_LOCALE,
          rate: 1.0,
          onDone: () => {
            if (!isMountedRef.current) return;
            setIsSpeaking(false);
            if (!node.isTerminal) startListening();
          },
        });
      } catch (_e) {
        setIsSpeaking(false);
      }
    },
    [startListening]
  );

  // Trigger speech when node changes + handle auto-advance nodes
  useEffect(() => {
    if (!isActive) return;
    const node = TriageTree[currentNodeId];
    if (!node) return;

    speakCurrentNode(node);

    // Instruction-only nodes advance on a timer rather than a yes/no.
    if (node.action === 'auto_advance' && node.autoAdvanceTo) {
      const timer = setTimeout(() => {
        if (isMountedRef.current && TriageTree[node.autoAdvanceTo!]) {
          setCurrentNodeId(node.autoAdvanceTo!);
          setVisitToken((t) => t + 1);
        }
      }, node.autoAdvanceDelayMs || 3000);
      return () => clearTimeout(timer);
    }
  }, [currentNodeId, visitToken, isActive, speakCurrentNode]);

  // The metronome starts once, when the tree reaches the CPR node.
  useEffect(() => {
    if (!isActive) return;
    if (TriageTree[currentNodeId]?.action === 'start_cpr' && !cprIntervalRef.current) {
      startCPRMetronome();
    }
  }, [currentNodeId, isActive, startCPRMetronome]);

  // Native speech-recognition events
  useEffect(() => {
    if (Platform.OS === 'web') return;

    const api = getSpeechApi();
    if (!api) return;

    const onResult = api.addSpeechRecognitionListener('result', (event) => {
      if (!isMountedRef.current) return;
      const transcript = event.results?.[0]?.transcript;
      if (transcript) applyTranscript(transcript);
    });
    const onEnd = api.addSpeechRecognitionListener('end', () => {
      if (isMountedRef.current) setIsListening(false);
    });
    const onStart = api.addSpeechRecognitionListener('start', () => {
      if (isMountedRef.current) setIsListening(true);
    });
    const onError = api.addSpeechRecognitionListener('error', () => {
      if (isMountedRef.current) setIsListening(false);
    });

    return () => {
      onResult.remove();
      onEnd.remove();
      onStart.remove();
      onError.remove();
    };
  }, [applyTranscript]);

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      stopCPRMetronome();
      if (Platform.OS === 'web' && typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      audioCtxRef.current?.close().catch(() => {});
      audioCtxRef.current = null;
      if (Platform.OS !== 'web') {
        try {
          getSpeechApi()?.ExpoSpeechRecognitionModule.abort();
        } catch (_e) {
          // nothing listening
        }
      }
    };
  }, [stopCPRMetronome]);

  if (!isActive) return null;

  return (
    <View style={styles.container}>
      {/* 1. Header HUD & Mic Status */}
      <View style={styles.hudTopRow}>
        <View style={styles.aiTag}>
          <Text style={styles.aiTagText}>SEVERE TRAUMA PROTOCOL</Text>
        </View>
        <View style={styles.micStatusTag}>
          <View
            style={[
              styles.micDot,
              {
              backgroundColor: !voiceAvailable
                ? color.textFaint
                : isListening
                ? color.confirm
                : isSpeaking
                ? color.amber
                : color.amber,
            },
            ]}
          />
          <Text style={styles.micStatusText}>
            {!voiceAvailable
              ? 'TAP TO ANSWER'
              : isListening
              ? 'MIC ACTIVE • SAY YES / NO'
              : isSpeaking
              ? 'VOICE COACHING...'
              : 'STANDBY'}
          </Text>
        </View>
      </View>

      {/* 2. Interactive Triage Question Card */}
      {!cprActive && (
        <View style={styles.questionCard}>
          <Text style={styles.questionNodeTitle}>
            {currentNode.step ? `STEP ${currentNode.step} • ` : ''}{currentNode.id.replace(/_/g, ' ').toUpperCase()}
          </Text>
          <Text style={styles.questionText}>{currentNode.text}</Text>

          {currentNode.imageSource && (
            <Image
              source={currentNode.imageSource}
              style={styles.instructionalImage}
              resizeMode="contain"
            />
          )}

          {/* Tactile Yes / No Buttons — hidden for auto-advance nodes */}
          {currentNode.action !== 'auto_advance' && (
            <View style={styles.buttonActionRow}>
              {currentNode.onYes && (
                <TouchableOpacity
                  style={styles.yesBtn}
                  onPress={() => handleTransition('yes')}
                  activeOpacity={0.8}
                >
                  <Text style={styles.yesBtnText}>YES</Text>
                </TouchableOpacity>
              )}

              {currentNode.onNo && (
                <TouchableOpacity
                  style={styles.noBtn}
                  onPress={() => handleTransition('no')}
                  activeOpacity={0.8}
                >
                  <Text style={styles.noBtnText}>NO</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {!voiceAvailable && currentNode.action !== 'auto_advance' && (
            <Text style={styles.voiceUnavailableNote}>Voice answers need a development build — spoken guidance still works, tap YES or NO.
            </Text>
          )}

          {/* Auto-advance indicator for instruction-only nodes */}
          {currentNode.action === 'auto_advance' && (
            <View style={styles.autoAdvanceBanner}>
              <Text style={styles.autoAdvanceText}>AUTO-ADVANCING TO NEXT STEP...</Text>
            </View>
          )}
        </View>
      )}

      {/* 3. CPR 110 BPM Metronome HUD (When Active) */}
      {cprActive && (
        <View style={styles.cprCard}>
          <View style={styles.cprHeaderRow}>
            <Text style={styles.cprTitle}>CPR PACING METRONOME (110 BPM)</Text>
            <Text style={styles.cprSetBadge}>SET #{setCount}</Text>
          </View>

          {/* Glowing Heart Metronome Actuator */}
          <Animated.View style={[styles.heartContainer, { transform: [{ scale: pulseAnim }] }]}>
            <PulseIcon size={20} color={color.text} />
            <Text style={styles.cprCounterText}>{beatCount}</Text>
            <Text style={styles.cprTargetSubtext}>/ 30 PUSHES</Text>
          </Animated.View>

          {/* Rescue Breath Guidance */}
          <View style={styles.cprInstructionBox}>
            <Text style={styles.cprInstructionTitle}>PUSH HARD & FAST • CENTER OF CHEST • LOCK ELBOWS STRAIGHT</Text>
            <Text style={styles.cprInstructionDetail}>Depth: 2+ inches • Rate: 100–120/min • Full recoil • Ignore rib cracking
            </Text>
            <Text style={styles.cprInstructionDetail}>COMPRESSIONS ONLY — NO MOUTH-TO-MOUTH
            </Text>
          </View>

          {/* CPR Controls */}
          <View style={styles.cprControlsRow}>
            <TouchableOpacity
              style={styles.cprStopBtn}
              onPress={cprIntervalRef.current ? stopCPRMetronome : resumeCPRMetronome}
              activeOpacity={0.8}
            >
              <Text style={styles.cprStopBtnText}>
                {cprIntervalRef.current ? 'PAUSE' : 'RESUME'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.cprResetBtn}
              onPress={startCPRMetronome}
              activeOpacity={0.8}
            >
              <Text style={styles.cprResetBtnText}>RESTART SET</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
};

export default VoiceTriage;

const styles = StyleSheet.create({
  container: {
    marginVertical: 10,
  } as ViewStyle,

  hudTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  } as ViewStyle,
  aiTag: {
    backgroundColor: color.surfaceMuted,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: color.amber,
  } as ViewStyle,
  aiTagText: {
    fontSize: 10,
    fontFamily: font.mono,
    fontWeight: '800',
    color: color.amber,
  } as TextStyle,
  micStatusTag: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: color.surface,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: color.hairline,
  } as ViewStyle,
  micDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  } as ViewStyle,
  micStatusText: {
    fontSize: 9,
    fontFamily: font.mono,
    fontWeight: '800',
    color: color.textMuted,
  } as TextStyle,

  // Question Card
  questionCard: {
    backgroundColor: color.surface,
    borderRadius: 16,
    padding: 18,
    borderWidth: 1.5,
    borderColor: color.hairline,
    marginBottom: 12,
  } as ViewStyle,
  questionNodeTitle: {
    fontSize: 10,
    fontFamily: font.mono,
    fontWeight: '800',
    color: color.amber,
    letterSpacing: 1,
    marginBottom: 6,
  } as TextStyle,
  questionText: {
    fontSize: 16,
    fontWeight: '800',
    color: color.text,
    lineHeight: 24,
    marginBottom: 16,
  } as TextStyle,
  instructionalImage: {
    width: '100%',
    height: 160,
    borderRadius: 12,
    marginBottom: 16,
    backgroundColor: color.groundDeep,
    borderWidth: 1,
    borderColor: color.hairline,
  } as ImageStyle,

  buttonActionRow: {
    flexDirection: 'row',
    gap: 12,
  } as ViewStyle,
  yesBtn: {
    flex: 1,
    backgroundColor: color.confirmWash,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: color.confirm,
  } as ViewStyle,
  yesBtnText: {
    fontSize: 14,
    fontWeight: '900',
    color: color.confirm,
    fontFamily: font.mono,
    letterSpacing: 1,
  } as TextStyle,
  noBtn: {
    flex: 1,
    backgroundColor: color.signalWash,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: color.signal,
  } as ViewStyle,
  noBtnText: {
    fontSize: 14,
    fontWeight: '900',
    color: color.signalLift,
    fontFamily: font.mono,
    letterSpacing: 1,
  } as TextStyle,

  // CPR Metronome Card
  cprCard: {
    backgroundColor: color.signalWash,
    borderRadius: 18,
    padding: 18,
    borderWidth: 2,
    borderColor: color.signal,
    alignItems: 'center',
    marginBottom: 12,
  } as ViewStyle,
  cprHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    alignItems: 'center',
    marginBottom: 16,
  } as ViewStyle,
  cprTitle: {
    fontSize: 11,
    fontFamily: font.mono,
    fontWeight: '900',
    color: color.signalLift,
    letterSpacing: 1,
  } as TextStyle,
  cprSetBadge: {
    fontSize: 10,
    fontFamily: font.mono,
    fontWeight: '900',
    color: color.amber,
    backgroundColor: color.amberWash,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: color.amber,
  } as TextStyle,

  heartContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  } as ViewStyle,
  heartEmoji: {
    fontSize: 48,
    marginBottom: 4,
  } as TextStyle,
  cprCounterText: {
    fontSize: 48,
    fontWeight: '900',
    color: color.text,
    fontFamily: font.mono,
  } as TextStyle,
  cprTargetSubtext: {
    fontSize: 12,
    fontFamily: font.mono,
    color: color.signalLift,
    fontWeight: '700',
    marginTop: -4,
  } as TextStyle,

  cprInstructionBox: {
    backgroundColor: color.signalWash,
    borderRadius: 10,
    padding: 12,
    width: '100%',
    alignItems: 'center',
    marginVertical: 14,
    borderWidth: 1,
    borderColor: color.signal,
  } as ViewStyle,
  cprInstructionTitle: {
    fontSize: 12,
    fontWeight: '900',
    color: color.text,
    textAlign: 'center',
    marginBottom: 4,
  } as TextStyle,
  cprInstructionDetail: {
    fontSize: 10,
    color: color.signalLift,
    textAlign: 'center',
  } as TextStyle,

  cprControlsRow: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
  } as ViewStyle,
  cprStopBtn: {
    flex: 1,
    backgroundColor: color.hairline,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: color.hairlineStrong,
  } as ViewStyle,
  cprStopBtnText: {
    fontSize: 10,
    fontFamily: font.mono,
    fontWeight: '800',
    color: color.textMuted,
  } as TextStyle,
  cprResetBtn: {
    flex: 1,
    backgroundColor: color.hairline,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: color.signal,
  } as ViewStyle,
  cprResetBtnText: {
    fontSize: 10,
    fontFamily: font.mono,
    fontWeight: '800',
    color: color.signalLift,
  } as TextStyle,

  voiceUnavailableNote: {
    fontSize: 10,
    color: color.textMuted,
    textAlign: 'center',
    marginTop: 10,
    lineHeight: 15,
  } as TextStyle,

  // Auto-advance indicator
  autoAdvanceBanner: {
    backgroundColor: color.surfaceMuted,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: color.amber,
    marginTop: 12,
  } as ViewStyle,
  autoAdvanceText: {
    fontSize: 11,
    fontFamily: font.mono,
    fontWeight: '800',
    color: color.amber,
    letterSpacing: 1,
  } as TextStyle,
});
