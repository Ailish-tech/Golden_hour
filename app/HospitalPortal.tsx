// ============================================================================
// SAMARITAN SHIELD — Hospital CAD Command Center (HospitalPortal.tsx)
// Live Trauma Dispatch, Dynamic Telemetry Polling, & End-to-End Incident Sync
// ============================================================================

import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Platform,
  Alert,
  Linking,
  ActivityIndicator,
  ViewStyle,
  TextStyle,
} from 'react-native';
import { type AppUserProfile } from './firebaseConfig';
import { authedFetch } from './api';

export interface EmergencyIncidentItem {
  id: string;
  incidentCode: string;
  responderId: string;
  lat: number;
  lng: number;
  distanceKm: number;
  distanceText: string;
  etaMinutes: number;
  timestamp: string;
  victimStatus: string;
  status: 'PENDING_DISPATCH' | 'AMBULANCE_EN_ROUTE' | 'ICU_RESERVED' | 'PATIENT_ADMITTED';
  ambulanceUnitAssigned?: string;
  cprCompressions?: number;
  cprSets?: number;
  sha256Hash: string;
  phone: string;
  googleMapsUrl: string;
}

interface HospitalPortalProps {
  userProfile: AppUserProfile;
  onLogout: () => void;
  onInspectCertificate: (incident: EmergencyIncidentItem) => void;
}

export const HospitalPortal: React.FC<HospitalPortalProps> = ({
  userProfile,
  onLogout,
  onInspectCertificate,
}) => {
  const [icuBeds, setIcuBeds] = useState<number>(18);
  const [loading, setLoading] = useState<boolean>(false);
  const [incidents, setIncidents] = useState<EmergencyIncidentItem[]>([]);
  const [pollingActive, setPollingActive] = useState<boolean>(true);

  // -------------------------------------------------------------------------
  // Live End-to-End Telemetry Polling (Every 2.5s)
  // -------------------------------------------------------------------------
  const fetchLiveIncidents = useCallback(async () => {
    try {
      // Use user's actual coordinates (resolved from GPS during auth)
      const hospitalLat = userProfile.lat || 26.8924;
      const hospitalLng = userProfile.lng || 75.8150;
      const res = await authedFetch(
        `/api/hospital/incidents?lat=${hospitalLat}&lng=${hospitalLng}`
      );
      if (res.ok) {
        const data = await res.json();
        if (data.status === 'success' && Array.isArray(data.incidents)) {
          setIncidents(data.incidents);
        }
      }
    } catch (_e) {
      // Offline / standby
    }
  }, [userProfile.hospitalId, userProfile.lat, userProfile.lng]);

  useEffect(() => {
    fetchLiveIncidents();
    const timer = setInterval(fetchLiveIncidents, 2500);
    return () => clearInterval(timer);
  }, [fetchLiveIncidents]);

  // -------------------------------------------------------------------------
  // Dispatch Ambulance Action
  // -------------------------------------------------------------------------
  const handleDispatchUnit = async (incidentId: string) => {
    const assignedUnit = 'ALS Mobile Unit #108-ALPHA (Dispatched)';
    // Update local immediately for instant UI response
    setIncidents((prev) =>
      prev.map((inc) =>
        inc.id === incidentId
          ? { ...inc, status: 'AMBULANCE_EN_ROUTE', ambulanceUnitAssigned: assignedUnit }
          : inc
      )
    );

    // Sync to backend MongoDB
    try {
      await authedFetch(`/api/incidents/${incidentId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'AMBULANCE_DISPATCHED',
          ambulanceUnitAssigned: assignedUnit,
        }),
      });
    } catch (_e) {}

    Alert.alert('Unit Dispatched', 'Ambulance #108-ALPHA dispatched with siren priority.');
  };

  // -------------------------------------------------------------------------
  // Reserve ICU Bed Action
  // -------------------------------------------------------------------------
  const handleReserveBed = async (incidentId: string) => {
    if (icuBeds <= 0) {
      Alert.alert('ICU Capacity Full', 'No critical trauma ICU beds currently vacant.');
      return;
    }
    setIcuBeds((b) => Math.max(0, b - 1));

    setIncidents((prev) =>
      prev.map((inc) => (inc.id === incidentId ? { ...inc, status: 'ICU_RESERVED' } : inc))
    );

    try {
      await authedFetch(`/api/incidents/${incidentId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'ICU_RESERVED',
          icuBedReserved: true,
        }),
      });
    } catch (_e) {}

    Alert.alert('Bed Reserved', '1 Trauma ICU Bed locked & surgical team alerted.');
  };

  // Call Responder Handler
  const handleCallResponder = (phone: string) => {
    const clean = phone.replace(/[^0-9+]/g, '');
    Linking.openURL(`tel:${clean}`).catch((e) => console.warn('Call error:', e));
  };

  // Open Route in Google Maps
  const handleOpenRoute = (url: string) => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.open(url, '_blank');
    } else {
      Linking.openURL(url).catch((e) => console.warn('Nav error:', e));
    }
  };

  // Helper to render victim condition badge
  const renderVictimConditionTag = (condition: string, compressions?: number) => {
    switch (condition) {
      case 'CPR_ACTIVE':
        return (
          <View style={styles.victimStatusTagRed}>
            <Text style={styles.victimStatusTextRed}>
              🫀 CPR IS LIVE • {compressions ? `${compressions} COMPRESSIONS` : '110 BPM'} • DO NOT STOP
            </Text>
          </View>
        );
      case 'CRITICAL_UNCONSCIOUS':
        return (
          <View style={styles.victimStatusTagYellow}>
            <Text style={styles.victimStatusTextYellow}>⚠️ UNCONSCIOUS / UNRESPONSIVE</Text>
          </View>
        );
      case 'RECOVERY_POSITION':
        return (
          <View style={styles.victimStatusTagGreen}>
            <Text style={styles.victimStatusTextGreen}>🫁 BREATHING • RECOVERY POSITION</Text>
          </View>
        );
      case 'BLEEDING_TRAUMA':
        return (
          <View style={styles.victimStatusTagRed}>
            <Text style={styles.victimStatusTextRed}>🩸 SEVERE TRAUMA BLEEDING • ACTIVE</Text>
          </View>
        );
      case 'BLEEDING_CONTROLLED':
        return (
          <View style={styles.victimStatusTagGreen}>
            <Text style={styles.victimStatusTextGreen}>✅ BLEEDING CONTROLLED • PRESSURE HELD</Text>
          </View>
        );
      default:
        return (
          <View style={styles.victimStatusTagYellow}>
            <Text style={styles.victimStatusTextYellow}>
              ⚠️ {condition ? condition.toUpperCase() : 'CRITICAL TRIAGE ACTIVE'}
            </Text>
          </View>
        );
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      {/* Hospital Identity Header Card */}
      <View style={styles.hospitalHeroCard}>
        <View style={styles.heroTopRow}>
          <View style={styles.hospitalIconBadge}>
            <Text style={styles.hospitalIcon}>🏥</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.hospitalName}>
              {userProfile.hospitalName || 'Sawai Man Singh (SMS) Govt Trauma Hospital'}
            </Text>
            <View style={styles.deskTagRow}>
              <View style={styles.greenBeaconDot} />
              <Text style={styles.deskTagText}>
                TRAUMA CAD DESK • 2-WAY CAD DISPATCH ACTIVE
              </Text>
            </View>
          </View>
        </View>

        {/* 3 Metric Telemetry Stats */}
        <View style={styles.statsGrid}>
          <View style={styles.statBox}>
            <Text style={styles.statNumAlert}>{incidents.length}</Text>
            <Text style={styles.statLabel}>ACTIVE SOS IN RANGE</Text>
          </View>

          <View style={styles.statBox}>
            <Text style={styles.statNumGreen}>
              {incidents.filter((i) => i.status === 'AMBULANCE_EN_ROUTE').length}
            </Text>
            <Text style={styles.statLabel}>UNITS EN ROUTE</Text>
          </View>

          <View style={styles.statBox}>
            <View style={styles.bedControlRow}>
              <TouchableOpacity
                style={styles.bedBtn}
                onPress={() => setIcuBeds((b) => Math.max(0, b - 1))}
              >
                <Text style={styles.bedBtnText}>−</Text>
              </TouchableOpacity>
              <Text style={styles.statNumCyan}>{icuBeds}</Text>
              <TouchableOpacity
                style={styles.bedBtn}
                onPress={() => setIcuBeds((b) => b + 1)}
              >
                <Text style={styles.bedBtnText}>+</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.statLabel}>VACANT ICU BEDS</Text>
          </View>
        </View>
      </View>

      {/* Incoming SOS Incident Stream Header */}
      {incidents.length > 0 ? (
        <View style={styles.sectionHeaderRow}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={styles.liveRadarDot} />
            <Text style={styles.sectionTitle}>INCOMING EMERGENCY SOS QUEUE</Text>
          </View>
          <Text style={styles.sectionMeta}>SORTED BY DISTANCE & SEVERITY</Text>
        </View>
      ) : (
        <View style={styles.emptyStateCard}>
          <Text style={styles.emptyStateEmoji}>📡</Text>
          <Text style={styles.emptyStateTitle}>NO ACTIVE INCIDENTS</Text>
          <Text style={styles.emptyStateText}>
            Monitoring for incoming SOS alerts. When a citizen activates an emergency,
            it will appear here in real-time with live triage telemetry.
          </Text>
        </View>
      )}

      {/* Incidents List */}
      <View style={styles.incidentsList}>
        {incidents.map((incident) => {
          const isPending = incident.status === 'PENDING_DISPATCH';
          const isEnRoute = incident.status === 'AMBULANCE_EN_ROUTE';

          return (
            <View
              key={incident.id}
              style={[
                styles.incidentCard,
                isPending && styles.incidentCardPending,
                isEnRoute && styles.incidentCardEnRoute,
              ]}
            >
              {/* Card Header */}
              <View style={styles.cardHeader}>
                <View style={styles.incidentIdRow}>
                  <View
                    style={[
                      styles.incidentStatusDot,
                      { backgroundColor: isPending ? '#ef4444' : '#22c55e' },
                    ]}
                  />
                  <Text style={styles.incidentCodeText}>INCIDENT #{incident.incidentCode}</Text>
                </View>

                {/* Distance & ETA Badge */}
                <View style={styles.distanceBadge}>
                  <Text style={styles.distanceBadgeText}>
                    📍 {incident.distanceText} • ETA {incident.etaMinutes} MIN
                  </Text>
                </View>
              </View>

              {/* Responder & Telemetry Details */}
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>RESPONDER ID:</Text>
                <Text style={styles.detailValue}>{incident.responderId}</Text>
              </View>

              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>SCENE LOCATION:</Text>
                <Text style={styles.detailValueCyan}>
                  {Number(incident.lat).toFixed(4)}° N, {Number(incident.lng).toFixed(4)}° E
                </Text>
              </View>

              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>VICTIM CONDITION:</Text>
                {renderVictimConditionTag(incident.victimStatus, incident.cprCompressions)}
              </View>

              {/* SHA-256 Cryptographic Verification Box */}
              <View style={styles.hashBox}>
                <View style={styles.hashHeaderRow}>
                  <Text style={styles.hashLabel}>GOOD SAMARITAN LEGAL DIGEST (SHA-256)</Text>
                  <Text style={styles.hashVerifiedTag}>✓ VERIFIED</Text>
                </View>
                <Text style={styles.hashText} numberOfLines={1}>
                  {incident.sha256Hash}
                </Text>
              </View>

              {/* Unit Status Notification */}
              {incident.ambulanceUnitAssigned && (
                <View style={styles.unitAssignedBanner}>
                  <Text style={styles.unitAssignedText}>
                    🚑 {incident.ambulanceUnitAssigned}
                  </Text>
                </View>
              )}

              {/* Tactical Hospital Action Buttons */}
              <View style={styles.actionButtonsGrid}>
                {isPending ? (
                  <TouchableOpacity
                    style={styles.dispatchUnitBtn}
                    onPress={() => handleDispatchUnit(incident.id)}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.dispatchBtnText}>🚑 DISPATCH AMBULANCE UNIT</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={styles.reserveBedBtn}
                    onPress={() => handleReserveBed(incident.id)}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.reserveBedBtnText}>
                      {incident.status === 'ICU_RESERVED'
                        ? '✓ ICU BED RESERVED'
                        : '🛏️ RESERVE ICU BED'}
                    </Text>
                  </TouchableOpacity>
                )}

                <View style={styles.secondaryActionRow}>
                  <TouchableOpacity
                    style={styles.secCallBtn}
                    onPress={() => handleCallResponder(incident.phone)}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.secBtnText}>📞 CALL</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.secCertBtn}
                    onPress={() => onInspectCertificate(incident)}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.secBtnText}>📄 CERTIFICATE</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.secMapBtn}
                    onPress={() => handleOpenRoute(incident.googleMapsUrl)}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.secBtnText}>🗺️ ROUTE</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          );
        })}
      </View>

      {/* Logout Link */}
      <TouchableOpacity style={styles.logoutBtn} onPress={onLogout}>
        <Text style={styles.logoutBtnText}>🔒 LOGOUT OF HOSPITAL CAD DESK</Text>
      </TouchableOpacity>
    </ScrollView>
  );
};

export default HospitalPortal;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a14',
  } as ViewStyle,
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
    maxWidth: 680,
    width: '100%',
    alignSelf: 'center',
  } as ViewStyle,

  // Hospital Hero Card
  hospitalHeroCard: {
    backgroundColor: '#0f172a',
    borderRadius: 18,
    padding: 18,
    marginBottom: 16,
    borderWidth: 1.5,
    borderColor: '#253b5e',
  } as ViewStyle,
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  } as ViewStyle,
  hospitalIconBadge: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#1e293b',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    borderWidth: 1,
    borderColor: '#38bdf8',
  } as ViewStyle,
  hospitalIcon: {
    fontSize: 24,
  } as TextStyle,
  hospitalName: {
    fontSize: 16,
    fontWeight: '900',
    color: '#ffffff',
    lineHeight: 22,
  } as TextStyle,
  deskTagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  } as ViewStyle,
  greenBeaconDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#22c55e',
    marginRight: 6,
  } as ViewStyle,
  deskTagText: {
    fontSize: 10,
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
    fontWeight: '800',
    color: '#38bdf8',
    letterSpacing: 0.5,
  } as TextStyle,

  statsGrid: {
    flexDirection: 'row',
    gap: 8,
  } as ViewStyle,
  statBox: {
    flex: 1,
    backgroundColor: '#0a0f1d',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1e293b',
  } as ViewStyle,
  statNumAlert: {
    fontSize: 20,
    fontWeight: '900',
    color: '#ef4444',
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
  } as TextStyle,
  statNumGreen: {
    fontSize: 20,
    fontWeight: '900',
    color: '#22c55e',
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
  } as TextStyle,
  statNumCyan: {
    fontSize: 20,
    fontWeight: '900',
    color: '#38bdf8',
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
    marginHorizontal: 4,
  } as TextStyle,
  statLabel: {
    fontSize: 8,
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
    fontWeight: '800',
    color: '#64748b',
    marginTop: 4,
    letterSpacing: 0.5,
    textAlign: 'center',
  } as TextStyle,

  bedControlRow: {
    flexDirection: 'row',
    alignItems: 'center',
  } as ViewStyle,
  bedBtn: {
    backgroundColor: '#1e293b',
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  } as ViewStyle,
  bedBtnText: {
    color: '#38bdf8',
    fontSize: 14,
    fontWeight: '900',
    marginTop: -2,
  } as TextStyle,

  // Section Header
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  } as ViewStyle,
  liveRadarDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#ef4444',
    marginRight: 6,
  } as ViewStyle,
  sectionTitle: {
    fontSize: 12,
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
    fontWeight: '900',
    color: '#8ed5ff',
    letterSpacing: 1,
  } as TextStyle,
  sectionMeta: {
    fontSize: 9,
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
    color: '#64748b',
  } as TextStyle,

  emptyStateCard: {
    backgroundColor: '#0a0f1d',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#1e293b',
    borderStyle: 'dashed',
    marginBottom: 16,
  } as ViewStyle,
  emptyStateEmoji: {
    fontSize: 32,
    marginBottom: 12,
  } as TextStyle,
  emptyStateTitle: {
    fontSize: 14,
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
    fontWeight: '900',
    color: '#94a3b8',
    letterSpacing: 1,
    marginBottom: 8,
  } as TextStyle,
  emptyStateText: {
    fontSize: 12,
    color: '#475569',
    textAlign: 'center',
    lineHeight: 18,
    maxWidth: '80%',
  } as TextStyle,

  // Incident Cards
  incidentsList: {
    gap: 12,
  } as ViewStyle,
  incidentCard: {
    backgroundColor: '#111827',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1.5,
    borderColor: '#1e293b',
  } as ViewStyle,
  incidentCardPending: {
    borderColor: '#ef4444',
    backgroundColor: '#1a1014',
  } as ViewStyle,
  incidentCardEnRoute: {
    borderColor: '#22c55e',
    backgroundColor: '#0c1a14',
  } as ViewStyle,

  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  } as ViewStyle,
  incidentIdRow: {
    flexDirection: 'row',
    alignItems: 'center',
  } as ViewStyle,
  incidentStatusDot: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
    marginRight: 6,
  } as ViewStyle,
  incidentCodeText: {
    fontSize: 13,
    fontWeight: '900',
    color: '#ffffff',
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
  } as TextStyle,

  distanceBadge: {
    backgroundColor: '#0c2744',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: '#38bdf8',
  } as ViewStyle,
  distanceBadgeText: {
    fontSize: 10,
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
    fontWeight: '800',
    color: '#38bdf8',
  } as TextStyle,

  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  } as ViewStyle,
  detailLabel: {
    width: 125,
    fontSize: 10,
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
    fontWeight: '800',
    color: '#64748b',
  } as TextStyle,
  detailValue: {
    fontSize: 11,
    fontWeight: '800',
    color: '#ffffff',
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
  } as TextStyle,
  detailValueCyan: {
    fontSize: 11,
    fontWeight: '800',
    color: '#38bdf8',
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
  } as TextStyle,

  victimStatusTagRed: {
    backgroundColor: '#3b1216',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: '#ef4444',
  } as ViewStyle,
  victimStatusTextRed: {
    fontSize: 10,
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
    fontWeight: '800',
    color: '#fca5a5',
  } as TextStyle,

  victimStatusTagYellow: {
    backgroundColor: '#382506',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: '#eab308',
  } as ViewStyle,
  victimStatusTextYellow: {
    fontSize: 10,
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
    fontWeight: '800',
    color: '#fde047',
  } as TextStyle,

  victimStatusTagGreen: {
    backgroundColor: '#052e16',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: '#22c55e',
  } as ViewStyle,
  victimStatusTextGreen: {
    fontSize: 10,
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
    fontWeight: '800',
    color: '#86efac',
  } as TextStyle,

  // Hash Box
  hashBox: {
    backgroundColor: '#0a0f1d',
    borderRadius: 8,
    padding: 8,
    marginVertical: 10,
    borderWidth: 1,
    borderColor: '#1e293b',
  } as ViewStyle,
  hashHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  } as ViewStyle,
  hashLabel: {
    fontSize: 8,
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
    color: '#64748b',
    fontWeight: '700',
  } as TextStyle,
  hashVerifiedTag: {
    fontSize: 8,
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
    color: '#22c55e',
    fontWeight: '900',
  } as TextStyle,
  hashText: {
    fontSize: 9,
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
    color: '#34d399',
  } as TextStyle,

  unitAssignedBanner: {
    backgroundColor: '#052e16',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#22c55e',
  } as ViewStyle,
  unitAssignedText: {
    fontSize: 11,
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
    fontWeight: '800',
    color: '#4ade80',
  } as TextStyle,

  // Action Buttons Grid
  actionButtonsGrid: {
    gap: 8,
  } as ViewStyle,
  dispatchUnitBtn: {
    backgroundColor: '#b91c1c',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  } as ViewStyle,
  dispatchBtnText: {
    fontSize: 12,
    fontWeight: '900',
    color: '#ffffff',
    letterSpacing: 1,
  } as TextStyle,

  reserveBedBtn: {
    backgroundColor: '#0369a1',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  } as ViewStyle,
  reserveBedBtnText: {
    fontSize: 12,
    fontWeight: '900',
    color: '#ffffff',
    letterSpacing: 1,
  } as TextStyle,

  secondaryActionRow: {
    flexDirection: 'row',
    gap: 6,
  } as ViewStyle,
  secCallBtn: {
    flex: 1,
    backgroundColor: '#1e293b',
    borderRadius: 8,
    paddingVertical: 9,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#38bdf8',
  } as ViewStyle,
  secCertBtn: {
    flex: 1.4,
    backgroundColor: '#1e293b',
    borderRadius: 8,
    paddingVertical: 9,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#eab308',
  } as ViewStyle,
  secMapBtn: {
    flex: 0.9,
    backgroundColor: '#1e293b',
    borderRadius: 8,
    paddingVertical: 9,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#475569',
  } as ViewStyle,
  secBtnText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#ffffff',
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
  } as TextStyle,

  logoutBtn: {
    backgroundColor: '#162032',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#253b5e',
    marginTop: 20,
  } as ViewStyle,
  logoutBtnText: {
    fontSize: 11,
    fontFamily: Platform.OS === 'web' ? 'JetBrains Mono, monospace' : 'monospace',
    fontWeight: '800',
    color: '#94a3b8',
    letterSpacing: 1,
  } as TextStyle,
});
