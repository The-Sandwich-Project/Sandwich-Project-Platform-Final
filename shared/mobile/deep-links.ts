export type MobileRouteName =
  | 'eventDetail'
  | 'collectionDetail'
  | 'messageThread'
  | 'resourceDetail'
  | 'taskDetail'
  | 'notifications'
  | 'home';

export interface MobileRouteResolution {
  mobileRoute: MobileRouteName;
  mobileParams: Record<string, string | number | boolean | null>;
  webPath: string;
}

export interface NotificationRouteInput {
  relatedType?: string | null;
  relatedId?: number | string | null;
  actionUrl?: string | null;
  metadata?: unknown;
}

function numericId(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function readMetadataRoute(metadata: unknown): MobileRouteResolution | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const record = metadata as Record<string, unknown>;
  if (typeof record.mobileRoute !== 'string') return null;
  return {
    mobileRoute: record.mobileRoute as MobileRouteName,
    mobileParams: (record.mobileParams && typeof record.mobileParams === 'object'
      ? (record.mobileParams as Record<string, string | number | boolean | null>)
      : {}),
    webPath: typeof record.webPath === 'string' ? record.webPath : '/',
  };
}

export function resolveMobileRoute(input: NotificationRouteInput): MobileRouteResolution {
  const metadataRoute = readMetadataRoute(input.metadata);
  if (metadataRoute) return metadataRoute;

  const id = numericId(input.relatedId);
  const relatedType = (input.relatedType || '').toLowerCase();

  if (id !== null) {
    if (['event_request', 'event', 'volunteer_event'].includes(relatedType)) {
      return { mobileRoute: 'eventDetail', mobileParams: { eventId: id }, webPath: `/event-requests/${id}` };
    }
    if (['collection', 'sandwich_collection'].includes(relatedType)) {
      return { mobileRoute: 'collectionDetail', mobileParams: { collectionId: id }, webPath: `/collections/${id}` };
    }
    if (['message_thread', 'thread', 'conversation', 'project'].includes(relatedType)) {
      return { mobileRoute: 'messageThread', mobileParams: { threadId: id }, webPath: `/messages/threads/${id}` };
    }
    if (relatedType === 'resource') {
      return { mobileRoute: 'resourceDetail', mobileParams: { resourceId: id }, webPath: `/resources/${id}` };
    }
    if (relatedType === 'task') {
      return { mobileRoute: 'taskDetail', mobileParams: { taskId: id }, webPath: `/tasks/${id}` };
    }
  }

  const actionUrl = input.actionUrl || '';
  const patterns: Array<[RegExp, MobileRouteName, string]> = [
    [/\/event-requests\/(\d+)/, 'eventDetail', 'eventId'],
    [/\/events\/(\d+)/, 'eventDetail', 'eventId'],
    [/\/collections\/(\d+)/, 'collectionDetail', 'collectionId'],
    [/\/messages\/threads\/(\d+)/, 'messageThread', 'threadId'],
    [/\/inbox\/(\d+)/, 'messageThread', 'threadId'],
    [/\/resources\/(\d+)/, 'resourceDetail', 'resourceId'],
    [/\/tasks\/(\d+)/, 'taskDetail', 'taskId'],
  ];

  for (const [pattern, mobileRoute, paramName] of patterns) {
    const match = actionUrl.match(pattern);
    const matchId = numericId(match?.[1]);
    if (matchId !== null) {
      return { mobileRoute, mobileParams: { [paramName]: matchId }, webPath: actionUrl };
    }
  }

  return { mobileRoute: 'notifications', mobileParams: {}, webPath: actionUrl || '/notifications' };
}

export function withMobileRoute<T extends NotificationRouteInput>(notification: T): T & MobileRouteResolution {
  return { ...notification, ...resolveMobileRoute(notification) };
}
