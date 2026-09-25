// ============================================================================
// SAMARITAN SHIELD — Control Room
//
// Live CCTV grid + detection ticker. Streams come from the Python ML service;
// events come from /ws/live. Confirm/Dismiss hit the existing control routes.
// ============================================================================

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { type AppUserProfile } from './firebaseConfig';
import { authedJson } from './api';
import { ML_BASE } from './config';
import { connectLive } from './liveSocket';
import SignalSim, { type LiveSignalPhase } from './SignalSim';

interface ControlRoomProps {
  userProfile: AppUserProfile;
  onLogout: () => void;
}

interface CameraTile {
  cameraId: string;
  name: string;
  zone: string;
  status: 'ONLINE' | 'OFFLINE' | 'DEGRADED' | string;
  location: { lat: number; lng: number };
}

interface DetectionRow {
  id: string;
  type: 'CANDIDATE' | 'ESCALATED';
  cameraId: string;
  cameraName?: string;
  confidence: number;
  detectedAt: string;
  snapshot?: string;
  incidentId?: string;
  lat?: number;
  lng?: number;
}

interface CamerasResponse {
  status: string;
  cameras: CameraTile[];
}

interface DetectionsResponse {
  status: string;
  detections: Array<{
    detectionId: string;
    cameraId: string;
    fusedConfidence: number;
    escalated: boolean;
    incidentId?: string;
    snapshotBase64?: string;
    detectedAt: string;
  }>;
}

function snapshotUri(raw?: string): string | undefined {
  if (!raw) return undefined;
  return raw.startsWith('data:') ? raw : `data:image/jpeg;base64,${raw}`;
}

function timeLabel(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 15_000) return 'Just now';
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  return new Date(iso).toLocaleTimeString();
}

export default function ControlRoom({ userProfile }: ControlRoomProps): React.JSX.Element {
  const [cameras, setCameras] = useState<CameraTile[]>([]);
  const [events, setEvents] = useState<DetectionRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [streamBroken, setStreamBroken] = useState<Record<string, boolean>>({});
  const [tick, setTick] = useState(0);
  const [socketState, setSocketState] = useState<'connecting' | 'live'>('connecting');
  const [livePhase, setLivePhase] = useState<LiveSignalPhase | null>(null);
  const [corridorNote, setCorridorNote] = useState<string | null>(null);

  const selected = useMemo(
    () => events.find((e) => e.id === selectedId) ?? null,
    [events, selectedId]
  );

  const upsertEvent = useCallback((row: DetectionRow) => {
    setEvents((prev) => {
      const without = prev.filter((e) => e.id !== row.id);
      return [row, ...without].slice(0, 40);
    });
    setSelectedId((current) => current ?? row.id);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const load = async (): Promise<void> => {
      try {
        const [cams, dets] = await Promise.all([
          authedJson<CamerasResponse>('/api/control/cameras'),
          authedJson<DetectionsResponse>('/api/control/detections'),
        ]);
        if (cancelled) return;
        setCameras(cams.cameras);
        setEvents(
          dets.detections.map((d) => ({
            id: d.detectionId,
            type: d.escalated ? 'ESCALATED' : 'CANDIDATE',
            cameraId: d.cameraId,
            confidence: d.fusedConfidence,
            detectedAt: typeof d.detectedAt === 'string' ? d.detectedAt : new Date(d.detectedAt).toISOString(),
            snapshot: snapshotUri(d.snapshotBase64),
            incidentId: d.incidentId,
          }))
        );
      } catch (_err) {
        // The ticker still fills from the socket if the REST warm-up fails.
      }
    };

    void load();
    const poll = setInterval(load, 12_000);
    return () => {
      cancelled = true;
      clearInterval(poll);
    };
  }, []);

  useEffect(() => {
    const disconnect = connectLive({
      'detection-candidate': (payload) => {
        setSocketState('live');
        upsertEvent({
          id: String(payload.detectionId ?? `${payload.cameraId}-${payload.detectedAt}`),
          type: 'CANDIDATE',
          cameraId: String(payload.cameraId ?? ''),
          cameraName: payload.cameraName ? String(payload.cameraName) : undefined,
          confidence: Number(payload.fusedConfidence ?? 0),
          detectedAt: String(payload.detectedAt ?? new Date().toISOString()),
          snapshot: snapshotUri(payload.snapshotBase64 ? String(payload.snapshotBase64) : undefined),
          lat: payload.location && typeof payload.location === 'object'
            ? Number((payload.location as { lat?: number }).lat)
            : undefined,
          lng: payload.location && typeof payload.location === 'object'
            ? Number((payload.location as { lng?: number }).lng)
            : undefined,
        });
      },
      'signal-state': (payload) => {
        setSocketState('live');
        setLivePhase({
          signalId: payload.signalId ? String(payload.signalId) : undefined,
          approach: payload.approach ? String(payload.approach) : undefined,
          state: payload.state ? String(payload.state) : undefined,
          mode: payload.mode ? String(payload.mode) : undefined,
        });
      },
      'corridor-opened': (payload) => {
        setSocketState('live');
        const n = Array.isArray(payload.signalsAffected)
          ? payload.signalsAffected.length
          : Array.isArray(payload.signals)
            ? (payload.signals as unknown[]).length
            : 0;
        setCorridorNote(
          `Green corridor open${payload.degraded ? ' (straight-line fallback)' : ''} · ${n} signal(s)`
        );
      },
      'incident-created': (payload) => {
        setSocketState('live');
        upsertEvent({
          id: String(payload.detectionId ?? payload.incidentId ?? Date.now()),
          type: 'ESCALATED',
          cameraId: String(payload.cameraId ?? ''),
          cameraName: payload.cameraName ? String(payload.cameraName) : undefined,
          confidence: Number(payload.fusedConfidence ?? 0),
          detectedAt: String(payload.detectedAt ?? new Date().toISOString()),
          snapshot: snapshotUri(payload.snapshotBase64 ? String(payload.snapshotBase64) : undefined),
          incidentId: payload.incidentId ? String(payload.incidentId) : undefined,
          lat: payload.location && typeof payload.location === 'object'
            ? Number((payload.location as { lat?: number }).lat)
            : undefined,
          lng: payload.location && typeof payload.location === 'object'
            ? Number((payload.location as { lng?: number }).lng)
            : undefined,
        });
      },
    });
    return disconnect;
  }, [upsertEvent]);

  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 800);
    return () => clearInterval(id);
  }, []);

  const escalate = async (id: string): Promise<void> => {
    setBusyId(id);
    try {
      const res = await authedJson<{ incidentId: string }>(`/api/control/detections/${id}/escalate`, {
        method: 'POST',
      });
      setEvents((prev) =>
        prev.map((e) => (e.id === id ? { ...e, type: 'ESCALATED', incidentId: res.incidentId } : e))
      );
    } catch (_err) {
      // Leave the row as a candidate; the operator can retry.
    } finally {
      setBusyId(null);
    }
  };

  const openCorridor = async (row: DetectionRow): Promise<void> => {
    const camera = cameras.find((c) => c.cameraId === row.cameraId);
    const startLat = row.lat ?? camera?.location.lat;
    const startLng = row.lng ?? camera?.location.lng;
    if (!row.incidentId || startLat == null || startLng == null) return;
    setBusyId(row.id);
    try {
      await authedJson('/api/traffic/corridor', {
        method: 'POST',
        body: JSON.stringify({
          incidentId: row.incidentId,
          startLat,
          startLng,
          endLat: 26.8924,
          endLng: 75.815,
          zone: userProfile.zone || camera?.zone,
        }),
      });
    } catch (_err) {
      // ticker / existing corridor
    } finally {
      setBusyId(null);
    }
  };

  const dismiss = async (id: string): Promise<void> => {
    setBusyId(id);
    try {
      await authedJson(`/api/control/detections/${id}/dismiss`, { method: 'POST' });
      setEvents((prev) => prev.filter((e) => e.id !== id));
      setSelectedId((current) => (current === id ? null : current));
    } catch (_err) {
      // keep the row
    } finally {
      setBusyId(null);
    }
  };

  const renderFeed = (cameraId: string): React.ReactNode => {
    if (!ML_BASE) {
      return <Text style={styles.feedMissing}>EXPO_PUBLIC_ML_URL is not set</Text>;
    }

    if (Platform.OS === 'web' && !streamBroken[cameraId]) {
      return React.createElement('img', {
        src: `${ML_BASE}/stream/${cameraId}`,
        alt: cameraId,
        style: { width: '100%', height: '100%', objectFit: 'cover', backgroundColor: '#000' },
        onError: () => setStreamBroken((prev) => ({ ...prev, [cameraId]: true })),
      });
    }

    return (
      <Image
        source={{ uri: `${ML_BASE}/snapshot/${cameraId}.jpg?t=${tick}` }}
        style={styles.feedImage}
      />
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.metaBar}>
        <Text style={styles.metaText}>
          {userProfile.zone || 'City'} · {cameras.filter((c) => c.status === 'ONLINE').length}/
          {cameras.length} cameras online · socket {socketState}
          {corridorNote ? ` · ${corridorNote}` : ''}
        </Text>
      </View>

      <View style={styles.mainLayout}>
        <View style={styles.leftPane}>
          <Text style={styles.paneTitle}>Live Detections</Text>
          <ScrollView>
            {events.length === 0 && (
              <Text style={styles.emptyText}>Waiting for the detector. Loop the sample clip and an impact at ~8s should land here.</Text>
            )}
            {events.map((evt) => (
              <TouchableOpacity
                key={evt.id}
                style={[styles.eventCard, selectedId === evt.id && styles.eventCardSelected]}
                onPress={() => setSelectedId(evt.id)}
              >
                <View style={styles.eventCardHeader}>
                  <Text style={evt.type === 'CANDIDATE' ? styles.tagCandidate : styles.tagEscalated}>
                    {evt.type}
                  </Text>
                  <Text style={styles.eventTime}>{timeLabel(evt.detectedAt)}</Text>
                </View>
                <Text style={styles.eventCamera}>{evt.cameraName || evt.cameraId}</Text>
                <Text style={styles.eventConfidence}>
                  Confidence: {Math.round(evt.confidence * 100)}%
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        <View style={styles.middlePane}>
          <ScrollView>
          <Text style={styles.paneTitle}>Camera Grid</Text>
          <View style={styles.grid}>
            {cameras.map((cam) => (
              <View
                key={cam.cameraId}
                style={[
                  styles.tile,
                  events.some((e) => e.cameraId === cam.cameraId && e.type !== 'ESCALATED') && styles.tileHot,
                ]}
              >
                <View style={styles.feedWrap}>{renderFeed(cam.cameraId)}</View>
                <View style={styles.tileCaption}>
                  <View style={[styles.dot, cam.status === 'ONLINE' ? styles.dotOn : styles.dotOff]} />
                  <Text style={styles.tileName} numberOfLines={1}>
                    {cam.cameraId} · {cam.name}
                  </Text>
                </View>
              </View>
            ))}
            {cameras.length === 0 && (
              <Text style={styles.emptyText}>No cameras seeded. Run npm --prefix server run seed:city — you@example.com</Text>
            )}
          </View>
          <View style={{ height: 16 }} />
          <SignalSim livePhase={livePhase} />
          </ScrollView>
        </View>

        <View style={styles.rightPane}>
          <Text style={styles.paneTitle}>Event Details</Text>
          {selected ? (
            <View style={styles.detailsContent}>
              <Text style={styles.detailsTitle}>{selected.cameraName || selected.cameraId}</Text>
              {selected.snapshot ? (
                <Image source={{ uri: selected.snapshot }} style={styles.snapshot} />
              ) : (
                <View style={[styles.snapshot, styles.snapshotEmpty]}>
                  <Text style={styles.emptyText}>No snapshot on this event</Text>
                </View>
              )}
              <Text style={styles.detailLine}>
                {Math.round(selected.confidence * 100)}% fused · {selected.type}
              </Text>
              {selected.incidentId ? (
                <Text style={styles.detailLine}>Incident {selected.incidentId}</Text>
              ) : null}

              {(selected.type === 'ESCALATED' || selected.incidentId) && (
                <View style={styles.actionRow}>
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.btnCorridor]}
                    disabled={busyId === selected.id}
                    onPress={() => void openCorridor(selected)}
                  >
                    <Text style={styles.btnTextWhite}>
                      {busyId === selected.id ? 'Opening…' : 'Open Green Corridor'}
                    </Text>
                  </TouchableOpacity>
                </View>
              )}

              {selected.type === 'CANDIDATE' && (
                <View style={styles.actionRow}>
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.btnEscalate]}
                    disabled={busyId === selected.id}
                    onPress={() => void escalate(selected.id)}
                  >
                    <Text style={styles.btnTextWhite}>
                      {busyId === selected.id ? 'Working…' : 'Escalate to Incident'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.btnDismiss]}
                    disabled={busyId === selected.id}
                    onPress={() => void dismiss(selected.id)}
                  >
                    <Text style={styles.btnTextBlack}>Dismiss</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          ) : (
            <Text style={styles.emptyText}>Select an event from the feed.</Text>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  metaBar: {
    paddingHorizontal: 24,
    paddingVertical: 8,
    backgroundColor: '#1E293B',
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  metaText: {
    color: '#94A3B8',
    fontSize: 12,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  mainLayout: {
    flex: 1,
    flexDirection: 'row',
  },
  paneTitle: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginBottom: 16,
    letterSpacing: 0.5,
  },
  leftPane: {
    width: 300,
    borderRightWidth: 1,
    borderRightColor: '#334155',
    padding: 16,
  },
  middlePane: {
    flex: 1,
    padding: 16,
  },
  rightPane: {
    width: 360,
    borderLeftWidth: 1,
    borderLeftColor: '#334155',
    padding: 16,
    backgroundColor: '#1E293B',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    minHeight: 220,
  },
  tile: {
    width: '32%',
    minWidth: 220,
    flexGrow: 1,
    height: 200,
    backgroundColor: '#020617',
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#334155',
  },
  tileHot: {
    borderColor: '#EF4444',
  },
  feedWrap: {
    flex: 1,
    backgroundColor: '#000',
  },
  feedImage: {
    width: '100%',
    height: '100%',
  },
  feedMissing: {
    color: '#64748B',
    fontSize: 12,
    padding: 12,
  },
  tileCaption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: '#0F172A',
  },
  tileName: {
    color: '#E2E8F0',
    fontSize: 11,
    flex: 1,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  dotOn: { backgroundColor: '#10B981' },
  dotOff: { backgroundColor: '#64748B' },
  eventCard: {
    backgroundColor: '#1E293B',
    padding: 16,
    borderRadius: 8,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  eventCardSelected: {
    borderColor: '#3B82F6',
    backgroundColor: '#1E3A8A',
  },
  eventCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  tagCandidate: {
    color: '#92400E',
    fontSize: 10,
    fontWeight: 'bold',
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  tagEscalated: {
    color: '#991B1B',
    fontSize: 10,
    fontWeight: 'bold',
    backgroundColor: '#FEE2E2',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  eventTime: {
    color: '#94A3B8',
    fontSize: 12,
  },
  eventCamera: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  eventConfidence: {
    color: '#CBD5E1',
    fontSize: 14,
  },
  detailsContent: {
    flex: 1,
  },
  detailsTitle: {
    color: '#F8FAFC',
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  snapshot: {
    width: '100%',
    height: 200,
    borderRadius: 8,
    marginBottom: 16,
    backgroundColor: '#000',
  },
  snapshotEmpty: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  detailLine: {
    color: '#CBD5E1',
    fontSize: 13,
    marginBottom: 8,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  btnEscalate: {
    backgroundColor: '#EF4444',
  },
  btnCorridor: {
    backgroundColor: '#10B981',
  },
  btnDismiss: {
    backgroundColor: '#E2E8F0',
  },
  btnTextWhite: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 14,
  },
  btnTextBlack: {
    color: '#0F172A',
    fontWeight: 'bold',
    fontSize: 14,
  },
  emptyText: {
    color: '#64748B',
    fontSize: 13,
    lineHeight: 18,
  },
});
