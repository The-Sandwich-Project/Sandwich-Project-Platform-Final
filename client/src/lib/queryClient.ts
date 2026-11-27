import { SAME_DAY_VAN_QUERY_KEY } from '@shared/van-rules';
import { QueryClient, QueryFunction } from '@tanstack/react-query';
import { logger } from '@/lib/logger';
import { getSocketInstance } from '@/lib/socket-singleton';
import {
  isServerUnavailableBody,
  RATE_LIMITED_MESSAGE,
  SERVER_UNAVAILABLE_MESSAGE,
} from '@/lib/api-errors';

export {
  describeApiError,
  isServerUnavailableBody,
  isServerUnavailableError,
  RATE_LIMITED_MESSAGE,
  SERVER_UNAVAILABLE_MESSAGE,
} from '@/lib/api-errors';

/**
 * Custom error class that preserves server response details.
 * This allows mutation onError handlers to access the original
 * error message, status code, and any structured data from the server.
 */
export class ApiError extends Error {
  status: number;
  statusText: string;
  data: any;
  code: string;

  constructor(status: number, statusText: string, body: string, data?: any) {
    // Determine error code for retry logic
    let code = `${status}: ${body || statusText}`;
    let userMessage: string | undefined;

    if (isServerUnavailableBody(body)) {
      code = 'SERVER_UNAVAILABLE';
      userMessage = SERVER_UNAVAILABLE_MESSAGE;
    } else if (status === 429) {
      code = 'RATE_LIMITED';
      userMessage = RATE_LIMITED_MESSAGE;
    } else if (status === 401) code = 'AUTH_EXPIRED';
    else if (status === 403) code = 'PERMISSION_DENIED';
    else if (status === 404) code = 'DATA_LOADING_ERROR';
    else if (status === 502 || status === 503 || status === 504) {
      code = 'SERVER_UNAVAILABLE';
      userMessage = SERVER_UNAVAILABLE_MESSAGE;
    } else if (status >= 500) code = 'DATABASE_ERROR';
    else if (typeof navigator !== 'undefined' && !navigator.onLine) code = 'NETWORK_ERROR';

    const serverMessage =
      userMessage || data?.message || data?.error || body || statusText;
    super(serverMessage);

    this.name = 'ApiError';
    this.status = status;
    this.statusText = statusText;
    this.code = code;
    this.data = data || {};
  }
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    let text = '';
    let jsonData: any = null;

    try {
      // Try to parse as JSON first to get structured error info
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        jsonData = await res.json();
        text = jsonData?.message || jsonData?.error || JSON.stringify(jsonData);
      } else {
        text = (await res.text()) || res.statusText;
      }
    } catch (e) {
      text = res.statusText || 'Unknown error';
    }

    throw new ApiError(res.status, res.statusText, text, jsonData);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  body?: any,
  timeoutMs: number = 30000 // 30 second default timeout
): Promise<any> {
  logger.log(`🔵 [apiRequest] ${method} ${url}`);
  if (body) {
    logger.log('📦 [apiRequest] Body:', JSON.stringify(body).substring(0, 200));
  }
  
  const isFormData = body instanceof FormData;

  // Tag every request with this browser tab's Socket.IO id. The server echoes
  // it back on real-time broadcasts so the originating tab can ignore its OWN
  // echo instead of triggering a redundant full refetch (which can reset an
  // open form mid-edit). Fails safe: if the socket isn't connected yet the
  // header is simply omitted and the old refetch-on-echo behavior applies.
  const socketId = getSocketInstance()?.id;
  const headers: Record<string, string> = {};
  if (!isFormData && body) headers['Content-Type'] = 'application/json';
  if (socketId) headers['X-Socket-Id'] = socketId;

  // Create an AbortController for timeout handling
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    logger.log('🚀 [apiRequest] Sending fetch request...');
    const res = await fetch(url, {
      method,
      headers,
      body: isFormData ? body : body ? JSON.stringify(body) : undefined,
      credentials: 'include',
      signal: controller.signal,
    });

    logger.log(`✅ [apiRequest] Response received: ${res.status} ${res.statusText}`);
    
    // Clear the timeout since the request completed
    clearTimeout(timeoutId);
    
    await throwIfResNotOk(res);

    // If response has content, parse as JSON
    const contentType = res.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      try {
        const jsonData = await res.json();
        logger.log(`📥 [apiRequest] JSON response:`, jsonData);
        // Ensure we return a valid object, not null/undefined
        return jsonData ?? {};
      } catch (parseError) {
        logger.warn('Failed to parse JSON response:', parseError);
        return {};
      }
    }

    logger.log('📭 [apiRequest] No JSON content, returning empty object');
    // For empty responses (like 204), return empty object instead of null
    // This prevents "null is not an object" errors when accessing properties
    return {};
  } catch (error: any) {
    logger.error(`❌ [apiRequest] Error:`, error);
    // Clear timeout on error
    clearTimeout(timeoutId);
    
    // Handle timeout/abort errors
    if (error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeoutMs}ms`);
    }
    
    // Re-throw other errors
    throw error;
  }
}

type UnauthorizedBehavior = 'returnNull' | 'throw';
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey[0] as string, {
      credentials: 'include',
    });

    if (unauthorizedBehavior === 'returnNull' && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    
    // Check content-type to prevent parsing HTML as JSON
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      const preview = await res.text().catch(() => '');
      if (isServerUnavailableBody(preview)) {
        throw new ApiError(res.status, res.statusText, preview);
      }
      logger.warn('DATA_LOADING_ERROR: Non-JSON API response', { 
        url: res.url, 
        status: res.status, 
        contentType, 
        preview: preview?.slice(0, 200) 
      });
      throw new Error('DATA_LOADING_ERROR: Non-JSON response from API');
    }
    
    try {
      const jsonData = await res.json();
      // Ensure we return a valid object, not null/undefined
      return jsonData ?? {};
    } catch (parseError) {
      // Get a preview of the actual response to debug HTML vs JSON issues
      const preview = await res.clone().text().catch(() => '');
      logger.warn('DEBUGGING: Failed to parse JSON response', { 
        url: res.url, 
        status: res.status, 
        contentType: res.headers.get('content-type'),
        bodyPreview: preview?.slice(0, 200),
        error: parseError 
      });
      return {};
    }
  };

const EVENT_LIST_QUERY_PREFIX = '/api/event-requests/list';
const EVENT_STATUS_COUNTS_KEY = '/api/event-requests/status-counts';

/** Fields whose change affects volunteer-hub screens — invalidate hub only when touched. */
const VOLUNTEER_HUB_TOUCH_FIELDS = new Set([
  'showOnVolunteerHub',
  'status',
  'scheduledEventDate',
  'desiredEventDate',
  'eventStartTime',
  'eventEndTime',
  'eventAddress',
  'organizationName',
  'department',
  'driversNeeded',
  'speakersNeeded',
  'volunteersNeeded',
  'vanDriverNeeded',
  'vanNeededLikely',
  'assignedDriverIds',
  'assignedSpeakerIds',
  'assignedVolunteerIds',
  'assignedVanDriverId',
  'selfTransport',
  'isDhlVan',
  'estimatedSandwichCount',
]);

/** Fields whose change affects the event map — invalidate map only when touched. */
/** Saved fields that change who has the van on which day (see invalidateSameDayVanQueries). */
const SAME_DAY_VAN_TOUCH_FIELDS = new Set([
  'vanDriverNeeded',
  'vanNeededLikely',
  'vanNeededFor',
  'vanTeamOk',
  'vanTimeOverride',
  'isDhlVan',
  'selfTransport',
  'status',
  'scheduledEventDate',
  'desiredEventDate',
  'eventStartTime',
  'eventEndTime',
  'organizationName',
]);

const EVENT_MAP_TOUCH_FIELDS = new Set([
  'status',
  'scheduledEventDate',
  'desiredEventDate',
  'latitude',
  'longitude',
  'eventAddress',
  'organizationName',
]);

function isEventListQueryKey(key: unknown): key is readonly unknown[] {
  return Array.isArray(key) && key[0] === EVENT_LIST_QUERY_PREFIX;
}

function stripEventResponseMeta<T extends Record<string, unknown>>(event: T): Omit<T, '_droppedFields'> {
  const { _droppedFields: _dropped, ...rest } = event;
  return rest;
}

/**
 * Patch one event row inside every cached `/api/event-requests/list` query.
 * Returns how many list caches contained that event id.
 */
export function patchEventInListCaches(
  qc: QueryClient,
  eventId: number,
  merge: (existing: Record<string, unknown>) => Record<string, unknown>
): number {
  let cachesPatched = 0;

  qc.getQueryCache().findAll({
    predicate: (query) => isEventListQueryKey(query.queryKey),
  }).forEach((query) => {
    qc.setQueryData(query.queryKey, (old: unknown) => {
      if (!Array.isArray(old)) return old;

      let rowFound = false;
      const next = old.map((item) => {
        if (!item || typeof item !== 'object' || (item as { id?: number }).id !== eventId) {
          return item;
        }
        rowFound = true;
        return merge(item as Record<string, unknown>);
      });

      if (rowFound) cachesPatched += 1;
      return rowFound ? next : old;
    });
  });

  return cachesPatched;
}

/** Read the first cached list row for an event (any list query), if present. */
export function findEventInListCaches(
  qc: QueryClient,
  eventId: number
): Record<string, unknown> | undefined {
  for (const query of qc.getQueryCache().findAll({
    predicate: (q) => isEventListQueryKey(q.queryKey),
  })) {
    const data = query.state.data;
    if (!Array.isArray(data)) continue;
    const match = data.find(
      (item) => item && typeof item === 'object' && (item as { id?: number }).id === eventId
    );
    if (match && typeof match === 'object') return match as Record<string, unknown>;
  }
  return undefined;
}

/** Mark list + status-count queries stale and refetch only the ones that are mounted. */
export async function refreshEventRequestListAndCounts(qc: QueryClient): Promise<void> {
  const predicate = (query: { queryKey: unknown }) => {
    const key = query.queryKey;
    if (!Array.isArray(key) || typeof key[0] !== 'string') return false;
    return key[0] === EVENT_LIST_QUERY_PREFIX || key[0] === EVENT_STATUS_COUNTS_KEY;
  };

  // invalidateQueries already refetches active matches (refetchType: 'active').
  // A second refetchQueries would double-fetch the open tab and wake every
  // cached inactive tab.
  await qc.invalidateQueries({ predicate });
}

async function invalidateVolunteerHubQueries(qc: QueryClient): Promise<void> {
  await qc.invalidateQueries({
    predicate: (query) => {
      const key = query.queryKey;
      return Array.isArray(key) && typeof key[0] === 'string' && key[0].startsWith('/api/volunteer-hub');
    },
  });
}

export type EventRequestCacheUpdateOptions = {
  /** When true, row-level list patch is insufficient (event may move tabs). */
  statusChanged?: boolean;
  /** Limit downstream invalidations to fields the PATCH actually sent. */
  touchedFields?: string[];
  /** Creates/deletes/bulk imports — fall back to full invalidation. */
  forceFullInvalidate?: boolean;
};

/**
 * Surgical cache update after a successful event PATCH/PUT.
 *
 * - Same-status field saves: patch list row + single-record caches; refetch lists
 *   only if the event id was not found in any cached list query.
 * - Status changes: refresh list + status-counts only (not the full sledgehammer).
 * - Volunteer hub / event map: invalidate only when relevant fields changed.
 */
export async function applyEventRequestSaveToCache(
  qc: QueryClient,
  updatedEvent: Record<string, unknown> & { id: number },
  options: EventRequestCacheUpdateOptions = {}
): Promise<void> {
  if (options.forceFullInvalidate) {
    await invalidateEventRequestQueries(qc);
    return;
  }

  const eventData = stripEventResponseMeta(updatedEvent);
  const id = updatedEvent.id;

  qc.setQueryData(['/api/event-requests', id], eventData);

  if (options.statusChanged) {
    await refreshEventRequestListAndCounts(qc);
  } else {
    const cachesPatched = patchEventInListCaches(qc, id, (existing) => ({
      ...existing,
      ...eventData,
    }));
    // Event is not in any mounted/cached list (e.g. a `new` row just became
    // `scheduled` while only scheduled-filtered dashboard widgets are loaded).
    // Patching in place cannot insert it; refetch so the row and counts appear.
    if (cachesPatched === 0) {
      await refreshEventRequestListAndCounts(qc);
    }
  }

  const touched = options.touchedFields ?? Object.keys(eventData);
  if (touched.some((field) => VOLUNTEER_HUB_TOUCH_FIELDS.has(field))) {
    await invalidateVolunteerHubQueries(qc);
  }
  if (touched.some((field) => EVENT_MAP_TOUCH_FIELDS.has(field))) {
    await qc.invalidateQueries({ queryKey: ['/api/event-map'] });
  }
  if (touched.some((field) => SAME_DAY_VAN_TOUCH_FIELDS.has(field))) {
    await invalidateSameDayVanQueries(qc);
  }
}

/**
 * The other van events on a day (badge + edit form). Each card reads the
 * OTHER events' "team OK'd" and van flags from here, so a save to one event
 * must refresh every cached day: ticking the OK on one event clears "Van
 * pending" on the other. Covers saves from other users too, which arrive
 * through `applyEventRequestUpdateById` with every field counted as touched.
 */
export async function invalidateSameDayVanQueries(qc: QueryClient): Promise<void> {
  await qc.invalidateQueries({ queryKey: [SAME_DAY_VAN_QUERY_KEY] });
}

/**
 * Convenience wrapper after a successful PATCH/PUT: merges the server row into
 * list + single-record caches. Infers statusChanged from previousStatus when omitted.
 */
export async function applyPatchResponseToCache(
  qc: QueryClient,
  updatedEvent: Record<string, unknown> & { id: number },
  options: {
    previousStatus?: string | null;
    touchedFields?: string[];
    statusChanged?: boolean;
    forceFullInvalidate?: boolean;
  } = {}
): Promise<void> {
  const statusChanged =
    options.statusChanged ??
    (!!options.previousStatus &&
      !!updatedEvent.status &&
      options.previousStatus !== updatedEvent.status);

  await applyEventRequestSaveToCache(qc, updatedEvent, {
    statusChanged,
    touchedFields: options.touchedFields,
    forceFullInvalidate: options.forceFullInvalidate,
  });
}

/**
 * Apply a socket or cross-tab update when we only know the event id.
 * Fetches the full record once, then patches caches surgically.
 */
export async function applyEventRequestUpdateById(
  qc: QueryClient,
  eventId: number
): Promise<void> {
  const previous = findEventInListCaches(qc, eventId);
  try {
    const fresh = await apiRequest('GET', `/api/event-requests/${eventId}`);
    if (!fresh?.id) {
      await refreshEventRequestListAndCounts(qc);
      return;
    }
    const statusChanged =
      !previous ||
      (!!previous.status && !!fresh.status && previous.status !== fresh.status);
    await applyEventRequestSaveToCache(qc, fresh, { statusChanged });
  } catch {
    await refreshEventRequestListAndCounts(qc);
  }
}

/**
 * Invalidate and refetch all event request related queries.
 * Use this after any mutation that modifies event request data to ensure
 * the UI refreshes with the latest data immediately.
 *
 * Prefer `applyEventRequestSaveToCache` for single-event PATCH saves.
 * Keep this for creates, deletes, bulk imports, and status moves when
 * surgical patching is insufficient.
 *
 * This handles the query key mismatch between different query patterns:
 * - /api/event-requests (legacy)
 * - /api/event-requests/list (optimized list endpoint)
 * - /api/event-requests/status-counts (tab badge counts)
 * - /api/volunteer-hub/* (volunteer-facing event needs)
 */
export async function invalidateEventRequestQueries(qc: QueryClient) {
  const eventDataPrefixes = [
    '/api/event-requests',
    '/api/volunteer-hub',
  ];

  // Mark all cached event-derived screens stale, including inactive tabs.
  // Without this, moving from Event Management to Volunteer Hub can show
  // stale volunteer needs for up to the default staleTime window.
  await qc.invalidateQueries({
    predicate: (query) => {
      const key = query.queryKey;
      if (!Array.isArray(key) || typeof key[0] !== 'string') return false;
      return eventDataPrefixes.some((prefix) => key[0].startsWith(prefix));
    },
  });

  // Force immediate refresh for event-management screens that are already
  // mounted so saves are reflected before dialogs/tabs settle.
  await Promise.all([
    qc.refetchQueries({
      predicate: (query) => {
        const key = query.queryKey;
        if (!Array.isArray(key) || typeof key[0] !== 'string') return false;
        return eventDataPrefixes.some((prefix) => key[0].startsWith(prefix));
      },
    }),
    // Also refetch event map since it depends on event data
    qc.invalidateQueries({ queryKey: ['/api/event-map'] }),
    // And who else has the van each day (van badges, edit form)
    invalidateSameDayVanQueries(qc),
  ]);
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: 'throw' }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000, // 5 minutes - reduces aggressive refetching while allowing proper cache invalidation
      gcTime: 10 * 60 * 1000, // 10 minutes - garbage collection time (formerly cacheTime)
      retry: (failureCount, error) => {
        // Don't retry for auth, permission, or validation errors
        const noRetryErrors = [
          'AUTH_EXPIRED',
          'PERMISSION_DENIED',
          'VALIDATION_ERROR',
        ];
        // Check both ApiError.code and error.message for error codes
        const errorCode = (error as any)?.code || '';
        const errorMessage = error?.message || '';
        const errorStatus = (error as any)?.status || 0;
        const errorStr = `${errorCode} ${errorMessage}`;

        if (noRetryErrors.some((code) => errorStr.includes(code))) {
          return false;
        }

        // Retry 429 (rate limited) with longer backoff — up to 3 retries
        if (errorStatus === 429 || errorStr.includes('429') || errorStr.includes('RATE_LIMITED')) {
          return failureCount < 3;
        }

        // Retry network and database errors (initial attempt + up to 2 retries = 3 total)
        const retryableErrors = ['NETWORK_ERROR', 'DATABASE_ERROR', 'Failed to fetch', 'Request timeout'];
        if (retryableErrors.some((code) => errorStr.includes(code)) && failureCount < 2) {
          return true;
        }

        return false;
      },
      retryDelay: (attemptIndex, error) => {
        // Use longer backoff for rate limiting
        const errorStatus = (error as any)?.status || 0;
        const isRateLimited = errorStatus === 429 || ((error as any)?.code || '').includes('429');
        const base = isRateLimited ? 2000 : 1000;
        return Math.min(base * 2 ** attemptIndex, 30000);
      },
    },
    mutations: {
      retry: (failureCount, error) => {
        // Don't retry auth/permission/validation errors
        const noRetryErrors = ['AUTH_EXPIRED', 'PERMISSION_DENIED', 'VALIDATION_ERROR'];
        const errorCode = (error as any)?.code || '';
        const errorMessage = error?.message || '';
        const errorStatus = (error as any)?.status || 0;
        const errorStr = `${errorCode} ${errorMessage}`;

        if (noRetryErrors.some((code) => errorStr.includes(code))) {
          return false;
        }

        // Retry 429 (rate limited) with backoff
        if (errorStatus === 429 || errorStr.includes('429') || errorStr.includes('RATE_LIMITED')) {
          return failureCount < 2;
        }

        // Retry database, network, and timeout errors (initial attempt + up to 2 retries = 3 total)
        const retryableErrors = ['DATABASE_ERROR', 'NETWORK_ERROR', 'Failed to fetch', 'Request timeout'];
        return (
          retryableErrors.some((code) => errorStr.includes(code)) &&
          failureCount < 2
        );
      },
      retryDelay: (attemptIndex, error) => {
        const errorStatus = (error as any)?.status || 0;
        const isRateLimited = errorStatus === 429 || ((error as any)?.code || '').includes('429');
        const base = isRateLimited ? 2000 : 1000;
        return Math.min(base * 2 ** attemptIndex, 5000);
      },
    },
  },
});