# Smart Notification Delivery System

This directory contains the smart notification delivery system that handles multi-channel notification delivery with ML-powered relevance scoring, optimal timing, and A/B testing.

## Overview

The notification system includes **actual integrations** for:

- **Email**: Twilio Email (`server/services/email`) ✅ Implemented
- **SMS**: Twilio integration ✅ Implemented
- **In-App**: WebSocket delivery ✅ Implemented

## Configuration

### 1. Email Notifications (Twilio Email)

**Status**: Fully Implemented

**Setup Steps**:

1. In the Twilio Console, verify your sending domain (Email -> Domains)
2. Create a restricted API key with Comms -> Emails: Read + Create
3. Add to your `.env` file (email only; SMS uses its own Twilio credentials):
   ```bash
   TWILIO_EMAIL_API_KEY=your_twilio_email_api_key_sid
   TWILIO_EMAIL_API_SECRET=your_twilio_email_api_key_secret
   EMAIL_FROM_ADDRESS=katie@thesandwichproject.org
   NOTIFICATION_FROM_EMAIL=noreply@thesandwichproject.org
   ```

**Features**:
- Professional HTML email templates
- Personalized greetings
- Priority-based styling
- Action buttons with URLs
- Automatic fallback to plain text

**Testing**:
```typescript
import { smartDeliveryService } from './services/notifications/smart-delivery';

await smartDeliveryService.sendNotification(
  'user-id',
  'Test Email',
  'This is a test email notification',
  'system_update',
  { forceChannel: 'email' }
);
```

### 2. SMS Notifications (Twilio)

**Status**: Fully Implemented

**Setup Steps**:

1. Sign up for a Twilio account at https://www.twilio.com
2. Get your Account SID and Auth Token
3. Purchase or configure a Twilio phone number
4. Add to your `.env` file:
   ```bash
   SMS_PROVIDER=twilio
   TWILIO_ACCOUNT_SID=your_twilio_account_sid_here
   TWILIO_AUTH_TOKEN=your_twilio_auth_token_here
   TWILIO_PHONE_NUMBER=+1234567890
   ```

**Features**:
- Automatic phone number formatting (E.164)
- 160-character message optimization
- Multiple SMS provider support (Twilio, Phone Gateway)
- Comprehensive error handling and logging
- User phone number validation

**Testing**:
```typescript
import { smartDeliveryService } from './services/notifications/smart-delivery';

await smartDeliveryService.sendNotification(
  'user-id',
  'Test SMS',
  'This is a test SMS notification',
  'reminder',
  { forceChannel: 'sms' }
);
```

### 3. In-App Notifications (WebSocket)

**Status**: Fully Implemented

**How it works**:
- Uses Socket.IO for real-time delivery
- Automatically sends to connected users
- No additional configuration needed

## Usage

### Basic Notification Sending

```typescript
import { smartDeliveryService } from './services/notifications/smart-delivery';

// Send with smart channel selection (ML-powered)
const result = await smartDeliveryService.sendNotification(
  userId,
  'Notification Title',
  'Notification message body',
  'notification_type'
);

// Force specific channel
await smartDeliveryService.sendNotification(
  userId,
  'Email Notification',
  'This will be sent via email',
  'system_update',
  { forceChannel: 'email' }
);

// Set priority
await smartDeliveryService.sendNotification(
  userId,
  'Urgent Alert',
  'This is urgent',
  'alert',
  { priority: 'urgent' }
);
```

### Broadcast Notifications

```typescript
// Send to multiple users with smart delivery
const results = await smartDeliveryService.broadcastNotification(
  ['user-id-1', 'user-id-2', 'user-id-3'],
  'Team Update',
  'Important team announcement',
  'announcement'
);
```

### Track User Interactions

```typescript
// Track when users interact with notifications
await smartDeliveryService.trackInteraction(
  notificationId,
  userId,
  'clicked',
  { clickedAt: new Date() }
);
```

## Architecture

### File Structure

```
server/services/notifications/
├── README.md                    # This file
├── smart-delivery.ts           # Main delivery service ✅ INTEGRATED
├── ml-engine.ts                # ML scoring engine
├── ab-testing.ts               # A/B testing functionality
└── notification-triggers.ts    # Event-based triggers

server/services/
├── email/                      # Twilio Email helper ✅ INTEGRATED

server/sms-providers/
├── provider-factory.ts         # SMS provider factory ✅ INTEGRATED
├── twilio-provider.ts          # Twilio implementation ✅ INTEGRATED
└── phone-gateway-provider.ts   # Alternative SMS provider
```

### Integration Points

The smart delivery service (`smart-delivery.ts`) includes:

1. **Email Integration**
   - Sends through the shared email helper (Twilio Email)
   - HTML email templates
   - Configuration checking
   - Error handling

2. **SMS Integration**
   - SMS provider factory integration
   - Phone number formatting
   - Message optimization (160 chars)
   - Multi-provider support

3. **In-App Integration**
   - Socket.IO WebSocket delivery
   - Real-time notifications
   - Automatic user targeting

## Notification Channels

### Channel Selection Logic

The system uses ML-powered scoring to select the optimal channel:

1. **In-App** (WebSocket): Default for immediate, less critical updates
2. **Email**: Best for detailed information, non-urgent updates
3. **SMS**: High engagement, use for urgent/time-sensitive

You can override with `forceChannel` option or let the ML engine decide.

## Error Handling

All delivery methods include:
- Configuration validation
- Graceful degradation
- Detailed error logging
- Status tracking in database
- Retry logic (where appropriate)

## Monitoring

The system logs all notification delivery attempts with:
- Delivery status (delivered, failed, pending)
- Channel used
- ML scores and recommendations
- Error messages
- Performance metrics

Check logs with:
```bash
# Filter notification logs
grep "smart-delivery" logs/combined.log
```

## Next Steps

To complete the notification system:

1. **For Email** (Ready to use):
   - Add `TWILIO_EMAIL_API_KEY`, `TWILIO_EMAIL_API_SECRET` and `EMAIL_FROM_ADDRESS`
   - Test with `forceChannel: 'email'`

2. **For SMS** (Ready to use):
   - Add Twilio credentials to `.env` file
   - Ensure users have phone numbers in database
   - Test with `forceChannel: 'sms'`

## Database Schema

The system uses these tables:
- `notifications`: Stores notification records
- `notificationHistory`: Tracks delivery attempts and interactions
- `notificationABTests`: Manages A/B test configurations
- `users`: User information including email and phoneNumber

## Support

For issues or questions:
- Check logs in `logs/` directory
- Review error messages in notification history
- Verify environment variables are set correctly
- Check service configuration status

## Status Summary

| Feature | Status | Configuration Required |
|---------|--------|----------------------|
| Email (Twilio Email) | ✅ Fully Implemented | `TWILIO_EMAIL_API_KEY`, `TWILIO_EMAIL_API_SECRET`, `EMAIL_FROM_ADDRESS` |
| SMS (Twilio) | ✅ Fully Implemented | Twilio credentials |
| In-App (WebSocket) | ✅ Fully Implemented | None (automatic) |
| ML Scoring | ✅ Implemented | None |
| A/B Testing | ✅ Implemented | None |

The notification delivery system is **production-ready** for Email, SMS, and In-App channels.
