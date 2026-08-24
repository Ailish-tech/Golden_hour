# Golden Hour — Samaritan Shield

An emergency response system for road-accident bystanders in India. A citizen
presses SOS; the backend records the incident, deduplicates it against nearby
reports, routes it to the closest hospital, and streams live triage and CPR
telemetry to a hospital dispatch desk. The responder gets voice-guided trauma
first aid and a timestamped record of the assistance they rendered.

```
app/      Expo SDK 54 / React Native 0.81 client (citizen + hospital portal)
server/   Express + TypeScript + MongoDB backend
```

## What it does

**Citizen** — presses SOS, gets routed to a hospital, and is walked through a
severe-trauma protocol by voice: secure the scene, stop massive bleeding,
check breathing, then compressions-only CPR paced by a 110 BPM metronome.

**Hospital desk** — sees incoming incidents sorted by distance with live victim
condition and compression counts, dispatches an ambulance, reserves an ICU
bed, reports its own bed capacity, and closes out resolved incidents.

**Incident record** — a PDF summarising what happened, when, and where, plus a
plain-language summary of the responder's rights under Section 134A of the
Motor Vehicles (Amendment) Act, 2019. It carries a SHA-256 digest of the
stored record, checkable at `/api/verify/:hash`.

> This record is **not a government document** and is **not digitally signed**.
> It does not confer legal status. The Section 134A protections it summarises
> apply by law whether or not anyone holds it.

## Quick start

On macOS, double-click **`run.command`** (or run `./run.command`). It checks
prerequisites, starts MongoDB, creates the `.env` files, installs
dependencies, runs typecheck and tests, boots the backend, runs the
end-to-end check, and opens the app.

```bash
./run.command           # set up, verify, launch
./run.command verify    # set up and verify only
./run.command stop      # stop the MongoDB container it started
```

**No Firebase project is needed to try it.** The script configures both halves
for local development: the app mints a local identity and the backend accepts
it under its matching opt-in. Sign in with any email and a 6+ character
password; `hospital@local.test` is seeded as a hospital desk so you can see
both sides.

That is a development stand-in, not authentication — no password is checked and
no token is verified. The server ignores the flag when `NODE_ENV=production`.
Setting the `EXPO_PUBLIC_FIREBASE_*` values and dropping
`EXPO_PUBLIC_ALLOW_INSECURE_NO_AUTH` switches both sides back to real Firebase.

## Prerequisites

- Node.js 22+
- MongoDB 6+ (local, Docker, or Atlas)
- A Firebase project with Email/Password and Google sign-in enabled
- A Firebase **service account** for the backend

## Setup

### Backend

```bash
cd server
npm ci
cp .env.example .env      # then fill it in
npm run dev
```

`.env` must provide `MONGO_URI`, `CORS_ORIGINS`, and Firebase credentials via
`FIREBASE_SERVICE_ACCOUNT` (raw JSON or a path) or
`GOOGLE_APPLICATION_CREDENTIALS`.

> **The service account and the app must belong to the same Firebase project.**
> The Admin SDK verifies an ID token's audience against its own project, so a
> key from project A cannot verify tokens minted for project B — every request
> fails with `Firebase ID token has incorrect audience`, which reads like a
> broken token rather than a configuration mismatch. The key's `project_id`
> must equal `EXPO_PUBLIC_FIREBASE_PROJECT_ID` in `app/.env`.
>
> Both sides are required from the environment and neither has a built-in
> default, so a missing or mismatched project fails loudly at startup rather
> than silently authenticating against the wrong Firebase.

Enable the sign-in methods the app uses in that same project — Firebase console
→ Authentication → Sign-in method → **Email/Password**, and **Google** if you
want the Google button to work. Auth fails with `auth/operation-not-allowed`
until they are switched on.

> **Never commit the service-account JSON.** It carries a private key granting
> full admin access to the project, and this repository is public. Keep it
> outside the tree and reference it by path. `.gitignore` covers the common
> filenames, but that is a safety net, not a licence to put one in the repo.
> If a key is ever exposed — committed, pasted, emailed — rotate it in the
> Firebase console (Project settings → Service accounts → Manage service
> account permissions → Keys) and delete the old one.

**The server refuses to start without auth credentials.** Every endpoint except
`/api/health` and `/api/verify/:hash` verifies a Firebase ID token, and an
unauthenticated emergency API would expose victim coordinates. For local work
without Firebase, set `ALLOW_INSECURE_NO_AUTH=true` — tokens are then read as
`uid:email` with no signature check, a warning banner prints on boot, and the
flag is ignored when `NODE_ENV=production`. Never point it at real data.

### App

```bash
cd app
npm ci
cp .env.example .env      # set EXPO_PUBLIC_API_URL
npm start
```

For device testing, `EXPO_PUBLIC_API_URL` must be your machine's LAN address —
a phone cannot reach the bundler host's `localhost`.

Expo Go works for everything except spoken answers. Speech recognition is a
native module Expo Go cannot provide, so the app loads it optionally: voice
answers are unavailable there and the triage screen says so, while spoken
guidance, SOS, dispatch and the CPR metronome all work normally. For voice
answers on a device, build a development client (`npx expo prebuild`, then
`npm run ios` / `npm run android`).

### Granting hospital access

Hospital access exposes live victim coordinates, so it is provisioned by an
operator rather than requested by a client. Signing up through the hospital
tab does not grant it.

```bash
cd server
npx ts-node scripts/seed-hospital-staff.ts \
  --email trauma.cad@hospital.org \
  --hospitalId HOSP-01 \
  --hospitalName "Sawai Man Singh (SMS) Government Trauma Hospital"
```

## Testing

```bash
cd server && npm test          # unit tests, no database required
cd app    && npm run typecheck
```

End-to-end, against a running server and MongoDB:

```bash
cd server
ALLOW_INSECURE_NO_AUTH=true npm run dev    # terminal 1
node test_e2e_sync.js                      # terminal 2
```

This asserts the auth boundary holds and that the digest on a responder's
record matches what the hospital sees and what `/api/verify/:hash` returns.

## API

| Method | Endpoint | Access |
|---|---|---|
| `GET` | `/api/health` | public |
| `GET` | `/api/verify/:hash` | public — confirms a digest, returns no personal data |
| `POST` | `/api/auth/sync` | authenticated |
| `POST` | `/api/sos` | authenticated — the single emergency write path |
| `GET` | `/api/incidents/:id` | reporters on that incident |
| `PATCH` | `/api/incidents/:id/triage` | reporters on that incident |
| `GET` | `/api/hospital/incidents` | hospital desks |
| `PATCH` | `/api/incidents/:id/status` | hospital desks |
| `GET` | `/api/hospitals/me` | hospital desks |
| `PATCH` | `/api/hospitals/me/capacity` | hospital desks |

Identity always comes from the verified token. No endpoint accepts a
client-supplied user id or role.

## Design notes

**One write path.** `/api/sos` deduplicates, records, hashes, routes and renders
in a single call. Splitting record-keeping from dispatch previously meant the
digest on a responder's record was stored nowhere and never matched the one the
hospital saw.

**Unknown is reported as unknown.** Bed counts appear only when a hospital desk
has reported them; map data does not carry capacity. If no hospital can be
resolved, the app says so and tells the responder to call 108 rather than
naming a plausible-looking destination.

**Spatial deduplication.** Reports within 150 m of an active incident merge into
it as secondary reporters, so five bystanders at one crash produce one dispatch
— and each still receives their own record.

## Pilot preconditions

Before running this with a real hospital:

- [ ] Review Firebase Auth and Firestore security rules on the project in use
- [ ] Confirm the Admin SDK key and the app config name the SAME Firebase project
- [ ] Confirm no service-account key has ever been committed (`git log -p -- '*adminsdk*'`)
- [ ] Provision hospital staff via the seed script; verify a citizen account
      cannot reach `/api/hospital/incidents`
- [ ] Set `CORS_ORIGINS` to the deployed origins only
- [ ] Confirm `ALLOW_INSECURE_NO_AUTH` is unset in every deployed environment
- [ ] Device-test voice triage end to end, including native speech recognition
- [ ] Have the incident record's wording reviewed by a lawyer before responders
      present it to police or hospitals
- [ ] Agree a retention policy — incidents hold victim coordinates
