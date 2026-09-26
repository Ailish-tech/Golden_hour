// ============================================================================
// SAMARITAN SHIELD — Intersection simulation
//
// A 4-way junction drawn in react-native-svg. LIVE follows server pre-emption
// over the live socket. DEMO is self-contained so the corridor can be shown
// with Mongo and the ML service both stopped. The DEMO badge is mandatory:
// a judge must not be able to confuse a canned loop with a live corridor.
// ============================================================================

import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Svg, { Circle, G, Line, Rect, Text as SvgText } from 'react-native-svg';
import { connectLive } from './liveSocket';

type Approach = 'N' | 'S' | 'E' | 'W';
type Lamp = 'GREEN' | 'YELLOW' | 'RED';

export interface LiveSignalPhase {
  signalId?: string;
  approach?: string;
  state?: string;
  mode?: string;
}

interface SignalSimProps {
  livePhase?: LiveSignalPhase | null;
}

const SIZE = 320;
const CX = SIZE / 2;
const CY = SIZE / 2;
const ROAD = 54;

const APPROACHES: Approach[] = ['N', 'S', 'E', 'W'];

function opposite(a: Approach): Approach {
  if (a === 'N') return 'S';
  if (a === 'S') return 'N';
  if (a === 'E') return 'W';
  return 'E';
}

function lampFor(active: Approach, self: Approach, preempted: boolean): Lamp {
  if (preempted && (self === active || self === opposite(active))) return 'GREEN';
  if (preempted) return 'RED';
  if (self === active || self === opposite(active)) return 'GREEN';
  return 'RED';
}

function ambulanceXY(progress: number, approach: Approach): { x: number; y: number } {
  const t = Math.max(0, Math.min(1, progress));
  if (approach === 'S') return { x: CX - 10, y: SIZE - 20 - t * (SIZE - 40) };
  if (approach === 'N') return { x: CX + 10, y: 20 + t * (SIZE - 40) };
  if (approach === 'W') return { x: SIZE - 20 - t * (SIZE - 40), y: CY + 10 };
  return { x: 20 + t * (SIZE - 40), y: CY - 10 };
}

export default function SignalSim({ livePhase }: SignalSimProps): React.JSX.Element {
  const [mode, setMode] = useState<'LIVE' | 'DEMO'>('DEMO');
  const [active, setActive] = useState<Approach>('S');
  const [preempted, setPreempted] = useState(false);
  const [progress, setProgress] = useState(0);
  const [running, setRunning] = useState(false);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    const conn = connectLive({
      'signal-state': (payload) => {
        if (mode !== 'LIVE') return;
        const approach = String(payload.approach || '').toUpperCase();
        if (approach === 'N' || approach === 'S' || approach === 'E' || approach === 'W') {
          setActive(approach);
        }
        setPreempted(payload.mode === 'PREEMPTED' || payload.state === 'GREEN');
      },
      'corridor-opened': (payload) => {
        if (mode !== 'LIVE') return;
        const first = Array.isArray(payload.signals) ? (payload.signals[0] as { approach?: string }) : null;
        const approach = String(first?.approach || 'S').toUpperCase();
        if (approach === 'N' || approach === 'S' || approach === 'E' || approach === 'W') {
          setActive(approach);
        }
        setPreempted(true);
        setRunning(true);
        setProgress(0);
      },
      'corridor-cleared': () => {
        if (mode !== 'LIVE') return;
        setPreempted(false);
        setRunning(false);
        setProgress(0);
      },
    });
    return () => conn.disconnect();
  }, [mode]);

  useEffect(() => {
    if (livePhase && mode === 'LIVE') {
      const approach = String(livePhase.approach || '').toUpperCase();
      if (approach === 'N' || approach === 'S' || approach === 'E' || approach === 'W') {
        setActive(approach);
      }
      if (livePhase.mode === 'PREEMPTED') setPreempted(true);
    }
  }, [livePhase, mode]);

  useEffect(() => {
    if (!running) return;
    let start: number | null = null;
    const step = (ts: number) => {
      if (start == null) start = ts;
      const t = (ts - start) / 6000;
      if (t >= 1) {
        setProgress(1);
        setRunning(false);
        if (mode === 'DEMO') {
          setTimeout(() => {
            setPreempted(false);
            setProgress(0);
          }, 800);
        }
        return;
      }
      setProgress(t);
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => {
      if (raf.current != null) cancelAnimationFrame(raf.current);
    };
  }, [running, mode]);

  const injectAmbulance = (): void => {
    setMode('DEMO');
    setActive('S');
    setPreempted(true);
    setProgress(0);
    setRunning(true);
  };

  const pos = ambulanceXY(progress, active);

  return (
    <View style={styles.wrap}>
      <View style={styles.toolbar}>
        <Text style={styles.title}>Intersection</Text>
        <View style={styles.modeRow}>
          <TouchableOpacity
            style={[styles.modeBtn, mode === 'LIVE' && styles.modeOn]}
            onPress={() => {
              setMode('LIVE');
              setRunning(false);
              setProgress(0);
            }}
          >
            <Text style={styles.modeTxt}>LIVE</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modeBtn, mode === 'DEMO' && styles.modeDemo]}
            onPress={() => setMode('DEMO')}
          >
            <Text style={styles.modeTxt}>DEMO</Text>
          </TouchableOpacity>
        </View>
      </View>

      {mode === 'DEMO' && (
        <Text style={styles.demoBanner}>DEMO — simulated corridor, not live city state</Text>
      )}

      <Svg width="100%" height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        <Rect x={0} y={0} width={SIZE} height={SIZE} fill="#0B1220" />
        <Rect x={CX - ROAD / 2} y={0} width={ROAD} height={SIZE} fill="#1E293B" />
        <Rect x={0} y={CY - ROAD / 2} width={SIZE} height={ROAD} fill="#1E293B" />
        <Line x1={CX} y1={8} x2={CX} y2={SIZE - 8} stroke="#334155" strokeDasharray="6 8" />
        <Line x1={8} y1={CY} x2={SIZE - 8} y2={CY} stroke="#334155" strokeDasharray="6 8" />

        {APPROACHES.map((arm) => {
          const lamp = lampFor(active, arm, preempted);
          const color = lamp === 'GREEN' ? '#22C55E' : lamp === 'YELLOW' ? '#F59E0B' : '#EF4444';
          const posLamp =
            arm === 'N' ? { x: CX + 38, y: 36 } :
            arm === 'S' ? { x: CX - 38, y: SIZE - 36 } :
            arm === 'E' ? { x: SIZE - 36, y: CY - 38 } :
            { x: 36, y: CY + 38 };
          return (
            <G key={arm}>
              <Rect x={posLamp.x - 8} y={posLamp.y - 18} width={16} height={36} rx={3} fill="#020617" />
              <Circle cx={posLamp.x} cy={posLamp.y} r={6} fill={color} />
              <SvgText x={posLamp.x} y={posLamp.y + 28} fill="#94A3B8" fontSize="10" textAnchor="middle">
                {arm}
              </SvgText>
            </G>
          );
        })}

        {(running || progress > 0) && (
          <G>
            <Rect x={pos.x - 9} y={pos.y - 6} width={18} height={12} rx={2} fill="#F8FAFC" />
            <Rect x={pos.x - 5} y={pos.y - 4} width={6} height={8} fill="#EF4444" />
            <SvgText x={pos.x} y={pos.y - 10} fill="#F8FAFC" fontSize="8" textAnchor="middle">
              AMB
            </SvgText>
          </G>
        )}
      </Svg>

      <TouchableOpacity style={styles.inject} onPress={injectAmbulance}>
        <Text style={styles.injectTxt}>Inject ambulance (DEMO)</Text>
      </TouchableOpacity>
      <Text style={styles.hint}>
        {preempted
          ? `Corridor holding ${active}/${opposite(active)} GREEN`
          : 'Adaptive cycle — tap inject to watch pre-emption'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: '#020617',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
    padding: 10,
  },
  toolbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  title: {
    color: '#E2E8F0',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  modeRow: { flexDirection: 'row', gap: 6 },
  modeBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    backgroundColor: '#1E293B',
  },
  modeOn: { backgroundColor: '#1D4ED8' },
  modeDemo: { backgroundColor: '#B45309' },
  modeTxt: { color: '#F8FAFC', fontSize: 10, fontWeight: '700' },
  demoBanner: {
    color: '#FDE68A',
    backgroundColor: '#78350F',
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
    paddingVertical: 4,
    marginBottom: 6,
    borderRadius: 4,
  },
  inject: {
    marginTop: 8,
    backgroundColor: '#10B981',
    borderRadius: 6,
    paddingVertical: 10,
    alignItems: 'center',
  },
  injectTxt: { color: '#022C22', fontWeight: '800', fontSize: 13 },
  hint: { color: '#94A3B8', fontSize: 11, marginTop: 8, textAlign: 'center' },
});
