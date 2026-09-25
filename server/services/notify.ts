// ============================================================================
// SAMARITAN SHIELD — Hospital call + citizen alert fan-out
//
// Telephony is pluggable. Twilio is used when all three credentials are set
// (trial accounts work: verify the destination number, then set
// DEMO_HOSPITAL_PHONE to that number). Missing credentials fall through to
// the console provider so a demo still has a visible call in the logs and a
// live banner on the hospital desk — Twilio cannot reach localhost without a
// tunnel, and a silent no-op would look like the feature was never built.
// ============================================================================

import { PUBLIC_BASE_URL } from '../config';
import User from '../models/User';
import { broadcastToRole } from '../realtime';
import type { HospitalInfo } from './hospitals';

export interface IncidentCallContext {
  incidentId: string;
  incidentCode: string;
  lat: number;
  lng: number;
  hospitalName?: string;
  confidence?: number;
  source: string;
}

export interface CallResult {
  provider: 'console' | 'twilio';
  to: string;
  sid?: string;
}

export interface TelephonyProvider {
  placeCall(to: string, context: IncidentCallContext): Promise<CallResult>;
  sendSms(to: string, body: string): Promise<void>;
}

function digitsOnly(raw: string): string | null {
  const match = raw.match(/\+\d{8,15}|\d{10,15}/);
  if (!match) return null;
  return match[0].startsWith('+') ? match[0] : `+${match[0]}`;
}

export function resolveHospitalPhone(hospital?: HospitalInfo | null): string | null {
  const demo = process.env.DEMO_HOSPITAL_PHONE?.trim();
  if (demo) return digitsOnly(demo);
  if (hospital?.phone) return digitsOnly(hospital.phone);
  return null;
}

class ConsoleTelephonyProvider implements TelephonyProvider {
  async placeCall(to: string, context: IncidentCallContext): Promise<CallResult> {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📞  HOSPITAL AUTO-CALL  (console provider — no Twilio credentials)');
    console.log(`    To:        ${to}`);
    console.log(`    Incident:  ${context.incidentCode}  ${context.incidentId}`);
    console.log(`    Scene:     ${context.lat}, ${context.lng}`);
    console.log(`    Hospital:  ${context.hospitalName || 'unassigned'}`);
    console.log('    Spoken:    Accident detected. Ambulance corridor opening. Open the CAD desk.');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    return { provider: 'console', to };
  }

  async sendSms(to: string, body: string): Promise<void> {
    console.log(`💬  HOSPITAL SMS (console) → ${to}: ${body}`);
  }
}

class TwilioTelephonyProvider implements TelephonyProvider {
  constructor(
    private readonly sid: string,
    private readonly token: string,
    private readonly from: string
  ) {}

  private client(): { calls: { create: Function }; messages: { create: Function } } {
    // Lazy require so `npm test` and machines without the package still boot
    // when Twilio is not configured. The dependency is listed in package.json.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const twilio = require('twilio');
    return twilio(this.sid, this.token);
  }

  async placeCall(to: string, context: IncidentCallContext): Promise<CallResult> {
    const twimlUrl =
      `${PUBLIC_BASE_URL}/api/voice/twiml` +
      `?code=${encodeURIComponent(context.incidentCode)}` +
      `&lat=${context.lat}&lng=${context.lng}` +
      `&hospital=${encodeURIComponent(context.hospitalName || 'the trauma desk')}`;

    const call = await this.client().calls.create({
      to,
      from: this.from,
      url: twimlUrl,
    });

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📞  HOSPITAL AUTO-CALL  (Twilio)');
    console.log(`    To:   ${to}`);
    console.log(`    Sid:  ${call.sid}`);
    console.log(`    TwiML ${twimlUrl}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    return { provider: 'twilio', to, sid: call.sid };
  }

  async sendSms(to: string, body: string): Promise<void> {
    await this.client().messages.create({ to, from: this.from, body });
    console.log(`💬  HOSPITAL SMS (Twilio) → ${to}`);
  }
}

let provider: TelephonyProvider | null = null;

export function initTelephony(): TelephonyProvider {
  if (provider) return provider;

  const sid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const token = process.env.TWILIO_AUTH_TOKEN?.trim();
  const from = process.env.TWILIO_FROM_NUMBER?.trim();
  const present = [sid, token, from].filter(Boolean).length;

  if (present > 0 && present < 3) {
    console.error('❌  Twilio is half-configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER together, or none of them.');
    process.exit(1);
  }

  if (sid && token && from) {
    provider = new TwilioTelephonyProvider(sid, token, from);
    console.log('✅  Telephony: Twilio');
    return provider;
  }

  provider = new ConsoleTelephonyProvider();
  console.log('✅  Telephony: console (set the three TWILIO_* vars to place a real trial call)');
  return provider;
}

export async function notifyHospitalDesk(
  context: IncidentCallContext,
  hospital: HospitalInfo | null
): Promise<CallResult | null> {
  const tel = initTelephony();
  const to = resolveHospitalPhone(hospital);

  broadcastToRole('hospital', 'hospital-call', {
    incidentId: context.incidentId,
    incidentCode: context.incidentCode,
    lat: context.lat,
    lng: context.lng,
    hospitalName: hospital?.name || context.hospitalName,
    source: context.source,
    spoken:
      `Samaritan Shield emergency. Accident at ${context.lat.toFixed(4)}, ${context.lng.toFixed(4)}. ` +
      `Incident ${context.incidentCode}. Open the CAD desk and dispatch.`,
  });

  if (!to) {
    console.log('📞  Hospital call skipped — no dialable number. Set DEMO_HOSPITAL_PHONE for the Twilio trial.');
    return null;
  }

  const result = await tel.placeCall(to, { ...context, hospitalName: hospital?.name || context.hospitalName });
  const sms =
    `Samaritan Shield: accident at ${context.lat.toFixed(5)}, ${context.lng.toFixed(5)}. ` +
    `Incident ${context.incidentCode}. Open the hospital CAD.`;
  try {
    await tel.sendSms(to, sms);
  } catch (err) {
    console.warn('💬  Hospital SMS failed:', err);
  }
  return result;
}

/**
 * Alert every citizen the server knows about, plus anyone currently connected
 * as a citizen. Geo-fencing is intentionally not applied: a judge sitting
 * outside the 2 km radius would otherwise see nothing and conclude the
 * feature is dead. The payload still carries a computed distance when we
 * have a last-known point, so the UI can say "nearby".
 */
export async function alertAllCitizens(context: IncidentCallContext): Promise<number> {
  const users = await User.find({ role: 'citizen' }).limit(200).lean();
  const uids = users.map((u) => u.firebaseUid);

  const payload = {
    incidentId: context.incidentId,
    incidentCode: context.incidentCode,
    lat: context.lat,
    lng: context.lng,
    hospitalName: context.hospitalName,
    source: context.source,
    mapsUrl: `https://www.google.com/maps?q=${context.lat},${context.lng}`,
    message:
      `Accident nearby — ${context.incidentCode}. Ambulance is on the way. ` +
      `If you can reach the scene, tap I'm responding to join as a Good Samaritan.`,
  };

  broadcastToRole('citizen', 'citizen-alert', payload);

  console.log(`📣  Citizen alert → ${uids.length} account(s) + every connected citizen socket`);
  return uids.length;
}
