// ============================================================================
// SAMARITAN SHIELD — Authenticated API Client
//
// Every backend call carries a Firebase ID token. The server derives identity
// from that token, so nothing here needs to send a user id — and nothing here
// is able to claim one.
// ============================================================================

import { getAuth } from 'firebase/auth';
import { API_BASE, assertApiConfigured } from './config';

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function currentIdToken(): Promise<string> {
  const user = getAuth().currentUser;
  if (!user) {
    throw new ApiError(401, 'Not signed in.');
  }
  return user.getIdToken();
}

/**
 * fetch() with an Authorization header attached.
 * `path` is a server-relative path such as `/api/sos`.
 */
export async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  assertApiConfigured();
  const token = await currentIdToken();

  const headers = new Headers(init.headers as HeadersInit | undefined);
  headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  return fetch(`${API_BASE}${path}`, { ...init, headers });
}

/** authedFetch + JSON parsing, throwing ApiError on a non-2xx response. */
export async function authedJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await authedFetch(path, init);
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.message) message = body.message;
    } catch (_e) {
      // non-JSON error body — keep the status-based message
    }
    throw new ApiError(res.status, message);
  }
  return res.json() as Promise<T>;
}
