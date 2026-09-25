import https from 'https';
import Hospital from '../models/Hospital';

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
  ambulanceUnit?: string;
  bedsAvailable: number | null;
  googleMapsUrl: string;
}

const EMERGENCY_HOSPITALS = [
  {
    id: 'HOSP-01',
    name: 'Sawai Man Singh (SMS) Government Trauma Hospital',
    address: 'Jawahar Lal Nehru Marg, Ashok Nagar Trauma Ward',
    phone: '108 / +91-141-2560291',
    traumaLevel: 'Level 1 Apex Critical Trauma Center',
    lat: 26.8924,
    lng: 75.8150,
  },
  {
    id: 'HOSP-02',
    name: 'Apex Super Speciality Hospital & Emergency ICU',
    address: 'Sector 8, Malviya Nagar Trauma Wing',
    phone: '+91-141-2751871',
    traumaLevel: 'Level 1 Comprehensive Trauma Care',
    lat: 26.8530,
    lng: 75.8140,
  },
  {
    id: 'HOSP-03',
    name: 'Fortis Escorts Emergency & Trauma Department',
    address: 'JLN Marg, Malviya Nagar',
    phone: '+91-141-2547000',
    traumaLevel: 'Level 2 Cardiac & Trauma Care',
    lat: 26.8480,
    lng: 75.8080,
  },
];

const REGISTRY_MAX_RADIUS_KM = 60;

export type ReporterRole = 'PRIMARY_REPORTER' | 'SECONDARY_REPORTER';

export function getDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 100) / 100;
}

async function fetchLiveOSMHospitals(userLat: number, userLng: number): Promise<HospitalInfo[] | null> {
  const query = `[out:json][timeout:5];(node["amenity"="hospital"](around:10000,${userLat},${userLng});way["amenity"="hospital"](around:10000,${userLat},${userLng}););out center 8;`;
  const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;

  return new Promise((resolve) => {
    const req = https.get(
      url,
      {
        headers: { 'User-Agent': 'SamaritanShield-EmergencyCAD/1.0' },
        timeout: 4000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => (data += chunk.toString()));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (!json.elements || json.elements.length === 0) {
              resolve(null);
              return;
            }

            const hospitals: HospitalInfo[] = [];
            for (const el of json.elements) {
              const rawName = el.tags?.name || el.tags?.['name:en'];
              if (!rawName) continue;

              const hLat = el.lat || el.center?.lat;
              const hLng = el.lon || el.center?.lon;
              if (!hLat || !hLng) continue;

              const dist = getDistanceKm(userLat, userLng, hLat, hLng);
              const eta = Math.max(3, Math.round(dist * 2.2 + 2));
              const distText = dist < 1 ? `${Math.round(dist * 1000)} m away` : `${dist.toFixed(1)} km away`;
              const street = el.tags?.['addr:street'] || el.tags?.['addr:suburb'] || el.tags?.['addr:city'] || 'Emergency Trauma Department';
              const phone = el.tags?.phone || el.tags?.['contact:phone'] || '108 / 112';

              hospitals.push({
                id: `OSM-${el.id}`,
                name: rawName,
                address: street,
                phone,
                traumaLevel: 'Listed hospital (OpenStreetMap)',
                lat: hLat,
                lng: hLng,
                distanceKm: dist,
                distanceText: distText,
                etaMinutes: eta,
                bedsAvailable: null,
                googleMapsUrl: `https://www.google.com/maps/dir/?api=1&destination=${hLat},${hLng}`,
              });
            }

            if (hospitals.length === 0) {
              resolve(null);
            } else {
              hospitals.sort((a, b) => a.distanceKm - b.distanceKm);
              resolve(hospitals);
            }
          } catch (_e) {
            resolve(null);
          }
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });

    req.on('error', () => {
      resolve(null);
    });
  });
}

async function withReportedCapacity(hospitals: HospitalInfo[]): Promise<HospitalInfo[]> {
  if (hospitals.length === 0) return hospitals;
  try {
    const records = await Hospital.find({ hospitalId: { $in: hospitals.map((h) => h.id) } }).lean();
    if (records.length === 0) return hospitals;
    const byId = new Map(records.map((r) => [r.hospitalId, r.icuBedsAvailable]));
    return hospitals.map((h) => ({
      ...h,
      bedsAvailable: byId.has(h.id) ? byId.get(h.id)! : h.bedsAvailable,
    }));
  } catch (err) {
    console.warn('Capacity lookup failed; reporting capacity as unknown:', err);
    return hospitals;
  }
}

export async function getNearestHospitals(
  userLat: number,
  userLng: number
): Promise<{ primaryHospital: HospitalInfo | null; backupHospitals: HospitalInfo[] }> {
  try {
    const liveHospitals = await fetchLiveOSMHospitals(userLat, userLng);
    if (liveHospitals && liveHospitals.length > 0) {
      console.log(
        `🏥 [Live] ${liveHospitals.length} hospitals near [${userLat}, ${userLng}] — closest: ${liveHospitals[0].name} (${liveHospitals[0].distanceText})`
      );
      const enriched = await withReportedCapacity(liveHospitals.slice(0, 4));
      return {
        primaryHospital: enriched[0],
        backupHospitals: enriched.slice(1),
      };
    }
  } catch (err) {
    console.warn('Live hospital lookup failed, trying regional registry:', err);
  }

  const sorted: HospitalInfo[] = EMERGENCY_HOSPITALS.map((h) => {
    const dist = getDistanceKm(userLat, userLng, h.lat, h.lng);
    const eta = Math.max(3, Math.round(dist * 2.2 + 2));
    const distText = dist < 1 ? `${Math.round(dist * 1000)} m away` : `${dist.toFixed(1)} km away`;
    return {
      ...h,
      distanceKm: dist,
      distanceText: distText,
      etaMinutes: eta,
      bedsAvailable: null,
      googleMapsUrl: `https://www.google.com/maps/dir/?api=1&destination=${h.lat},${h.lng}`,
    };
  }).sort((a, b) => a.distanceKm - b.distanceKm);

  const inRange = sorted.filter((h) => h.distanceKm <= REGISTRY_MAX_RADIUS_KM);

  if (inRange.length === 0) {
    console.warn(
      `⚠️  No hospital located for [${userLat}, ${userLng}] — live lookup unavailable and the caller is outside the regional registry.`
    );
    return { primaryHospital: null, backupHospitals: [] };
  }

  const enriched = await withReportedCapacity(inRange.slice(0, 3));
  return {
    primaryHospital: enriched[0],
    backupHospitals: enriched.slice(1),
  };
}
