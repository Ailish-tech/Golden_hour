// ============================================================================
// SAMARITAN SHIELD — Geometry helpers
//
// Written here so corridor selection does not pull in a geo library. Distances
// reuse the same haversine as hospital routing.
// ============================================================================

import { getDistanceKm } from './hospitals';

export interface LatLng {
  lat: number;
  lng: number;
}

export function toLatLng(lngLat: [number, number]): LatLng {
  return { lng: lngLat[0], lat: lngLat[1] };
}

export function pointToSegmentDistanceKm(
  p: LatLng,
  a: LatLng,
  b: LatLng
): { distanceKm: number; t: number; closest: LatLng } {
  const dx = b.lng - a.lng;
  const dy = b.lat - a.lat;
  const len2 = dx * dx + dy * dy;

  let t = 0;
  if (len2 > 0) {
    t = ((p.lng - a.lng) * dx + (p.lat - a.lat) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
  }

  const closest = { lng: a.lng + t * dx, lat: a.lat + t * dy };
  return { distanceKm: getDistanceKm(p.lat, p.lng, closest.lat, closest.lng), t, closest };
}

export function projectOntoPolyline(
  p: LatLng,
  line: LatLng[]
): { distanceKm: number; alongKm: number; closest: LatLng; incomingBearing: number } {
  if (line.length === 0) {
    return { distanceKm: Number.POSITIVE_INFINITY, alongKm: 0, closest: p, incomingBearing: 0 };
  }
  if (line.length === 1) {
    return {
      distanceKm: getDistanceKm(p.lat, p.lng, line[0].lat, line[0].lng),
      alongKm: 0,
      closest: line[0],
      incomingBearing: 0,
    };
  }

  let bestDist = Number.POSITIVE_INFINITY;
  let bestAlong = 0;
  let bestClosest = line[0];
  let bestA = line[0];
  let bestB = line[1];
  let walked = 0;

  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i];
    const b = line[i + 1];
    const segLen = getDistanceKm(a.lat, a.lng, b.lat, b.lng);
    const hit = pointToSegmentDistanceKm(p, a, b);
    if (hit.distanceKm < bestDist) {
      bestDist = hit.distanceKm;
      bestAlong = walked + hit.t * segLen;
      bestClosest = hit.closest;
      bestA = a;
      bestB = b;
    }
    walked += segLen;
  }

  return {
    distanceKm: bestDist,
    alongKm: bestAlong,
    closest: bestClosest,
    incomingBearing: bearingDegrees(bestA, bestB),
  };
}

/** Compass bearing in degrees, 0 = north, clockwise. */
export function bearingDegrees(from: LatLng, to: LatLng): number {
  const φ1 = (from.lat * Math.PI) / 180;
  const φ2 = (to.lat * Math.PI) / 180;
  const Δλ = ((to.lng - from.lng) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const θ = Math.atan2(y, x);
  return ((θ * 180) / Math.PI + 360) % 360;
}

/**
 * Arm the ambulance arrives on. Travel northbound means it enters from the
 * south approach of the junction.
 */
export function incomingApproach(travelBearing: number): 'N' | 'S' | 'E' | 'W' {
  const b = ((travelBearing % 360) + 360) % 360;
  if (b >= 315 || b < 45) return 'S';
  if (b < 135) return 'W';
  if (b < 225) return 'N';
  return 'E';
}

export function polylineLengthKm(line: LatLng[]): number {
  let sum = 0;
  for (let i = 0; i < line.length - 1; i++) {
    sum += getDistanceKm(line[i].lat, line[i].lng, line[i + 1].lat, line[i + 1].lng);
  }
  return Math.round(sum * 1000) / 1000;
}
