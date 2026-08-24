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
import * as Speech from 'expo-speech';
import * as Haptics from 'expo-haptics';

import {
  TriageTree,
  INITIAL_NODE_ID,
  type TriageNode,
  type TriageAction,
} from './TriageTree';

// ---------------------------------------------------------------------------
// Types & Config
// ---------------------------------------------------------------------------
type EnginePhase = 'speaking' | 'listening' | 'processing' | 'action';

interface VoiceTriageProps {
  onDismiss?: () => void;
  isActive: boolean;
  incidentId?: string;
}

const CPR_BPM = 110;
const CPR_INTERVAL_MS = Math.round((60 / CPR_BPM) * 1000); // ~545ms
const VOICE_LOCALE = 'en-US';

const API_BASE: string = Platform.select({
  android: 'http://192.168.1.9:3000',
  ios: 'http://192.168.1.9:3000',
  default: 'http://localhost:3000',
}) as string;

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
  const [enginePhase, setEnginePhase] = useState<EnginePhase>('speaking');
  const [spokenText, setSpokenText] = useState<string>('');
  const [isListening, setIsListening] = useState<boolean>(false);
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [heardText, setHeardText] = useState<string>('');
  const [cprActive, setCprActive] = useState<boolean>(false);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [beatCount, setBeatCount] = useState<number>(0);
  const [setCount, setSetCount] = useState<number>(1);
  const [micSupported, setMicSupported] = useState<boolean>(true);
  const [nodeHistory, setNodeHistory] = useState<string[]>([]);

  // -- Refs ----------------------------------------------------------------
  const cprIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const webRecognitionRef = useRef<IWebSpeechRecognition | null>(null);
  const isMountedRef = useRef<boolean>(true);

  // -- Animations ----------------------------------------------------------
  const pulseAnim = useRef<Animated.Value>(new Animated.Value(1)).current;
  const micPulse = useRef<Animated.Value>(new Animated.Value(1)).current;
  const fadeAnim = useRef<Animated.Value>(new Animated.Value(0)).current;

  // Current Node
  const currentNode: TriageNode = TriageTree[currentNodeId] || TriageTree[INITIAL_NODE_ID];

  // -----------------------------------------------------------------------
  // Live Backend Telemetry Sync Helper
  // -----------------------------------------------------------------------
  const syncTelemetry = useCallback(
    (victimCondition: string, compressions?: number, sets?: number) => {
      // Guard against syncing telemetry to the placeholder mock ID
      if (!incidentId || incidentId === 'INC-8492' || incidentId === 'CAD-8492-TX') return;
      fetch(`${API_BASE}/api/incidents/${incidentId}/triage`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
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
  const playMetronomeClick = useCallback((): void => {
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
  }, []);

  // -----------------------------------------------------------------------
  // CPR Metronome Loop (110 BPM, 30 Compressions / 2 Breaths)
  // -----------------------------------------------------------------------
  const startCPRMetronome = useCallback((): void => {
    setCprActive(true);
    setBeatCount(0);
    syncTelemetry('CPR_ACTIVE', 0, setCount);

    if (cprIntervalRef.current) clearInterval(cprIntervalRef.current);

    cprIntervalRef.current = setInterval(() => {
      setBeatCount((prev) => {
        const next = prev + 1;
        playMetronomeClick();

        if (Platform.OS !== 'web') {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
        }

        // Pulse Animation on Beat
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.2, duration: 60, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1.0, duration: 120, useNativeDriver: true }),
        ]).start();

        // Sync compression telemetry to server every 5 beats
        if (next % 5 === 0 || next === 30) {
          syncTelemetry('CPR_ACTIVE', next, setCount);
        }

        if (next >= 30) {
          // Compressions-only CPR — no rescue breaths.
          // Immediately restart the next set of 30.
          if (cprIntervalRef.current) clearInterval(cprIntervalRef.current);
          setSetCount((s) => s + 1);

          if (Platform.OS === 'web' && typeof window !== 'undefined' && 'speechSynthesis' in window) {
            const nextSetUtterance = new SpeechSynthesisUtterance('Keep going. Next set. Do not stop.');
            nextSetUtterance.rate = 1.1;
            window.speechSynthesis.speak(nextSetUtterance);
          }

          setTimeout(() => {
            if (isMountedRef.current) {
              startCPRMetronome();
            }
          }, 1200);

          return 30;
        }
        return next;
      });
    }, CPR_INTERVAL_MS);
  }, [playMetronomeClick, pulseAnim, syncTelemetry, setCount]);

  const stopCPRMetronome = useCallback((): void => {
    if (cprIntervalRef.current) {
      clearInterval(cprIntervalRef.current);
      cprIntervalRef.current = null;
    }
    setCprActive(false);
  }, []);

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
        setCurrentNodeId(nextNodeId);
      } else if (node.action) {
        if (node.action === 'start_cpr') {
          startCPRMetronome();
        }
      }
    },
    [currentNodeId, startCPRMetronome, syncTelemetry]
  );

  // -----------------------------------------------------------------------
  // Speech Recognition (Keyword Spotting)
  // -----------------------------------------------------------------------
  const startListening = useCallback((): void => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const SpeechRec =
        (window as unknown as { SpeechRecognition?: new () => IWebSpeechRecognition }).SpeechRecognition ||
        (window as unknown as { webkitSpeechRecognition?: new () => IWebSpeechRecognition }).webkitSpeechRecognition;

      if (SpeechRec) {
        try {
          const rec = new SpeechRec();
          rec.continuous = false;
          rec.interimResults = false;
          rec.lang = VOICE_LOCALE;

          rec.onstart = () => {
            if (isMountedRef.current) {
              setIsListening(true);
              setEnginePhase('listening');
            }
          };

          rec.onresult = (event) => {
            if (!isMountedRef.current) return;
            const transcript = event.results[0][0].transcript.toLowerCase().trim();
            setHeardText(transcript);

            if (transcript.includes('yes') || transcript.includes('yeah') || transcript.includes('ok') || transcript.includes('ready')) {
              handleTransition('yes');
            } else if (transcript.includes('no') || transcript.includes('not') || transcript.includes('nope')) {
              handleTransition('no');
            }
          };

          rec.onerror = () => { if (isMountedRef.current) setIsListening(false); };
          rec.onend = () => { if (isMountedRef.current) setIsListening(false); };

          webRecognitionRef.current = rec;
          rec.start();
        } catch (_e) {
          setMicSupported(false);
        }
      }
    }
  }, [handleTransition]);

  // -----------------------------------------------------------------------
  // Speak Current Node
  // -----------------------------------------------------------------------
  const speakCurrentNode = useCallback(
    (node: TriageNode): void => {
      setIsSpeaking(true);
      setEnginePhase('speaking');

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
    if (node) {
      setSpokenText(node.text);
      speakCurrentNode(node);

      if (node.action === 'start_cpr') {
        startCPRMetronome();
      }

      // Auto-advance nodes (e.g. call_108, victim_responsive)
      // These are instruction-only nodes that don't wait for yes/no.
      if (node.action === 'auto_advance' && node.autoAdvanceTo) {
        const delay = node.autoAdvanceDelayMs || 3000;
        const timer = setTimeout(() => {
          if (isMountedRef.current && TriageTree[node.autoAdvanceTo!]) {
            setCurrentNodeId(node.autoAdvanceTo!);
          }
        }, delay);
        return () => clearTimeout(timer);
      }
    }
  }, [currentNodeId, isActive, speakCurrentNode, startCPRMetronome]);

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      stopCPRMetronome();
      if (Platform.OS === 'web' && typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, [stopCPRMetronome]);

  if (!isActive) return null;

  return (
    <View style={styles.container}>
      {/* 1. Header HUD & Mic Status */}
      <View style={styles.hudTopRow}>
        <View style={styles.aiTag}>
          <Text style={styles.aiTagText}>🤖 SEVERE TRAUMA PROTOCOL</Text>
        </View>
        <View style={styles.micStatusTag}>
          <View
            style={[
              styles.micDot,
              { backgroundColor: isListening ? '#22c55e' : isSpeaking ? '#38bdf8' : '#eab308' },
            ]}
          />
          <Text style={styles.micStatusText}>
            {isListening ? 'MIC ACTIVE • SAY YES / NO' : isSpeaking ? 'VOICE COACHING...' : 'STANDBY'}
          </Text>
        </View>
      </View>

      {/* 2. Interactive Triage Question Card */}
      {!cprActive && (
        <View style={styles.questionCard}>
          <Text style={styles.questionNodeTitle}>
            {currentNode.step ? `STEP ${currentNode.step} • ` : ''}{currentNode.id.replace(/_/g, ' ').toUpperCase()}
          </Text>
          <Text style={styles.questionText}>{spokenText || currentNode.text}</Text>

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
                  <Text style={styles.yesBtnText}>✓ YES</Text>
                </TouchableOpacity>
              )}

              {currentNode.onNo && (
                <TouchableOpacity
                  style={styles.noBtn}
                  onPress={() => handleTransition('no')}
                  activeOpacity={0.8}
                >
                  <Text style={styles.noBtnText}>✕ NO</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* Auto-advance indicator for instruction-only nodes */}
          {currentNode.action === 'auto_advance' && (
            <View style={styles.autoAdvanceBanner}>
              <Text style={styles.autoAdvanceText}>⏳ AUTO-ADVANCING TO NEXT STEP...</Text>
            </View>
          )}
        </View>
      )}

      {/* 3. CPR 110 BPM Metronome HUD (When Active) */}
      {cprActive && (
        <View style={styles.cprCard}>
          <View style={styles.cprHeaderRow}>
            <Text style={styles.cprTitle}>🫀 CPR PACING METRONOME (110 BPM)</Text>
            <Text style={styles.cprSetBadge}>SET #{setCount}</Text>
          </View>

          {/* Glowing Heart Metronome Actuator */}
          <Animated.View style={[styles.heartContainer, { transform: [{ scale: pulseAnim }] }]}>
            <Text style={styles.heartEmoji}>❤️</Text>
            <Text style={styles.cprCounterText}>{beatCount}</Text>
            <Text style={styles.cprTargetSubtext}>/ 30 PUSHES</Text>
          </Animated.View>

          {/* Rescue Breath Guidance */}
          <View style={styles.cprInstructionBox}>
            <Text style={styles.cprInstructionTitle}>
              ⚡ PUSH HARD & FAST • CENTER OF CHEST • LOCK ELBOWS STRAIGHT
            </Text>
            <Text style={styles.cprInstructionDetail}>
              Depth: 2+ inches • Rate: 100–120/min • Full recoil • Ignore rib cracking
            </Text>
            <Text style={styles.cprInstructionDetail}>
              COMPRESSIONS ONLY — NO MOUTH-TO-MOUTH
            </Text>
          </View>

          {/* CPR Controls */}
          <View style={styles.cprControlsRow}>
            <TouchableOpacity
              style={styles.cprStopBtn}
              onPress={stopCPRMetronome}
              activeOpacity={0.8}
            >
              <Text style={styles.cprStopBtnText}>⏸ PAUSE METRONOME</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.cprResetBtn}
              onPress={() => {
                stopCPRMetronome();
                startCPRMetronome();
              }}
              activeOpacity={0.8}
            >
              <Text style={styles.cprResetBtnText}>🔄 RESTART CPR</Text>
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
    backgroundColor: '#0c2744',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#38bdf8',
  } as ViewStyle,
  aiTagText: {
    fontSize: 10,
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
    fontWeight: '800',
    color: '#38bdf8',
  } as TextStyle,
  micStatusTag: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111827',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#1e293b',
  } as ViewStyle,
  micDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  } as ViewStyle,
  micStatusText: {
    fontSize: 9,
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
    fontWeight: '800',
    color: '#94a3b8',
  } as TextStyle,

  // Question Card
  questionCard: {
    backgroundColor: '#111827',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1.5,
    borderColor: '#1e293b',
    marginBottom: 12,
  } as ViewStyle,
  questionNodeTitle: {
    fontSize: 10,
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
    fontWeight: '800',
    color: '#facc15',
    letterSpacing: 1,
    marginBottom: 6,
  } as TextStyle,
  questionText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#ffffff',
    lineHeight: 24,
    marginBottom: 16,
  } as TextStyle,
  instructionalImage: {
    width: '100%',
    height: 160,
    borderRadius: 12,
    marginBottom: 16,
    backgroundColor: '#0a0f1d',
    borderWidth: 1,
    borderColor: '#1e293b',
  } as ImageStyle,

  buttonActionRow: {
    flexDirection: 'row',
    gap: 12,
  } as ViewStyle,
  yesBtn: {
    flex: 1,
    backgroundColor: '#052e16',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#22c55e',
  } as ViewStyle,
  yesBtnText: {
    fontSize: 14,
    fontWeight: '900',
    color: '#4ade80',
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
    letterSpacing: 1,
  } as TextStyle,
  noBtn: {
    flex: 1,
    backgroundColor: '#3b1216',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#ef4444',
  } as ViewStyle,
  noBtnText: {
    fontSize: 14,
    fontWeight: '900',
    color: '#fca5a5',
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
    letterSpacing: 1,
  } as TextStyle,

  // CPR Metronome Card
  cprCard: {
    backgroundColor: '#1a0c10',
    borderRadius: 18,
    padding: 18,
    borderWidth: 2,
    borderColor: '#ef4444',
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
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
    fontWeight: '900',
    color: '#fca5a5',
    letterSpacing: 1,
  } as TextStyle,
  cprSetBadge: {
    fontSize: 10,
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
    fontWeight: '900',
    color: '#facc15',
    backgroundColor: '#3b2405',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#eab308',
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
    color: '#ffffff',
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
  } as TextStyle,
  cprTargetSubtext: {
    fontSize: 12,
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
    color: '#fca5a5',
    fontWeight: '700',
    marginTop: -4,
  } as TextStyle,

  cprInstructionBox: {
    backgroundColor: '#2e0f15',
    borderRadius: 10,
    padding: 12,
    width: '100%',
    alignItems: 'center',
    marginVertical: 14,
    borderWidth: 1,
    borderColor: '#ef4444',
  } as ViewStyle,
  cprInstructionTitle: {
    fontSize: 12,
    fontWeight: '900',
    color: '#ffffff',
    textAlign: 'center',
    marginBottom: 4,
  } as TextStyle,
  cprInstructionDetail: {
    fontSize: 10,
    color: '#fca5a5',
    textAlign: 'center',
  } as TextStyle,

  cprControlsRow: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
  } as ViewStyle,
  cprStopBtn: {
    flex: 1,
    backgroundColor: '#1e293b',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#475569',
  } as ViewStyle,
  cprStopBtnText: {
    fontSize: 10,
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
    fontWeight: '800',
    color: '#cbd5e1',
  } as TextStyle,
  cprResetBtn: {
    flex: 1,
    backgroundColor: '#1e293b',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ef4444',
  } as ViewStyle,
  cprResetBtnText: {
    fontSize: 10,
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
    fontWeight: '800',
    color: '#fca5a5',
  } as TextStyle,

  // Auto-advance indicator
  autoAdvanceBanner: {
    backgroundColor: '#1a1a2e',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#eab308',
    marginTop: 12,
  } as ViewStyle,
  autoAdvanceText: {
    fontSize: 11,
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
    fontWeight: '800',
    color: '#facc15',
    letterSpacing: 1,
  } as TextStyle,
});
