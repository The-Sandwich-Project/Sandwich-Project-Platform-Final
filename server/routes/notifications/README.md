# Smart Notification System API

## Overview

The Smart Notification System is a comprehensive, ML-powered notification platform that provides intelligent delivery, user behavior tracking, and optimization capabilities. It seamlessly integrates with the existing notification infrastructure while adding advanced machine learning features.

## Features

### 🧠 Machine Learning Engine
- **Relevance Scoring**: ML algorithms analyze user behavior to calculate notification relevance
- **Timing Optimization**: Smart delivery timing based on user activity patterns
- **Channel Selection**: AI-powered channel optimization (email, SMS, in-app, push)
- **Engagement Prediction**: Personalized notifications to maximize user engagement

### 📊 Analytics & Insights
- Real-time performance analytics
- User behavior pattern analysis
- A/B testing framework
- Comprehensive reporting and insights

### 🚀 Smart Delivery
- Multi-channel delivery support
- Real-time WebSocket integration
- Batch processing capabilities
- Scheduled delivery optimization

## API Endpoints

### Smart Notification Management

#### Get User Preferences
```http
GET /api/notifications/smart/preferences
```
Retrieve user's smart notification preferences and behavior patterns.

**Query Parameters:**
- `type` (optional): Filter by notification type

**Response:**
```json
{
  "preferences": [...],
  "behaviorPattern": {
    "activeHours": [9, 10, 11, 14, 15, 16, 17, 18],
    "preferredChannels": {"in_app": 0.7, "email": 0.5},
    "engagementRate": 0.65,
    "optimalFrequency": 3
  },
  "success": true
}
```

#### Update User Preferences
```http
PUT /api/notifications/smart/preferences
```
Update user's notification preferences for smart delivery.

**Request Body:**
```json
{
  "type": "task_assignment",
  "enabledChannels": ["in_app", "email"],
  "quietHours": {"start": 22, "end": 8},
  "frequency": "normal",
  "priority": "medium"
}
```

#### Send Smart Notification
```http
POST /api/notifications/smart/send
```
Send notification using ML-powered smart delivery logic.

**Request Body:**
```json
{
  "userId": "user123",
  "title": "New Task Assignment",
  "message": "You have been assigned a new task",
  "type": "task_assignment",
  "priority": "high",
  "forceChannel": "email", // optional
  "skipMLScoring": false
}
```

**Response:**
```json
{
  "success": true,
  "notification": {...},
  "mlAnalysis": {
    "score": 0.85,
    "factors": {
      "userEngagement": 0.8,
      "contentRelevance": 0.9,
      "timingOptimality": 0.7,
      "channelPreference": 0.8,
      "frequencyBalance": 0.9
    },
    "recommendedChannel": "email",
    "recommendedDelay": 0
  },
  "deliveryChannel": "email",
  "deliveryTime": "2025-09-27T10:30:00Z"
}
```

#### Track Interaction
```http
POST /api/notifications/smart/track-interaction
```
Track user interaction with notification for ML learning.

**Request Body:**
```json
{
  "notificationId": 123,
  "interactionType": "clicked",
  "channel": "email",
  "responseTime": 300
}
```

### Analytics & Reporting

#### Get Analytics Overview
```http
GET /api/notifications/analytics/overview
```
Get comprehensive notification analytics and performance metrics.

**Query Parameters:**
- `period`: `1d`, `7d`, `30d`, `90d`
- `startDate`, `endDate`: Custom date range
- `userId`: Filter by specific user
- `notificationType`: Filter by notification type
- `channel`: Filter by delivery channel

**Response:**
```json
{
  "analytics": {
    "summary": {
      "totalSent": 1250,
      "totalOpened": 875,
      "totalClicked": 432,
      "openRate": 0.7,
      "clickRate": 0.346,
      "averageMlScore": 0.72
    },
    "channelPerformance": [...],
    "typePerformance": [...],
    "dailyTrends": [...],
    "topPerformers": [...]
  }
}
```

#### Create A/B Test
```http
POST /api/notifications/analytics/ab-test
```
Create a new A/B test for notification optimization.

**Request Body:**
```json
{
  "name": "Subject Line Test",
  "description": "Testing different subject lines for task notifications",
  "notificationType": "task_assignment",
  "variants": [
    {
      "name": "control",
      "title": "New Task Assignment",
      "message": "You have a new task"
    },
    {
      "name": "variant_a",
      "title": "🚀 New Task Ready!",
      "message": "Your next task is ready for you"
    }
  ],
  "trafficSplit": [50, 50],
  "duration": 7,
  "successMetric": "click_rate"
}
```

#### Get User Behavior Patterns
```http
GET /api/notifications/smart/user-patterns
```
Get user behavior patterns for analysis (admin only).

#### Batch Processing
```http
POST /api/notifications/analytics/batch-process
```
Execute batch operations for ML model updates and analytics.

**Request Body:**
```json
{
  "operations": [
    "update_user_patterns",
    "recalculate_ml_scores",
    "cleanup_old_data",
    "generate_insights"
  ],
  "batchSize": 100
}
```

### Testing Endpoints (Development Only)

#### Test Smart Delivery
```http
POST /api/notifications/test/send-smart
```
Send a test notification using smart delivery.

#### Test ML Scoring
```http
GET /api/notifications/test/ml-score
```
Calculate ML relevance score for testing.

#### System Status
```http
GET /api/notifications/test/system-status
```
Get smart notification system status and capabilities.

## Machine Learning Features

### Relevance Scoring Algorithm

The ML engine calculates a relevance score (0-1) based on multiple factors:

1. **User Engagement** (30% weight): Historical interaction rates
2. **Content Relevance** (25% weight): Notification type importance and user preferences
3. **Timing Optimality** (20% weight): Current time vs. user active hours
4. **Channel Preference** (15% weight): User's preferred communication channels
5. **Frequency Balance** (10% weight): Daily notification frequency vs. optimal rate

### Smart Timing Optimization

- Analyzes user activity patterns to identify optimal delivery windows
- Calculates delay recommendations for maximum engagement
- Supports quiet hours and user timezone preferences

### Channel Selection AI

- Tracks engagement rates across all channels (email, SMS, in-app, push)
- Learns user preferences through interaction data
- Automatically selects the highest-performing channel for each user

### Behavior Pattern Learning

The system continuously learns from user interactions:

- **Active Hours**: Identifies when users are most responsive
- **Channel Preferences**: Tracks engagement rates by delivery method
- **Response Patterns**: Analyzes how quickly users interact with notifications
- **Frequency Optimization**: Finds the optimal number of notifications per day

## Database Schema

The system uses several database tables for smart notifications:

- `notification_preferences`: User-specific notification settings
- `notification_history`: Detailed delivery and interaction tracking
- `user_notification_patterns`: ML-derived user behavior patterns
- `notification_rules`: Smart delivery rules and constraints
- `notification_analytics`: Aggregated performance metrics
- `notification_ab_tests`: A/B testing configurations and results

## Integration Points

### WebSocket Real-time Delivery
- Seamlessly integrates with existing Socket.IO chat system
- Real-time in-app notification delivery
- User-specific notification channels

### Email & SMS Integration
- Email goes through `server/services/email` (Twilio Email); SMS through Twilio
- Template-based email notifications
- SMS delivery with length optimization

### Existing Notification System
- Extends current notification infrastructure
- Maintains backward compatibility
- Enhanced with ML insights and tracking

## Performance Considerations

- **Batch Processing**: Supports bulk operations for ML updates
- **Caching**: User patterns cached for fast access
- **Rate Limiting**: Prevents notification spam
- **Queue Support**: Ready for job queue integration (Bull, Agenda)
- **Database Optimization**: Indexed queries for fast analytics

## Security & Privacy

- **User Consent**: Respects user notification preferences
- **Data Privacy**: Anonymized analytics and behavior tracking
- **Access Control**: Admin-only access to sensitive analytics
- **Audit Logging**: Complete interaction tracking for compliance

## Getting Started

1. **Set User Preferences**: Configure notification preferences for users
2. **Send Smart Notifications**: Use the smart send endpoint for ML-powered delivery
3. **Track Interactions**: Implement interaction tracking in your frontend
4. **Monitor Analytics**: Use the analytics dashboard to optimize performance
5. **A/B Testing**: Create tests to optimize notification effectiveness

## Production Deployment

For production deployment:

1. Remove test endpoints by setting `NODE_ENV=production`
2. Configure email/SMS service integrations
3. Set up job queue for scheduled deliveries
4. Implement monitoring and alerting
5. Configure backup and recovery procedures

The smart notification system is production-ready with comprehensive error handling, validation, logging, and performance optimization.