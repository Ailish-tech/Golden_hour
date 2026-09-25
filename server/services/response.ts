// ============================================================================
// SAMARITAN SHIELD — Post-incident fan-out
//
// One function so AI escalation, a citizen SOS and an ambulance dispatch all
// open the same corridor and wake the same people. Failures here are logged
// and swallowed: a Twilio timeout must not roll back the incident record.
// ============================================================================

import type { IIncident } from '../models/Incident';
import type { HospitalInfo } from './hospitals';
import { openCorridor } from './corridor';
import { alertAllCitizens, notifyHospitalDesk } from './notify';

export async function activateEmergencyResponse(opts: {
  incident: IIncident;
  hospital: HospitalInfo | null;
  zone?: string;
  source: string;
  confidence?: number;
  openGreenCorridor?: boolean;
}): Promise<void> {
  const { incident, hospital } = opts;
  const [lng, lat] = incident.location.coordinates;
  const incidentId = String(incident._id);
  const incidentCode = `CAD-${incidentId.slice(-4).toUpperCase()}`;

  const context = {
    incidentId,
    incidentCode,
    lat,
    lng,
    hospitalName: incident.assignedHospitalName || hospital?.name,
    confidence: opts.confidence,
    source: opts.source,
  };

  try {
    await notifyHospitalDesk(context, hospital);
  } catch (err) {
    console.error('❌ Hospital notify failed:', err);
  }

  try {
    await alertAllCitizens(context);
  } catch (err) {
    console.error('❌ Citizen alert failed:', err);
  }

  if (opts.openGreenCorridor === false) return;

  const dest = hospital
    ? { lat: hospital.lat, lng: hospital.lng }
    : { lat: 26.8924, lng: 75.815 }; // SMS Trauma, same fallback the router uses

  try {
    await openCorridor({
      incidentId,
      from: { lat, lng },
      to: dest,
      zone: opts.zone,
      originHospitalId: incident.assignedHospitalId || hospital?.id,
    });
  } catch (err) {
    console.error('❌ Corridor open failed:', err);
  }
}
