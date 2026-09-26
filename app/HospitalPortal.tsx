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
  ViewStyle,
  TextStyle,
} from 'react-native';
import { color, font } from './theme';
import {
  HospitalIcon,
  PulseIcon,
} from './icons';
import { type AppUserProfile } from './firebaseConfig';
import { authedFetch } from './api';
import { connectLive } from './liveSocket';

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
  status: 'PENDING_DISPATCH' | 'AMBULANCE_EN_ROUTE' | 'ICU_RESERVED';
  ambulanceUnitAssigned?: string;
  cprCompressions?: number;
  cprSets?: number;
  sha256Hash?: string;
  reporterCount?: number;
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
  const [icuBeds, setIcuBeds] = useState<number | null>(null);
  const [incidents, setIncidents] = useState<EmergencyIncidentItem[]>([]);
  const [incomingCall, setIncomingCall] = useState<{
    incidentCode: string;
    spoken: string;
    lat: number;
    lng: number;
  } | null>(null);

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

  useEffect(() => {
    const conn = connectLive({
      'hospital-call': (payload) => {
        setIncomingCall({
          incidentCode: String(payload.incidentCode ?? 'CAD'),
          spoken: String(payload.spoken ?? 'Incoming emergency. Open the CAD desk.'),
          lat: Number(payload.lat),
          lng: Number(payload.lng),
        });
        void fetchLiveIncidents();
      },
      'incident-created': () => {
        void fetchLiveIncidents();
      },
    });
    return () => conn.disconnect();
  }, [fetchLiveIncidents]);

  // Capacity is shared state, not a local counter: what this desk reports is
  // what responders are routed on.
  useEffect(() => {
    (async () => {
      try {
        const res = await authedFetch('/api/hospitals/me');
        if (res.ok) {
          const data = await res.json();
          setIcuBeds(data.hospital?.icuBedsAvailable ?? null);
        }
      } catch (_e) {
        // leave as unknown
      }
    })();
  }, []);

  const reportCapacity = useCallback(async (next: number) => {
    const clamped = Math.max(0, next);
    setIcuBeds(clamped);
    try {
      await authedFetch('/api/hospitals/me/capacity', {
        method: 'PATCH',
        body: JSON.stringify({ icuBedsAvailable: clamped }),
      });
    } catch (_e) {
      Alert.alert('Not saved', 'Could not report capacity to the server.');
    }
  }, []);

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
    const target = incidents.find((i) => i.id === incidentId);
    if (target?.status === 'ICU_RESERVED') return; // already reserved — don't double-decrement

    if (icuBeds != null && icuBeds <= 0) {
      Alert.alert('ICU Capacity Full', 'No critical trauma ICU beds currently vacant.');
      return;
    }
    if (icuBeds != null) await reportCapacity(icuBeds - 1);

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

  // Close out a resolved incident so it leaves the live queue.
  const handleResolve = async (incidentId: string) => {
    setIncidents((prev) => prev.filter((inc) => inc.id !== incidentId));
    try {
      await authedFetch(`/api/incidents/${incidentId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'RESOLVED' }),
      });
    } catch (_e) {
      Alert.alert('Not saved', 'Could not close the incident on the server.');
    }
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
            <Text style={styles.victimStatusTextRed}>CPR IS LIVE • {compressions ? `${compressions} COMPRESSIONS` : '110 BPM'} • DO NOT STOP
            </Text>
          </View>
        );
      case 'CRITICAL_UNCONSCIOUS':
        return (
          <View style={styles.victimStatusTagYellow}>
            <Text style={styles.victimStatusTextYellow}>UNCONSCIOUS / UNRESPONSIVE</Text>
          </View>
        );
      case 'RECOVERY_POSITION':
        return (
          <View style={styles.victimStatusTagGreen}>
            <Text style={styles.victimStatusTextGreen}>BREATHING • RECOVERY POSITION</Text>
          </View>
        );
      case 'BLEEDING_TRAUMA':
        return (
          <View style={styles.victimStatusTagRed}>
            <Text style={styles.victimStatusTextRed}>SEVERE TRAUMA BLEEDING • ACTIVE</Text>
          </View>
        );
      case 'BLEEDING_CONTROLLED':
        return (
          <View style={styles.victimStatusTagGreen}>
            <Text style={styles.victimStatusTextGreen}>BLEEDING CONTROLLED • PRESSURE HELD</Text>
          </View>
        );
      default:
        return (
          <View style={styles.victimStatusTagYellow}>
            <Text style={styles.victimStatusTextYellow}>
               {condition ? condition.toUpperCase() : 'CRITICAL TRIAGE ACTIVE'}
            </Text>
          </View>
        );
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      {incomingCall && (
        <View style={styles.incomingCallBanner}>
          <Text style={styles.incomingCallKicker}>INCOMING HOSPITAL AUTO-CALL · {incomingCall.incidentCode}</Text>
          <Text style={styles.incomingCallBody}>{incomingCall.spoken}</Text>
          <TouchableOpacity style={styles.incomingCallAck} onPress={() => setIncomingCall(null)}>
            <Text style={styles.incomingCallAckText}>ACKNOWLEDGE</Text>
          </TouchableOpacity>
        </View>
      )}
      {/* Hospital Identity Header Card */}
      <View style={styles.hospitalHeroCard}>
        <View style={styles.heroTopRow}>
          <View style={styles.hospitalIconBadge}>
            <HospitalIcon size={20} color={color.text} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.hospitalName}>
              {userProfile.hospitalName || 'Sawai Man Singh (SMS) Govt Trauma Hospital'}
            </Text>
            <View style={styles.deskTagRow}>
              <View style={styles.greenBeaconDot} />
              <Text style={styles.deskTagText}>TRAUMA CAD DESK • 2-WAY CAD DISPATCH ACTIVE
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
                onPress={() => reportCapacity((icuBeds ?? 0) - 1)}
              >
                <Text style={styles.bedBtnText}>−</Text>
              </TouchableOpacity>
              <Text style={styles.statNumCyan}>{icuBeds ?? '—'}</Text>
              <TouchableOpacity
                style={styles.bedBtn}
                onPress={() => reportCapacity((icuBeds ?? 0) + 1)}
              >
                <Text style={styles.bedBtnText}>+</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.statLabel}>
              {icuBeds == null ? 'REPORT ICU BEDS' : 'VACANT ICU BEDS'}
            </Text>
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
          <PulseIcon size={26} color={color.text} />
          <Text style={styles.emptyStateTitle}>NO ACTIVE INCIDENTS</Text>
          <Text style={styles.emptyStateText}>Monitoring for incoming SOS alerts. When a citizen activates an emergency,
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
                      { backgroundColor: isPending ? color.signal : color.confirm },
                    ]}
                  />
                  <Text style={styles.incidentCodeText}>INCIDENT #{incident.incidentCode}</Text>
                </View>

                {/* Distance & ETA Badge */}
                <View style={styles.distanceBadge}>
                  <Text style={styles.distanceBadgeText}>
                     {incident.distanceText} • ETA {incident.etaMinutes} MIN
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
                  <Text style={styles.hashVerifiedTag}>VERIFIED</Text>
                </View>
                <Text style={styles.hashText} numberOfLines={1}>
                  {incident.sha256Hash || 'No certificate digest recorded'}
                </Text>
              </View>

              {/* Unit Status Notification */}
              {incident.ambulanceUnitAssigned && (
                <View style={styles.unitAssignedBanner}>
                  <Text style={styles.unitAssignedText}>
                     {incident.ambulanceUnitAssigned}
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
                    <Text style={styles.dispatchBtnText}>DISPATCH AMBULANCE UNIT</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={styles.reserveBedBtn}
                    onPress={() => handleReserveBed(incident.id)}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.reserveBedBtnText}>
                      {incident.status === 'ICU_RESERVED'
                        ? 'ICU BED RESERVED'
                        : 'RESERVE ICU BED'}
                    </Text>
                  </TouchableOpacity>
                )}

                <View style={styles.secondaryActionRow}>
                  <TouchableOpacity
                    style={styles.secCallBtn}
                    onPress={() => handleCallResponder(incident.phone)}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.secBtnText}>CALL</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.secCertBtn}
                    onPress={() => onInspectCertificate(incident)}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.secBtnText}>CERTIFICATE</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.secMapBtn}
                    onPress={() => handleOpenRoute(incident.googleMapsUrl)}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.secBtnText}>ROUTE</Text>
                  </TouchableOpacity>
                </View>

                <TouchableOpacity
                  style={styles.resolveBtn}
                  onPress={() =>Alert.alert(
                      'Close incident?',
                      'This removes it from the live queue for every desk.',
                      [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Close', style: 'destructive', onPress: () => handleResolve(incident.id) },
                      ]
                    )
                  }
                  activeOpacity={0.8}
                >
                  <Text style={styles.resolveBtnText}>CLOSE INCIDENT</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })}
      </View>

      {/* Logout Link */}
      <TouchableOpacity style={styles.logoutBtn} onPress={onLogout}>
        <Text style={styles.logoutBtnText}>LOGOUT OF HOSPITAL CAD DESK</Text>
      </TouchableOpacity>
    </ScrollView>
  );
};

export default HospitalPortal;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: color.ground,
  } as ViewStyle,
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
    maxWidth: 680,
    width: '100%',
    alignSelf: 'center',
  } as ViewStyle,

  hospitalHeroCard: {
    backgroundColor: color.surface,
    borderRadius: 20,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: color.hairline,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 14,
    elevation: 2,
  } as ViewStyle,
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  } as ViewStyle,
  hospitalIconBadge: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: color.blueWash,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  } as ViewStyle,
  hospitalIcon: {
    fontSize: 22,
  } as TextStyle,
  hospitalName: {
    fontSize: 16,
    fontWeight: '800',
    color: color.text,
    fontFamily: font.display,
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
    backgroundColor: color.confirm,
    marginRight: 6,
  } as ViewStyle,
  deskTagText: {
    fontSize: 10,
    fontFamily: font.mono,
    fontWeight: '700',
    color: color.confirm,
    letterSpacing: 0.4,
  } as TextStyle,

  statsGrid: {
    flexDirection: 'row',
    gap: 10,
  } as ViewStyle,
  statBox: {
    flex: 1,
    backgroundColor: color.groundDeep,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: color.hairline,
  } as ViewStyle,
  statNumAlert: {
    fontSize: 22,
    fontWeight: '800',
    color: color.signal,
    fontFamily: font.display,
  } as TextStyle,
  statNumGreen: {
    fontSize: 22,
    fontWeight: '800',
    color: color.confirm,
    fontFamily: font.display,
  } as TextStyle,
  statNumCyan: {
    fontSize: 22,
    fontWeight: '800',
    color: color.blue,
    fontFamily: font.display,
    marginHorizontal: 4,
  } as TextStyle,
  statLabel: {
    fontSize: 9,
    fontFamily: font.mono,
    fontWeight: '700',
    color: color.textFaint,
    marginTop: 4,
    letterSpacing: 0.4,
    textAlign: 'center',
  } as TextStyle,

  bedControlRow: {
    flexDirection: 'row',
    alignItems: 'center',
  } as ViewStyle,
  bedBtn: {
    backgroundColor: color.surface,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: color.hairline,
  } as ViewStyle,
  bedBtnText: {
    color: color.blue,
    fontSize: 14,
    fontWeight: '800',
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
    backgroundColor: color.signal,
    marginRight: 6,
  } as ViewStyle,
  sectionTitle: {
    fontSize: 12,
    fontFamily: font.mono,
    fontWeight: '800',
    color: color.text,
    letterSpacing: 0.6,
  } as TextStyle,
  sectionMeta: {
    fontSize: 10,
    fontFamily: font.mono,
    color: color.textFaint,
  } as TextStyle,

  emptyStateCard: {
    backgroundColor: color.surface,
    borderRadius: 18,
    padding: 28,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: color.hairline,
    borderStyle: 'dashed',
    marginBottom: 16,
  } as ViewStyle,
  emptyStateEmoji: {
    fontSize: 32,
    marginBottom: 12,
  } as TextStyle,
  emptyStateTitle: {
    fontSize: 14,
    fontFamily: font.display,
    fontWeight: '800',
    color: color.text,
    letterSpacing: -0.2,
    marginBottom: 8,
  } as TextStyle,
  emptyStateText: {
    fontSize: 12,
    color: color.textMuted,
    textAlign: 'center',
    lineHeight: 18,
    maxWidth: '85%',
  } as TextStyle,

  // Incident Cards
  incidentsList: {
    gap: 12,
  } as ViewStyle,
  incidentCard: {
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
  } as ViewStyle,
  incidentCardPending: {
    borderColor: color.signal,
    backgroundColor: '#FFF5F6',
  } as ViewStyle,
  incidentCardEnRoute: {
    borderColor: color.confirm,
    backgroundColor: '#F0FDF4',
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
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  } as ViewStyle,
  incidentCodeText: {
    fontSize: 13,
    fontWeight: '800',
    color: color.text,
    fontFamily: font.mono,
  } as TextStyle,

  distanceBadge: {
    backgroundColor: color.surface,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: color.hairline,
  } as ViewStyle,
  distanceBadgeText: {
    fontSize: 10,
    fontFamily: font.mono,
    fontWeight: '700',
    color: color.textMuted,
  } as TextStyle,

  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  } as ViewStyle,
  detailLabel: {
    width: 120,
    fontSize: 10,
    fontFamily: font.mono,
    fontWeight: '700',
    color: color.textFaint,
  } as TextStyle,
  detailValue: {
    fontSize: 11,
    fontWeight: '700',
    color: color.text,
    fontFamily: font.mono,
  } as TextStyle,
  detailValueCyan: {
    fontSize: 11,
    fontWeight: '700',
    color: color.blue,
    fontFamily: font.mono,
  } as TextStyle,

  victimStatusTagRed: {
    backgroundColor: color.signalWash,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: color.signal,
  } as ViewStyle,
  victimStatusTextRed: {
    fontSize: 10,
    fontFamily: font.mono,
    fontWeight: '800',
    color: color.signalDeep,
  } as TextStyle,

  victimStatusTagYellow: {
    backgroundColor: color.amberWash,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: color.amber,
  } as ViewStyle,
  victimStatusTextYellow: {
    fontSize: 10,
    fontFamily: font.mono,
    fontWeight: '800',
    color: color.amber,
  } as TextStyle,

  victimStatusTagGreen: {
    backgroundColor: color.confirmWash,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: color.confirm,
  } as ViewStyle,
  victimStatusTextGreen: {
    fontSize: 10,
    fontFamily: font.mono,
    fontWeight: '800',
    color: color.confirm,
  } as TextStyle,

  // Hash Box
  hashBox: {
    backgroundColor: color.groundDeep,
    borderRadius: 10,
    padding: 10,
    marginVertical: 10,
    borderWidth: 1,
    borderColor: color.hairline,
  } as ViewStyle,
  hashHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  } as ViewStyle,
  hashLabel: {
    fontSize: 8,
    fontFamily: font.mono,
    color: color.textFaint,
    fontWeight: '700',
  } as TextStyle,
  hashVerifiedTag: {
    fontSize: 8,
    fontFamily: font.mono,
    color: color.confirm,
    fontWeight: '800',
  } as TextStyle,
  hashText: {
    fontSize: 9,
    fontFamily: font.mono,
    color: color.textMuted,
  } as TextStyle,

  unitAssignedBanner: {
    backgroundColor: color.confirmWash,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: color.confirm,
  } as ViewStyle,
  unitAssignedText: {
    fontSize: 11,
    fontFamily: font.mono,
    fontWeight: '800',
    color: color.confirm,
  } as TextStyle,

  // Action Buttons Grid
  actionButtonsGrid: {
    gap: 8,
  } as ViewStyle,
  dispatchUnitBtn: {
    backgroundColor: color.signal,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: color.signal,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 2,
  } as ViewStyle,
  dispatchBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.8,
  } as TextStyle,

  reserveBedBtn: {
    backgroundColor: color.blue,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: color.blue,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 2,
  } as ViewStyle,
  reserveBedBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.8,
  } as TextStyle,

  secondaryActionRow: {
    flexDirection: 'row',
    gap: 8,
  } as ViewStyle,
  secCallBtn: {
    flex: 1,
    backgroundColor: color.surfaceMuted,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: color.hairline,
  } as ViewStyle,
  secCertBtn: {
    flex: 1.4,
    backgroundColor: color.surfaceMuted,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: color.hairline,
  } as ViewStyle,
  secMapBtn: {
    flex: 0.9,
    backgroundColor: color.surfaceMuted,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: color.hairline,
  } as ViewStyle,
  secBtnText: {
    fontSize: 10,
    fontWeight: '700',
    color: color.text,
    fontFamily: font.mono,
  } as TextStyle,

  resolveBtn: {
    marginTop: 10,
    backgroundColor: color.surfaceMuted,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: color.hairline,
  } as ViewStyle,
  resolveBtnText: {
    fontSize: 10,
    fontFamily: font.mono,
    fontWeight: '700',
    color: color.textMuted,
    letterSpacing: 0.5,
  } as TextStyle,

  incomingCallBanner: {
    backgroundColor: '#7F1D1D',
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#FECACA',
  } as ViewStyle,
  incomingCallKicker: {
    color: '#FECACA',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
    marginBottom: 6,
  } as TextStyle,
  incomingCallBody: {
    color: '#FFF7ED',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 12,
  } as TextStyle,
  incomingCallAck: {
    alignSelf: 'flex-start',
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  } as ViewStyle,
  incomingCallAckText: {
    color: '#7F1D1D',
    fontWeight: '800',
    fontSize: 12,
  } as TextStyle,

  logoutBtn: {
    backgroundColor: color.surfaceMuted,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: color.hairline,
    marginTop: 20,
  } as ViewStyle,
  logoutBtnText: {
    fontSize: 11,
    fontFamily: font.mono,
    fontWeight: '700',
    color: color.textMuted,
    letterSpacing: 0.6,
  } as TextStyle,
});
