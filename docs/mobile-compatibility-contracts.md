# Mobile Compatibility Contracts

This document is the foundation contract for mobile-web, Expo, and native clients. It keeps mobile clients on narrow, predictable endpoints while the desktop app continues to use the broader admin APIs.

## Auth/session

The platform currently supports session-cookie auth for mobile clients:

- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/auth/logout`
- `GET /api/mobile/auth/me` — mobile-shaped session check with `{ success, user, authMode }`
- `POST /api/mobile/auth/logout` — logs out and deactivates registered devices for the user

If Expo cookie persistence proves brittle, add token auth beside these routes instead of replacing the web session flow.

## Notifications and deep links

Notifications returned from `GET /api/notifications` include mobile routing metadata:

```ts
{
  mobileRoute: 'eventDetail' | 'collectionDetail' | 'messageThread' | 'resourceDetail' | 'taskDetail' | 'notifications',
  mobileParams: Record<string, string | number | boolean | null>,
  webPath: string
}
```

Supported endpoints:

- `GET /api/notifications`
- `PATCH /api/notifications/:id/read`
- `POST /api/notifications/mark-all-read`
- `GET /api/notifications/badge-count`
- `POST /api/mobile/notifications/resolve-route`

Resolver mapping:

| relatedType | Native destination |
| --- | --- |
| `event_request`, `event`, `volunteer_event` | `eventDetail` |
| `collection`, `sandwich_collection` | `collectionDetail` |
| `message_thread`, `thread`, `conversation`, `project` | `messageThread` |
| `resource` | `resourceDetail` |
| `task` | `taskDetail` |

## Device registration / push prep

Native push delivery is not wired yet, but device-token infrastructure is ready:

- `POST /api/mobile/devices/register`
- `DELETE /api/mobile/devices/:id`
- `POST /api/mobile/devices/unregister-current`

Register payload:

```json
{
  "platform": "ios",
  "deviceToken": "ExponentPushToken[...]",
  "pushProvider": "expo",
  "appVersion": "1.0.0",
  "deviceName": "Katie's iPhone"
}
```

## Collections

Use the stable mobile namespace for native clients:

- `GET /api/mobile/collections`
- `GET /api/mobile/collections/:id`
- `POST /api/mobile/collections`
- `PATCH /api/mobile/collections/:id`

These routes currently wrap the existing sandwich collection implementation so the backend behavior stays consistent while clients migrate off mixed `/api/collections` and `/api/sandwich-collections` usage.

## Events

Mobile clients should treat events as action queues and detail summaries, not as the full desktop event manager:

- `GET /api/mobile/events/today`
- `GET /api/mobile/events/needs-action`
- `GET /api/mobile/events/:id`

Event payloads are intentionally summarized for mobile cards/detail headers and include `mobileRoute: "eventDetail"` plus `mobileParams.eventId`.

## Error shape

Mobile-specific routes return a predictable JSON error shape:

```json
{
  "success": false,
  "error": {
    "code": "EVENT_NOT_FOUND",
    "message": "Event not found"
  },
  "code": "EVENT_NOT_FOUND",
  "message": "Event not found"
}
```

The top-level `code` and `message` are kept as compatibility aliases for existing client utilities.

## Native API abstraction

Mobile-web code should route platform calls through `client/src/mobile/lib/native-actions.ts`:

- `openExternalUrl`
- `copyToClipboard`
- `openMaps`
- `callPhone`
- `sendSms`
- `shareResource`
- `storeSecureValue`
- `getSecureValue`
- `removeSecureValue`

The web implementation uses browser APIs; Expo/native can replace the module with Linking, Clipboard, Share, and SecureStore-backed implementations.
