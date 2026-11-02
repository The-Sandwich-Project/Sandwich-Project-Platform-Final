/**
 * Server-side Google Maps roadmap tiles.
 *
 * GOOGLE_MAPS_API_KEY stays on the server. The browser asks this app for
 * tiles and attribution; it never receives the key. That matters because the
 * same key is also used for Directions, and a browser-exposed server key can
 * be copied and billed against the project.
 *
 * Requires the Map Tiles API on the Google Cloud project that owns the key:
 * https://console.cloud.google.com/apis/library/tile.googleapis.com
 */

import { logger } from '../utils/production-safe-logger';

const SESSION_URL = 'https://tile.googleapis.com/v1/createSession';
const TILE_URL = 'https://tile.googleapis.com/v1/2dtiles';
const VIEWPORT_URL = 'https://tile.googleapis.com/tile/v1/viewport';

const REQUEST_TIMEOUT_MS = 8000;
const SESSION_REFRESH_BUFFER_MS = 5 * 60 * 1000;
const FAILURE_COOLDOWN_MS = 60 * 1000;
const MAX_CACHED_TILES = 400;

/** Atlanta metro, used for the first copyright string before the user pans. */
const DEFAULT_VIEWPORT = {
  north: 34.15,
  south: 33.45,
  east: -84.05,
  west: -84.65,
  zoom: 10,
};

export type MapTileConfig =
  | { provider: 'google'; attribution: string }
  | { provider: 'carto'; reason: string };

export type Viewport = {
  north: number;
  south: number;
  east: number;
  west: number;
  zoom: number;
};

export type MapTilePayload = {
  body: Buffer;
  contentType: string;
  cacheControl: string;
  etag?: string;
};

type Session = {
  token: string;
  expiryMs: number;
  attribution: string;
};

type CachedTile = MapTilePayload & { expiresAt: number };

class MapTilesError extends Error {
  constructor(
    message: string,
    readonly safeReason: string
  ) {
    super(message);
    this.name = 'MapTilesError';
  }
}

let session: Session | null = null;
let sessionPromise: Promise<Session> | null = null;
let lastFailure: { reason: string; at: number } | null = null;
const tileCache = new Map<string, CachedTile>();
const tileInflight = new Map<string, Promise<MapTilePayload>>();
const copyrightCache = new Map<string, { copyright: string; expiresAt: number }>();
let viewportFailedAt = 0;

function apiKey(): string | undefined {
  const key = process.env.GOOGLE_MAPS_API_KEY?.trim();
  return key || undefined;
}

export function redactMapSecrets(text: string): string {
  const key = apiKey();
  let redacted = text.replace(/key=[^&\s"']+/gi, 'key=[redacted]');
  if (key) redacted = redacted.split(key).join('[redacted]');
  if (session?.token) redacted = redacted.split(session.token).join('[session]');
  return redacted;
}

export function isValidTileCoord(z: number, x: number, y: number): boolean {
  if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y)) return false;
  if (z < 0 || z > 22) return false;
  const limit = 2 ** z;
  return x >= 0 && y >= 0 && x < limit && y < limit;
}

export function isValidViewport(view: Viewport): boolean {
  const { north, south, east, west, zoom } = view;
  if (![north, south, east, west, zoom].every((n) => Number.isFinite(n))) return false;
  if (north <= south) return false;
  if (north > 90 || south < -90 || east > 180 || west < -180) return false;
  if (zoom < 0 || zoom > 22) return false;
  return true;
}

function googleErrorText(body: string): { reason: string; message: string } {
  try {
    const parsed = JSON.parse(body);
    const error = parsed?.error ?? parsed;
    const details = Array.isArray(error?.details) ? error.details : [];
    const reason = details.find((detail: { reason?: string }) => typeof detail?.reason === 'string')?.reason ?? '';
    const message = typeof error?.message === 'string' ? error.message : body;
    return { reason, message };
  } catch {
    return { reason: '', message: body };
  }
}

export function safeReasonFromGoogle(status: number, body: string): string {
  const { reason, message } = googleErrorText(body);
  const lower = `${reason} ${message}`.toLowerCase();

  if (
    reason === 'API_KEY_HTTP_REFERRER_BLOCKED' ||
    lower.includes('referer') ||
    lower.includes('referrer')
  ) {
    return 'This Google key only allows specific websites, so the server cannot request map tiles with it. In Credentials, change that key’s application restrictions, or use a separate server key.';
  }
  if (reason === 'API_KEY_IP_ADDRESS_BLOCKED' || lower.includes('ip address')) {
    return 'This Google key blocks the server IP. In Credentials, allow the host that runs the app.';
  }
  if (
    reason === 'API_KEY_SERVICE_BLOCKED' ||
    lower.includes('are blocked') ||
    lower.includes('api restrictions') ||
    lower.includes('not authorized to use this service')
  ) {
    return 'Map Tiles API is on for the project, but this key is not allowed to call it. In Credentials, open the GOOGLE_MAPS_API_KEY key, choose API restrictions, and add Map Tiles API.';
  }
  if (lower.includes('billing')) {
    return 'Enable billing on the Google Cloud project that owns GOOGLE_MAPS_API_KEY.';
  }
  if (
    reason === 'SERVICE_DISABLED' ||
    lower.includes('has not been used') ||
    lower.includes('is disabled')
  ) {
    return 'Enable the Map Tiles API for the Google Cloud project that owns GOOGLE_MAPS_API_KEY.';
  }
  if (lower.includes('api key not valid') || lower.includes('invalid api key') || lower.includes('api key expired')) {
    return 'GOOGLE_MAPS_API_KEY was rejected by Google.';
  }
  if (status === 429 || lower.includes('quota') || lower.includes('rate limit')) {
    return 'Google Maps tile quota was exceeded. Try again later.';
  }
  // Redact before truncating, so a key or token cut by the length limit
  // can't slip through as an unmatched fragment.
  const detail = redactMapSecrets(reason || message || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
  return `Google Maps tiles are temporarily unavailable (Google returned HTTP ${status}${
    detail ? `: ${detail}` : ''
  }).`;
}

function parseExpiry(expiry: unknown): number {
  const value = Number(expiry);
  if (!Number.isFinite(value) || value <= 0) {
    return Date.now() + 60 * 60 * 1000;
  }
  return value > 1e12 ? value : value * 1000;
}

function sessionUsable(current: Session | null): current is Session {
  return !!current && current.expiryMs - Date.now() > SESSION_REFRESH_BUFFER_MS;
}

async function googleFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, {
    ...init,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

async function createSession(key: string): Promise<Session> {
  const response = await googleFetch(`${SESSION_URL}?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mapType: 'roadmap',
      language: 'en-US',
      region: 'US',
    }),
  });

  const body = await response.text();
  if (!response.ok) {
    throw new MapTilesError(
      redactMapSecrets(`Map Tiles createSession failed (${response.status}): ${body}`),
      safeReasonFromGoogle(response.status, body)
    );
  }

  let parsed: { session?: string; expiry?: string };
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new MapTilesError(
      'Map Tiles createSession returned a non-JSON body',
      'Google Maps tiles are temporarily unavailable.'
    );
  }

  if (!parsed.session) {
    throw new MapTilesError(
      'Map Tiles createSession did not return a session',
      'Google Maps tiles are temporarily unavailable.'
    );
  }

  const created: Session = {
    token: parsed.session,
    expiryMs: parseExpiry(parsed.expiry),
    attribution: 'Map data © Google Maps',
  };

  try {
    created.attribution = await requestCopyright(key, created.token, DEFAULT_VIEWPORT);
  } catch (error) {
    logger.warn(
      `Map tile session started, but the initial copyright lookup failed: ${
        error instanceof Error ? redactMapSecrets(error.message) : 'unknown error'
      }`
    );
  }

  return created;
}

async function getSession(): Promise<Session> {
  if (sessionUsable(session)) return session;
  if (!sessionPromise) {
    const key = apiKey();
    if (!key) {
      throw new MapTilesError(
        'GOOGLE_MAPS_API_KEY is not set',
        'GOOGLE_MAPS_API_KEY is not set on the server.'
      );
    }
    sessionPromise = createSession(key)
      .then((created) => {
        session = created;
        lastFailure = null;
        return created;
      })
      .finally(() => {
        sessionPromise = null;
      });
  }
  return sessionPromise;
}

function rememberFailure(reason: string) {
  lastFailure = { reason, at: Date.now() };
  session = null;
}

/** Plain-language reason for a failure that never got an HTTP response. */
function reasonForThrown(error: unknown): string {
  if (error instanceof MapTilesError) return error.safeReason;
  const name = error instanceof Error ? error.name : '';
  if (name === 'TimeoutError' || name === 'AbortError') {
    return `Google Maps tiles are temporarily unavailable (Google did not respond within ${
      REQUEST_TIMEOUT_MS / 1000
    }s).`;
  }
  const cause = error instanceof Error ? (error as Error & { cause?: { code?: string } }).cause : undefined;
  const code = cause?.code ? ` ${cause.code}` : '';
  return `Google Maps tiles are temporarily unavailable (the server could not reach Google:${code || ' network error'}).`;
}

export async function getMapConfig(): Promise<MapTileConfig> {
  if (!apiKey()) {
    return {
      provider: 'carto',
      reason: 'GOOGLE_MAPS_API_KEY is not set on the server.',
    };
  }

  if (lastFailure && Date.now() - lastFailure.at < FAILURE_COOLDOWN_MS) {
    return { provider: 'carto', reason: lastFailure.reason };
  }

  try {
    const current = await getSession();
    return { provider: 'google', attribution: current.attribution };
  } catch (error) {
    const reason = reasonForThrown(error);
    rememberFailure(reason);
    logger.error(
      `Google map tiles unavailable: ${
        error instanceof Error ? redactMapSecrets(error.message) : reason
      }`
    );
    return { provider: 'carto', reason };
  }
}

async function requestCopyright(key: string, token: string, view: Viewport): Promise<string> {
  const params = new URLSearchParams({
    session: token,
    key,
    zoom: String(Math.round(view.zoom)),
    north: String(view.north),
    south: String(view.south),
    east: String(view.east),
    west: String(view.west),
  });

  const response = await googleFetch(`${VIEWPORT_URL}?${params}`);
  const body = await response.text();
  if (!response.ok) {
    throw new MapTilesError(
      redactMapSecrets(`Map Tiles viewport failed (${response.status}): ${body}`),
      safeReasonFromGoogle(response.status, body)
    );
  }

  let parsed: { copyright?: string };
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new MapTilesError(
      'Map Tiles viewport returned a non-JSON body',
      'Google Maps tiles are temporarily unavailable.'
    );
  }

  const copyright = parsed.copyright?.trim();
  if (!copyright) return 'Map data © Google Maps';
  return copyright;
}

function copyrightCacheKey(view: Viewport): string {
  return [
    Math.round(view.zoom),
    view.north.toFixed(2),
    view.south.toFixed(2),
    view.east.toFixed(2),
    view.west.toFixed(2),
  ].join(':');
}

export async function getViewportCopyright(view: Viewport): Promise<string> {
  const cacheKey = copyrightCacheKey(view);
  const cached = copyrightCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.copyright;

  const key = apiKey();
  if (!key) {
    throw new MapTilesError(
      'GOOGLE_MAPS_API_KEY is not set',
      'GOOGLE_MAPS_API_KEY is not set on the server.'
    );
  }

  if (viewportFailedAt && Date.now() - viewportFailedAt < FAILURE_COOLDOWN_MS) {
    return (await getSession()).attribution;
  }

  try {
    const current = await getSession();
    const copyright = await requestCopyright(key, current.token, view);
    copyrightCache.set(cacheKey, { copyright, expiresAt: Date.now() + 60 * 60 * 1000 });
    while (copyrightCache.size > 200) {
      const oldest = copyrightCache.keys().next().value;
      if (oldest === undefined) break;
      copyrightCache.delete(oldest);
    }
    return copyright;
  } catch (error) {
    viewportFailedAt = Date.now();
    logger.error(
      `Map copyright lookup failed: ${
        error instanceof Error ? redactMapSecrets(error.message) : 'unknown error'
      }`
    );
    if (sessionUsable(session)) return session.attribution;
    throw error;
  }
}

function sharedCacheTtlMs(cacheControl: string | null): number | null {
  if (!cacheControl) return null;
  const lower = cacheControl.toLowerCase();
  if (lower.includes('no-store') || lower.includes('private') || lower.includes('no-cache')) {
    return null;
  }
  const match = lower.match(/max-age=(\d+)/);
  if (!match) return null;
  const seconds = Number(match[1]);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return seconds * 1000;
}

function readCachedTile(cacheKey: string): CachedTile | null {
  const cached = tileCache.get(cacheKey);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    tileCache.delete(cacheKey);
    return null;
  }
  tileCache.delete(cacheKey);
  tileCache.set(cacheKey, cached);
  return cached;
}

function storeTile(cacheKey: string, tile: MapTilePayload, ttlMs: number) {
  tileCache.set(cacheKey, { ...tile, expiresAt: Date.now() + ttlMs });
  while (tileCache.size > MAX_CACHED_TILES) {
    const oldest = tileCache.keys().next().value;
    if (oldest === undefined) break;
    tileCache.delete(oldest);
  }
}

function sessionExpired(status: number, body: string): boolean {
  const lower = body.toLowerCase();
  return (
    status === 400 ||
    status === 401 ||
    (status === 403 && (lower.includes('session') || lower.includes('expired')))
  );
}

async function downloadTile(z: number, x: number, y: number, allowRetry: boolean): Promise<MapTilePayload> {
  const key = apiKey();
  if (!key) {
    throw new MapTilesError(
      'GOOGLE_MAPS_API_KEY is not set',
      'GOOGLE_MAPS_API_KEY is not set on the server.'
    );
  }

  const current = await getSession();
  const url = `${TILE_URL}/${z}/${x}/${y}?session=${encodeURIComponent(current.token)}&key=${encodeURIComponent(key)}`;
  const response = await googleFetch(url);

  if (!response.ok) {
    const body = await response.text();
    if (allowRetry && sessionExpired(response.status, body)) {
      session = null;
      return downloadTile(z, x, y, false);
    }
    const error = new MapTilesError(
      redactMapSecrets(`Map tile ${z}/${x}/${y} failed (${response.status}): ${body}`),
      safeReasonFromGoogle(response.status, body)
    );
    if (response.status === 403) rememberFailure(error.safeReason);
    throw error;
  }

  const contentType = response.headers.get('content-type') || 'image/png';
  if (!contentType.startsWith('image/')) {
    const body = await response.text();
    throw new MapTilesError(
      redactMapSecrets(`Map tile ${z}/${x}/${y} was not an image: ${body.slice(0, 200)}`),
      'Google Maps tiles are temporarily unavailable.'
    );
  }

  const cacheControl = response.headers.get('cache-control') || 'private, max-age=3600';
  const etag = response.headers.get('etag') || undefined;
  const body = Buffer.from(await response.arrayBuffer());
  return { body, contentType, cacheControl, etag };
}

export async function fetchMapTile(z: number, x: number, y: number): Promise<MapTilePayload> {
  const cacheKey = `${z}/${x}/${y}`;
  const cached = readCachedTile(cacheKey);
  if (cached) {
    return cached;
  }

  const existing = tileInflight.get(cacheKey);
  if (existing) return existing;

  const request = downloadTile(z, x, y, true)
    .then((tile) => {
      const ttlMs = sharedCacheTtlMs(tile.cacheControl);
      if (ttlMs) storeTile(cacheKey, tile, ttlMs);
      return tile;
    })
    .finally(() => {
      tileInflight.delete(cacheKey);
    });

  tileInflight.set(cacheKey, request);
  return request;
}
