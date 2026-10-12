import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  timestamp,
  varchar,
  jsonb,
  index,
  uniqueIndex,
  decimal,
  unique,
  primaryKey,
  time,
  date,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createInsertSchema } from 'drizzle-zod';
import { z } from 'zod';

// Session storage table.
// (IMPORTANT) This table is mandatory for Replit Auth, don't drop it.
export const sessions = pgTable(
  'sessions',
  {
    sid: varchar('sid').primaryKey(),
    sess: jsonb('sess').notNull(),
    expire: timestamp('expire').notNull(),
  },
  (table) => [index('IDX_session_expire').on(table.expire)]
);

// Migrations tracking table (used by server/run-migrations.ts and server/migrate.ts).
// (IMPORTANT) Do not remove from schema or db:push will drop it and break migration runs.
export const migrations = pgTable('_migrations', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull().unique(),
  executedAt: timestamp('executed_at').defaultNow(),
});

// User storage table.
// (IMPORTANT) This table is mandatory for Replit Auth, don't drop it.
//
// Note on email uniqueness: the uniqueness constraint is defined as a
// functional UNIQUE INDEX on LOWER(email) at the table level below, not as
// a column-level `.unique()`. This enforces case-insensitive uniqueness in
// the database (so `Foo@x.com` and `foo@x.com` can't both exist), matching
// the normalization we do in app code via shared/email-utils.ts.
export const users = pgTable('users', {
  id: varchar('id').primaryKey().notNull(),
  email: varchar('email'),
  password: varchar('password'), // For custom auth system
  firstName: varchar('first_name'),
  lastName: varchar('last_name'),
  displayName: varchar('display_name'), // User-chosen display name for chat/activities
  profileImageUrl: varchar('profile_image_url'),
  phoneNumber: varchar('phone_number'), // User's phone number for contact
  preferredEmail: varchar('preferred_email'), // Preferred email for communications (defaults to login email)
  role: varchar('role').notNull().default('volunteer'), // 'admin', 'admin_coordinator', 'volunteer', 'viewer'
  permissions: jsonb('permissions').default('[]'), // Array of specific permissions
  permissionsModifiedAt: timestamp('permissions_modified_at'),
  permissionsModifiedBy: varchar('permissions_modified_by'),
  address: text('address'), // Home address for map display in driver planning tool
  vanApproved: boolean('van_approved').default(false), // Whether this user is approved to drive the van
  // Event-role capabilities. Two axes per role (see shared/event-role-eligibility.ts):
  //  - "willing*" = self-declared by the user in their profile (what they want to do)
  //  - "*Approved" = coordinator-granted vetting for roles that carry responsibility
  // A user is offered a role on the Volunteer Hub when they're willing AND
  // (where the role requires it) approved. General volunteering is the baseline
  // everyone can do, so willingToVolunteer defaults to true.
  willingToVolunteer: boolean('willing_to_volunteer').default(true), // Willing to help as a general volunteer
  willingToSpeak: boolean('willing_to_speak').default(false), // Willing to speak at events
  willingToDrive: boolean('willing_to_drive').default(false), // Willing to drive for events
  speakerApproved: boolean('speaker_approved').default(false), // Coordinator-approved to speak on behalf of the org
  driverApproved: boolean('driver_approved').default(false), // Coordinator-approved to drive for events
  eventRolesModifiedAt: timestamp('event_roles_modified_at'), // When approval flags were last changed
  eventRolesModifiedBy: varchar('event_roles_modified_by'), // Who changed the approval flags
  latitude: varchar('latitude'), // Geocoded latitude for map display
  longitude: varchar('longitude'), // Geocoded longitude for map display
  geocodedAt: timestamp('geocoded_at'), // When coordinates were last geocoded
  metadata: jsonb('metadata').default('{}'), // Additional user data (phone, address, availability, etc.)
  isActive: boolean('is_active').notNull().default(true),
  needsPasswordSetup: boolean('needs_password_setup').default(false), // True for manually created accounts without password
  lastLoginAt: timestamp('last_login_at'), // Track when user last logged in
  lastActiveAt: timestamp('last_active_at'), // Track when user was last active (updated on API requests)
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  passwordBackup20241023: text('password_backup_20241023'),
  // Columns present in DB (do not remove or db:push will drop them and break the app)
  approvalStatus: text('approval_status'),
  approvedBy: varchar('approved_by'),
  approvedAt: timestamp('approved_at'),
  platformUserId: varchar('platform_user_id'),
  smsAlertsEnabled: boolean('sms_alerts_enabled'),
  emailNotificationsEnabled: boolean('email_notifications_enabled'),
  notifyOnNewIntake: boolean('notify_on_new_intake'),
  notifyOnTaskDue: boolean('notify_on_task_due'),
  notifyOnStatusChange: boolean('notify_on_status_change'),
  // Per-user opt-out for the Monday morning "Your Weekly Event Portfolio"
  // digest. Null/false = receive (default). True = skip in processWeeklyDigests.
  weeklyDigestOptOut: boolean('weekly_digest_opt_out').notNull().default(false),
}, (table) => ({
  // Case-insensitive unique index on email. Lives here instead of as a
  // column-level `.unique()` so the same email with different casing can't
  // coexist (e.g., Foo@x.com vs foo@x.com). Matches the
  // `users_email_lower_unique` index that exists in production.
  emailLowerIdx: uniqueIndex('users_email_lower_unique').on(sql`LOWER(${table.email})`),
}));

// API Keys table for external app integrations
export const apiKeys = pgTable('api_keys', {
  id: serial('id').primaryKey(),
  name: varchar('name').notNull(), // Descriptive name for the API key (e.g., "Intake Workflow App")
  keyHash: varchar('key_hash').notNull().unique(), // Hashed API key for secure storage
  keyPrefix: varchar('key_prefix').notNull(), // First 8 chars of key for identification (e.g., "tsp_1234...")
  permissions: jsonb('permissions').default('["EVENT_REQUESTS_VIEW"]'), // Array of allowed permissions
  createdBy: varchar('created_by').notNull(), // User who created the key
  lastUsedAt: timestamp('last_used_at'), // Track when key was last used
  expiresAt: timestamp('expires_at'), // Optional expiration date
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const insertApiKeySchema = createInsertSchema(apiKeys).omit({
  id: true,
  createdAt: true,
  lastUsedAt: true,
});
export type InsertApiKey = z.infer<typeof insertApiKeySchema>;
export type ApiKey = typeof apiKeys.$inferSelect;

// Audit logging table for tracking all data changes
export const auditLogs = pgTable('audit_logs', {
  id: serial('id').primaryKey(),
  action: varchar('action').notNull(), // CREATE, UPDATE, DELETE, LOGIN, LOGOUT
  tableName: varchar('table_name').notNull(),
  recordId: varchar('record_id').notNull(),
  oldData: text('old_data'), // JSON string of old values
  newData: text('new_data'), // JSON string of new values
  userId: varchar('user_id'), // Who made the change
  ipAddress: varchar('ip_address'),
  userAgent: text('user_agent'),
  sessionId: varchar('session_id'),
  timestamp: timestamp('timestamp').defaultNow().notNull(),
});

// User activity tracking table for detailed usage analytics
export const userActivityLogs = pgTable(
  'user_activity_logs',
  {
    id: serial('id').primaryKey(),
    userId: varchar('user_id').notNull(),
    action: varchar('action').notNull(), // PAGE_VIEW, FEATURE_USE, FORM_SUBMIT, DOWNLOAD, SEARCH, etc.
    section: varchar('section').notNull(), // dashboard, collections, messaging, admin, etc.
    details: jsonb('details').default('{}'), // Additional context (page, search terms, etc.)
    sessionId: varchar('session_id'),
    ipAddress: varchar('ip_address'),
    userAgent: text('user_agent'),
    duration: integer('duration'), // Time spent on action in seconds
    page: varchar('page'), // Specific page or route visited
    feature: varchar('feature'), // Specific feature used (button clicked, form submitted, etc.)
    metadata: jsonb('metadata').default('{}'), // Additional context data
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    userActionIdx: index('idx_user_activity_user_action').on(
      table.userId,
      table.action
    ),
    sectionTimeIdx: index('idx_user_activity_section_time').on(
      table.section,
      table.createdAt
    ),
    userTimeIdx: index('idx_user_activity_user_time').on(
      table.userId,
      table.createdAt
    ),
  })
);

// Client error logs — errors caught by the React ErrorBoundary, also emailed to admin
export const clientErrorLogs = pgTable(
  'client_error_logs',
  {
    id: serial('id').primaryKey(),
    userId: varchar('user_id'), // Null if user was not authenticated when error occurred
    userEmail: varchar('user_email'), // Snapshot at time of error for quick lookup
    userName: varchar('user_name'), // Snapshot at time of error
    userRole: varchar('user_role'),
    message: text('message').notNull(),
    stack: text('stack'),
    componentStack: text('component_stack'), // React component tree that crashed
    url: text('url'), // Full page URL where error happened
    referrer: text('referrer'),
    userAgent: text('user_agent'),
    viewportWidth: integer('viewport_width'),
    viewportHeight: integer('viewport_height'),
    ipAddress: varchar('ip_address'),
    sessionId: varchar('session_id'),
    emailSent: boolean('email_sent').default(false),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    createdAtIdx: index('idx_client_error_logs_created_at').on(table.createdAt),
    userIdx: index('idx_client_error_logs_user_id').on(table.userId),
  })
);

// Server-side application error logs — SMS failures, integration outages, cron errors, etc.
export const applicationErrorLogs = pgTable(
  'application_error_logs',
  {
    id: serial('id').primaryKey(),
    source: varchar('source').notNull(), // sms_parser, sms_webhook, health_check, cron, api, email, etc.
    severity: varchar('severity').notNull().default('error'), // info, warning, error, critical
    category: varchar('category'), // openai, twilio, parse_failure, database, etc.
    message: text('message').notNull(),
    details: jsonb('details').default('{}'),
    userId: varchar('user_id'),
    phoneNumber: varchar('phone_number'), // redacted phone for SMS-related errors
    requestPath: varchar('request_path'),
    emailSent: boolean('email_sent').default(false),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    createdAtIdx: index('idx_application_error_logs_created_at').on(table.createdAt),
    sourceIdx: index('idx_application_error_logs_source').on(table.source),
    severityIdx: index('idx_application_error_logs_severity').on(table.severity),
  })
);

/** User-submitted issue reports from the in-app "Report a problem" flow. */
export const userIssueReports = pgTable(
  'user_issue_reports',
  {
    id: serial('id').primaryKey(),
    userId: varchar('user_id').notNull(),
    userEmail: varchar('user_email'),
    userName: varchar('user_name'),
    pagePath: text('page_path').notNull(),
    pageLabel: varchar('page_label'),
    whatDoing: text('what_doing').notNull(),
    expectedOutcome: text('expected_outcome').notNull(),
    actualOutcome: text('actual_outcome').notNull(),
    recordType: varchar('record_type'),
    recordId: varchar('record_id'),
    recordLabel: varchar('record_label'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    createdAtIdx: index('idx_user_issue_reports_created_at').on(table.createdAt),
    userIdx: index('idx_user_issue_reports_user_id').on(table.userId),
  })
);

export const insertUserIssueReportSchema = createInsertSchema(userIssueReports).omit({
  id: true,
  createdAt: true,
});
export type InsertUserIssueReport = z.infer<typeof insertUserIssueReportSchema>;
export type UserIssueReport = typeof userIssueReports.$inferSelect;

// Team member availability calendar system
export const availabilitySlots = pgTable('availability_slots', {
  id: serial('id').primaryKey(),
  userId: varchar('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  startAt: timestamp('start_at').notNull(),
  endAt: timestamp('end_at').notNull(),
  status: varchar('status').notNull(), // 'available' or 'unavailable'
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Chat messages table for real-time chat system
export const chatMessages = pgTable('chat_messages', {
  id: serial('id').primaryKey(),
  channel: varchar('channel').notNull().default('general'), // 'general', 'core-team', 'host', 'driver', 'recipient'
  userId: varchar('user_id').notNull(),
  userName: varchar('user_name').notNull(),
  content: text('content').notNull(),
  editedAt: timestamp('edited_at'),
  createdAt: timestamp('created_at').defaultNow(),
});

// Chat message likes table for real-time chat system
export const chatMessageLikes = pgTable(
  'chat_message_likes',
  {
    id: serial('id').primaryKey(),
    messageId: integer('message_id').references(() => chatMessages.id, {
      onDelete: 'cascade',
    }),
    userId: varchar('user_id').notNull(),
    userName: varchar('user_name').notNull(),
    likedAt: timestamp('liked_at').defaultNow(),
  },
  (table) => ({
    uniqueLike: unique().on(table.messageId, table.userId),
  })
);

// Chat message reads table for tracking which users have read which messages
export const chatMessageReads = pgTable(
  'chat_message_reads',
  {
    id: serial('id').primaryKey(),
    messageId: integer('message_id').references(() => chatMessages.id, {
      onDelete: 'cascade',
    }),
    userId: varchar('user_id').notNull(),
    channel: varchar('channel').notNull(),
    readAt: timestamp('read_at').defaultNow(),
    createdAt: timestamp('created_at').defaultNow(), // ← MOVE IT HERE
  },
  (table) => ({
    uniqueRead: unique().on(table.messageId, table.userId),
    userChannelIdx: index('idx_chat_reads_user_channel').on(
      table.userId,
      table.channel
    ),
  })
);

// Instant messages table for 1:1 direct messaging
export const instantMessages = pgTable(
  'instant_messages',
  {
    id: serial('id').primaryKey(),
    senderId: varchar('sender_id').notNull(),
    senderName: varchar('sender_name').notNull(),
    recipientId: varchar('recipient_id').notNull(),
    content: text('content').notNull(),
    read: boolean('read').default(false), // Legacy field - use isRead for new code
    isRead: boolean('is_read').default(false), // Canonical field - synced with 'read' via DB trigger
    readAt: timestamp('read_at'),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => ({
    senderIdx: index('idx_instant_messages_sender').on(table.senderId),
    recipientIdx: index('idx_instant_messages_recipient').on(table.recipientId),
    conversationIdx: index('idx_instant_messages_conversation').on(
      table.senderId,
      table.recipientId
    ),
  })
);

export const insertInstantMessageSchema = createInsertSchema(instantMessages).omit({
  id: true,
  createdAt: true,
});

export type InstantMessage = typeof instantMessages.$inferSelect;
export type InsertInstantMessage = typeof instantMessages.$inferInsert;

// Instant message likes table for reactions
export const instantMessageLikes = pgTable(
  'instant_message_likes',
  {
    id: serial('id').primaryKey(),
    messageId: integer('message_id').notNull(),
    userId: varchar('user_id').notNull(),
    userName: varchar('user_name').notNull(),
    emoji: varchar('emoji').notNull().default('❤️'), // Support different reactions
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => ({
    messageIdx: index('idx_instant_message_likes_message').on(table.messageId),
    userIdx: index('idx_instant_message_likes_user').on(table.userId),
    uniqueLike: unique().on(table.messageId, table.userId, table.emoji),
  })
);

export const insertInstantMessageLikeSchema = createInsertSchema(instantMessageLikes).omit({
  id: true,
  createdAt: true,
});

export type InstantMessageLike = typeof instantMessageLikes.$inferSelect;
export type InsertInstantMessageLike = typeof instantMessageLikes.$inferInsert;

export const projects = pgTable('projects', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description'),
  status: text('status').notNull(), // 'waiting', 'tabled', 'in_progress', 'completed'
  priority: text('priority').notNull().default('medium'), // 'low', 'medium', 'high', 'urgent'
  category: text('category').notNull().default('technology'), // 'technology', 'events', 'grants', 'outreach'
  milestone: text('milestone'), // Project milestone information
  assigneeId: integer('assignee_id'),
  assigneeName: text('assignee_name'),
  assigneeIds: jsonb('assignee_ids').default('[]'), // Array of user IDs for multiple assignees
  assigneeNames: text('assignee_names'), // Comma-separated names for multiple assignees
  supportPeopleIds: jsonb('support_people_ids').default('[]'), // Array of user IDs for support people
  supportPeople: text('support_people'), // Support team members - names/emails (Column E in Google Sheets)
  dueDate: text('due_date'), // ISO date string
  startDate: text('start_date'), // ISO date string
  completionDate: text('completion_date'), // ISO date string
  progressPercentage: integer('progress_percentage').notNull().default(0), // 0-100
  notes: text('notes'), // Additional project notes
  requirements: text('requirements'), // Project requirements and specifications
  deliverables: text('deliverables'), // Expected deliverables/outcomes
  resources: text('resources'), // Resources needed or available
  blockers: text('blockers'), // Current blockers or issues
  tags: text('tags'), // JSON array of tags
  estimatedHours: integer('estimated_hours'), // Estimated work hours
  actualHours: integer('actual_hours'), // Actual hours worked
  budget: varchar('budget'), // Project budget
  color: text('color').notNull().default('blue'), // for status indicator
  createdBy: varchar('created_by'), // User ID who created the project
  createdByName: varchar('created_by_name'), // Display name of creator
  // Google Sheets integration fields
  reviewInNextMeeting: boolean('review_in_next_meeting')
    .notNull()
    .default(false), // Include in agenda
  lastDiscussedDate: text('last_discussed_date'), // ISO date string of last meeting where this was discussed
  meetingDiscussionPoints: text('meeting_discussion_points'), // What needs to be discussed about this project
  meetingDecisionItems: text('meeting_decision_items'), // What decisions need to be made
  googleSheetRowId: text('google_sheet_row_id'), // Track which sheet row this corresponds to
  lastSyncedAt: timestamp('last_synced_at'), // When last synced with Google Sheets
  syncStatus: text('sync_status').default('unsynced'), // "unsynced", "synced", "conflict", "error"
  // Bidirectional sync metadata
  lastPulledFromSheetAt: timestamp('last_pulled_from_sheet_at'), // When last pulled changes from sheet
  lastPushedToSheetAt: timestamp('last_pushed_to_sheet_at'), // When last pushed changes to sheet
  lastSheetHash: text('last_sheet_hash'), // Hash of sheet data for change detection
  lastAppHash: text('last_app_hash'), // Hash of app data for change detection
  tasksAndOwners: text('tasks_and_owners'), // Parsed from Google Sheets format: "Katie: Design, Chris: Review"
  // Additional database columns to prevent deletion during migrations
  estimatedhours: integer('estimatedhours'),
  actualhours: integer('actualhours'),
  startdate: text('startdate'), // Using text to match existing pattern
  enddate: text('enddate'), // Using text to match existing pattern
  risklevel: varchar('risklevel'),
  stakeholders: text('stakeholders'),
  milestones: text('milestones'),
  // NEW REFACTOR FIELDS - Primary owner
  ownerId: text('owner_id'), // Primary owner (single person ultimately responsible)
  ownerName: text('owner_name'), // Display name of primary owner
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// Archived projects table for completed projects
export const archivedProjects = pgTable('archived_projects', {
  id: serial('id').primaryKey(),
  originalProjectId: integer('original_project_id').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  priority: text('priority').notNull().default('medium'),
  category: text('category').notNull().default('technology'),
  assigneeId: integer('assignee_id'),
  assigneeName: text('assignee_name'),
  assigneeIds: jsonb('assignee_ids').default('[]'),
  assigneeNames: text('assignee_names'),
  dueDate: text('due_date'),
  startDate: text('start_date'),
  completionDate: text('completion_date').notNull(),
  progressPercentage: integer('progress_percentage').notNull().default(100),
  notes: text('notes'),
  requirements: text('requirements'),
  deliverables: text('deliverables'),
  resources: text('resources'),
  blockers: text('blockers'),
  tags: text('tags'),
  estimatedHours: integer('estimated_hours'),
  actualHours: integer('actual_hours'),
  budget: varchar('budget'),
  color: text('color').notNull().default('blue'),
  createdBy: varchar('created_by'),
  createdByName: varchar('created_by_name'),
  createdAt: timestamp('created_at').notNull(),
  completedAt: timestamp('completed_at').notNull().defaultNow(),
  archivedAt: timestamp('archived_at').notNull().defaultNow(),
  archivedBy: varchar('archived_by'),
  archivedByName: varchar('archived_by_name'),
  googleSheetRowId: text('google_sheet_row_id'), // Preserve Google Sheet row ID to prevent re-import
});

export const projectTasks = pgTable('project_tasks', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id'), // Nullable to support standalone tasks
  title: text('title').notNull(),
  description: text('description'),
  status: text('status').notNull().default('pending'), // 'pending', 'in_progress', 'completed'
  priority: text('priority').notNull().default('medium'), // 'low', 'medium', 'high'
  assigneeId: text('assignee_id'), // Single assignee - kept for backward compatibility
  assigneeName: text('assignee_name'), // Single assignee name - kept for backward compatibility
  assigneeIds: text('assignee_ids').array(), // Multiple assignee IDs as JSON array
  assigneeNames: text('assignee_names').array(), // Multiple assignee names as JSON array
  dueDate: text('due_date'),
  completedAt: timestamp('completed_at'),
  attachments: text('attachments'), // JSON array of file paths
  order: integer('order').notNull().default(0), // for task ordering
  orderNum: integer('order_num').default(0),
  // Additional database columns to prevent deletion during migrations
  completedBy: text('completed_by'),
  completedByName: text('completed_by_name'),
  // NEW REFACTOR FIELDS - Origin tracking
  originType: text('origin_type').notNull().default('manual'), // 'manual' | 'converted_from_note' | 'team_board'
  sourceNoteId: integer('source_note_id'), // If converted from note, references the source meeting note
  sourceMeetingId: integer('source_meeting_id'), // If created in a meeting context
  sourceTeamBoardId: integer('source_team_board_id'), // If promoted from team board
  selectedForAgenda: boolean('selected_for_agenda').notNull().default(false), // Whether to include in agenda
  // Subtask support - allows tasks to have parent tasks
  parentTaskId: integer('parent_task_id'), // References project_tasks.id for subtasks
  // Promotion to to-do list
  promotedToTodo: boolean('promoted_to_todo').notNull().default(false), // Whether subtask is promoted to to-do list
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const projectComments = pgTable('project_comments', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull(),
  authorName: text('author_name').notNull(),
  content: text('content').notNull(),
  commentType: text('comment_type').notNull().default('general'), // 'general', 'update', 'blocker', 'completion'
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const taskCompletions = pgTable(
  'task_completions',
  {
    id: serial('id').primaryKey(),
    taskId: integer('task_id').notNull(),
    userId: text('user_id').notNull(),
    userName: text('user_name').notNull(),
    completedAt: timestamp('completed_at').notNull().defaultNow(),
    notes: text('notes'),
  },
  (table) => ({
    uniqueTaskUser: unique().on(table.taskId, table.userId),
  })
);

// ============================================================================
// NEW REFACTOR TABLES - Multi-assignee with role-based assignments
// ============================================================================

// Project assignments - tracks owners and support people for projects
export const projectAssignments = pgTable('project_assignments', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull(), // References users.id
  userName: text('user_name').notNull(), // Denormalized for performance
  role: text('role').notNull(), // 'owner' | 'support'
  addedAt: timestamp('added_at').notNull().defaultNow(),
  addedBy: varchar('added_by'), // Who assigned this person
}, (table) => ({
  uniqueAssignment: unique().on(table.projectId, table.userId),
  projectIdx: index('idx_project_assignments_project').on(table.projectId),
  userIdx: index('idx_project_assignments_user').on(table.userId),
  roleIdx: index('idx_project_assignments_role').on(table.role),
}));

// Task assignments - tracks assignees for project tasks
export const taskAssignments = pgTable('task_assignments', {
  id: serial('id').primaryKey(),
  taskId: integer('task_id')
    .notNull()
    .references(() => projectTasks.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull(),
  userName: text('user_name').notNull(),
  role: text('role').notNull().default('assignee'), // 'assignee' | 'reviewer'
  addedAt: timestamp('added_at').notNull().defaultNow(),
  addedBy: varchar('added_by'),
}, (table) => ({
  uniqueAssignment: unique().on(table.taskId, table.userId),
  taskIdx: index('idx_task_assignments_task').on(table.taskId),
  userIdx: index('idx_task_assignments_user').on(table.userId),
}));

// Team board assignments - tracks assignees for team board items
export const teamBoardAssignments = pgTable('team_board_assignments', {
  id: serial('id').primaryKey(),
  itemId: integer('item_id')
    .notNull()
    .references(() => teamBoardItems.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull(),
  userName: text('user_name').notNull(),
  addedAt: timestamp('added_at').notNull().defaultNow(),
}, (table) => ({
  uniqueAssignment: unique().on(table.itemId, table.userId),
  itemIdx: index('idx_team_board_assignments_item').on(table.itemId),
  userIdx: index('idx_team_board_assignments_user').on(table.userId),
}));

// Meeting-project junction - tracks which projects are in which meetings
export const meetingProjects = pgTable('meeting_projects', {
  id: serial('id').primaryKey(),
  meetingId: integer('meeting_id')
    .notNull()
    .references(() => meetings.id, { onDelete: 'cascade' }),
  projectId: integer('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),

  // Pre-meeting planning
  discussionPoints: text('discussion_points'),
  questionsToAddress: text('questions_to_address'),

  // Post-meeting outcomes
  discussionSummary: text('discussion_summary'),
  decisionsReached: text('decisions_reached'),

  // Status and agenda control
  status: text('status').notNull().default('planned'), // 'planned' | 'discussed' | 'tabled' | 'deferred'
  includeInAgenda: boolean('include_in_agenda').notNull().default(true),

  // Ordering and categorization
  agendaOrder: integer('agenda_order'),
  section: text('section'), // 'urgent' | 'old_business' | 'new_business' | 'housekeeping'

  // Audit trail
  addedAt: timestamp('added_at').notNull().defaultNow(),
  addedBy: varchar('added_by'),
  discussedAt: timestamp('discussed_at'),
}, (table) => ({
  uniqueMeetingProject: unique().on(table.meetingId, table.projectId),
  meetingIdx: index('idx_meeting_projects_meeting').on(table.meetingId),
  projectIdx: index('idx_meeting_projects_project').on(table.projectId),
  statusIdx: index('idx_meeting_projects_status').on(table.status),
  includeIdx: index('idx_meeting_projects_include').on(table.includeInAgenda),
}));

// Committees table for organizing committee information
export const committees = pgTable('committees', {
  id: serial('id').primaryKey(), // Auto-incrementing numeric ID
  name: varchar('name').notNull(), // 'Marketing Committee', 'Grant Committee', etc.
  description: text('description'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Committee memberships table for tracking which users belong to which committees
export const committeeMemberships = pgTable('committee_memberships', {
  id: serial('id').primaryKey(),
  userId: varchar('user_id').notNull(),
  committeeId: integer('committee_id').notNull(), // References committees.id
  role: varchar('role').notNull().default('member'), // 'chair', 'co-chair', 'member'
  permissions: jsonb('permissions').default('[]'), // Specific committee permissions
  joinedAt: timestamp('joined_at').defaultNow(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow(),
});

// Announcements table for website banners
export const announcements = pgTable('announcements', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  message: text('message').notNull(),
  type: varchar('type').notNull().default('general'), // 'event', 'position', 'alert', 'general'
  priority: varchar('priority').notNull().default('medium'), // 'low', 'medium', 'high', 'urgent'
  startDate: timestamp('start_date').notNull(),
  endDate: timestamp('end_date').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  link: text('link'), // Optional external link
  linkText: text('link_text'), // Text for the link
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// SIMPLE MESSAGING SYSTEM - 3 tables only

// 1. Conversations - stores all conversation types
export const conversations = pgTable('conversations', {
  id: serial('id').primaryKey(),
  type: text('type').notNull(), // 'direct', 'group', 'channel'
  name: text('name'), // NULL for direct messages, required for groups/channels
  createdAt: timestamp('created_at').defaultNow(),
});

// 2. Conversation participants - who's in each conversation
export const conversationParticipants = pgTable(
  'conversation_participants',
  {
    conversationId: integer('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    joinedAt: timestamp('joined_at').defaultNow(),
    lastReadAt: timestamp('last_read_at').defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.conversationId, table.userId] }),
  })
);

// 3. Messages - for chat messages only
export const messages = pgTable('messages', {
  id: serial('id').primaryKey(),
  conversationId: integer('conversation_id').references(
    () => conversations.id,
    { onDelete: 'cascade' }
  ),
  userId: text('user_id').notNull(),
  senderId: text('sender_id').notNull(),
  content: text('content').notNull(),
  sender: text('sender'), // Display name of sender
  contextType: text('context_type'), // 'suggestion', 'project', 'task', 'event', 'graphic', 'expense', 'collection', 'direct'
  contextId: text('context_id'),
  contextTitle: text('context_title'), // Display name of related entity
  read: boolean('read').notNull().default(false), // Legacy field - use isRead for new code
  isRead: boolean('is_read').notNull().default(false), // Canonical field - synced with 'read' via DB trigger
  editedAt: timestamp('edited_at'),
  editedContent: text('edited_content'),
  deletedAt: timestamp('deleted_at'),
  deletedBy: text('deleted_by'),
  // Reply functionality
  replyToMessageId: integer('reply_to_message_id'),
  replyToContent: text('reply_to_content'), // Store original message content for display
  replyToSender: text('reply_to_sender'), // Store sender name for display
  // Attachments - stored as JSON array: [{ name, url, type, size }]
  attachments: text('attachments'), // JSON string of attachment objects
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// 4. Message Recipients - track read status per recipient
export const messageRecipients = pgTable(
  'message_recipients',
  {
    id: serial('id').primaryKey(),
    messageId: integer('message_id').references(() => messages.id, {
      onDelete: 'cascade',
    }),
    recipientId: text('recipient_id').notNull(),
    read: boolean('read').notNull().default(false), // Legacy field - use isRead for new code
    isRead: boolean('is_read').notNull().default(false), // Canonical field - synced with 'read' via DB trigger
    readAt: timestamp('read_at'),
    notificationSent: boolean('notification_sent').notNull().default(false),
    emailSentAt: timestamp('email_sent_at'),
    contextAccessRevoked: boolean('context_access_revoked').default(false),
    initiallyNotified: boolean('initially_notified').notNull().default(false),
    initiallyNotifiedAt: timestamp('initially_notified_at'),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => ({
    uniqueRecipient: unique().on(table.messageId, table.recipientId),
    unreadIdx: index('idx_message_recipients_unread').on(
      table.recipientId,
      table.read
    ),
  })
);

// THREADING REMOVED: No message threads table needed for simplified Gmail functionality

// 6. Kudos Tracking - prevent spam by tracking sent kudos
export const kudosTracking = pgTable(
  'kudos_tracking',
  {
    id: serial('id').primaryKey(),
    senderId: text('sender_id').notNull(),
    recipientId: text('recipient_id').notNull(),
    contextType: text('context_type').notNull(), // 'project' or 'task'
    contextId: text('context_id').notNull(),
    entityName: text('entity_name').notNull().default('Legacy Entry'), // Store the project/task name for display
    messageId: integer('message_id').references(() => messages.id, {
      onDelete: 'cascade',
    }),
    sentAt: timestamp('sent_at').defaultNow(),
  },
  (table) => ({
    // Ensure one kudos per sender-recipient-context combination
    uniqueKudos: unique().on(
      table.senderId,
      table.recipientId,
      table.contextType,
      table.contextId
    ),
    senderIdx: index('idx_kudos_sender').on(table.senderId),
  })
);

// 5. Message Likes - track who liked which messages
export const messageLikes = pgTable(
  'message_likes',
  {
    id: serial('id').primaryKey(),
    messageId: integer('message_id')
      .references(() => messages.id, { onDelete: 'cascade' })
      .notNull(),
    userId: text('user_id').notNull(),
    userName: text('user_name'), // Store user display name for tooltip
    likedAt: timestamp('liked_at').defaultNow(),
  },
  (table) => ({
    // Ensure each user can only like a message once
    uniqueLike: unique().on(table.messageId, table.userId),
    messageIdx: index('idx_message_likes_message').on(table.messageId),
    userIdx: index('idx_message_likes_user').on(table.userId),
  })
);

// All complex messaging tables removed - using enhanced messaging system above

// SIMPLIFIED Email-style messaging table - NO THREADING COMPLEXITY
// Simple Gmail-like inbox with send/receive, read/unread, reply, archive, delete operations only
export const emailMessages = pgTable(
  'email_messages',
  {
    id: serial('id').primaryKey(),
    senderId: varchar('sender_id').notNull(),
    senderName: varchar('sender_name').notNull(),
    senderEmail: varchar('sender_email').notNull(),
    recipientId: varchar('recipient_id').notNull(),
    recipientName: varchar('recipient_name').notNull(),
    recipientEmail: varchar('recipient_email').notNull(),
    subject: text('subject').notNull(),
    content: text('content').notNull(),
    isRead: boolean('is_read').notNull().default(false),
    isStarred: boolean('is_starred').notNull().default(false),
    isArchived: boolean('is_archived').notNull().default(false),
    isTrashed: boolean('is_trashed').notNull().default(false),
    isDraft: boolean('is_draft').notNull().default(false),
    parentMessageId: integer('parent_message_id'), // Reference to parent message for threading
    contextType: varchar('context_type'), // 'suggestion', 'project', 'task', 'event', 'graphic', 'expense', 'collection', 'direct'
    contextId: varchar('context_id'), // ID of the related entity
    contextTitle: varchar('context_title'), // Display name of related entity
    attachments: text('attachments').array(), // Array of attachment file paths
    includeSchedulingLink: boolean('include_scheduling_link').default(false), // Whether to include scheduling link in email
    requestPhoneCall: boolean('request_phone_call').default(false), // Whether to request phone call
    readAt: timestamp('read_at'),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => ({
    senderIdx: index('idx_email_sender').on(table.senderId),
    recipientIdx: index('idx_email_recipient').on(table.recipientId),
    readIdx: index('idx_email_read').on(table.isRead),
    trashedIdx: index('idx_email_trashed').on(table.isTrashed),
    draftIdx: index('idx_email_draft').on(table.isDraft),
  })
);

// Drafts table for email-style drafts functionality
export const emailDrafts = pgTable(
  'email_drafts',
  {
    id: serial('id').primaryKey(),
    userId: varchar('user_id').notNull(),
    recipientId: varchar('recipient_id').notNull(),
    recipientName: varchar('recipient_name').notNull(),
    subject: text('subject').notNull(),
    content: text('content').notNull(),
    lastSaved: timestamp('last_saved').defaultNow(),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => ({
    userIdx: index('idx_drafts_user').on(table.userId),
  })
);

export const weeklyReports = pgTable('weekly_reports', {
  id: serial('id').primaryKey(),
  weekEnding: text('week_ending').notNull(), // date string
  sandwichCount: integer('sandwich_count').notNull(),
  notes: text('notes'),
  submittedBy: text('submitted_by').notNull(),
  submittedAt: timestamp('submitted_at').notNull().defaultNow(),
});

// Sandwich distribution tracking - tracks how many sandwiches go from each host to each recipient org each week
export const sandwichDistributions = pgTable(
  'sandwich_distributions',
  {
    id: serial('id').primaryKey(),
    distributionDate: text('distribution_date').notNull(), // Date of distribution (YYYY-MM-DD format)
    weekEnding: text('week_ending').notNull(), // Week ending date for grouping (YYYY-MM-DD format)
    hostId: integer('host_id').notNull(), // ID of host location
    hostName: text('host_name').notNull(), // Name of host location (denormalized for reporting)
    recipientId: integer('recipient_id').notNull(), // ID of recipient organization
    recipientName: text('recipient_name').notNull(), // Name of recipient org (denormalized for reporting)
    sandwichCount: integer('sandwich_count').notNull(), // Number of sandwiches distributed
    notes: text('notes'), // Optional notes about the distribution
    createdBy: text('created_by').notNull(), // User ID who created this entry
    createdByName: text('created_by_name').notNull(), // Display name of creator
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => ({
    // Indexes for efficient querying
    weekEndingIdx: index('idx_distributions_week_ending').on(table.weekEnding),
    hostIdx: index('idx_distributions_host').on(table.hostId),
    recipientIdx: index('idx_distributions_recipient').on(table.recipientId),
    dateIdx: index('idx_distributions_date').on(table.distributionDate),
    // Ensure no duplicate entries for same host+recipient+date
    uniqueDistribution: unique().on(
      table.hostId,
      table.recipientId,
      table.distributionDate
    ),
  })
);

export const sandwichCollections = pgTable('sandwich_collections', {
  id: serial('id').primaryKey(),
  collectionDate: text('collection_date').notNull(), // The date sandwiches were actually collected
  hostName: text('host_name').notNull(),
  individualSandwiches: integer('individual_sandwiches').notNull().default(0),
  // Individual sandwich type breakdown (optional)
  individualDeli: integer('individual_deli'), // Number of deli sandwiches for individuals
  individualTurkey: integer('individual_turkey'), // Number of turkey sandwiches for individuals
  individualHam: integer('individual_ham'), // Number of ham sandwiches for individuals
  individualPbj: integer('individual_pbj'), // Number of PBJ sandwiches for individuals
  individualGeneric: integer('individual_generic'), // Number of generic/unknown sandwiches for individuals
  // Group collection columns (Phase 5: JSON column for unlimited groups)
  group1Name: text('group1_name'), // Name of first group (nullable) - LEGACY, use groupCollections
  group1Count: integer('group1_count'), // Count for first group (nullable) - LEGACY, use groupCollections
  group2Name: text('group2_name'), // Name of second group (nullable) - LEGACY, use groupCollections
  group2Count: integer('group2_count'), // Count for second group (nullable) - LEGACY, use groupCollections
  // New JSON column for unlimited groups
  groupCollections: jsonb('group_collections').notNull().default('[]'), // Array of {name: string, department?: string, count: number, deli?: number, turkey?: number, ham?: number, pbj?: number, generic?: number}
  createdBy: text('created_by'), // User ID who created this entry
  createdByName: text('created_by_name'), // Display name of creator
  submittedAt: timestamp('submitted_at').notNull().defaultNow(), // When form was submitted
  // Add field to track if this was submitted via walkthrough
  submissionMethod: text('submission_method').default('standard'), // 'standard' or 'walkthrough'
  // Soft delete tracking
  deletedAt: timestamp('deleted_at'), // When this record was soft-deleted
  deletedBy: text('deleted_by'), // User ID who deleted this record
  // Link to event request (for group events that came from formal event requests)
  eventRequestId: integer('event_request_id'), // Links collection to event request
});

// Authoritative weekly collections from Scott's Excel tracking system
// This is the source of truth for analytics and reporting (2020-2025)
// Imported from "New Sandwich Totals Scott" Excel file with weekly aggregated data
export const authoritativeWeeklyCollections = pgTable('authoritative_weekly_collections', {
  id: serial('id').primaryKey(),
  weekDate: text('week_date').notNull(), // Date of the week (from Excel Date column)
  location: text('location').notNull(), // Host location name
  sandwiches: integer('sandwiches').notNull(), // Total sandwiches for this location for this week
  weekOfYear: integer('week_of_year').notNull(), // Week number in the year (1-52)
  weekOfProgram: integer('week_of_program').notNull(), // Week number since program start
  year: integer('year').notNull(), // Year
  importedAt: timestamp('imported_at').defaultNow().notNull(),
  sourceFile: text('source_file').default('New Sandwich Totals Scott (5)_1761847323011.xlsx'),
});

export const meetingMinutes = pgTable('meeting_minutes', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  date: text('date').notNull(), // date string
  summary: text('summary').notNull(),
  color: text('color').notNull().default('blue'), // for border color
  fileName: text('file_name'), // original uploaded file name
  filePath: text('file_path'), // stored file path
  fileType: text('file_type'), // 'pdf', 'docx', 'google_docs', 'text'
  mimeType: text('mime_type'), // file mime type
  committeeType: text('committee_type'), // Committee this minute belongs to - "core_group", "marketing_committee", etc.
});

export const driveLinks = pgTable('drive_links', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  url: text('url').notNull(),
  icon: text('icon').notNull(), // icon name
  iconColor: text('icon_color').notNull(),
});

export const agendaItems = pgTable('agenda_items', {
  id: serial('id').primaryKey(),
  meetingId: integer('meeting_id').notNull(), // Links to specific meeting
  submittedBy: text('submitted_by').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  section: text('section'), // "urgent_items", "old_business", "new_business", "housekeeping"
  status: text('status').notNull().default('pending'), // "pending", "approved", "rejected", "postponed"
  submittedAt: timestamp('submitted_at').defaultNow().notNull(),
});

export const meetings = pgTable('meetings', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  type: text('type').notNull(), // "weekly", "marketing_committee", "grant_committee", "core_group", "all_team"
  date: text('date').notNull(),
  time: text('time').notNull(),
  location: text('location'),
  description: text('description'),
  finalAgenda: text('final_agenda'),
  status: text('status').notNull().default('planning'), // "planning", "agenda_set", "completed"
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const compiledAgendas = pgTable('compiled_agendas', {
  id: serial('id').primaryKey(),
  meetingId: integer('meeting_id').notNull(), // Links to meeting
  title: text('title').notNull(),
  date: text('date').notNull(),
  status: text('status').notNull().default('draft'), // "draft", "finalized", "published"
  sections: jsonb('sections').notNull().default('[]'), // Array of agenda sections with items
  deferredItems: jsonb('deferred_items').notNull().default('[]'), // Items deferred to next meeting
  compiledBy: text('compiled_by').notNull(), // User who compiled the agenda
  compiledAt: timestamp('compiled_at').defaultNow().notNull(),
  finalizedAt: timestamp('finalized_at'),
  publishedAt: timestamp('published_at'),
});

export const agendaSections = pgTable('agenda_sections', {
  id: serial('id').primaryKey(),
  compiledAgendaId: integer('compiled_agenda_id').notNull(),
  title: text('title').notNull(), // "Old Business", "Urgent Items", "Housekeeping", "New Business"
  orderIndex: integer('order_index').notNull(), // For ordering sections
  items: jsonb('items').notNull().default('[]'), // Array of agenda items in this section
});

export const drivers = pgTable('drivers', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  phone: text('phone'),
  email: text('email'),
  address: text('address'),
  notes: text('notes'),
  isActive: boolean('is_active').notNull().default(true),
  vehicleType: text('vehicle_type'),
  licenseNumber: text('license_number'),
  availability: text('availability').default('available'), // "available", "busy", "off-duty"
  zone: text('zone'), // Keep for migration compatibility
  area: text('area'), // Geographic area for driver coverage
  routeDescription: text('route_description'), // New field to preserve route info like "SS to Dunwoody"
  hostLocation: text('host_location'), // Connect to specific host locations
  hostId: integer('host_id'), // Reference to hosts table for directory connection
  vanApproved: boolean('van_approved').notNull().default(false),
  homeAddress: text('home_address'),
  availabilityNotes: text('availability_notes'),
  emailAgreementSent: boolean('email_agreement_sent').notNull().default(false),
  voicemailLeft: boolean('voicemail_left').notNull().default(false),
  inactiveReason: text('inactive_reason'),
  isWeeklyDriver: boolean('is_weekly_driver').notNull().default(false),
  willingToSpeak: boolean('willing_to_speak').notNull().default(false), // Legacy field - use isSpeaker for new code
  isSpeaker: boolean('is_speaker').notNull().default(false), // Canonical field - synced with 'willingToSpeak' via DB trigger
  // New driver fields
  isEventDriver: boolean('is_event_driver').notNull().default(false),
  wantsAppWalkthrough: boolean('wants_app_walkthrough').notNull().default(false),
  wantsTextAlerts: boolean('wants_text_alerts').notNull().default(false),
  temporarilyUnavailable: boolean('temporarily_unavailable').notNull().default(false),
  unavailableNote: text('unavailable_note'),
  unavailableUntil: timestamp('unavailable_until'),
  // Follow-up preference when unavailable: 'will_reach_out' or 'check_back'
  unavailableFollowUp: text('unavailable_follow_up'),
  // Enhanced availability system
  // availabilityStatus: 'available', 'unavailable', 'pending_checkin', 'inactive'
  availabilityStatus: text('availability_status').notNull().default('available'),
  // Date when driver should become unavailable (for scheduling future unavailability)
  unavailableStartDate: timestamp('unavailable_start_date'),
  // Date when admin should check in with driver to see if they're ready to return
  checkInDate: timestamp('check_in_date'),
  // Reason for unavailability (e.g., "medical", "travel", "personal", "work conflict")
  unavailableReason: text('unavailable_reason'),
  // Cooler status: 'has_tsp_coolers', 'would_hold_tsp_coolers', 'would_buy_coolers', 'has_own_coolers', 'cannot_hold_coolers', or null
  coolerStatus: text('cooler_status'),
  agreementInDatabase: boolean('agreement_in_database').notNull().default(false),
  // Onboarding status fields
  neverFullyOnboarded: boolean('never_fully_onboarded').notNull().default(false),
  wantsToRestart: boolean('wants_to_restart').notNull().default(false),
  // Van driving interest - requires insurance setup process
  interestedInVanDriving: boolean('interested_in_van_driving').notNull().default(false),
  surveySubmitted: boolean('survey_submitted').notNull().default(false), // Whether driver has submitted the driver survey
  latitude: decimal('latitude'), // Latitude coordinate for map display (nullable)
  longitude: decimal('longitude'), // Longitude coordinate for map display (nullable)
  geocodedAt: timestamp('geocoded_at'), // When coordinates were last updated/geocoded (nullable)
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// Driver vehicles table for multiple vehicles per driver with cooler capacity
export const driverVehicles = pgTable('driver_vehicles', {
  id: serial('id').primaryKey(),
  driverId: integer('driver_id').notNull(),
  make: text('make').notNull(),
  model: text('model').notNull(),
  year: integer('year'),
  color: text('color'),
  coolerCapacity: integer('cooler_capacity'), // Number of coolers this vehicle can hold
  isPrimary: boolean('is_primary').notNull().default(false),
  notes: text('notes'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const volunteers = pgTable('volunteers', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  phone: text('phone'),
  email: text('email'),
  address: text('address'),
  notes: text('notes'),
  isActive: boolean('is_active').notNull().default(true),
  vehicleType: text('vehicle_type'),
  licenseNumber: text('license_number'),
  availability: text('availability').default('available'), // "available", "busy", "off-duty"
  zone: text('zone'), // Keep for migration compatibility
  routeDescription: text('route_description'), // New field to preserve route info like "SS to Dunwoody"
  hostLocation: text('host_location'), // Connect to specific host locations
  hostId: integer('host_id'), // Reference to hosts table for directory connection
  vanApproved: boolean('van_approved').notNull().default(false),
  homeAddress: text('home_address'),
  availabilityNotes: text('availability_notes'),
  emailAgreementSent: boolean('email_agreement_sent').notNull().default(false),
  voicemailLeft: boolean('voicemail_left').notNull().default(false),
  inactiveReason: text('inactive_reason'),
  volunteerType: text('volunteer_type').notNull().default('general'), // 'general', 'former_driver', 'driver_candidate', etc.
  isDriver: boolean('is_driver').notNull().default(false), // Whether this volunteer can drive
  isSpeaker: boolean('is_speaker').notNull().default(false), // Whether this volunteer can speak at events (legacy: speaker role is being retired)
  // Volunteer readiness. 'new' volunteers are not yet cleared to attend an event
  // on their own and must be paired with an 'experienced' volunteer; 'experienced'
  // volunteers can attend any event solo. Kept independent of trainingCompleted so
  // finishing training can be recorded separately from being cleared to solo.
  experienceLevel: text('experience_level').notNull().default('new'), // 'new' | 'experienced'
  trainingCompleted: boolean('training_completed').notNull().default(false), // Whether the volunteer has completed the onboarding training
  latitude: decimal('latitude'),
  longitude: decimal('longitude'),
  geocodedAt: timestamp('geocoded_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const driverAgreements = pgTable('driver_agreements', {
  id: serial('id').primaryKey(),
  submittedBy: text('submitted_by').notNull(),
  email: text('email').notNull(),
  phone: text('phone').notNull(),
  licenseNumber: text('license_number').notNull(),
  vehicleInfo: text('vehicle_info').notNull(),
  emergencyContact: text('emergency_contact').notNull(),
  emergencyPhone: text('emergency_phone').notNull(),
  agreementAccepted: boolean('agreement_accepted').notNull().default(false),
  submittedAt: timestamp('submitted_at').defaultNow().notNull(),
});

export const hosts = pgTable('hosts', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(), // Location name (e.g., "Alpharetta", "Roswell Community Center")
  address: text('address'),
  email: text('email'),
  phone: text('phone'),
  status: text('status').notNull().default('active'), // 'active', 'inactive'
  notes: text('notes'),
  latitude: decimal('latitude'), // Latitude coordinate for map display (nullable for backwards compatibility)
  longitude: decimal('longitude'), // Longitude coordinate for map display (nullable for backwards compatibility)
  geocodedAt: timestamp('geocoded_at'), // When coordinates were last updated/geocoded (nullable)
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const hostContacts = pgTable('host_contacts', {
  id: serial('id').primaryKey(),
  hostId: integer('host_id').notNull(),
  name: text('name').notNull(), // Contact person name
  role: text('role').notNull(), // 'Lead', 'host', 'alternate', 'volunteer', 'head of school'
  phone: text('phone').notNull(),
  email: text('email'),
  address: text('address'), // Contact person's address
  isPrimary: boolean('is_primary').notNull().default(false),
  notes: text('notes'),
  hostLocation: text('host_location'), // Location name for grouping contacts
  driverAgreementSigned: boolean('driver_agreement_signed').default(false), // Whether the host has signed the driver agreement
  vanApproved: boolean('van_approved').default(false), // Whether this host contact is approved to drive the van
  weeklyActive: boolean('weekly_active').default(false), // Auto-updated from external site scrape every Monday
  // Soft-deactivation for hosts who've left the organization. UI surfaces
  // this as "Former Host". Distinct from hosts.status (location-level, for
  // the collection-log dropdown) and weeklyActive (weekly host-finder
  // rotation) — those answer different questions.
  isFormerHost: boolean('is_former_host').notNull().default(false),
  alternateForContactId: integer('alternate_for_contact_id'), // ID of the host contact this person is an alternate for
  lastScraped: timestamp('last_scraped'), // Last time availability was scraped from external site
  latitude: decimal('latitude'), // Latitude coordinate for map display (nullable)
  longitude: decimal('longitude'), // Longitude coordinate for map display (nullable)
  geocodedAt: timestamp('geocoded_at'), // When coordinates were last updated/geocoded (nullable)
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const recipients = pgTable('recipients', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  contactName: text('contact_name'), // Contact person name (legacy field)
  phone: text('phone').notNull(),
  email: text('email'),
  website: text('website'), // Organization website URL
  instagramHandle: text('instagram_handle'), // Instagram handle for social media tracking
  ein: text('ein'), // Employer Identification Number (tax ID) for the organization
  address: text('address'), // Actual street address (primary — also drives map + region detection)
  // Optional extra addresses (e.g., second site, warehouse, summer location). Each entry is a free-form labeled address.
  // The primary `address` field above stays authoritative for geocoding and map pins.
  addresses: jsonb('addresses').$type<Array<{ label: string; address: string }>>().default([]),
  region: text('region'), // Geographic region/area (e.g., "Downtown", "Sandy Springs")
  preferences: text('preferences'), // Legacy field - keeping for backward compatibility
  weeklyEstimate: integer('weekly_estimate'), // Estimated weekly sandwich count
  focusArea: text('focus_area'), // Legacy single focus area field (keeping for backward compatibility)
  focusAreas: jsonb('focus_areas').$type<string[]>().default([]), // What groups they focus on (e.g., ["youth", "veterans", "seniors", "families"])
  status: text('status').notNull().default('active'), // 'active', 'inactive'
  // New detailed contact fields
  contactPersonName: text('contact_person_name'), // Our contact within the organization
  contactPersonPhone: text('contact_person_phone'), // Contact person's phone
  contactPersonEmail: text('contact_person_email'), // Contact person's email
  contactPersonRole: text('contact_person_role'), // Their role/title (e.g., "Program Director", "Volunteer Coordinator")
  // Second contact person fields
  secondContactPersonName: text('second_contact_person_name'), // Second contact within the organization
  secondContactPersonPhone: text('second_contact_person_phone'), // Second contact person's phone
  secondContactPersonEmail: text('second_contact_person_email'), // Second contact person's email
  secondContactPersonRole: text('second_contact_person_role'), // Second contact person's role/title
  // Enhanced fields for operational tracking
  reportingGroup: text('reporting_group'), // Corresponds to host locations for operational grouping
  estimatedSandwiches: integer('estimated_sandwiches'), // Estimated sandwiches — used as the MIN of the range (or the single value when min === max)
  estimatedSandwichesMax: integer('estimated_sandwiches_max'), // Upper bound of the range. NULL means the field is treated as a single number equal to estimatedSandwiches.
  // Planned breakdown by sandwich type. Each row = { type, min, max }.
  // Use min === max for a single number (no range). Sum of all min/max is what we plan to give.
  // This is the PLANNED distribution; actual logged counts live in sandwich_collections.
  plannedSandwichBreakdown: jsonb('planned_sandwich_breakdown')
    .$type<Array<{ type: string; min: number; max: number }>>()
    .default([]),
  // How often we serve this org — NOT tied to the sandwich count itself.
  // 'weekly_priority' = regular committed orgs.
  // 'when_extras'     = leftover-driven; only served when we have surplus.
  // 'as_needed'       = irregular / special-circumstance orgs.
  // Free-text deliveryCadenceNote captures nuance not in the tier.
  deliveryCadence: text('delivery_cadence'), // 'weekly_priority' | 'when_extras' | 'as_needed' | null
  deliveryCadenceNote: text('delivery_cadence_note'),
  sandwichType: text('sandwich_type'), // Type of sandwiches preferred (replaces old "preferences" field)
  tspContact: text('tsp_contact'), // TSP contact person (may be a user within our app)
  tspContactUserId: varchar('tsp_contact_user_id'), // Link to users table if TSP contact is an app user
  contractSigned: boolean('contract_signed').notNull().default(false), // Whether contract has been signed
  contractSignedDate: timestamp('contract_signed_date'), // When contract was signed
  // Collection and feeding schedule fields
  collectionDay: text('collection_day'), // Day of week they collect sandwiches (e.g., "Monday", "Tuesday")
  collectionTime: text('collection_time'), // Time they collect sandwiches (e.g., "9:00 AM", "2:30 PM")
  feedingDay: text('feeding_day'), // Day of week they feed people (e.g., "Wednesday", "Sunday")
  feedingTime: text('feeding_time'), // Time they feed people (e.g., "12:00 PM", "6:00 PM")
  // Social media post tracking fields
  hasSharedPost: boolean('has_shared_post').notNull().default(false), // Whether recipient has shared a post about TSP on their social media
  sharedPostDate: timestamp('shared_post_date'), // When the post was shared (nullable)

  // Recipient survey tracking
  surveySubmitted: boolean('survey_submitted').notNull().default(false), // Whether recipient has submitted their survey
  surveySubmittedDate: timestamp('survey_submitted_date'), // When the survey was submitted (nullable, optional even when surveySubmitted is true)

  // People served tracking
  averagePeopleServed: integer('average_people_served'), // Average number of people they serve
  peopleServedFrequency: text('people_served_frequency'), // 'daily', 'weekly', 'monthly'

  // Partnership tracking
  partnershipStartDate: timestamp('partnership_start_date'), // When they started partnering with TSP
  partnershipYears: integer('partnership_years'), // How many years they've been partnered (can be computed or manually entered)

  // Fruit/Snacks program
  receivingFruit: boolean('receiving_fruit').notNull().default(false), // Currently receiving fruit from TSP
  receivingSnacks: boolean('receiving_snacks').notNull().default(false), // Currently receiving snacks from TSP
  wantsFruit: boolean('wants_fruit').notNull().default(false), // Would like to receive fruit but isn't yet
  wantsSnacks: boolean('wants_snacks').notNull().default(false), // Would like to receive snacks but isn't yet
  fruitSnacksNotes: text('fruit_snacks_notes'), // Notes about fruit/snacks preferences or requirements

  // Seasonal needs tracking
  hasSeasonalChanges: boolean('has_seasonal_changes').notNull().default(false), // Whether their needs change seasonally
  seasonalChangesDescription: text('seasonal_changes_description'), // Description of how needs change by season
  summerNeeds: text('summer_needs'), // Summer-specific needs
  winterNeeds: text('winter_needs'), // Winter/holiday-specific needs

  // Communication preferences
  preferredContactMethods: jsonb('preferred_contact_methods').$type<string[]>().default([]), // 'text', 'email', 'call', 'whatsapp', 'facebook' - their preferred methods (can select multiple)
  allowedContactMethods: jsonb('allowed_contact_methods').$type<string[]>().default(['text', 'email']), // Methods they consent to receive
  doNotContact: boolean('do_not_contact').notNull().default(false), // Opt-out of all contact
  contactMethodNotes: text('contact_method_notes'), // Special instructions for contacting (e.g., "Only call before 2pm")

  // Impact stories - quotes and stories from recipients about TSP's impact
  impactStories: jsonb('impact_stories').$type<Array<{story: string; date?: string; source?: string}>>().default([]),

  // Multiple collection schedules (stored as JSON arrays)
  collectionSchedules: jsonb('collection_schedules').$type<Array<{day: string; time: string; notes?: string}>>().default([]),
  feedingSchedules: jsonb('feeding_schedules').$type<Array<{day: string; time: string; notes?: string}>>().default([]),

  // Geocoding fields for map display
  latitude: decimal('latitude'), // Latitude coordinate for map display (nullable)
  longitude: decimal('longitude'), // Longitude coordinate for map display (nullable)
  geocodedAt: timestamp('geocoded_at'), // When coordinates were last updated/geocoded (nullable)

  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// New table for managing multiple TSP contacts per recipient
export const recipientTspContacts = pgTable(
  'recipient_tsp_contacts',
  {
    id: serial('id').primaryKey(),
    recipientId: integer('recipient_id')
      .notNull()
      .references(() => recipients.id, { onDelete: 'cascade' }),
    // For app users
    userId: varchar('user_id').references(() => users.id, {
      onDelete: 'set null',
    }), // Link to users table if contact is an app user
    userName: text('user_name'), // Cached user name for display
    userEmail: text('user_email'), // Cached user email for display
    // For external contacts (non-app users)
    contactName: text('contact_name'), // Name if not an app user
    contactEmail: text('contact_email'), // Email if not an app user
    contactPhone: text('contact_phone'), // Phone if not an app user
    // Common fields
    role: text('role').notNull().default('tsp_contact'), // All contacts are TSP contacts
    notes: text('notes'), // Additional notes about this contact relationship
    isActive: boolean('is_active').notNull().default(true),
    isPrimary: boolean('is_primary').notNull().default(false), // Only one primary contact per recipient
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    recipientIdx: index('idx_recipient_tsp_contacts_recipient').on(
      table.recipientId
    ),
    userIdx: index('idx_recipient_tsp_contacts_user').on(table.userId),
    primaryIdx: index('idx_recipient_tsp_contacts_primary').on(
      table.recipientId,
      table.isPrimary
    ),
  })
);

export const projectDocuments = pgTable('project_documents', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull(),
  fileName: text('file_name').notNull(),
  originalName: text('original_name').notNull(),
  fileSize: integer('file_size').notNull(),
  mimeType: text('mime_type').notNull(),
  uploadedBy: text('uploaded_by').notNull(),
  uploadedAt: timestamp('uploaded_at').notNull().defaultNow(),
});

// General document management system with granular permissions
export const documents = pgTable(
  'documents',
  {
    id: serial('id').primaryKey(),
    title: text('title').notNull(),
    description: text('description'),
    fileName: text('file_name').notNull(),
    originalName: text('original_name').notNull(),
    filePath: text('file_path').notNull(), // Storage path
    fileSize: integer('file_size').notNull(),
    mimeType: text('mime_type').notNull(),
    category: text('category').notNull().default('general'), // 'governance', 'operations', 'training', 'confidential', 'general'
    isActive: boolean('is_active').notNull().default(true),
    uploadedBy: varchar('uploaded_by').notNull(),
    uploadedByName: text('uploaded_by_name').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    categoryIdx: index('idx_documents_category').on(table.category),
    uploadedByIdx: index('idx_documents_uploaded_by').on(table.uploadedBy),
    activeIdx: index('idx_documents_active').on(table.isActive),
  })
);

// Document access permissions - granular control over who can access specific documents
export const documentPermissions = pgTable(
  'document_permissions',
  {
    id: serial('id').primaryKey(),
    documentId: integer('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    userId: varchar('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    permissionType: text('permission_type').notNull(), // 'view', 'download', 'edit', 'admin'
    grantedBy: varchar('granted_by').notNull(), // Who granted this permission
    grantedByName: text('granted_by_name').notNull(),
    grantedAt: timestamp('granted_at').notNull().defaultNow(),
    expiresAt: timestamp('expires_at'), // Optional expiration date
    notes: text('notes'), // Reason for granting permission
    isActive: boolean('is_active').notNull().default(true),
  },
  (table) => ({
    documentUserIdx: index('idx_document_permissions_doc_user').on(
      table.documentId,
      table.userId
    ),
    userPermissionIdx: index('idx_document_permissions_user').on(
      table.userId,
      table.permissionType
    ),
    documentPermissionIdx: index('idx_document_permissions_doc').on(
      table.documentId,
      table.permissionType
    ),
    uniquePermission: unique().on(
      table.documentId,
      table.userId,
      table.permissionType
    ),
  })
);

// Document access log for audit trail
export const documentAccessLogs = pgTable(
  'document_access_logs',
  {
    id: serial('id').primaryKey(),
    documentId: integer('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    userId: varchar('user_id').notNull(),
    userName: text('user_name').notNull(),
    action: text('action').notNull(), // 'view', 'download', 'upload', 'delete', 'share'
    ipAddress: varchar('ip_address'),
    userAgent: text('user_agent'),
    sessionId: varchar('session_id'),
    accessedAt: timestamp('accessed_at').notNull().defaultNow(),
  },
  (table) => ({
    documentIdx: index('idx_document_access_doc').on(table.documentId),
    userIdx: index('idx_document_access_user').on(table.userId),
    actionTimeIdx: index('idx_document_access_action_time').on(
      table.action,
      table.accessedAt
    ),
  })
);

// Confidential documents table for sensitive documents with email-based access control
export const confidentialDocuments = pgTable('confidential_documents', {
  id: serial('id').primaryKey(),
  fileName: varchar('file_name').notNull(),
  originalName: varchar('original_name').notNull(),
  filePath: varchar('file_path').notNull(),
  allowedEmails: jsonb('allowed_emails').notNull().default('[]'), // Array of email addresses with access
  uploadedBy: varchar('uploaded_by').notNull(), // User ID who uploaded
  uploadedAt: timestamp('uploaded_at').notNull().defaultNow(),
});

// Resources system - unified document and link management for easy discovery
export const resources = pgTable(
  'resources',
  {
    id: serial('id').primaryKey(),
    title: text('title').notNull(),
    description: text('description'),
    type: text('type').notNull(), // 'file', 'link', 'google_drive'
    category: text('category').notNull(), // 'legal_governance', 'brand_marketing', 'operations_safety', 'forms_templates', 'training', 'master_documents'

    // For files - references documents table
    documentId: integer('document_id').references(() => documents.id, { onDelete: 'cascade' }),

    // For external links
    url: text('url'),

    // Display and organization
    icon: text('icon'), // Icon name for display
    iconColor: text('icon_color'), // Color for icon
    isPinnedGlobal: boolean('is_pinned_global').notNull().default(false), // Admin global pin
    pinnedOrder: integer('pinned_order'), // Order for pinned items (lower = higher priority)

    // Usage tracking
    accessCount: integer('access_count').notNull().default(0),
    lastAccessedAt: timestamp('last_accessed_at'),

    // Metadata
    createdBy: varchar('created_by').notNull(),
    createdByName: text('created_by_name').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    isActive: boolean('is_active').notNull().default(true),
  },
  (table) => ({
    categoryIdx: index('idx_resources_category').on(table.category),
    typeIdx: index('idx_resources_type').on(table.type),
    pinnedIdx: index('idx_resources_pinned').on(table.isPinnedGlobal, table.pinnedOrder),
    accessCountIdx: index('idx_resources_access_count').on(table.accessCount),
    activeIdx: index('idx_resources_active').on(table.isActive),
  })
);

// User's personal favorite resources
export const userResourceFavorites = pgTable(
  'user_resource_favorites',
  {
    id: serial('id').primaryKey(),
    userId: varchar('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    resourceId: integer('resource_id')
      .notNull()
      .references(() => resources.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index('idx_user_resource_favorites_user').on(table.userId),
    resourceIdx: index('idx_user_resource_favorites_resource').on(table.resourceId),
    uniqueFavorite: unique('unique_user_resource_favorite').on(
      table.userId,
      table.resourceId
    ),
  })
);

// User's personal "notable" collections — per-user bookmark on a
// sandwich collection log entry. Used for the star icon on the
// collection log (distinct from the kudos / send-recognition icon
// which targets the SUBMITTER, not the entry).
export const userCollectionFavorites = pgTable(
  'user_collection_favorites',
  {
    id: serial('id').primaryKey(),
    userId: varchar('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    collectionId: integer('collection_id')
      .notNull()
      .references(() => sandwichCollections.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index('idx_user_collection_favorites_user').on(table.userId),
    collectionIdx: index('idx_user_collection_favorites_collection').on(
      table.collectionId
    ),
    uniqueFavorite: unique('unique_user_collection_favorite').on(
      table.userId,
      table.collectionId
    ),
  })
);

// Tag definitions for categorizing resources
export const resourceTags = pgTable(
  'resource_tags',
  {
    id: serial('id').primaryKey(),
    name: text('name').notNull().unique(),
    color: text('color'), // Hex color for display
    description: text('description'),
    createdBy: varchar('created_by').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    nameIdx: index('idx_resource_tags_name').on(table.name),
  })
);

// Many-to-many relationship between resources and tags
export const resourceTagAssignments = pgTable(
  'resource_tag_assignments',
  {
    id: serial('id').primaryKey(),
    resourceId: integer('resource_id')
      .notNull()
      .references(() => resources.id, { onDelete: 'cascade' }),
    tagId: integer('tag_id')
      .notNull()
      .references(() => resourceTags.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    resourceIdx: index('idx_resource_tag_assignments_resource').on(table.resourceId),
    tagIdx: index('idx_resource_tag_assignments_tag').on(table.tagId),
    uniqueAssignment: unique('unique_resource_tag_assignment').on(
      table.resourceId,
      table.tagId
    ),
  })
);

// Insert schemas
export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertProjectSchema = createInsertSchema(projects)
  .omit({ id: true, createdAt: true, updatedAt: true })
  .extend({
    estimatedHours: z.number().int().nullable().optional(),
    actualHours: z.number().int().nullable().optional(),
  });
export const insertArchivedProjectSchema = createInsertSchema(
  archivedProjects
).omit({ id: true, archivedAt: true });
export const insertMessageSchema = createInsertSchema(messages).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertMessageRecipientSchema = createInsertSchema(
  messageRecipients
).omit({ id: true, createdAt: true });
// REMOVED: insertMessageThreadSchema - Threading functionality removed
export const insertKudosTrackingSchema = createInsertSchema(kudosTracking).omit(
  { id: true, sentAt: true }
);
export const insertWeeklyReportSchema = createInsertSchema(weeklyReports).omit({
  id: true,
  submittedAt: true,
});
export const insertSandwichCollectionSchema = createInsertSchema(
  sandwichCollections
)
  .omit({ id: true, submittedAt: true })
  .extend({
    // Support groupCollections array for frontend (will be processed into group1/group2 by backend)
    groupCollections: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(120),
          department: z.string().trim().max(120).optional(), // Optional department field for admin editing
          count: z.number().int().min(0),
          deli: z.number().int().min(0).optional(),
          turkey: z.number().int().min(0).optional(),
          ham: z.number().int().min(0).optional(),
          pbj: z.number().int().min(0).optional(),
        })
      )
      .max(100)
      .optional(),
    // Optional breakdown for individual sandwiches
    individualDeli: z.number().int().min(0).optional(),
    individualTurkey: z.number().int().min(0).optional(),
    individualHam: z.number().int().min(0).optional(),
    individualPbj: z.number().int().min(0).optional(),
  });
export const insertMeetingMinutesSchema = createInsertSchema(
  meetingMinutes
).omit({ id: true });
export const insertDriveLinkSchema = createInsertSchema(driveLinks).omit({
  id: true,
});
export const insertAgendaItemSchema = createInsertSchema(agendaItems).omit({
  id: true,
  submittedAt: true,
});
export const insertMeetingSchema = createInsertSchema(meetings).omit({
  id: true,
  createdAt: true,
});
export const insertCompiledAgendaSchema = createInsertSchema(
  compiledAgendas
).omit({ id: true, compiledAt: true, finalizedAt: true, publishedAt: true });
export const insertAgendaSectionSchema = createInsertSchema(
  agendaSections
).omit({ id: true });
export const insertDriverAgreementSchema = createInsertSchema(
  driverAgreements
).omit({ id: true, submittedAt: true });

// Helper for nullable timestamp fields that can come as string, Date, or null
const nullableTimestampField = z
  .union([
    z.string().transform((val) => (val === '' ? null : new Date(val))),
    z.date(),
    z.null(),
  ])
  .optional();

export const insertDriverSchema = createInsertSchema(drivers)
  .omit({ id: true, createdAt: true, updatedAt: true })
  .extend({
    // Convert all timestamp fields from string to Date or null
    unavailableUntil: nullableTimestampField,
    unavailableStartDate: nullableTimestampField,
    checkInDate: nullableTimestampField,
    geocodedAt: nullableTimestampField,
  });
export const insertDriverVehicleSchema = createInsertSchema(driverVehicles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
/** Volunteer readiness levels. Single source of truth for client + server. */
export const VOLUNTEER_EXPERIENCE_LEVELS = ['new', 'experienced'] as const;
export type VolunteerExperienceLevel = (typeof VOLUNTEER_EXPERIENCE_LEVELS)[number];

export const insertVolunteerSchema = createInsertSchema(volunteers)
  .omit({ id: true, createdAt: true, updatedAt: true })
  .extend({
    // Convert all timestamp fields from string to Date or null
    geocodedAt: nullableTimestampField,
    // Constrain readiness to the known values on the create path.
    experienceLevel: z.enum(VOLUNTEER_EXPERIENCE_LEVELS).optional(),
  });
export const insertHostSchema = createInsertSchema(hosts)
  .omit({ id: true, createdAt: true, updatedAt: true })
  .extend({
    name: z
      .string()
      .min(1, 'Host name is required')
      .trim()
      .refine(
        (name) => name.length > 0,
        'Host name cannot be empty or just whitespace'
      ),
  });
export const insertHostContactSchema = createInsertSchema(hostContacts)
  .omit({ id: true, createdAt: true, updatedAt: true })
  .extend({
    // Convert all timestamp fields from string to Date or null
    geocodedAt: nullableTimestampField,
    lastScraped: nullableTimestampField,
  });

export const insertRecipientSchema = createInsertSchema(recipients)
  .omit({ id: true, createdAt: true, updatedAt: true })
  .extend({
    // Convert estimatedSandwiches from string to number or null
    estimatedSandwiches: z
      .union([
        z.string().transform((val) => (val === '' ? null : parseInt(val, 10))),
        z.number(),
        z.null(),
      ])
      .optional(),
    // Convert all timestamp fields from string to Date or null
    contractSignedDate: nullableTimestampField,
    sharedPostDate: nullableTimestampField,
    partnershipStartDate: nullableTimestampField,
    geocodedAt: nullableTimestampField,
    surveySubmittedDate: nullableTimestampField,
  });
export const insertRecipientTspContactSchema = createInsertSchema(
  recipientTspContacts
).omit({ id: true, createdAt: true, updatedAt: true });
export const insertProjectDocumentSchema = createInsertSchema(
  projectDocuments
).omit({ id: true, uploadedAt: true });
export const insertDocumentSchema = createInsertSchema(documents).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertDocumentPermissionSchema = createInsertSchema(
  documentPermissions
).omit({ id: true, grantedAt: true });
export const insertConfidentialDocumentSchema = createInsertSchema(
  confidentialDocuments
).omit({
  id: true,
  uploadedAt: true,
});

export const insertDocumentAccessLogSchema = createInsertSchema(
  documentAccessLogs
).omit({ id: true, accessedAt: true });

// Resource system insert schemas
export const insertResourceSchema = createInsertSchema(resources).omit({
  id: true,
  accessCount: true,
  lastAccessedAt: true,
  createdAt: true,
  updatedAt: true,
});
export const insertUserResourceFavoriteSchema = createInsertSchema(
  userResourceFavorites
).omit({
  id: true,
  createdAt: true,
});
export const insertResourceTagSchema = createInsertSchema(resourceTags).omit({
  id: true,
  createdAt: true,
});
export const insertResourceTagAssignmentSchema = createInsertSchema(
  resourceTagAssignments
).omit({
  id: true,
  createdAt: true,
});

export const insertProjectTaskSchema = createInsertSchema(projectTasks).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertProjectCommentSchema = createInsertSchema(
  projectComments
).omit({ id: true, createdAt: true });
export const insertTaskCompletionSchema = createInsertSchema(
  taskCompletions
).omit({ id: true, completedAt: true });

// Types
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type UpsertUser = typeof users.$inferInsert;
export type Project = typeof projects.$inferSelect;
export type InsertProject = z.infer<typeof insertProjectSchema>;
export type ArchivedProject = typeof archivedProjects.$inferSelect;
export type InsertArchivedProject = z.infer<typeof insertArchivedProjectSchema>;
export type Message = typeof messages.$inferSelect;
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type CompiledAgenda = typeof compiledAgendas.$inferSelect;
export type InsertCompiledAgenda = z.infer<typeof insertCompiledAgendaSchema>;
export type AgendaSection = typeof agendaSections.$inferSelect;
export type InsertAgendaSection = z.infer<typeof insertAgendaSectionSchema>;

// Message likes schema types
export const insertMessageLikeSchema = createInsertSchema(messageLikes).omit({
  id: true,
  likedAt: true,
});

export type MessageLike = typeof messageLikes.$inferSelect;
export type InsertMessageLike = z.infer<typeof insertMessageLikeSchema>;
export type MessageRecipient = typeof messageRecipients.$inferSelect;
export type InsertMessageRecipient = z.infer<
  typeof insertMessageRecipientSchema
>;
// REMOVED: MessageThread types - Threading functionality removed
export type KudosTracking = typeof kudosTracking.$inferSelect;
export type InsertKudosTracking = z.infer<typeof insertKudosTrackingSchema>;
export type WeeklyReport = typeof weeklyReports.$inferSelect;
export type InsertWeeklyReport = z.infer<typeof insertWeeklyReportSchema>;
export type SandwichCollection = typeof sandwichCollections.$inferSelect;
export type InsertSandwichCollection = z.infer<
  typeof insertSandwichCollectionSchema
>;
export type MeetingMinutes = typeof meetingMinutes.$inferSelect;
export type InsertMeetingMinutes = z.infer<typeof insertMeetingMinutesSchema>;
export type DriveLink = typeof driveLinks.$inferSelect;
export type InsertDriveLink = z.infer<typeof insertDriveLinkSchema>;
export type AgendaItem = typeof agendaItems.$inferSelect;
export type InsertAgendaItem = z.infer<typeof insertAgendaItemSchema>;
export type Meeting = typeof meetings.$inferSelect;
export type InsertMeeting = z.infer<typeof insertMeetingSchema>;
export type DriverAgreement = typeof driverAgreements.$inferSelect;
export type InsertDriverAgreement = z.infer<typeof insertDriverAgreementSchema>;
export type Host = typeof hosts.$inferSelect;
export type InsertHost = z.infer<typeof insertHostSchema>;
export type HostContact = typeof hostContacts.$inferSelect;
export type InsertHostContact = z.infer<typeof insertHostContactSchema>;
export type Recipient = typeof recipients.$inferSelect;
export type InsertRecipient = z.infer<typeof insertRecipientSchema>;
export type RecipientTspContact = typeof recipientTspContacts.$inferSelect;
export type InsertRecipientTspContact = z.infer<
  typeof insertRecipientTspContactSchema
>;
export type ProjectDocument = typeof projectDocuments.$inferSelect;
export type InsertProjectDocument = z.infer<typeof insertProjectDocumentSchema>;
export type Document = typeof documents.$inferSelect;
export type InsertDocument = z.infer<typeof insertDocumentSchema>;
export type DocumentPermission = typeof documentPermissions.$inferSelect;
export type InsertDocumentPermission = z.infer<
  typeof insertDocumentPermissionSchema
>;
export type DocumentAccessLog = typeof documentAccessLogs.$inferSelect;
export type InsertDocumentAccessLog = z.infer<
  typeof insertDocumentAccessLogSchema
>;
export type ConfidentialDocument = typeof confidentialDocuments.$inferSelect;
export type InsertConfidentialDocument = z.infer<
  typeof insertConfidentialDocumentSchema
>;
export type ProjectTask = typeof projectTasks.$inferSelect;
export type InsertProjectTask = z.infer<typeof insertProjectTaskSchema>;
export type ProjectComment = typeof projectComments.$inferSelect;
export type InsertProjectComment = z.infer<typeof insertProjectCommentSchema>;
export type TaskCompletion = typeof taskCompletions.$inferSelect;
export type InsertTaskCompletion = z.infer<typeof insertTaskCompletionSchema>;

// Hosted Files table
export const hostedFiles = pgTable('hosted_files', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description'),
  fileName: text('file_name').notNull(),
  originalName: text('original_name').notNull(),
  filePath: text('file_path').notNull(),
  fileSize: integer('file_size').notNull(),
  mimeType: text('mime_type').notNull(),
  category: text('category').notNull().default('general'), // toolkit, forms, guides, etc.
  uploadedBy: text('uploaded_by').notNull(),
  isPublic: boolean('is_public').notNull().default(true),
  downloadCount: integer('download_count').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const insertHostedFileSchema = createInsertSchema(hostedFiles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  downloadCount: true,
});

export type HostedFile = typeof hostedFiles.$inferSelect;
export type InsertHostedFile = z.infer<typeof insertHostedFileSchema>;

// General Contacts table (for people who aren't hosts or recipients)
export const contacts = pgTable('contacts', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  organization: text('organization'),
  role: text('role'),
  phone: text('phone').notNull(),
  email: text('email'),
  address: text('address'),
  notes: text('notes'),
  category: text('category').notNull().default('general'), // volunteer, board, vendor, donor, etc.
  status: text('status').notNull().default('active'), // active, inactive
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const insertContactSchema = createInsertSchema(contacts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type Contact = typeof contacts.$inferSelect;
export type InsertContact = z.infer<typeof insertContactSchema>;

// Audit log types
export const insertAuditLogSchema = createInsertSchema(auditLogs).omit({
  id: true,
  timestamp: true,
});

export type AuditLog = typeof auditLogs.$inferSelect;
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;

// Driver and Volunteer types
export type Driver = typeof drivers.$inferSelect;
export type InsertDriver = z.infer<typeof insertDriverSchema>;
export type DriverVehicle = typeof driverVehicles.$inferSelect;
export type InsertDriverVehicle = z.infer<typeof insertDriverVehicleSchema>;
export type Volunteer = typeof volunteers.$inferSelect;
export type InsertVolunteer = z.infer<typeof insertVolunteerSchema>;

// Enhanced notifications table for comprehensive in-app notifications
export const notifications = pgTable('notifications', {
  id: serial('id').primaryKey(),
  userId: varchar('user_id').notNull(), // Who receives the notification
  type: varchar('type').notNull(), // 'system_update', 'announcement', 'reminder', 'achievement', 'alert', 'celebration', etc.
  priority: varchar('priority').notNull().default('medium'), // 'low', 'medium', 'high', 'urgent'
  title: text('title').notNull(),
  message: text('message').notNull(),
  isRead: boolean('is_read').notNull().default(false),
  isArchived: boolean('is_archived').notNull().default(false),
  category: varchar('category'), // 'updates', 'events', 'tasks', 'system', 'social'
  relatedType: varchar('related_type'), // 'task', 'project', 'collection', 'announcement', etc.
  relatedId: integer('related_id'), // ID of related record
  actionUrl: text('action_url'), // URL to navigate to when clicked
  actionText: text('action_text'), // Text for action button (e.g., "View Details", "Take Action")
  expiresAt: timestamp('expires_at'), // When notification should be auto-archived
  metadata: jsonb('metadata').default('{}'), // Extra data (icons, colors, celebration data, etc.)
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const insertNotificationSchema = createInsertSchema(notifications)
  .omit({ id: true, createdAt: true })
  .extend({
    // Convert expiresAt from string to Date or null
    expiresAt: nullableTimestampField,
  });

export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = z.infer<typeof insertNotificationSchema>;

// Registered native/mobile devices for future push notifications.
export const mobileDevices = pgTable(
  'mobile_devices',
  {
    id: serial('id').primaryKey(),
    userId: varchar('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    platform: varchar('platform').notNull(), // 'ios' | 'android'
    deviceToken: text('device_token').notNull(),
    pushProvider: varchar('push_provider').notNull().default('expo'), // 'expo' | 'apns' | 'fcm'
    appVersion: varchar('app_version'),
    deviceName: text('device_name'),
    isActive: boolean('is_active').notNull().default(true),
    lastSeenAt: timestamp('last_seen_at').defaultNow(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_mobile_devices_user_id').on(table.userId),
    uniqueIndex('idx_mobile_devices_user_token').on(table.userId, table.deviceToken),
  ]
);

export const insertMobileDeviceSchema = createInsertSchema(mobileDevices).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type MobileDevice = typeof mobileDevices.$inferSelect;
export type InsertMobileDevice = z.infer<typeof insertMobileDeviceSchema>;

// Committee schema types
export const insertCommitteeSchema = createInsertSchema(committees).omit({
  createdAt: true,
  updatedAt: true,
});

export type Committee = typeof committees.$inferSelect;
export type InsertCommittee = z.infer<typeof insertCommitteeSchema>;

export const insertCommitteeMembershipSchema = createInsertSchema(
  committeeMemberships
).omit({
  id: true,
  joinedAt: true,
});

export type CommitteeMembership = typeof committeeMemberships.$inferSelect;
export type InsertCommitteeMembership = z.infer<
  typeof insertCommitteeMembershipSchema
>;

// Announcement schema types
export const insertAnnouncementSchema = createInsertSchema(announcements).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type Announcement = typeof announcements.$inferSelect;
export type InsertAnnouncement = z.infer<typeof insertAnnouncementSchema>;

// Chat message types for team chat system
export type ChatMessage = typeof chatMessages.$inferSelect;
export type InsertChatMessage = z.infer<typeof insertChatMessageSchema>;

export const insertChatMessageSchema = createInsertSchema(chatMessages).omit({
  id: true,
  createdAt: true,
  editedAt: true,
});

// Chat message likes schema types
export const insertChatMessageLikeSchema = createInsertSchema(
  chatMessageLikes
).omit({
  id: true,
  likedAt: true,
});

export type ChatMessageLike = typeof chatMessageLikes.$inferSelect;
export type InsertChatMessageLike = z.infer<typeof insertChatMessageLikeSchema>;

// Simple messaging schema types
export const insertConversationSchema = createInsertSchema(conversations).omit({
  id: true,
  createdAt: true,
});

export const insertConversationParticipantSchema = createInsertSchema(
  conversationParticipants
).omit({
  joinedAt: true,
  lastReadAt: true,
});

export type Conversation = typeof conversations.$inferSelect;
export type InsertConversation = z.infer<typeof insertConversationSchema>;
export type ConversationParticipant =
  typeof conversationParticipants.$inferSelect;
export type InsertConversationParticipant = z.infer<
  typeof insertConversationParticipantSchema
>;

// Email messaging schemas
export const insertEmailMessageSchema = createInsertSchema(emailMessages).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertEmailDraftSchema = createInsertSchema(emailDrafts).omit({
  id: true,
  createdAt: true,
  lastSaved: true,
});

export type EmailMessage = typeof emailMessages.$inferSelect;
export type EmailDraft = typeof emailDrafts.$inferSelect;
export type InsertEmailMessage = z.infer<typeof insertEmailMessageSchema>;
export type InsertEmailDraft = z.infer<typeof insertEmailDraftSchema>;

// Wishlist suggestions table for Amazon wishlist item requests
export const wishlistSuggestions = pgTable('wishlist_suggestions', {
  id: serial('id').primaryKey(),
  item: text('item').notNull(),
  reason: text('reason'),
  priority: varchar('priority').notNull().default('medium'), // high, medium, low
  suggestedBy: varchar('suggested_by').notNull(), // user ID who suggested it
  status: varchar('status').notNull().default('pending'), // pending, approved, rejected, added
  adminNotes: text('admin_notes'), // Notes from admin review
  amazonUrl: text('amazon_url'), // URL if added to actual Amazon wishlist
  estimatedCost: decimal('estimated_cost', { precision: 10, scale: 2 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  reviewedAt: timestamp('reviewed_at'),
  reviewedBy: varchar('reviewed_by'), // user ID who reviewed it
});

export const insertWishlistSuggestionSchema = createInsertSchema(
  wishlistSuggestions
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  reviewedAt: true,
});

export type WishlistSuggestion = typeof wishlistSuggestions.$inferSelect;
export type InsertWishlistSuggestion = z.infer<
  typeof insertWishlistSuggestionSchema
>;

// Holding Zone Categories - categories for organizing holding zone items
export const holdingZoneCategories = pgTable('holding_zone_categories', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  color: varchar('color', { length: 50 }).notNull(), // Hex color code or Tailwind color class
  createdBy: varchar('created_by').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  isActive: boolean('is_active').notNull().default(true),
});

export const insertHoldingZoneCategorySchema = createInsertSchema(
  holdingZoneCategories
).omit({
  id: true,
  createdAt: true,
});

export type HoldingZoneCategory = typeof holdingZoneCategories.$inferSelect;
export type InsertHoldingZoneCategory = z.infer<typeof insertHoldingZoneCategorySchema>;

// Team Bulletin Board - simple board for tasks, notes, ideas, anything team wants to share
export const teamBoardItems = pgTable('team_board_items', {
  id: serial('id').primaryKey(),
  content: text('content').notNull(), // The actual task/note/idea - can be anything
  type: varchar('type').default('task'), // 'task', 'note', 'idea', 'canvas' (removed 'reminder')
  createdBy: varchar('created_by').notNull(), // User ID who posted it
  createdByName: varchar('created_by_name').notNull(), // Display name of poster
  assignedTo: text('assigned_to').array(), // Array of user IDs - supports multiple assignees
  assignedToNames: text('assigned_to_names').array(), // Array of display names - supports multiple assignees
  status: varchar('status').notNull().default('open'), // 'open', 'todo', 'done'
  // HOLDING ZONE FIELDS
  categoryId: integer('category_id').references(() => holdingZoneCategories.id), // Category for organization
  isUrgent: boolean('is_urgent').notNull().default(false), // Urgent flag for priority items
  isPrivate: boolean('is_private').notNull().default(false), // Private items only visible to creator and admins
  sharedWithUserId: varchar('shared_with_user_id'), // When set with isPrivate: only creator, this user, and admins can see
  details: text('details'), // Free text details section for additional information
  dueDate: timestamp('due_date'), // Optional due date for the item
  // NEW REFACTOR FIELDS - Project linking and promotion tracking
  projectId: integer('project_id'), // Optional link to a project for context
  promotedToTaskId: integer('promoted_to_task_id'), // If promoted to project task
  promotedAt: timestamp('promoted_at'), // When promoted to project task
  // PARENT-CHILD LINKING - Link items to other items (e.g., meeting items with sub-items)
  parentItemId: integer('parent_item_id').references(() => teamBoardItems.id, { onDelete: 'set null' }), // Optional parent item for nesting
  createdAt: timestamp('created_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'), // When marked as done
  // Canvas-specific fields
  isCanvas: boolean('is_canvas').notNull().default(false), // Whether this item uses the structured canvas
  canvasSections: jsonb('canvas_sections'), // Structured content: [{id,title,cards:[{id,type,content}]}]
  canvasStatus: varchar('canvas_status').default('draft'), // 'draft', 'in_review', 'published', 'archived'
  canvasPublishedSnapshot: jsonb('canvas_published_snapshot'), // Snapshot of last published version
  canvasPublishedAt: timestamp('canvas_published_at'),
  canvasPublishedBy: varchar('canvas_published_by'),
});

export const insertTeamBoardItemSchema = createInsertSchema(
  teamBoardItems
).omit({
  id: true,
  createdAt: true,
});

export type TeamBoardItem = typeof teamBoardItems.$inferSelect;
export type InsertTeamBoardItem = z.infer<typeof insertTeamBoardItemSchema>;

// Team Board Item Categories - junction table for many-to-many relationship
export const teamBoardItemCategories = pgTable(
  'team_board_item_categories',
  {
    id: serial('id').primaryKey(),
    itemId: integer('item_id')
      .notNull()
      .references(() => teamBoardItems.id, { onDelete: 'cascade' }),
    categoryId: integer('category_id')
      .notNull()
      .references(() => holdingZoneCategories.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    uniqueItemCategory: unique().on(table.itemId, table.categoryId),
  })
);

export type TeamBoardItemCategory = typeof teamBoardItemCategories.$inferSelect;

// TSP Yearly Calendar - Month-based planning items with optional specific dates
export const yearlyCalendarItems = pgTable('yearly_calendar_items', {
  id: serial('id').primaryKey(),
  month: integer('month').notNull(), // 1-12 (January = 1, December = 12)
  year: integer('year').notNull(), // Year for this calendar item (allows multiple years)
  title: text('title').notNull(), // Short title/description
  description: text('description'), // Optional longer description
  category: varchar('category').default('preparation'), // 'preparation', 'event-rush', 'staffing', 'board', 'seasonal', 'other'
  priority: varchar('priority').default('medium'), // 'low', 'medium', 'high'
  startDate: date('start_date'), // Optional specific start date for calendar display
  endDate: date('end_date'), // Optional specific end date (if null, same as startDate)
  createdBy: varchar('created_by').notNull(), // User ID who created it
  createdByName: varchar('created_by_name').notNull(), // Display name of creator
  assignedTo: text('assigned_to').array(), // Array of user IDs
  assignedToNames: text('assigned_to_names').array(), // Array of display names
  isRecurring: boolean('is_recurring').notNull().default(true), // Whether this repeats every year (legacy)
  // New recurrence fields for weekly/monthly/yearly patterns
  recurrenceType: varchar('recurrence_type').default('none'), // 'none', 'weekly', 'monthly', 'yearly'
  recurrencePattern: jsonb('recurrence_pattern'), // { dayOfWeek: 0-6, dayOfMonth: 1-31, weekOfMonth: 1-5 }
  recurrenceEndDate: date('recurrence_end_date'), // Optional: when the recurrence stops
  isCompleted: boolean('is_completed').notNull().default(false), // Mark as completed for the year
  completedAt: timestamp('completed_at'), // When it was marked complete
  completedBy: varchar('completed_by'), // User who marked it complete
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  monthYearIndex: index('idx_yearly_calendar_month_year').on(table.year, table.month),
  dateRangeIndex: index('idx_yearly_calendar_dates').on(table.startDate, table.endDate),
}));

export const insertYearlyCalendarItemSchema = createInsertSchema(
  yearlyCalendarItems
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type YearlyCalendarItem = typeof yearlyCalendarItems.$inferSelect;
export type InsertYearlyCalendarItem = z.infer<typeof insertYearlyCalendarItemSchema>;

// Tracked Calendar Items - Date-range based items (e.g., school breaks, holidays)
// Month is derived from dates, not stored separately
export const trackedCalendarItems = pgTable('tracked_calendar_items', {
  id: serial('id').primaryKey(),
  externalId: varchar('external_id').unique(), // For upsert by external source ID
  category: varchar('category').notNull(), // 'school_breaks', 'holidays', 'events', etc.
  title: text('title').notNull(),
  startDate: date('start_date').notNull(),
  endDate: date('end_date').notNull(),
  notes: text('notes'),
  metadata: jsonb('metadata').default('{}'), // Store category-specific data (districts, academicYear, etc.)
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  categoryIndex: index('idx_tracked_calendar_category').on(table.category),
  dateRangeIndex: index('idx_tracked_calendar_dates').on(table.startDate, table.endDate),
  externalIdIndex: index('idx_tracked_calendar_external_id').on(table.externalId),
}));

export const insertTrackedCalendarItemSchema = createInsertSchema(
  trackedCalendarItems
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type TrackedCalendarItem = typeof trackedCalendarItems.$inferSelect;
export type InsertTrackedCalendarItem = z.infer<typeof insertTrackedCalendarItemSchema>;

// Team Board Comments - allow discussion on team board items
export const teamBoardComments = pgTable('team_board_comments', {
  id: serial('id').primaryKey(),
  itemId: integer('item_id')
    .notNull()
    .references(() => teamBoardItems.id, { onDelete: 'cascade' }),
  userId: varchar('user_id').notNull(),
  userName: varchar('user_name').notNull(),
  content: text('content').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Team Board Item Likes - track who liked which team board items
export const teamBoardItemLikes = pgTable(
  'team_board_item_likes',
  {
    id: serial('id').primaryKey(),
    itemId: integer('item_id')
      .notNull()
      .references(() => teamBoardItems.id, { onDelete: 'cascade' }),
    userId: varchar('user_id').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    uniqueLike: uniqueIndex('unique_team_board_item_like').on(table.itemId, table.userId),
    itemIdx: index('idx_team_board_item_likes_item').on(table.itemId),
    userIdx: index('idx_team_board_item_likes_user').on(table.userId),
  })
);

export const insertTeamBoardCommentSchema = createInsertSchema(
  teamBoardComments
).omit({
  id: true,
  createdAt: true,
});

export type TeamBoardComment = typeof teamBoardComments.$inferSelect;
export type InsertTeamBoardComment = z.infer<
  typeof insertTeamBoardCommentSchema
>;

export const insertTeamBoardItemLikeSchema = createInsertSchema(
  teamBoardItemLikes
).omit({
  id: true,
  createdAt: true,
});

export type TeamBoardItemLike = typeof teamBoardItemLikes.$inferSelect;
export type InsertTeamBoardItemLike = z.infer<typeof insertTeamBoardItemLikeSchema>;

// Cooler Types table for defining types of coolers
export const coolerTypes = pgTable('cooler_types', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull(), // e.g., "Large rolling cooler"
  description: text('description'), // Optional details
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0), // For display ordering
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const insertCoolerTypeSchema = createInsertSchema(coolerTypes).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type CoolerType = typeof coolerTypes.$inferSelect;
export type InsertCoolerType = z.infer<typeof insertCoolerTypeSchema>;

// Cooler Inventory table for tracking cooler locations
export const coolerInventory = pgTable('cooler_inventory', {
  id: serial('id').primaryKey(),
  hostHomeId: varchar('host_home_id').notNull(), // User ID of the host home
  coolerTypeId: integer('cooler_type_id')
    .notNull()
    .references(() => coolerTypes.id),
  quantity: integer('quantity').notNull().default(0),
  notes: text('notes'), // Optional notes about condition, etc.
  reportedAt: timestamp('reported_at').defaultNow().notNull(),
  reportedBy: varchar('reported_by').notNull(), // User ID who submitted the report
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const insertCoolerInventorySchema = createInsertSchema(
  coolerInventory
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type CoolerInventory = typeof coolerInventory.$inferSelect;
export type InsertCoolerInventory = z.infer<typeof insertCoolerInventorySchema>;

// Event Requests table for tracking organization event planning
export const eventRequests = pgTable(
  'event_requests',
  {
    id: serial('id').primaryKey(),
    // Submitter information (primary contact)
    firstName: varchar('first_name'), // Made optional for manual entries
    lastName: varchar('last_name'), // Made optional for manual entries
    email: varchar('email'), // Made optional - can be null
    phone: varchar('phone'),

    // Backup/secondary contact information
    backupContactFirstName: varchar('backup_contact_first_name'),
    backupContactLastName: varchar('backup_contact_last_name'),
    backupContactEmail: varchar('backup_contact_email'),
    backupContactPhone: varchar('backup_contact_phone'),
    backupContactRole: varchar('backup_contact_role'), // Role/title (e.g., "Assistant Principal", "Events Coordinator")

    // Organization information
    organizationName: varchar('organization_name'), // Made optional for manual entries
    department: varchar('department'),
    organizationCategory: varchar('organization_category'), // 'corp', 'small_medium_corp', 'large_corp', 'church_faith', 'religious', 'nonprofit', 'government', 'hospital', 'political', 'school', 'neighborhood', 'club', 'greek_life', 'cultural', 'other'
    schoolClassification: varchar('school_classification'), // 'public', 'private', 'charter' (only applicable when category is 'school')

    // Partner/co-hosting organizations (for events hosted by multiple organizations)
    partnerOrganizations: jsonb('partner_organizations').$type<Array<{
      name: string;
      department?: string;
      role?: 'co-host' | 'partner' | 'sponsor';
    }>>(),

    // AI auto-categorization fields
    autoCategories: jsonb('auto_categories').$type<{
      eventType?: string;
      eventSize?: string;
      specialNeeds?: string[];
      targetAudience?: string;
      confidence?: number;
      reasoning?: string;
      suggestedTags?: string[];
    }>(),
    categorizedAt: timestamp('categorized_at'),
    categorizedBy: varchar('categorized_by'), // 'ai' or user ID

    // Event details
    desiredEventDate: timestamp('desired_event_date'), // Date originally requested by organizer
    backupDates: jsonb('backup_dates').$type<string[]>(), // Array of backup/alternate dates in ISO format
    dateFlexible: boolean('date_flexible'), // Whether the organizer is flexible on the date (null = unknown, false = inflexible, true = flexible)
    scheduledEventDate: timestamp('scheduled_event_date'), // Actual scheduled date (may differ from requested)
    isConfirmed: boolean('is_confirmed').notNull().default(false), // Whether event is confirmed by our team (separate from status workflow)
    addedToOfficialSheet: boolean('added_to_official_sheet')
      .notNull()
      .default(false), // Whether scheduled event has been manually added to the official events Google Sheet (not synced)
    addedToOfficialSheetAt: timestamp('added_to_official_sheet_at'), // When the event was added to the official Google Sheet
    showOnVolunteerHub: boolean('show_on_volunteer_hub').notNull().default(false), // Whether this event is visible on the Volunteer Event Hub for volunteer signups
    message: text('message'), // Other relevant info about the group

    // Previous hosting experience
    previouslyHosted: varchar('previously_hosted')
      .notNull()
      .default('i_dont_know'), // 'yes', 'no', 'i_dont_know'

    // System tracking
    status: varchar('status').notNull().default('new'), // 'new', 'in_process', 'scheduled', 'rescheduled', 'completed', 'declined', 'cancelled', 'non_event', 'standby', 'stalled'
    statusChangedAt: timestamp('status_changed_at'), // When the status was last changed (used for follow-up badge logic)
    assignedTo: varchar('assigned_to'), // User ID of person handling this request
    nextAction: text('next_action'), // What needs to happen next for this event (intake tracking)
    nextActionUpdatedAt: timestamp('next_action_updated_at'), // When nextAction was last updated

    // Declined tracking (for 'declined' status)
    declinedReason: text('declined_reason'), // Reason why the request was declined or the organizer decided not to proceed
    declinedNotes: text('declined_notes'), // Additional notes about the decline
    declinedAt: timestamp('declined_at'), // When the event was declined
    declinedBy: varchar('declined_by'), // User ID who marked it as declined

    // Cancelled tracking (for 'cancelled' status - only from scheduled)
    cancelledReason: text('cancelled_reason'), // Reason why the scheduled event was cancelled
    cancelledNotes: text('cancelled_notes'), // Additional notes about the cancellation
    cancelledAt: timestamp('cancelled_at'), // When the event was cancelled
    cancelledBy: varchar('cancelled_by'), // User ID who marked it as cancelled

    // Postponement tracking (for 'postponed' status)
    postponementReason: text('postponement_reason'), // Reason why event was postponed
    tentativeNewDate: timestamp('tentative_new_date'), // Tentative new date for the event (optional)
    postponementNotes: text('postponement_notes'), // Free text notes describing the postponement situation
    originalScheduledDate: timestamp('original_scheduled_date'), // The original scheduled date before postponement (preserved for reference)
    postponedAt: timestamp('postponed_at'), // When the event was postponed
    postponedBy: varchar('postponed_by'), // User ID who marked it as postponed
    wasPostponed: boolean('was_postponed').default(false), // Flag indicating this event was previously postponed (stays true even after rescheduling)
    postponementCount: integer('postponement_count').default(0), // How many times this event has been postponed

    // Standby tracking (for 'standby' status - waiting on organizer who is working things out)
    standbyReason: text('standby_reason'), // Reason why we're on standby (e.g., "Waiting for budget approval")
    standbyExpectedDate: timestamp('standby_expected_date'), // When we expect to hear back from them
    standbyNotes: text('standby_notes'), // Notes about the standby situation
    standbyMarkedAt: timestamp('standby_marked_at'), // When the event was marked as standby
    standbyMarkedBy: varchar('standby_marked_by'), // User ID who marked it as standby

    // Stalled tracking (for 'stalled' status - no response after repeated outreach)
    stalledReason: text('stalled_reason'), // Reason why it's stalled (e.g., "No response after 3 attempts")
    stalledLastOutreachDate: timestamp('stalled_last_outreach_date'), // When we last reached out while stalled
    stalledNextOutreachDate: timestamp('stalled_next_outreach_date'), // When we should reach out again (quarterly)
    stalledOutreachCount: integer('stalled_outreach_count').default(0), // How many times we've reached out while stalled
    stalledNotes: text('stalled_notes'), // Notes about the stalled situation
    stalledMarkedAt: timestamp('stalled_marked_at'), // When the event was marked as stalled
    stalledMarkedBy: varchar('stalled_marked_by'), // User ID who marked it as stalled
    stalledOriginalEventDate: timestamp('stalled_original_event_date'), // Keep the original requested date on file for reference

    // Non-event tracking (for 'non_event' status)
    nonEventReason: text('non_event_reason'),
    nonEventNotes: text('non_event_notes'),
    nonEventAt: timestamp('non_event_at'),
    nonEventBy: varchar('non_event_by'),

    // Admin escalation tracking (for stale events with no contact in 2+ weeks)
    adminEscalationSentAt: timestamp('admin_escalation_sent_at'), // When the last escalation email was sent to admins

    // Follow-up tracking fields
    // NOTE: follow_up_method, updated_email were removed in migration 0024
    followUpDate: timestamp('follow_up_date'), // When follow-up was completed
    scheduledCallDate: timestamp('scheduled_call_date'), // When a follow-up call is scheduled

    // Contact completion details (collected when marking contacted)
    // NOTE: contacted_at, contact_completion_notes were removed in migration 0024
    communicationMethod: varchar('communication_method'), // 'phone', 'email', 'video_meeting'
    eventAddress: text('event_address'), // Event location address collected
    latitude: varchar('latitude'), // Geocoded latitude for map display
    longitude: varchar('longitude'), // Geocoded longitude for map display
    estimatedSandwichCount: integer('estimated_sandwich_count'), // Number of sandwiches planned
    estimatedSandwichCountMin: integer('estimated_sandwich_count_min'), // Minimum sandwiches in range (optional)
    estimatedSandwichCountMax: integer('estimated_sandwich_count_max'), // Maximum sandwiches in range (optional)
    estimatedSandwichRangeType: varchar('estimated_sandwich_range_type'), // Type for sandwich range (e.g., 'turkey', 'ham')
    volunteerCount: integer('volunteer_count'), // Number of attendees expected (general total, or can use adult/children breakdown)
    // @deprecated Use attendanceAdults instead - data migrated in migration 0025
    adultCount: integer('adult_count'),
    // @deprecated Use attendanceKids instead - data migrated in migration 0025
    childrenCount: integer('children_count'),
    hasRefrigeration: boolean('has_refrigeration'), // Whether site has refrigeration
    // NOTE: completed_by_user_id was removed in migration 0024

    // Advanced event planning fields (for scheduled/in_planning status)
    tspContactAssigned: varchar('tsp_contact_assigned'), // TSP team member assigned to this event
    tspContact: varchar('tsp_contact'), // Primary TSP contact for the event
    tspContactAssignedDate: timestamp('tsp_contact_assigned_date'), // When TSP contact was assigned
    additionalTspContacts: text('additional_tsp_contacts'), // Additional TSP contacts (legacy field)
    additionalContact1: varchar('additional_contact_1'), // Third TSP contact (user ID)
    additionalContact2: varchar('additional_contact_2'), // Fourth TSP contact (user ID)
    customTspContact: text('custom_tsp_contact'), // Custom TSP contact information
    toolkitSent: boolean('toolkit_sent').default(false), // Whether toolkit has been sent
    toolkitSentDate: timestamp('toolkit_sent_date'), // When toolkit was sent
    toolkitStatus: varchar('toolkit_status').default('not_sent'), // 'not_sent', 'sent', 'received_confirmed', 'not_needed'
    toolkitSentBy: varchar('toolkit_sent_by'), // User ID of who sent the toolkit

    // TSP-shopped events: TSP purchases the supplies for the group for a fee + admin/donation
    // (instead of the group shopping). Designation + tracking checklist + shopping plan.
    isTspShopped: boolean('is_tsp_shopped').default(false), // Marks this as a TSP-shopped event
    tspShopFeeAgreed: boolean('tsp_shop_fee_agreed').default(false), // Group notified of the fee and agreed
    tspShopEstimateProvided: boolean('tsp_shop_estimate_provided').default(false), // Group given a budget/estimate
    tspShopEstimateAmount: decimal('tsp_shop_estimate_amount', { precision: 10, scale: 2 }), // Estimated supplies + fee total
    tspShopPaid: boolean('tsp_shop_paid').default(false), // Group has paid TSP (supplies + fee)
    tspShopAmountPaid: decimal('tsp_shop_amount_paid', { precision: 10, scale: 2 }), // Amount the group actually paid
    tspShopPlanReady: boolean('tsp_shop_plan_ready').default(false), // TSP has a plan to shop the supplies
    tspShoppingPlan: text('tsp_shopping_plan'), // The shopping plan; shows on the card and flows to the planning sheet "All Details" column
    eventStartTime: varchar('event_start_time'), // Event start time (stored as string for flexibility)
    eventEndTime: varchar('event_end_time'), // Event end time
    pickupTime: varchar('pickup_time'), // Driver pickup time for sandwiches
    pickupDateTime: varchar('pickup_date_time'), // Full datetime for pickup time - stored as local datetime string (YYYY-MM-DDTHH:MM:SS) to avoid timezone conversion
    pickupTimeWindow: text('pickup_time_window'), // Time window for pickup (e.g., "2:00 PM - 3:00 PM")
    pickupPersonResponsible: text('pickup_person_responsible'), // Contact person who will pick up the sandwiches
    additionalRequirements: text('additional_requirements'), // Special requirements or notes
    planningNotes: text('planning_notes'), // General planning notes
    schedulingNotes: text('scheduling_notes'), // Scheduling notes and instructions
    howHeardAboutUs: varchar('how_heard_about_us'), // 'previous_event' | 'friend_family' | 'internet_search' | 'other' | null
    howHeardAboutUsNotes: text('how_heard_about_us_notes'), // Free-text notes for how-heard, esp. when 'other' is selected

    // Additional event details
    sandwichTypes: jsonb('sandwich_types'), // Array of {type: string, quantity: number} objects
    deliveryDestination: text('delivery_destination'), // Organization/host location where sandwiches will be delivered (final destination)
    overnightHoldingLocation: text('overnight_holding_location'), // Location where sandwiches will be stored overnight before final delivery
    overnightPickupTime: time('overnight_pickup_time'), // Time to pick up sandwiches from overnight location
    // Driver, speaker, and volunteer requirements
    driversNeeded: integer('drivers_needed').default(0), // How many drivers this event needs
    selfTransport: boolean('self_transport').default(false), // Organization is transporting sandwiches themselves (no TSP driver needed)
    speakersNeeded: integer('speakers_needed').default(0), // How many speakers this event needs
    volunteersNeeded: integer('volunteers_needed').default(0), // How many volunteers this event needs
    volunteerNotes: text('volunteer_notes'), // General notes about volunteer requirements

    // Driver, speaker, and volunteer assignments
    assignedDriverIds: text('assigned_driver_ids').array(), // Array of assigned driver IDs/names
    tentativeDriverIds: text('tentative_driver_ids').array(), // Array of driver IDs that are tentatively assigned (shown with ? badge)
    driverPickupTime: varchar('driver_pickup_time'), // Pickup time for drivers
    driverNotes: text('driver_notes'), // Notes for drivers
    driversArranged: boolean('drivers_arranged').default(false), // Whether drivers are confirmed
    assignedSpeakerIds: text('assigned_speaker_ids').array(), // Array of assigned speaker IDs/names
    tentativeSpeakerIds: text('tentative_speaker_ids').array(), // Array of speaker IDs that are tentatively assigned (shown with ? badge)
    // NOTE: assigned_driver_speakers was removed in migration 0024
    assignedVolunteerIds: text('assigned_volunteer_ids').array(), // Array of assigned volunteer IDs/names
    tentativeVolunteerIds: text('tentative_volunteer_ids').array(), // Array of volunteer IDs that are tentatively assigned (shown with ? badge)
    volunteerDetails: jsonb('volunteer_details'), // Additional volunteer assignment details (mirrors driverDetails/speakerDetails)
    assignedRecipientIds: text('assigned_recipient_ids').array(), // Array of assigned recipient IDs
    recipientAllocations: jsonb('recipient_allocations').$type<Array<{
      recipientId: string;
      recipientName: string; // Cached name for display
      sandwichCount: number;
      sandwichType?: string; // Optional type like 'pbj', 'deli', 'cheese', etc.
      notes?: string; // Optional notes for this allocation
    }>>(), // Detailed tracking of sandwich distribution to each recipient

    // Van driver assignment
    vanDriverNeeded: boolean('van_driver_needed').default(false), // Whether a van driver is required (confirmed)
    vanNeededLikely: boolean('van_needed_likely').notNull().default(false), // Soft flag set during in-process; user is told to confirm or clear when scheduling. When vanDriverNeeded becomes true, this is cleared.
    vanNeededFor: varchar('van_needed_for'), // 'transport' | 'refrigeration' | null — why the van is needed; only meaningful when vanDriverNeeded is true. Maps to planning-sheet column J.
    assignedVanDriverId: text('assigned_van_driver_id'), // Van driver ID from database
    customVanDriverName: text('custom_van_driver_name'), // Custom van driver name (text entry)
    vanDriverNotes: text('van_driver_notes'), // Special notes for van driver
    isDhlVan: boolean('is_dhl_van').notNull().default(false), // Flag when DHL is providing the van/driver

    // Follow-up tracking for completed events
    followUpOneDayCompleted: boolean('follow_up_one_day_completed').default(
      false
    ), // 1-day follow-up completed
    followUpOneDayDate: timestamp('follow_up_one_day_date'), // When 1-day follow-up was completed
    followUpOneMonthCompleted: boolean('follow_up_one_month_completed').default(
      false
    ), // 1-month follow-up completed
    followUpOneMonthDate: timestamp('follow_up_one_month_date'), // When 1-month follow-up was completed
    followUpNotes: text('follow_up_notes'), // Notes from follow-up communications

    // Social media post tracking for past events
    socialMediaPostRequested: boolean('social_media_post_requested').default(
      false
    ), // Whether we asked them to make a post tagging us
    socialMediaPostRequestedDate: timestamp('social_media_post_requested_date'), // When we asked for the post
    socialMediaPostCompleted: boolean('social_media_post_completed').default(
      false
    ), // Whether they completed the post
    socialMediaPostCompletedDate: timestamp('social_media_post_completed_date'), // When they completed the post
    socialMediaPostNotes: text('social_media_post_notes'), // Notes about social media posts
    socialMediaPostLink: text('social_media_post_link'), // Link to the published post (requires the 20260618 migration)

    // Event attendance tracking for completed events
    actualAttendance: integer('actual_attendance'), // Actual number of people who attended the event
    estimatedAttendance: integer('estimated_attendance'), // Estimated number of people expected to attend
    // Attendance breakdown by age group (for more detailed tracking)
    attendanceAdults: integer('attendance_adults'), // Number of adults who attended
    attendanceTeens: integer('attendance_teens'), // Number of teens who attended
    attendanceKids: integer('attendance_kids'), // Number of kids who attended
    kidsAgeRange: text('kids_age_range'), // Age range of kids participating (e.g., "5-12", "8-15")
    attendanceRecordedDate: timestamp('attendance_recorded_date'), // When attendance was recorded
    attendanceRecordedBy: varchar('attendance_recorded_by'), // User ID who recorded attendance
    attendanceNotes: text('attendance_notes'), // Notes about attendance

    // Actual sandwich count and distribution tracking for completed events
    actualSandwichCount: integer('actual_sandwich_count'), // Final count of sandwiches made
    actualSandwichTypes: jsonb('actual_sandwich_types'), // Array of {type: string, quantity: number} for actual sandwiches made
    actualSandwichCountRecordedDate: timestamp(
      'actual_sandwich_count_recorded_date'
    ), // When final count was recorded
    actualSandwichCountRecordedBy: varchar('actual_sandwich_count_recorded_by'), // User ID who recorded final count
    sandwichDistributions: jsonb('sandwich_distributions'), // Array of {destination: string, sandwichTypes: [{type: string, quantity: number}], totalCount: number} for distribution tracking
    distributionRecordedDate: timestamp('distribution_recorded_date'), // When distribution was recorded
    distributionRecordedBy: varchar('distribution_recorded_by'), // User ID who recorded distribution
    distributionNotes: text('distribution_notes'), // Notes about sandwich distribution

    // Duplicate detection flags
    organizationExists: boolean('organization_exists').notNull().default(false), // Flag if we found a match in our database
    duplicateCheckDate: timestamp('duplicate_check_date'), // When we last checked for duplicates
    duplicateNotes: text('duplicate_notes'), // Notes about potential matches

    // Unresponsive contact tracking
    contactAttempts: integer('contact_attempts').default(0), // Number of contact attempts made
    lastContactAttempt: timestamp('last_contact_attempt'), // When we last tried to contact them
    isUnresponsive: boolean('is_unresponsive').default(false), // Flag indicating they're not responding
    markedUnresponsiveAt: timestamp('marked_unresponsive_at'), // When marked as unresponsive
    markedUnresponsiveBy: varchar('marked_unresponsive_by'), // User ID who marked as unresponsive
    // NOTE: unresponsive_reason was removed in migration 0024
    contactMethod: varchar('contact_method'), // 'phone', 'email', 'both' - preferred contact method
    nextFollowUpDate: timestamp('next_follow_up_date'), // Scheduled next attempt date
    unresponsiveNotes: text('unresponsive_notes'), // Detailed notes about unresponsive status (legacy - use contactAttemptsLog for new entries)
    contactAttemptsLog: jsonb('contact_attempts_log').$type<Array<{
      attemptNumber: number;
      timestamp: string;
      method: string;
      outcome: string;
      notes?: string;
      createdBy: string;
      createdByName?: string;
    }>>(), // Structured log of all contact attempts with metadata for editing/deleting

    // Past date notification tracking for in-process events
    pastDateNotificationSentAt: timestamp('past_date_notification_sent_at'), // When TSP contact was notified about passed event date

    // Manual entry tracking
    manualEntrySource: varchar('manual_entry_source'), // Where this manual request came from: 'phone_call', 'text_message', 'email', 'social_media', 'in_person', 'referral', 'other'

    // Google Sheets sync tracking
    googleSheetRowId: text('google_sheet_row_id'), // Stable identifier: Google Sheets row number for duplicate detection
    externalId: varchar('external_id').notNull().unique(), // External ID from Google Sheets for duplicate prevention
    lastSyncedAt: timestamp('last_synced_at'), // When this record was last synced with Google Sheets
    driverDetails: jsonb('driver_details'), // Additional driver assignment details

    // Pre-event critical flags (time-sensitive issues that need attention before event)
    preEventFlags: jsonb('pre_event_flags').$type<Array<{
      id: string;
      type: 'critical' | 'important' | 'attention';
      message: string;
      createdAt: string;
      createdBy: string;
      createdByName: string;
      resolvedAt: string | null;
      resolvedBy: string | null;
      resolvedByName: string | null;
      dueDate: string | null;
    }>>().default('[]'), // Critical flags that need resolution before event
    speakerDetails: jsonb('speaker_details'), // Additional speaker assignment details
    speakerAudienceType: text('speaker_audience_type'), // Type of audience for speaker (e.g., "Elementary School", "Adults", "Mixed")
    speakerDuration: text('speaker_duration'), // Duration of speaker session (e.g., "30 minutes", "1 hour")
    deliveryTimeWindow: text('delivery_time_window'), // Time window for next-day delivery after overnight storage
    deliveryParkingAccess: text('delivery_parking_access'), // Parking/access details for delivery location

    // Special event tracking
    isMlkDayEvent: boolean('is_mlk_day_event').default(false), // Whether this event is designated as an MLK Day event
    mlkDayMarkedAt: timestamp('mlk_day_marked_at'), // When it was marked as MLK Day event
    mlkDayMarkedBy: varchar('mlk_day_marked_by'), // User ID who marked it as MLK Day event

    // Corporate priority tracking - manually assigned, triggers strict follow-up protocol
    isCorporatePriority: boolean('is_corporate_priority').default(false), // Whether this is a corporate priority event requiring immediate attention
    corporatePriorityMarkedAt: timestamp('corporate_priority_marked_at'), // When it was marked as corporate priority
    corporatePriorityMarkedBy: varchar('corporate_priority_marked_by'), // User ID who marked it as corporate priority
    requiresCoreTeamMember: boolean('requires_core_team_member').default(false), // Whether a core team member should attend (auto-set for corporate)
    coreTeamMemberNotes: text('core_team_member_notes'), // Notes about core team member assignment for relationship building

    // Corporate follow-up protocol tracking - strict protocol for corporate events
    corporateFollowUpProtocol: jsonb('corporate_follow_up_protocol').$type<{
      status: 'not_started' | 'active' | 'completed' | 'stalled'; // Current protocol status
      protocolStartedAt: string | null; // When TSP contact was assigned (protocol begins)
      protocolStartedBy: string | null; // User ID who started the protocol

      // Day 1 actions (required immediately when TSP contact assigned)
      initialCallMade: boolean;
      initialCallAt: string | null; // Timestamp
      initialCallBy: string | null; // User ID
      initialCallOutcome: 'answered' | 'voicemail' | 'no_answer' | null;

      voicemailLeft: boolean;
      voicemailLeftAt: string | null;

      toolkitEmailSent: boolean;
      toolkitEmailSentAt: string | null;
      toolkitEmailSentBy: string | null;

      // Day 2+ actions (if no response)
      day2CallMade: boolean;
      day2CallAt: string | null;
      day2CallBy: string | null;
      day2CallOutcome: 'answered' | 'voicemail' | 'no_answer' | null;

      day2TextSent: boolean;
      day2TextSentAt: string | null;
      day2TextSentBy: string | null;

      // Ongoing tracking
      lastReminderSentAt: string | null; // Last reminder sent to TSP contact
      reminderCount: number; // How many reminders have been sent

      // Resolution
      successfulContactAt: string | null; // When we got through to them
      successfulContactBy: string | null;
      finalOutcome: 'yes' | 'no' | 'standby' | null; // Their response
      finalOutcomeNotes: string | null;
    }>().default('{"status": "not_started", "initialCallMade": false, "voicemailLeft": false, "toolkitEmailSent": false, "day2CallMade": false, "day2TextSent": false, "reminderCount": 0}'),

    // Event instructions for volunteers (included in automated alerts)
    driverInstructions: text('driver_instructions'), // Special instructions for drivers (included in reminder texts/emails)
    volunteerInstructions: text('volunteer_instructions'), // Special instructions for general volunteers
    speakerInstructions: text('speaker_instructions'), // Special instructions for speakers
    instructionsLastUpdatedAt: timestamp('instructions_last_updated_at'), // When instructions were last modified
    instructionsLastUpdatedBy: varchar('instructions_last_updated_by'), // User ID who last updated instructions

    // Audit tracking
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    createdBy: varchar('created_by'), // User ID who created this record (if manually entered)

    // Soft delete tracking
    deletedAt: timestamp('deleted_at'), // When this record was soft-deleted
    deletedBy: varchar('deleted_by'), // User ID who deleted this record

    // Optimistic concurrency control for real-time collaboration
    version: integer('version').notNull().default(1), // Incremented on each update for conflict detection
  },
  (table) => ({
    orgNameIdx: index('idx_event_requests_org_name').on(table.organizationName),
    statusIdx: index('idx_event_requests_status').on(table.status),
    emailIdx: index('idx_event_requests_email').on(table.email),
    desiredDateIdx: index('idx_event_requests_desired_date').on(
      table.desiredEventDate
    ),
    createdAtIdx: index('idx_event_requests_created_at').on(table.createdAt),
    scheduledDateIdx: index('idx_event_requests_scheduled_date').on(table.scheduledEventDate),
  })
);

// Organization tracking for duplicate detection
export const organizations = pgTable(
  'organizations',
  {
    id: serial('id').primaryKey(),
    name: varchar('name').notNull(),
    department: varchar('department'), // Department within organization (e.g., "4th & 5th Graders")
    alternateNames: text('alternate_names').array(), // Array of variations/aliases
    addresses: text('addresses').array(), // Array of known addresses
    domains: text('domains').array(), // Array of email domains associated with this org

    // Organization categorization
    category: varchar('category'), // 'corp', 'small_medium_corp', 'large_corp', 'church_faith', 'religious', 'nonprofit', 'government', 'hospital', 'political', 'school', 'neighborhood', 'club', 'greek_life', 'cultural', 'other'
    schoolClassification: varchar('school_classification'), // 'public', 'private', 'charter' (only when category is 'school')
    isReligious: boolean('is_religious').default(false), // Whether the organization has religious affiliation (can be true for schools, churches, etc.)

    // Event history
    totalEvents: integer('total_events').notNull().default(0),
    lastEventDate: timestamp('last_event_date'),

    // Tracking
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    nameIdx: index('idx_organizations_name').on(table.name),
  })
);

// Imported external IDs tracking table for permanent blacklist system
// Prevents re-importing external_ids that have ever been imported, even if the original record is deleted
export const importedExternalIds = pgTable(
  'imported_external_ids',
  {
    id: serial('id').primaryKey(),
    externalId: varchar('external_id').notNull().unique(), // External ID from Google Sheets or other sources
    importedAt: timestamp('imported_at').defaultNow().notNull(), // When this external_id was first imported
    sourceTable: varchar('source_table').notNull().default('event_requests'), // Which table the external_id was imported to
    notes: text('notes'), // Optional notes about the import
  },
  (table) => ({
    externalIdIdx: index('idx_imported_external_ids_external_id').on(
      table.externalId
    ),
    sourceTableIdx: index('idx_imported_external_ids_source_table').on(
      table.sourceTable
    ),
    importedAtIdx: index('idx_imported_external_ids_imported_at').on(
      table.importedAt
    ),
  })
);

// Event volunteers table for managing volunteer assignments to events
export const eventVolunteers = pgTable(
  'event_volunteers',
  {
    id: serial('id').primaryKey(),
    eventRequestId: integer('event_request_id').notNull(), // Reference to event_requests.id
    volunteerUserId: varchar('volunteer_user_id'), // Reference to users.id for registered users
    volunteerName: varchar('volunteer_name'), // Name for non-registered volunteers
    volunteerEmail: varchar('volunteer_email'), // Email for non-registered volunteers
    volunteerPhone: varchar('volunteer_phone'), // Phone for non-registered volunteers
    role: varchar('role').notNull(), // 'driver', 'speaker', 'general'
    status: varchar('status').notNull().default('pending'), // 'pending', 'confirmed', 'declined', 'assigned'
    notes: text('notes'), // Special notes or requirements
    assignedBy: varchar('assigned_by'), // User ID who assigned this volunteer
    signedUpAt: timestamp('signed_up_at').defaultNow().notNull(),
    confirmedAt: timestamp('confirmed_at'),
    reminderSentAt: timestamp('reminder_sent_at'), // When email reminder was sent (legacy/first reminder)
    emailReminder1SentAt: timestamp('email_reminder_1_sent_at'), // First email reminder
    emailReminder2SentAt: timestamp('email_reminder_2_sent_at'), // Second email reminder
    smsReminder1SentAt: timestamp('sms_reminder_1_sent_at'), // First SMS reminder
    smsReminder2SentAt: timestamp('sms_reminder_2_sent_at'), // Second SMS reminder
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    eventIdIdx: index('idx_event_volunteers_event_id').on(table.eventRequestId),
    volunteerIdx: index('idx_event_volunteers_volunteer').on(
      table.volunteerUserId
    ),
    roleStatusIdx: index('idx_event_volunteers_role_status').on(
      table.role,
      table.status
    ),
  })
);

// Event-level negative RSVPs so coordinators know not to re-ask someone who
// already said they cannot help with a specific Volunteer Hub event.
export const eventVolunteerDeclines = pgTable(
  'event_volunteer_declines',
  {
    id: serial('id').primaryKey(),
    eventRequestId: integer('event_request_id').notNull(),
    volunteerUserId: varchar('volunteer_user_id').notNull(),
    volunteerName: varchar('volunteer_name'),
    volunteerEmail: varchar('volunteer_email'),
    volunteerPhone: varchar('volunteer_phone'),
    notes: text('notes'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    eventIdIdx: index('idx_event_volunteer_declines_event_id').on(table.eventRequestId),
    volunteerIdx: index('idx_event_volunteer_declines_volunteer').on(table.volunteerUserId),
    eventVolunteerUnique: uniqueIndex('idx_event_volunteer_declines_event_user_unique').on(
      table.eventRequestId,
      table.volunteerUserId
    ),
  })
);

// Event reminders table for tracking follow-ups and to-dos related to events
export const eventReminders = pgTable(
  'event_reminders',
  {
    id: serial('id').primaryKey(),
    eventRequestId: integer('event_request_id').notNull(), // Reference to event_requests.id
    title: varchar('title').notNull(), // Brief description of the reminder
    description: text('description'), // Detailed notes about what needs to be done
    reminderType: varchar('reminder_type').notNull(), // 'follow_up', 'toolkit_send', 'post_event', 'postponed_followup', 'custom'
    dueDate: timestamp('due_date').notNull(), // When this reminder should trigger
    assignedToUserId: varchar('assigned_to_user_id'), // User ID responsible for this task
    assignedToName: varchar('assigned_to_name'), // Name of assigned person
    status: varchar('status').notNull().default('pending'), // 'pending', 'in_progress', 'completed', 'cancelled'
    priority: varchar('priority').notNull().default('medium'), // 'low', 'medium', 'high', 'urgent'
    completedAt: timestamp('completed_at'),
    completedBy: varchar('completed_by'), // User ID who completed the task
    completionNotes: text('completion_notes'), // Notes about completion
    createdBy: varchar('created_by').notNull(), // User ID who created this reminder
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    eventIdIdx: index('idx_event_reminders_event_id').on(table.eventRequestId),
    dueDateIdx: index('idx_event_reminders_due_date').on(table.dueDate),
    statusIdx: index('idx_event_reminders_status').on(table.status),
    assignedIdx: index('idx_event_reminders_assigned').on(
      table.assignedToUserId
    ),
    typeStatusIdx: index('idx_event_reminders_type_status').on(
      table.reminderType,
      table.status
    ),
  })
);

// Per-event reminder rules (user-controlled, multiple rule types per event)
// Rule types:
//   'no_contact'       - No contact attempt logged in X days (in-process events)
//   'stale_event'      - No updates on event for X days (in-process events)
//   'date_approaching_inprocess' - Desired date nearing while still in-process
//   'date_approaching_scheduled' - Scheduled event date approaching (X days before)
//   'staffing_unmet'   - Unmet staffing needs X days before scheduled event
//   'general_checkin'  - General periodic check-in (legacy, backward-compatible)
export const eventCheckInReminders = pgTable(
  'event_check_in_reminders',
  {
    id: serial('id').primaryKey(),
    eventRequestId: integer('event_request_id').notNull(),
    userId: varchar('user_id').notNull(), // TSP contact who set and receives the reminder
    ruleType: varchar('rule_type').notNull().default('general_checkin'), // Type of reminder rule
    enabled: boolean('enabled').notNull().default(true),
    thresholdDays: integer('threshold_days').default(7), // Days threshold for condition (e.g., "no contact in X days", "X days before event")
    frequency: varchar('frequency').notNull().default('weekly'), // 'daily', 'every_3_days', 'weekly', 'biweekly' (how often to re-check/re-notify)
    channel: varchar('channel').notNull().default('email'), // 'email', 'sms', 'both'
    lastSentAt: timestamp('last_sent_at'), // When the last reminder was sent
    nextDueAt: timestamp('next_due_at'), // Pre-calculated next send time
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    eventUserRuleIdx: uniqueIndex('idx_checkin_reminders_event_user_rule').on(
      table.eventRequestId,
      table.userId,
      table.ruleType
    ),
    nextDueIdx: index('idx_checkin_reminders_next_due').on(table.nextDueAt),
    enabledIdx: index('idx_checkin_reminders_enabled').on(table.enabled),
    ruleTypeIdx: index('idx_checkin_reminders_rule_type').on(table.ruleType),
  })
);

export const insertEventCheckInReminderSchema = createInsertSchema(eventCheckInReminders).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  lastSentAt: true,
});
export type EventCheckInReminder = typeof eventCheckInReminders.$inferSelect;
export type InsertEventCheckInReminder = z.infer<typeof insertEventCheckInReminderSchema>;

// Valid reminder rule types
export const REMINDER_RULE_TYPES = {
  NO_CONTACT: 'no_contact',
  STALE_EVENT: 'stale_event',
  DATE_APPROACHING_INPROCESS: 'date_approaching_inprocess',
  DATE_APPROACHING_SCHEDULED: 'date_approaching_scheduled',
  STAFFING_UNMET: 'staffing_unmet',
  MISSING_DETAILS: 'missing_details',
  GENERAL_CHECKIN: 'general_checkin',
} as const;

export type ReminderRuleType = typeof REMINDER_RULE_TYPES[keyof typeof REMINDER_RULE_TYPES];

// Event reminder snooze / pause state
// When a snooze is active, ALL check-in reminders for that event+user are suppressed.
// Snooze types:
//   'timed'         — paused for a set number of days from now
//   'until_date'    — paused until a specific calendar date
//   'until_contact' — paused until a new contact is logged on the event
export const eventReminderSnoozes = pgTable(
  'event_reminder_snoozes',
  {
    id: serial('id').primaryKey(),
    eventRequestId: integer('event_request_id').notNull(),
    userId: varchar('user_id').notNull(),
    snoozeType: varchar('snooze_type').notNull(), // 'timed', 'until_date', 'until_contact'
    snoozedUntil: timestamp('snoozed_until'), // null for 'until_contact' (open-ended)
    reason: text('reason'), // optional note ("waiting for org to respond", etc.)
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    cancelledAt: timestamp('cancelled_at'), // when snooze was manually cancelled or auto-cleared
  },
  (table) => ({
    // Only one *active* snooze per event+user at a time.
    // Inactive (cancelled/expired) rows are kept as history and are not constrained.
    activeEventUserIdx: uniqueIndex('idx_reminder_snoozes_active_event_user')
      .on(table.eventRequestId, table.userId)
      .where(sql`active = true`),
    activeIdx: index('idx_reminder_snoozes_active').on(table.active),
  }),
);

export type EventReminderSnooze = typeof eventReminderSnoozes.$inferSelect;

// Event collaboration comments table for team discussion on event planning
export const eventCollaborationComments = pgTable(
  'event_collaboration_comments',
  {
    id: serial('id').primaryKey(),
    eventRequestId: integer('event_request_id').notNull().references(() => eventRequests.id, { onDelete: 'cascade' }),
    userId: varchar('user_id').notNull().references(() => users.id),
    userName: varchar('user_name').notNull(),
    content: text('content').notNull(),
    parentCommentId: integer('parent_comment_id'), // For threaded replies
    editedAt: timestamp('edited_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    eventIdIdx: index('idx_event_collab_comments_event_id').on(table.eventRequestId),
    userIdIdx: index('idx_event_collab_comments_user_id').on(table.userId),
    createdAtIdx: index('idx_event_collab_comments_created_at').on(table.createdAt),
  })
);

// Post-event notes — retrospective notes attached to completed events.
// Distinct from collaboration comments (which support replies/likes/intake collab).
export const eventPostEventNotes = pgTable(
  'event_post_event_notes',
  {
    id: serial('id').primaryKey(),
    eventRequestId: integer('event_request_id').notNull().references(() => eventRequests.id, { onDelete: 'cascade' }),
    userId: varchar('user_id').notNull().references(() => users.id),
    userName: varchar('user_name').notNull(),
    content: text('content').notNull(),
    editedAt: timestamp('edited_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    eventIdIdx: index('idx_post_event_notes_event_id').on(table.eventRequestId),
    userIdIdx: index('idx_post_event_notes_user_id').on(table.userId),
    createdAtIdx: index('idx_post_event_notes_created_at').on(table.createdAt),
  })
);

// Event collaboration comment likes table
export const eventCollaborationCommentLikes = pgTable(
  'event_collaboration_comment_likes',
  {
    id: serial('id').primaryKey(),
    commentId: integer('comment_id').notNull().references(() => eventCollaborationComments.id, { onDelete: 'cascade' }),
    userId: varchar('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    // Unique constraint: one like per user per comment
    userCommentIdx: unique().on(table.commentId, table.userId),
    commentIdIdx: index('idx_comment_likes_comment_id').on(table.commentId),
    userIdIdx: index('idx_comment_likes_user_id').on(table.userId),
  })
);

// Event field locks table for preventing edit conflicts
export const eventFieldLocks = pgTable(
  'event_field_locks',
  {
    id: serial('id').primaryKey(),
    eventRequestId: integer('event_request_id').notNull().references(() => eventRequests.id, { onDelete: 'cascade' }),
    fieldName: varchar('field_name').notNull(), // Name of the field being edited
    lockedBy: varchar('locked_by').notNull().references(() => users.id),
    lockedByName: varchar('locked_by_name').notNull(),
    lockedAt: timestamp('locked_at').defaultNow().notNull(),
    expiresAt: timestamp('expires_at').notNull(), // Auto-expire locks after 5 minutes
  },
  (table) => ({
    eventFieldIdx: unique().on(table.eventRequestId, table.fieldName), // One lock per field per event
    eventIdIdx: index('idx_event_field_locks_event_id').on(table.eventRequestId),
    expiresAtIdx: index('idx_event_field_locks_expires_at').on(table.expiresAt),
  })
);

// Event edit revisions table for tracking change history
export const eventEditRevisions = pgTable(
  'event_edit_revisions',
  {
    id: serial('id').primaryKey(),
    eventRequestId: integer('event_request_id').notNull().references(() => eventRequests.id, { onDelete: 'cascade' }),
    fieldName: varchar('field_name').notNull(), // Name of the field changed
    oldValue: text('old_value'), // Previous value (JSON-stringified for complex types)
    newValue: text('new_value'), // New value (JSON-stringified for complex types)
    changedBy: varchar('changed_by').notNull().references(() => users.id),
    changedByName: varchar('changed_by_name').notNull(),
    changeType: varchar('change_type').notNull(), // 'create', 'update', 'delete'
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    eventIdIdx: index('idx_event_edit_revisions_event_id').on(table.eventRequestId),
    fieldNameIdx: index('idx_event_edit_revisions_field_name').on(table.fieldName),
    createdAtIdx: index('idx_event_edit_revisions_created_at').on(table.createdAt),
  })
);

export const insertEventRequestSchema = createInsertSchema(eventRequests)
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
    duplicateCheckDate: true,
  })
  .extend({
    // Make core required fields optional and nullable for creation
    firstName: z.string().nullable().optional(),
    lastName: z.string().nullable().optional(),
    email: z
      .union([z.string(), z.null(), z.undefined()])
      // Trim first: a pasted address with leading/trailing whitespace (or a
      // stray newline) is the most common reason a manual event silently fails
      // to save. Empty/whitespace-only becomes undefined so the field is simply
      // omitted, matching the previous behavior.
      .transform((val) => {
        const trimmed = typeof val === 'string' ? val.trim() : '';
        return trimmed.length > 0 ? trimmed : undefined;
      })
      // Only enforce email format when a value is actually present, with a clear
      // message (the create endpoint surfaces this to the user).
      .refine(
        (val) => val === undefined || z.string().email().safeParse(val).success,
        { message: 'Please enter a valid email address (e.g., name@example.com).' }
      )
      .optional(),
    phone: z
      .union([z.string(), z.null(), z.undefined()])
      .transform((val) => {
        const trimmed = typeof val === 'string' ? val.trim() : '';
        return trimmed.length > 0 ? trimmed : undefined;
      })
      .optional(),
    backupContactEmail: z
      .union([z.string(), z.null(), z.undefined()])
      .transform((val) => {
        const trimmed = typeof val === 'string' ? val.trim() : '';
        return trimmed.length > 0 ? trimmed : undefined;
      })
      .refine(
        (val) => val === undefined || z.string().email().safeParse(val).success,
        { message: 'Please enter a valid backup contact email address.' }
      )
      .optional(),
    backupContactPhone: z
      .union([z.string(), z.null(), z.undefined()])
      .transform((val) => {
        const trimmed = typeof val === 'string' ? val.trim() : '';
        return trimmed.length > 0 ? trimmed : undefined;
      })
      .optional(),
    organizationName: z.string().nullable().optional(),
    manualEntrySource: z.string().nullable().optional(),
    previouslyHosted: z.string().optional(),
    status: z.string().optional(),
    // Allow desiredEventDate to be either a Date object or a string that can be converted to a Date
    desiredEventDate: z
      .union([
        z.date(),
        z.string().transform((str) => (str ? new Date(str) : null)),
        z.null(),
      ])
      .optional(),
    // Allow scheduledEventDate to be either a Date object or a string that can be converted to a Date
    scheduledEventDate: z
      .union([
        z.date(),
        z.string().transform((str) => (str ? new Date(str) : null)),
        z.null(),
      ])
      .optional(),
    // Allow toolkitSentDate to be either a Date object or a string that can be converted to a Date
    toolkitSentDate: z
      .union([
        z.date(),
        z.string().transform((str) => {
          if (!str || str === '') return null;
          try {
            // Handle YYYY-MM-DD format from HTML5 date inputs
            // IMPORTANT: Do NOT use 'Z' suffix - it causes dates to shift by one day!
            if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
              return new Date(str + 'T12:00:00');
            }
            return new Date(str);
          } catch (e) {
            return null;
          }
        }),
        z.null(),
        z.literal(''),
      ])
      .nullable()
      .optional(),
    // Make all the new event planning fields optional and nullable
    eventStartTime: z.string().nullable().optional(),
    eventEndTime: z.string().nullable().optional(),
    pickupTime: z.string().nullable().optional(),
    pickupDateTime: z.string().nullable().optional(), // Stored as local datetime string to avoid timezone conversion
    customTspContact: z.string().nullable().optional(),
    additionalContact1: z.string().nullable().optional(),
    additionalContact2: z.string().nullable().optional(),
    planningNotes: z.string().nullable().optional(),
    schedulingNotes: z.string().nullable().optional(),
    eventAddress: z.string().nullable().optional(),
    deliveryDestination: z.string().nullable().optional(),
    overnightHoldingLocation: z.string().nullable().optional(),
    overnightPickupTime: z.string().nullable().optional(),
    estimatedSandwichCount: z.number().nullable().optional(),
    estimatedSandwichCountMin: z.number().nullable().optional(),
    estimatedSandwichCountMax: z.number().nullable().optional(),
    estimatedSandwichRangeType: z.string().nullable().optional(),
    // Attendance tracking fields
    actualAttendance: z.number().nullable().optional(),
    estimatedAttendance: z.number().nullable().optional(),
    attendanceAdults: z.number().nullable().optional(),
    attendanceTeens: z.number().nullable().optional(),
    attendanceKids: z.number().nullable().optional(),
    attendanceNotes: z.string().nullable().optional(),
    driversArranged: z.boolean().nullable().optional(),
    selfTransport: z.boolean().nullable().optional(), // Organization transporting sandwiches themselves
    vanNeededFor: z
      .union([
        z.enum(['transport', 'refrigeration']),
        z.literal('').transform(() => null),
        z.null(),
      ])
      .nullable()
      .optional(),
    driverDetails: z.any().nullable().optional(), // JSONB field
    speakerDetails: z.any().nullable().optional(), // JSONB field
    volunteerDetails: z.any().nullable().optional(), // JSONB field
    // Follow-up tracking fields
    scheduledCallDate: z
      .union([
        z.date(),
        z
          .string()
          .trim()
          .transform((str) => {
            // Handle empty strings immediately
            if (!str) return null;

            // Validate non-empty strings with regex
            if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) {
              throw new Error('Invalid date format, expected YYYY-MM-DD');
            }

            const date = new Date(str);
            return isNaN(date.getTime()) ? null : date;
          }),
        z.null(),
      ])
      .nullable()
      .optional(),
    // Optional next-follow-up date (suppresses follow-up nagging for long-lead events)
    nextFollowUpDate: z
      .union([
        z.date(),
        z
          .string()
          .trim()
          .transform((str) => {
            if (!str) return null;
            if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) {
              throw new Error('Invalid date format, expected YYYY-MM-DD');
            }
            // Parse at local noon (NOT bare `new Date(str)`, which is midnight UTC
            // and renders/compares a day early in America/New_York). Mirrors the
            // toolkitSentDate coercion above.
            const date = new Date(str + 'T12:00:00');
            return isNaN(date.getTime()) ? null : date;
          }),
        z.null(),
      ])
      .nullable()
      .optional(),
    // TSP-shopped event fields
    isTspShopped: z.boolean().nullable().optional(),
    tspShopFeeAgreed: z.boolean().nullable().optional(),
    tspShopEstimateProvided: z.boolean().nullable().optional(),
    tspShopEstimateAmount: z.union([z.string(), z.number(), z.null()]).optional(),
    tspShopPaid: z.boolean().nullable().optional(),
    tspShopAmountPaid: z.union([z.string(), z.number(), z.null()]).optional(),
    tspShopPlanReady: z.boolean().nullable().optional(),
    tspShoppingPlan: z.string().nullable().optional(),
    followUpOneDayCompleted: z.boolean().nullable().optional(),
    followUpOneDayDate: z
      .union([
        z.date(),
        z
          .string()
          .trim()
          .transform((str) => {
            // Handle empty strings immediately
            if (!str) return null;

            // Validate non-empty strings with regex
            if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) {
              throw new Error('Invalid date format, expected YYYY-MM-DD');
            }

            const date = new Date(str);
            return isNaN(date.getTime()) ? null : date;
          }),
        z.null(),
      ])
      .nullable()
      .optional(),
    followUpOneMonthCompleted: z.boolean().nullable().optional(),
    followUpOneMonthDate: z
      .union([
        z.date(),
        z
          .string()
          .trim()
          .transform((str) => {
            // Handle empty strings immediately
            if (!str) return null;

            // Validate non-empty strings with regex
            if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) {
              throw new Error('Invalid date format, expected YYYY-MM-DD');
            }

            const date = new Date(str);
            return isNaN(date.getTime()) ? null : date;
          }),
        z.null(),
      ])
      .nullable()
      .optional(),
    followUpNotes: z.string().nullable().optional(),
    // Postponement tracking fields
    postponementReason: z.string().nullable().optional(),
    tentativeNewDate: z
      .union([
        z.date(),
        z
          .string()
          .trim()
          .transform((str) => {
            if (!str) return null;
            if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) {
              throw new Error('Invalid date format, expected YYYY-MM-DD');
            }
            const date = new Date(str);
            return isNaN(date.getTime()) ? null : date;
          }),
        z.null(),
      ])
      .nullable()
      .optional(),
    postponementNotes: z.string().nullable().optional(),
    // Fix type conversion issues for manual creation
    sandwichTypes: z
      .union([
        z.array(
          z.object({
            type: z.string(),
            quantity: z.number().min(0),
          })
        ),
        z.string().transform((str) => {
          if (!str || str.trim() === '') return null;
          try {
            return JSON.parse(str);
          } catch {
            return null;
          }
        }),
        z.null(),
      ])
      .nullable()
      .optional(),
    speakersNeeded: z
      .union([
        z.number(),
        z.string().transform((str) => {
          const num = parseInt(str, 10);
          return isNaN(num) ? 0 : num;
        }),
        z.null(),
      ])
      .optional(),
  });
// NOTE: No "must have at least one identifier" refine. Manual entries are
// intentionally allowed to be created fully blank (no org name, contact name,
// email, or phone) and filled in later as intake details come in. Email format
// is still validated when an email IS provided (see the `email` field above).

export const insertEventReminderSchema = createInsertSchema(eventReminders)
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    dueDate: z.union([
      z.date(),
      z.string().transform((str) => (str && str !== '' ? new Date(str) : new Date())),
    ]),
  });

export type InsertEventReminder = z.infer<typeof insertEventReminderSchema>;
export type EventReminder = typeof eventReminders.$inferSelect;

// Event collaboration comment schema types
export const insertEventCollaborationCommentSchema = createInsertSchema(eventCollaborationComments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  editedAt: true,
});

export type EventCollaborationComment = typeof eventCollaborationComments.$inferSelect;
export type InsertEventCollaborationComment = z.infer<typeof insertEventCollaborationCommentSchema>;

// Post-event note schema types
export const insertEventPostEventNoteSchema = createInsertSchema(eventPostEventNotes).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  editedAt: true,
});

export type EventPostEventNote = typeof eventPostEventNotes.$inferSelect;
export type InsertEventPostEventNote = z.infer<typeof insertEventPostEventNoteSchema>;

// Event collaboration comment like schema types
export const insertEventCollaborationCommentLikeSchema = createInsertSchema(eventCollaborationCommentLikes).omit({
  id: true,
  createdAt: true,
});

export type EventCollaborationCommentLike = typeof eventCollaborationCommentLikes.$inferSelect;
export type InsertEventCollaborationCommentLike = z.infer<typeof insertEventCollaborationCommentLikeSchema>;

// Event field lock schema types
export const insertEventFieldLockSchema = createInsertSchema(eventFieldLocks).omit({
  id: true,
  lockedAt: true,
});

export type EventFieldLock = typeof eventFieldLocks.$inferSelect;
export type InsertEventFieldLock = z.infer<typeof insertEventFieldLockSchema>;

// Event edit revision schema types
export const insertEventEditRevisionSchema = createInsertSchema(eventEditRevisions).omit({
  id: true,
  createdAt: true,
});

export type EventEditRevision = typeof eventEditRevisions.$inferSelect;
export type InsertEventEditRevision = z.infer<typeof insertEventEditRevisionSchema>;

export const insertOrganizationSchema = createInsertSchema(organizations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type EventRequest = typeof eventRequests.$inferSelect & {
  hasHostedBefore?: boolean;
};
export type InsertEventRequest = z.infer<typeof insertEventRequestSchema>;
export type Organization = typeof organizations.$inferSelect;
export type InsertOrganization = z.infer<typeof insertOrganizationSchema>;

// Google Sheets Import Schema - for receiving event data from Google Sheets export
export const importFromSheetsSchema = z.object({
  // Event date (required)
  date: z.string().min(1, 'Event date is required'),

  // Organization info
  'Day of Week': z.string().optional(),
  'Group Name': z.string().min(1, 'Organization name is required'),

  // Event timing
  'Event Start time (MUST when volunteer needed)': z.string().optional(),
  'Event end time (MUST when volunteer needed)': z.string().optional(),
  'Pick up time': z.string().optional(),

  // Event details
  'ALL DETAILS': z.string().optional(),
  'Social Post': z.string().optional(),
  'Staffing': z.string().optional(),

  // Sandwich info
  'Estimate # sandwiches': z.union([z.string(), z.number()]).optional(),
  'Deli or PBJ?': z.string().optional(),
  'Final # sandwiches made': z.union([z.string(), z.number()]).optional(),

  // Toolkit
  'Sent toolkit': z.string().optional(),

  // Contact info
  'Contact Name': z.string().optional(),
  'Email Address': z.string().optional(),
  'Contact Cell Number': z.union([z.string(), z.number()]).optional().transform(val => val != null ? String(val) : undefined),

  // TSP and logistics
  'TSP Contact': z.string().optional(),
  'Address': z.string().optional(),
  'Van Booked?': z.string().optional(),
  'Van needed for?': z.string().optional(),

  // Notes
  'Notes': z.string().optional(),
  "Add'l Notes": z.string().optional(),
  'Waiting On': z.string().optional(),

  // Recipient/destination
  'Planned Recipient/Host Home': z.string().optional(),

  // Status
  'Cancelled': z.string().optional(),
});

export type ImportFromSheetsData = z.infer<typeof importFromSheetsSchema>;

// Google Sheets integration table
export const googleSheets = pgTable('google_sheets', {
  id: serial('id').primaryKey(),
  name: varchar('name').notNull(),
  description: text('description'),
  sheetId: varchar('sheet_id').notNull(), // Google Sheets document ID
  isPublic: boolean('is_public').notNull().default(true),
  embedUrl: text('embed_url').notNull(),
  directUrl: text('direct_url').notNull(),
  createdBy: varchar('created_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const insertGoogleSheetSchema = createInsertSchema(googleSheets).omit({
  id: true,
  embedUrl: true,
  directUrl: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
});

export type GoogleSheet = typeof googleSheets.$inferSelect;
export type InsertGoogleSheet = z.infer<typeof insertGoogleSheetSchema>;

// Proposed Sheet Changes - Safety gate for app-to-sheet writes
// Changes proposed by the app are queued here for human review before being written to Google Sheets
export const proposedSheetChanges = pgTable('proposed_sheet_changes', {
  id: serial('id').primaryKey(),

  // Which event this change relates to
  eventRequestId: integer('event_request_id').references(() => eventRequests.id, { onDelete: 'cascade' }),

  // Target sheet information
  targetSheetId: varchar('target_sheet_id').notNull(), // Google Sheets document ID
  targetSheetName: varchar('target_sheet_name').default('Schedule'), // Tab name within the sheet
  targetRowIndex: integer('target_row_index'), // Row number if updating existing, null if new row

  // The proposed change
  changeType: varchar('change_type').notNull(), // 'create_row', 'update_cell', 'update_row', 'delete_row'
  fieldName: varchar('field_name'), // Which column/field (for cell updates)
  currentValue: text('current_value'), // What's currently in the sheet (for updates)
  proposedValue: text('proposed_value'), // What the app wants to write
  proposedRowData: jsonb('proposed_row_data'), // Full row data for create/update_row operations

  // Mapping info for safety
  columnMapping: jsonb('column_mapping'), // Which app field maps to which sheet column

  // Who proposed it
  proposedBy: varchar('proposed_by').references(() => users.id),
  proposedAt: timestamp('proposed_at').defaultNow().notNull(),
  proposalReason: text('proposal_reason'), // Why this change was proposed (e.g., "Event scheduled", "Driver assigned")

  // Review status
  status: varchar('status').notNull().default('pending'), // 'pending', 'approved', 'rejected', 'applied', 'failed'
  reviewedBy: varchar('reviewed_by').references(() => users.id),
  reviewedAt: timestamp('reviewed_at'),
  reviewNotes: text('review_notes'), // Reviewer can add notes

  // If approved and applied
  appliedAt: timestamp('applied_at'),
  applyError: text('apply_error'), // If write failed, store the error

  // Audit trail
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const insertProposedSheetChangeSchema = createInsertSchema(proposedSheetChanges).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type ProposedSheetChange = typeof proposedSheetChanges.$inferSelect;
export type InsertProposedSheetChange = z.infer<typeof insertProposedSheetChangeSchema>;

// OLD COMPLEX MESSAGING TABLES REMOVED - Using simple 3-table system only
// The following tables were part of the old 7-table messaging system:
// - conversationThreads
// - messageGroups
// - groupMemberships
// - groupMessageParticipants
//
// These have been replaced by the simple 3-table system:
// - conversations
// - conversationParticipants
// - messages

// Stream Chat integration tables - Track metadata for Stream messages
export const streamUsers = pgTable('stream_users', {
  id: serial('id').primaryKey(),
  userId: varchar('user_id').notNull(), // Your app's user ID
  streamUserId: varchar('stream_user_id').unique().notNull(), // Stream's user ID
  streamToken: text('stream_token'), // For authentication
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const streamChannels = pgTable('stream_channels', {
  id: serial('id').primaryKey(),
  channelId: varchar('channel_id').unique().notNull(), // Stream's channel ID
  userId: varchar('user_id').notNull(), // Which user has access
  folder: varchar('folder').notNull().default('inbox'), // 'inbox', 'sent', 'trash'
  lastRead: timestamp('last_read'),
  customData: jsonb('custom_data').default('{}'), // Subject lines, etc
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const streamMessages = pgTable('stream_messages', {
  id: serial('id').primaryKey(),
  streamMessageId: varchar('stream_message_id').unique().notNull(), // Reference to Stream's message
  channelId: varchar('channel_id').notNull(), // Stream's channel ID
  userId: varchar('user_id').notNull(), // User who this metadata belongs to
  isStarred: boolean('is_starred').notNull().default(false),
  isDraft: boolean('is_draft').notNull().default(false),
  folder: varchar('folder').notNull().default('inbox'), // User's folder assignment
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const streamThreads = pgTable('stream_threads', {
  id: serial('id').primaryKey(),
  streamThreadId: varchar('stream_thread_id').unique().notNull(), // Stream's thread ID
  parentMessageId: integer('parent_message_id').references(
    () => streamMessages.id,
    { onDelete: 'set null' }
  ),
  title: text('title'), // Thread title (usually "Re: ...")
  participants: jsonb('participants').notNull().default('[]'), // Array of user IDs in thread
  lastReplyAt: timestamp('last_reply_at'),
  replyCount: integer('reply_count').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const workLogs = pgTable('work_logs', {
  id: serial('id').primaryKey(),
  userId: varchar('user_id').notNull(),
  description: text('description').notNull(),
  hours: integer('hours').notNull().default(0),
  minutes: integer('minutes').notNull().default(0),
  workDate: timestamp('work_date', { withTimezone: true }).notNull(), // Date when the work was actually performed
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(), // When the log entry was created
  status: varchar('status', { length: 20 }).default('pending'), // for future approval
  approvedBy: varchar('approved_by'), // for future approval
  approvedAt: timestamp('approved_at', { withTimezone: true }), // for future approval
  visibility: varchar('visibility', { length: 20 }).default('private'), // "private", "team", "department", "public"
  sharedWith: jsonb('shared_with').$type<string[]>().default([]), // specific user IDs who can view
  department: varchar('department', { length: 50 }), // for department-based visibility
  teamId: varchar('team_id'), // for team-based visibility
});

export type WorkLog = typeof workLogs.$inferSelect;
export type InsertWorkLog = typeof workLogs.$inferInsert;

// Running "start work / stop work" stopwatch. A row exists only while a timer is
// running; stopping it converts the elapsed time into a work_logs row and deletes
// the row here. The unique index enforces at most one running timer per user.
export const workLogTimers = pgTable(
  'work_log_timers',
  {
    id: serial('id').primaryKey(),
    userId: varchar('user_id').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    description: text('description'), // optional note captured when the timer started
  },
  (table) => [uniqueIndex('work_log_timers_user_unique').on(table.userId)]
);

export type WorkLogTimer = typeof workLogTimers.$inferSelect;
export type InsertWorkLogTimer = typeof workLogTimers.$inferInsert;

// Suggestions portal for user feedback and feature requests
export const suggestions = pgTable('suggestions', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  category: text('category').notNull().default('general'), // 'general', 'feature', 'bug', 'improvement', 'ui_ux'
  priority: text('priority').notNull().default('medium'), // 'low', 'medium', 'high', 'urgent'
  status: text('status').notNull().default('submitted'), // 'submitted', 'under_review', 'in_progress', 'completed', 'rejected', 'needs_clarification'
  submittedBy: varchar('submitted_by').notNull(),
  submitterEmail: varchar('submitter_email'),
  submitterName: text('submitter_name'),
  isAnonymous: boolean('is_anonymous').notNull().default(false),
  upvotes: integer('upvotes').notNull().default(0),
  tags: text('tags').array().default([]),
  implementationNotes: text('implementation_notes'), // Admin notes on how this was/will be implemented
  estimatedEffort: text('estimated_effort'), // 'small', 'medium', 'large', 'epic'
  assignedTo: varchar('assigned_to'), // Admin user who is handling this suggestion
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// Communication thread between admins and suggestion submitters
export const suggestionResponses = pgTable('suggestion_responses', {
  id: serial('id').primaryKey(),
  suggestionId: integer('suggestion_id').notNull(),
  message: text('message').notNull(),
  isAdminResponse: boolean('is_admin_response').notNull().default(false),
  respondedBy: varchar('responded_by').notNull(),
  respondentName: text('respondent_name'),
  isInternal: boolean('is_internal').notNull().default(false), // Internal admin notes not visible to submitter
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// Schema types for suggestions
export const insertSuggestionSchema = createInsertSchema(suggestions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  upvotes: true,
  completedAt: true,
  submittedBy: true,
  submitterEmail: true,
  submitterName: true,
});

export const insertSuggestionResponseSchema = createInsertSchema(
  suggestionResponses
).omit({
  id: true,
  createdAt: true,
});

export type Suggestion = typeof suggestions.$inferSelect;
export type InsertSuggestion = z.infer<typeof insertSuggestionSchema>;
export type SuggestionResponse = typeof suggestionResponses.$inferSelect;
export type InsertSuggestionResponse = z.infer<
  typeof insertSuggestionResponseSchema
>;

// Sandwich distribution tracking schema types
export const insertSandwichDistributionSchema = createInsertSchema(
  sandwichDistributions
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type SandwichDistribution = typeof sandwichDistributions.$inferSelect;
export type InsertSandwichDistribution = z.infer<
  typeof insertSandwichDistributionSchema
>;

// Stream Chat schema types
export const insertStreamUserSchema = createInsertSchema(streamUsers).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertStreamChannelSchema = createInsertSchema(
  streamChannels
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertStreamMessageSchema = createInsertSchema(
  streamMessages
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertStreamThreadSchema = createInsertSchema(streamThreads).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// User activity tracking schemas
export const insertUserActivityLogSchema = createInsertSchema(
  userActivityLogs
).omit({
  id: true,
  createdAt: true,
});

export type UserActivityLog = typeof userActivityLogs.$inferSelect;
export type InsertUserActivityLog = z.infer<typeof insertUserActivityLogSchema>;

export type StreamUser = typeof streamUsers.$inferSelect;
export type InsertStreamUser = z.infer<typeof insertStreamUserSchema>;
export type StreamChannel = typeof streamChannels.$inferSelect;
export type InsertStreamChannel = z.infer<typeof insertStreamChannelSchema>;
export type StreamMessage = typeof streamMessages.$inferSelect;
export type InsertStreamMessage = z.infer<typeof insertStreamMessageSchema>;
export type StreamThread = typeof streamThreads.$inferSelect;
export type InsertStreamThread = z.infer<typeof insertStreamThreadSchema>;

// Event volunteers schema types
export const insertEventVolunteerSchema = createInsertSchema(
  eventVolunteers
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  signedUpAt: true,
  confirmedAt: true,
});

export type EventVolunteer = typeof eventVolunteers.$inferSelect;
export type InsertEventVolunteer = z.infer<typeof insertEventVolunteerSchema>;

export const insertEventVolunteerDeclineSchema = createInsertSchema(
  eventVolunteerDeclines
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type EventVolunteerDecline = typeof eventVolunteerDeclines.$inferSelect;
export type InsertEventVolunteerDecline = z.infer<typeof insertEventVolunteerDeclineSchema>;

// Meeting notes table for agenda planning and note management
export const meetingNotes = pgTable('meeting_notes', {
  id: serial('id').primaryKey(),
  meetingId: integer('meeting_id').notNull(), // REFACTOR: Made required (notes always belong to a meeting)
  projectId: integer('project_id'), // REFACTOR: Made optional (notes don't always need a project)
  type: text('type').notNull(), // 'discussion' | 'meeting' | 'general'
  content: text('content').notNull(),
  status: text('status').notNull().default('active'), // 'active' | 'converted' | 'archived'
  createdBy: varchar('created_by'), // User ID who created the note
  createdByName: varchar('created_by_name'), // User name for display
  // NEW REFACTOR FIELDS - Conversion tracking
  convertedToTaskId: integer('converted_to_task_id'), // If converted to task, references that task
  convertedAt: timestamp('converted_at'), // When converted to task
  selectedForAgenda: boolean('selected_for_agenda').notNull().default(false), // Include in agenda
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Meeting notes schema types
export const insertMeetingNoteSchema = createInsertSchema(meetingNotes).omit({
  id: true,
  createdAt: true,
});

export type MeetingNote = typeof meetingNotes.$inferSelect;
export type InsertMeetingNote = z.infer<typeof insertMeetingNoteSchema>;

// Imported external IDs schema types for permanent blacklist system
export const insertImportedExternalIdSchema = createInsertSchema(
  importedExternalIds
).omit({
  id: true,
  importedAt: true,
});

export type ImportedExternalId = typeof importedExternalIds.$inferSelect;
export type InsertImportedExternalId = z.infer<
  typeof insertImportedExternalIdSchema
>;

// =============================================================================
// SMART NOTIFICATIONS SYSTEM SCHEMA
// =============================================================================
// This builds on the existing notifications table to provide intelligent,
// personalized notification delivery with learning capabilities

// User notification preferences for smart delivery
export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    id: serial('id').primaryKey(),
    userId: varchar('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    category: varchar('category').notNull(), // 'projects', 'tasks', 'meetings', 'chat', 'system', etc.
    type: varchar('type').notNull(), // Specific notification type (e.g., 'task_assignment', 'project_update')

    // Delivery channel preferences
    emailEnabled: boolean('email_enabled').notNull().default(true),
    smsEnabled: boolean('sms_enabled').notNull().default(false),
    inAppEnabled: boolean('in_app_enabled').notNull().default(true),
    pushEnabled: boolean('push_enabled').notNull().default(true),

    // Smart delivery preferences
    priority: varchar('priority').notNull().default('medium'), // 'low', 'medium', 'high', 'urgent'
    frequency: varchar('frequency').notNull().default('immediate'), // 'immediate', 'hourly', 'daily', 'weekly'
    quietHoursStart: time('quiet_hours_start'), // e.g., '22:00'
    quietHoursEnd: time('quiet_hours_end'), // e.g., '08:00'
    timezone: varchar('timezone').default('America/New_York'),

    // Learning and personalization
    relevanceScore: decimal('relevance_score', {
      precision: 5,
      scale: 2,
    }).default('50.00'), // 0-100 score
    lastInteraction: timestamp('last_interaction'), // When user last interacted with this type
    totalReceived: integer('total_received').notNull().default(0), // Total notifications received
    totalOpened: integer('total_opened').notNull().default(0), // Total notifications opened/clicked
    totalDismissed: integer('total_dismissed').notNull().default(0), // Total notifications dismissed

    // Metadata for learning algorithms
    engagementMetadata: jsonb('engagement_metadata').default('{}'), // Patterns, timing preferences, etc.

    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    userCategoryTypeIdx: unique().on(table.userId, table.category, table.type),
    userCategoryIdx: index('idx_notif_prefs_user_category').on(
      table.userId,
      table.category
    ),
    relevanceScoreIdx: index('idx_notif_prefs_relevance').on(
      table.relevanceScore
    ),
  })
);

// Enhanced notification history with interaction tracking
export const notificationHistory = pgTable(
  'notification_history',
  {
    id: serial('id').primaryKey(),
    notificationId: integer('notification_id')
      .notNull()
      .references(() => notifications.id, { onDelete: 'cascade' }),
    userId: varchar('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    // Delivery tracking
    deliveryChannel: varchar('delivery_channel').notNull(), // 'email', 'sms', 'in_app'
    deliveryStatus: varchar('delivery_status').notNull().default('pending'), // 'pending', 'sent', 'delivered', 'failed', 'bounced'
    deliveryAttempts: integer('delivery_attempts').notNull().default(0),
    lastDeliveryAttempt: timestamp('last_delivery_attempt'),
    deliveredAt: timestamp('delivered_at'),
    failureReason: text('failure_reason'),

    // Interaction tracking
    openedAt: timestamp('opened_at'), // When notification was opened/viewed
    clickedAt: timestamp('clicked_at'), // When user clicked action button
    dismissedAt: timestamp('dismissed_at'), // When user dismissed/archived
    interactionType: varchar('interaction_type'), // 'opened', 'clicked', 'dismissed', 'snoozed', 'shared'
    timeToInteraction: integer('time_to_interaction'), // Seconds from delivery to interaction

    // Context and relevance
    relevanceScore: decimal('relevance_score', { precision: 5, scale: 2 }), // Computed relevance at delivery time
    contextMetadata: jsonb('context_metadata').default('{}'), // User context when delivered (active page, time, etc.)

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    notificationUserIdx: index('idx_notif_history_notif_user').on(
      table.notificationId,
      table.userId
    ),
    userChannelIdx: index('idx_notif_history_user_channel').on(
      table.userId,
      table.deliveryChannel
    ),
    deliveryStatusIdx: index('idx_notif_history_delivery_status').on(
      table.deliveryStatus
    ),
    interactionTimeIdx: index('idx_notif_history_interaction_time').on(
      table.openedAt,
      table.clickedAt
    ),
  })
);

// Smart notification rules for intelligent delivery timing and batching
export const notificationRules = pgTable(
  'notification_rules',
  {
    id: serial('id').primaryKey(),
    name: varchar('name').notNull(),
    description: text('description'),

    // Rule conditions
    category: varchar('category'), // Apply to specific category
    type: varchar('type'), // Apply to specific type
    priority: varchar('priority'), // Apply to specific priority level
    userRole: varchar('user_role'), // Apply to specific user role

    // Smart delivery rules
    batchingEnabled: boolean('batching_enabled').notNull().default(false),
    batchingWindow: integer('batching_window').default(3600), // Seconds to wait before batching
    maxBatchSize: integer('max_batch_size').default(5),

    // Timing rules
    respectQuietHours: boolean('respect_quiet_hours').notNull().default(true),
    minTimeBetween: integer('min_time_between').default(300), // Minimum seconds between similar notifications
    maxDailyLimit: integer('max_daily_limit'), // Maximum notifications per day for this rule

    // Delivery optimization
    smartChannelSelection: boolean('smart_channel_selection')
      .notNull()
      .default(true),
    fallbackChannel: varchar('fallback_channel').default('in_app'),
    retryAttempts: integer('retry_attempts').notNull().default(3),
    retryDelay: integer('retry_delay').notNull().default(3600), // Seconds between retries

    // A/B testing
    testVariant: varchar('test_variant'), // For A/B testing different rules

    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    categoryTypeIdx: index('idx_notif_rules_category_type').on(
      table.category,
      table.type
    ),
    activeRulesIdx: index('idx_notif_rules_active').on(table.isActive),
  })
);

// User behavior patterns for machine learning and personalization
export const userNotificationPatterns = pgTable(
  'user_notification_patterns',
  {
    id: serial('id').primaryKey(),
    userId: varchar('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    // Behavioral patterns
    mostActiveHours: jsonb('most_active_hours').default('[]'), // Array of hour numbers (0-23)
    mostActiveDays: jsonb('most_active_days').default('[]'), // Array of day numbers (0-6, Sun-Sat)
    averageResponseTime: integer('average_response_time'), // Average seconds to respond to notifications
    preferredChannels: jsonb('preferred_channels').default('[]'), // Ordered array of channel preferences

    // Engagement metrics
    overallEngagementScore: decimal('overall_engagement_score', {
      precision: 5,
      scale: 2,
    }).default('50.00'),
    categoryEngagement: jsonb('category_engagement').default('{}'), // Engagement scores by category
    recentEngagementTrend: varchar('recent_engagement_trend').default('stable'), // 'increasing', 'decreasing', 'stable'

    // Learning model data
    lastModelUpdate: timestamp('last_model_update'),
    modelVersion: varchar('model_version').default('1.0'),
    learningMetadata: jsonb('learning_metadata').default('{}'), // ML model parameters and features

    // Personalization features
    contentPreferences: jsonb('content_preferences').default('{}'), // Preferred content types, lengths, etc.
    timingPreferences: jsonb('timing_preferences').default('{}'), // Optimal delivery times and patterns

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    userIdx: unique().on(table.userId),
    engagementScoreIdx: index('idx_user_patterns_engagement').on(
      table.overallEngagementScore
    ),
    modelUpdateIdx: index('idx_user_patterns_model_update').on(
      table.lastModelUpdate
    ),
  })
);

// Notification analytics for system optimization
export const notificationAnalytics = pgTable(
  'notification_analytics',
  {
    id: serial('id').primaryKey(),

    // Time period this analytics entry covers
    periodType: varchar('period_type').notNull(), // 'hourly', 'daily', 'weekly', 'monthly'
    periodStart: timestamp('period_start').notNull(),
    periodEnd: timestamp('period_end').notNull(),

    // Aggregated metrics
    category: varchar('category'),
    type: varchar('type'),
    deliveryChannel: varchar('delivery_channel'),

    // Counts
    totalSent: integer('total_sent').notNull().default(0),
    totalDelivered: integer('total_delivered').notNull().default(0),
    totalOpened: integer('total_opened').notNull().default(0),
    totalClicked: integer('total_clicked').notNull().default(0),
    totalDismissed: integer('total_dismissed').notNull().default(0),
    totalFailed: integer('total_failed').notNull().default(0),

    // Calculated rates
    deliveryRate: decimal('delivery_rate', { precision: 5, scale: 2 }),
    openRate: decimal('open_rate', { precision: 5, scale: 2 }),
    clickRate: decimal('click_rate', { precision: 5, scale: 2 }),
    dismissalRate: decimal('dismissal_rate', { precision: 5, scale: 2 }),

    // Performance metrics
    averageDeliveryTime: integer('average_delivery_time'), // Average seconds from trigger to delivery
    averageResponseTime: integer('average_response_time'), // Average seconds from delivery to interaction

    // Additional insights
    peakHours: jsonb('peak_hours').default('[]'), // Hours with highest engagement
    insights: jsonb('insights').default('{}'), // ML-generated insights and patterns

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    periodTypeStartIdx: index('idx_notif_analytics_period').on(
      table.periodType,
      table.periodStart
    ),
    categoryTypeChannelIdx: index(
      'idx_notif_analytics_category_type_channel'
    ).on(table.category, table.type, table.deliveryChannel),
    performanceMetricsIdx: index('idx_notif_analytics_performance').on(
      table.openRate,
      table.clickRate
    ),
  })
);

// A/B testing framework for notification optimization
export const notificationABTests = pgTable(
  'notification_ab_tests',
  {
    id: serial('id').primaryKey(),
    name: varchar('name').notNull(),
    description: text('description'),
    hypothesis: text('hypothesis'), // What we're testing

    // Test configuration
    testType: varchar('test_type').notNull(), // 'delivery_time', 'content', 'channel', 'frequency'
    category: varchar('category'), // Limit test to specific category
    type: varchar('type'), // Limit test to specific type

    // Variants
    controlGroup: jsonb('control_group').notNull(), // Configuration for control group
    testGroup: jsonb('test_group').notNull(), // Configuration for test group
    trafficSplit: integer('traffic_split').notNull().default(50), // Percentage going to test group (0-100)

    // Test status and timeline
    status: varchar('status').notNull().default('draft'), // 'draft', 'running', 'paused', 'completed', 'cancelled'
    startDate: timestamp('start_date'),
    endDate: timestamp('end_date'),
    targetSampleSize: integer('target_sample_size').default(1000),

    // Success metrics
    primaryMetric: varchar('primary_metric').notNull(), // 'open_rate', 'click_rate', 'engagement_score'
    targetImprovement: decimal('target_improvement', {
      precision: 5,
      scale: 2,
    }).default('5.00'), // % improvement needed
    significanceLevel: decimal('significance_level', {
      precision: 3,
      scale: 2,
    }).default('0.05'),

    // Results
    controlResults: jsonb('control_results').default('{}'),
    testResults: jsonb('test_results').default('{}'),
    statisticalSignificance: boolean('statistical_significance'),
    winnerVariant: varchar('winner_variant'), // 'control', 'test', 'inconclusive'

    // Metadata
    createdBy: varchar('created_by').references(() => users.id),
    metadata: jsonb('metadata').default('{}'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    statusIdx: index('idx_notif_ab_tests_status').on(table.status),
    categoryTypeIdx: index('idx_notif_ab_tests_category_type').on(
      table.category,
      table.type
    ),
    activeTestsIdx: index('idx_notif_ab_tests_active').on(
      table.status,
      table.startDate,
      table.endDate
    ),
  })
);

// Notification action history - tracks when users execute actions from notifications
export const notificationActionHistory = pgTable(
  'notification_action_history',
  {
    id: serial('id').primaryKey(),
    notificationId: integer('notification_id')
      .notNull()
      .references(() => notifications.id, { onDelete: 'cascade' }),
    userId: varchar('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    // Action details
    actionType: varchar('action_type').notNull(), // 'approve', 'decline', 'mark_complete', 'assign', etc.
    actionStatus: varchar('action_status').notNull().default('pending'), // 'pending', 'success', 'failed'

    // Execution tracking
    startedAt: timestamp('started_at').defaultNow().notNull(),
    completedAt: timestamp('completed_at'),
    errorMessage: text('error_message'),

    // Related entity changes
    relatedType: varchar('related_type'), // 'event_request', 'task', 'project', etc.
    relatedId: integer('related_id'),

    // Undo support
    undoneAt: timestamp('undone_at'),
    undoneBy: varchar('undone_by').references(() => users.id),

    // Additional context
    metadata: jsonb('metadata').default('{}'), // Action-specific data
  },
  (table) => ({
    notificationActionIdx: index('idx_notif_action_history_notif').on(
      table.notificationId
    ),
    userActionIdx: index('idx_notif_action_history_user').on(
      table.userId,
      table.actionType
    ),
    statusIdx: index('idx_notif_action_history_status').on(
      table.actionStatus
    ),
  })
);

// =============================================================================
// SMART NOTIFICATIONS SYSTEM - INSERT SCHEMAS AND TYPES
// =============================================================================

// Smart notification insert schemas
export const insertNotificationPreferencesSchema = createInsertSchema(
  notificationPreferences
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertNotificationHistorySchema = createInsertSchema(
  notificationHistory
).omit({
  id: true,
  createdAt: true,
});

export const insertNotificationRulesSchema = createInsertSchema(
  notificationRules
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertUserNotificationPatternsSchema = createInsertSchema(
  userNotificationPatterns
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertNotificationActionHistorySchema = createInsertSchema(
  notificationActionHistory
).omit({
  id: true,
  startedAt: true,
});

export const insertNotificationAnalyticsSchema = createInsertSchema(
  notificationAnalytics
).omit({
  id: true,
  createdAt: true,
});

export const insertNotificationABTestsSchema = createInsertSchema(
  notificationABTests
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Smart notification types
export type NotificationPreferences =
  typeof notificationPreferences.$inferSelect;
export type InsertNotificationPreferences = z.infer<
  typeof insertNotificationPreferencesSchema
>;

export type NotificationHistory = typeof notificationHistory.$inferSelect;
export type InsertNotificationHistory = z.infer<
  typeof insertNotificationHistorySchema
>;

export type NotificationRules = typeof notificationRules.$inferSelect;
export type InsertNotificationRules = z.infer<
  typeof insertNotificationRulesSchema
>;

export type UserNotificationPatterns =
  typeof userNotificationPatterns.$inferSelect;
export type InsertUserNotificationPatterns = z.infer<
  typeof insertUserNotificationPatternsSchema
>;

export type NotificationAnalytics = typeof notificationAnalytics.$inferSelect;
export type InsertNotificationAnalytics = z.infer<
  typeof insertNotificationAnalyticsSchema
>;

export type NotificationABTests = typeof notificationABTests.$inferSelect;
export type InsertNotificationABTests = z.infer<
  typeof insertNotificationABTestsSchema
>;

export type NotificationActionHistory =
  typeof notificationActionHistory.$inferSelect;
export type InsertNotificationActionHistory = z.infer<
  typeof insertNotificationActionHistorySchema
>;

// Availability slots insert schema and types
export const insertAvailabilitySlotSchema = createInsertSchema(
  availabilitySlots
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type AvailabilitySlot = typeof availabilitySlots.$inferSelect;
export type InsertAvailabilitySlot = z.infer<
  typeof insertAvailabilitySlotSchema
>;

// Dashboard document preferences - which documents appear on dashboard
export const dashboardDocuments = pgTable('dashboard_documents', {
  id: serial('id').primaryKey(),
  documentId: varchar('document_id').notNull().unique(), // References the id from adminDocuments array
  displayOrder: integer('display_order').notNull().default(0), // Order to display on dashboard
  isActive: boolean('is_active').notNull().default(true), // Whether to show on dashboard
  addedBy: varchar('added_by'), // User who added this document to dashboard
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const insertDashboardDocumentSchema = createInsertSchema(
  dashboardDocuments
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type DashboardDocument = typeof dashboardDocuments.$inferSelect;
export type InsertDashboardDocument = z.infer<
  typeof insertDashboardDocumentSchema
>;

// Onboarding Challenge - Gamification for feature exploration
export const onboardingChallenges = pgTable('onboarding_challenges', {
  id: serial('id').primaryKey(),
  actionKey: varchar('action_key').notNull().unique(), // e.g., 'chat_first_message', 'view_important_docs'
  title: varchar('title').notNull(), // e.g., 'Send your first chat message'
  description: text('description'), // Detailed description of the action
  category: varchar('category').notNull(), // 'communication', 'documents', 'team', 'projects'
  points: integer('points').notNull().default(10), // Points awarded for completion
  icon: varchar('icon'), // Icon name for UI
  order: integer('order').notNull().default(0), // Display order
  promotion: text('promotion'), // Promotion text to highlight special challenges
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow(),
});

export const onboardingProgress = pgTable(
  'onboarding_progress',
  {
    id: serial('id').primaryKey(),
    userId: varchar('user_id').notNull(),
    challengeId: integer('challenge_id').notNull(),
    completedAt: timestamp('completed_at').notNull().defaultNow(),
    metadata: jsonb('metadata').default('{}'), // Additional context about completion
  },
  (table) => [
    unique().on(table.userId, table.challengeId), // Each user can complete each challenge once
  ]
);

export const insertOnboardingChallengeSchema = createInsertSchema(
  onboardingChallenges
).omit({
  id: true,
  createdAt: true,
});

export const insertOnboardingProgressSchema = createInsertSchema(
  onboardingProgress
).omit({
  id: true,
  completedAt: true,
});

export type OnboardingChallenge = typeof onboardingChallenges.$inferSelect;
export type InsertOnboardingChallenge = z.infer<
  typeof insertOnboardingChallengeSchema
>;
export type OnboardingProgress = typeof onboardingProgress.$inferSelect;
export type InsertOnboardingProgress = z.infer<
  typeof insertOnboardingProgressSchema
>;

// Feature Flags - Gradual feature rollout and A/B testing
export const featureFlags = pgTable('feature_flags', {
  id: serial('id').primaryKey(),
  flagName: varchar('flag_name', { length: 255 }).notNull().unique(), // e.g., 'unified-activities', 'new-ui-v2'
  description: text('description'), // Human-readable description of what this flag controls
  enabled: boolean('enabled').notNull().default(false), // Global enable/disable
  enabledForUsers: jsonb('enabled_for_users').default('[]'), // Array of user IDs who have access
  enabledForRoles: jsonb('enabled_for_roles').default('[]'), // Array of roles that have access
  enabledPercentage: integer('enabled_percentage').default(0), // For gradual rollout (0-100)
  metadata: jsonb('metadata').default('{}'), // Additional configuration (variants, parameters, etc.)
  createdBy: varchar('created_by'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => [
  index('idx_feature_flags_enabled').on(table.enabled),
  index('idx_feature_flags_flag_name').on(table.flagName),
]);

export const insertFeatureFlagSchema = createInsertSchema(featureFlags).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type FeatureFlag = typeof featureFlags.$inferSelect;
export type InsertFeatureFlag = z.infer<typeof insertFeatureFlagSchema>;

// ============================================================================
// UNIFIED TASK + COMMUNICATION SYSTEM (Phase 1)
// ============================================================================

/**
 * Activities - Unified table for tasks, events, projects, messages, and more
 * Replaces scattered task/event/message tables with one threaded conversation system
 */
export const activities = pgTable('activities', {
  id: varchar('id').primaryKey().notNull(), // UUID from client or server
  type: varchar('type', { length: 50 }).notNull(), // 'task', 'event', 'project', 'collection', 'message', 'kudos', 'system_log'
  title: text('title').notNull(), // Main description or message preview
  content: text('content'), // Detailed body - for messages or rich descriptions
  createdBy: varchar('created_by').notNull(), // FK to users.id
  assignedTo: jsonb('assigned_to').default('[]'), // Array of user IDs
  status: varchar('status', { length: 50 }), // 'open', 'in_progress', 'done', 'declined', 'postponed', NULL for messages
  priority: varchar('priority', { length: 20 }), // 'low', 'medium', 'high', 'urgent', NULL for non-tasks
  parentId: varchar('parent_id'), // Self-referential FK for threading (replies)
  rootId: varchar('root_id'), // Denormalized root of thread for efficient queries
  contextType: varchar('context_type', { length: 50 }), // 'event_request', 'project', 'collection', 'kudos', 'direct', 'channel'
  contextId: varchar('context_id'), // FK to eventRequests/projects/collections/etc
  metadata: jsonb('metadata').default('{}'), // Flexible field for type-specific data
  isDeleted: boolean('is_deleted').default(false), // Soft delete flag
  threadCount: integer('thread_count').default(0), // Denormalized count of replies
  lastActivityAt: timestamp('last_activity_at').defaultNow(), // For sorting threads by recent activity
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => [
  index('idx_activities_type').on(table.type),
  index('idx_activities_created_by').on(table.createdBy),
  index('idx_activities_parent_id').on(table.parentId),
  index('idx_activities_root_id').on(table.rootId),
  index('idx_activities_context').on(table.contextType, table.contextId),
  index('idx_activities_last_activity').on(table.lastActivityAt),
  index('idx_activities_is_deleted').on(table.isDeleted),
  index('idx_activities_status').on(table.status),
  index('idx_activities_created_at').on(table.createdAt),
]);

export const insertActivitySchema = createInsertSchema(activities).omit({
  threadCount: true,
  lastActivityAt: true,
  createdAt: true,
  updatedAt: true,
});

export type Activity = typeof activities.$inferSelect;
export type InsertActivity = z.infer<typeof insertActivitySchema>;

/**
 * Activity Participants - Track who's involved in each activity
 * Used for permissions, notifications, and unread tracking
 */
export const activityParticipants = pgTable('activity_participants', {
  id: serial('id').primaryKey(),
  activityId: varchar('activity_id').notNull(), // FK to activities.id
  userId: varchar('user_id').notNull(), // FK to users.id
  role: varchar('role', { length: 50 }).notNull(), // 'assignee', 'follower', 'mentioned', 'creator'
  lastReadAt: timestamp('last_read_at'), // For unread tracking
  notificationsEnabled: boolean('notifications_enabled').default(true), // Per-thread notification preference
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => [
  index('idx_activity_participants_activity').on(table.activityId),
  index('idx_activity_participants_user').on(table.userId),
  index('idx_activity_participants_activity_user').on(table.activityId, table.userId),
  unique().on(table.activityId, table.userId, table.role), // Prevent duplicate participant roles
]);

export const insertActivityParticipantSchema = createInsertSchema(activityParticipants).omit({
  id: true,
  createdAt: true,
});

export type ActivityParticipant = typeof activityParticipants.$inferSelect;
export type InsertActivityParticipant = z.infer<typeof insertActivityParticipantSchema>;

/**
 * Activity Reactions - Likes, celebrates, helpful, etc.
 * Lightweight engagement on activities and messages
 */
export const activityReactions = pgTable('activity_reactions', {
  id: serial('id').primaryKey(),
  activityId: varchar('activity_id').notNull(), // FK to activities.id
  userId: varchar('user_id').notNull(), // FK to users.id
  reactionType: varchar('reaction_type', { length: 50 }).notNull(), // 'like', 'celebrate', 'helpful', 'complete', 'question'
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => [
  index('idx_activity_reactions_activity').on(table.activityId),
  index('idx_activity_reactions_user').on(table.userId),
  unique().on(table.activityId, table.userId, table.reactionType), // One reaction type per user per activity
]);

export const insertActivityReactionSchema = createInsertSchema(activityReactions).omit({
  id: true,
  createdAt: true,
});

export type ActivityReaction = typeof activityReactions.$inferSelect;
export type InsertActivityReaction = z.infer<typeof insertActivityReactionSchema>;

/**
 * Activity Attachments - File uploads on threads
 * Links to storage service (Google Cloud Storage)
 */
export const activityAttachments = pgTable('activity_attachments', {
  id: serial('id').primaryKey(),
  activityId: varchar('activity_id').notNull(), // FK to activities.id
  fileUrl: text('file_url').notNull(), // URL to file in storage
  fileType: varchar('file_type', { length: 100 }), // MIME type
  fileName: text('file_name').notNull(), // Original filename
  fileSize: integer('file_size'), // Size in bytes
  uploadedBy: varchar('uploaded_by').notNull(), // FK to users.id
  uploadedAt: timestamp('uploaded_at').defaultNow(),
}, (table) => [
  index('idx_activity_attachments_activity').on(table.activityId),
  index('idx_activity_attachments_uploaded_by').on(table.uploadedBy),
]);

export const insertActivityAttachmentSchema = createInsertSchema(activityAttachments).omit({
  id: true,
  uploadedAt: true,
});

export type ActivityAttachment = typeof activityAttachments.$inferSelect;
export type InsertActivityAttachment = z.infer<typeof insertActivityAttachmentSchema>;

/**
 * Promotion Graphics - Social media graphics for team sharing
 * Store graphics that hosts can share on their social media
 */
export const promotionGraphics = pgTable('promotion_graphics', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  imageUrl: text('image_url').notNull(), // URL to the uploaded graphic
  fileName: text('file_name').notNull(), // Original filename
  fileSize: integer('file_size'), // Size in bytes
  fileType: varchar('file_type', { length: 100 }), // MIME type (image/png, image/jpeg, etc.)
  intendedUseDate: timestamp('intended_use_date'), // When the graphic should be used
  targetAudience: text('target_audience').default('hosts'), // 'hosts', 'volunteers', 'all', etc.
  status: varchar('status', { length: 50 }).default('active'), // 'active', 'archived'
  notificationSent: boolean('notification_sent').default(false), // Track if email was sent
  notificationSentAt: timestamp('notification_sent_at'), // When notification was sent
  viewCount: integer('view_count').default(0), // Track how many times the graphic has been viewed
  uploadedBy: varchar('uploaded_by').notNull(), // FK to users.id
  uploadedByName: text('uploaded_by_name').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => [
  index('idx_promotion_graphics_status').on(table.status),
  index('idx_promotion_graphics_target_audience').on(table.targetAudience),
  index('idx_promotion_graphics_uploaded_by').on(table.uploadedBy),
  index('idx_promotion_graphics_intended_use_date').on(table.intendedUseDate),
]);

export const insertPromotionGraphicSchema = createInsertSchema(promotionGraphics).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  notificationSent: true,
  notificationSentAt: true,
});

export type PromotionGraphic = typeof promotionGraphics.$inferSelect;
export type InsertPromotionGraphic = z.infer<typeof insertPromotionGraphicSchema>;

/**
 * Expenses - Track expenses and receipts for events, projects, or general use
 * Supports receipt file uploads via storage service
 */
export const expenses = pgTable('expenses', {
  id: serial('id').primaryKey(),
  contextType: varchar('context_type', { length: 50 }), // 'event', 'project', 'general'
  contextId: integer('context_id'), // FK to eventRequests.id or projects.id
  description: text('description').notNull(),
  amount: decimal('amount', { precision: 10, scale: 2 }).notNull(),
  category: varchar('category', { length: 100 }), // 'food', 'supplies', 'transport', 'reimbursement', 'other'
  vendor: varchar('vendor', { length: 255 }), // Where the purchase was made
  purchaseDate: timestamp('purchase_date'), // When the purchase was made
  receiptUrl: text('receipt_url'), // URL to receipt file in storage
  receiptFileName: text('receipt_file_name'), // Original filename
  receiptFileSize: integer('receipt_file_size'), // Size in bytes
  uploadedBy: varchar('uploaded_by').notNull(), // FK to users.id
  uploadedAt: timestamp('uploaded_at').defaultNow(),
  approvedBy: varchar('approved_by'), // FK to users.id (for approval workflow)
  approvedAt: timestamp('approved_at'),
  status: varchar('status', { length: 50 }).notNull().default('pending'), // 'pending', 'approved', 'rejected', 'reimbursed'
  notes: text('notes'),
  metadata: jsonb('metadata').default('{}'), // Additional context
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => [
  index('idx_expenses_context').on(table.contextType, table.contextId),
  index('idx_expenses_uploaded_by').on(table.uploadedBy),
  index('idx_expenses_status').on(table.status),
  index('idx_expenses_category').on(table.category),
  index('idx_expenses_purchase_date').on(table.purchaseDate),
]);

export const insertExpenseSchema = createInsertSchema(expenses, {
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/, "Amount must be a valid decimal with up to 2 decimal places"),
  description: z.string().min(1, "Description is required"),
  category: z.enum(['food', 'supplies', 'transport', 'reimbursement', 'other']).optional(),
  status: z.enum(['pending', 'approved', 'rejected', 'reimbursed']).optional(),
  contextType: z.enum(['event', 'project', 'general']).optional(),
}).omit({
  id: true,
  uploadedAt: true,
  createdAt: true,
  updatedAt: true,
});

export const updateExpenseSchema = insertExpenseSchema.partial();

export type Expense = typeof expenses.$inferSelect;
export type InsertExpense = z.infer<typeof insertExpenseSchema>;
export type UpdateExpense = z.infer<typeof updateExpenseSchema>;

/**
 * Impact Reports - AI-generated monthly/quarterly/annual impact reports
 * Automatically summarizes activities, metrics, and achievements for stakeholders
 */
export const impactReports = pgTable('impact_reports', {
  id: serial('id').primaryKey(),
  reportType: varchar('report_type', { length: 50 }).notNull(), // 'monthly', 'quarterly', 'annual', 'custom'
  reportPeriod: varchar('report_period', { length: 50 }).notNull(), // e.g., '2025-01', '2025-Q1', '2025'
  startDate: timestamp('start_date').notNull(), // Start of reporting period
  endDate: timestamp('end_date').notNull(), // End of reporting period

  // Report content (generated by AI)
  title: text('title').notNull(), // e.g., "January 2025 Impact Report"
  executiveSummary: text('executive_summary').notNull(), // High-level overview
  content: text('content').notNull(), // Full report content (markdown format)

  // Key metrics (for quick access without parsing content)
  metrics: jsonb('metrics').$type<{
    eventsCompleted: number;
    sandwichesDistributed: number;
    peopleServed: number;
    volunteersEngaged: number;
    organizationsServed: number;
    hoursVolunteered?: number;
    expensesTotal?: number;
    // Additional custom metrics stored in the customMetrics property below
    customMetrics?: { [key: string]: number | string | boolean | null | undefined };
  }>(),

  // Highlights and trends identified by AI
  highlights: jsonb('highlights').$type<Array<{
    title: string;
    description: string;
    metric?: string;
  }>>(),

  trends: jsonb('trends').$type<Array<{
    category: string; // 'growth', 'decline', 'seasonal', 'emerging'
    description: string;
    dataPoints?: any;
  }>>(),

  // Generation metadata
  generatedAt: timestamp('generated_at').defaultNow().notNull(),
  generatedBy: varchar('generated_by'), // 'ai' or user ID if manually created
  aiModel: varchar('ai_model', { length: 100 }), // e.g., 'gpt-4o'
  generationPrompt: text('generation_prompt'), // Prompt used for AI generation
  regenerationCount: integer('regeneration_count').default(0), // Number of times regenerated

  // Publishing and sharing
  status: varchar('status', { length: 50 }).notNull().default('draft'), // 'draft', 'published', 'archived'
  publishedAt: timestamp('published_at'),
  publishedBy: varchar('published_by'), // User ID who published

  // Export tracking
  pdfUrl: text('pdf_url'), // URL to generated PDF version
  pdfGeneratedAt: timestamp('pdf_generated_at'),

  // Metadata
  tags: text('tags').array(), // Custom tags for categorization
  notes: text('notes'), // Internal notes about the report
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('idx_impact_reports_period').on(table.reportPeriod),
  index('idx_impact_reports_type').on(table.reportType),
  index('idx_impact_reports_status').on(table.status),
  index('idx_impact_reports_start_date').on(table.startDate),
  uniqueIndex('unique_report_period_type').on(table.reportPeriod, table.reportType),
]);

export const insertImpactReportSchema = createInsertSchema(impactReports, {
  reportType: z.enum(['monthly', 'quarterly', 'annual', 'custom']),
  status: z.enum(['draft', 'published', 'archived']).optional(),
  title: z.string().min(1, "Title is required"),
  executiveSummary: z.string().min(1, "Executive summary is required"),
  content: z.string().min(1, "Content is required"),
}).omit({
  id: true,
  generatedAt: true,
  createdAt: true,
  updatedAt: true,
});

export const updateImpactReportSchema = insertImpactReportSchema.partial();

export type ImpactReport = typeof impactReports.$inferSelect;
export type InsertImpactReport = z.infer<typeof insertImpactReportSchema>;
export type UpdateImpactReport = z.infer<typeof updateImpactReportSchema>;

/**
 * Search Analytics - Track SmartSearch usage for learning and improvement
 * Enables ML-powered search result optimization and user behavior analysis
 */
export const searchAnalytics = pgTable('search_analytics', {
  id: serial('id').primaryKey(),
  query: text('query').notNull(), // The search query
  resultId: varchar('result_id'), // Which result was clicked (nullable)
  clicked: boolean('clicked').notNull().default(false), // Whether a result was clicked
  timestamp: timestamp('timestamp').defaultNow().notNull(), // When the search occurred
  userId: varchar('user_id'), // Who performed the search (nullable for anonymous)
  userRole: varchar('user_role'), // User's role at time of search
  usedAI: boolean('used_ai').notNull().default(false), // Whether AI semantic search was used
  resultsCount: integer('results_count').notNull().default(0), // How many results were returned
  queryTime: integer('query_time').notNull().default(0), // Milliseconds to process query
}, (table) => [
  index('idx_search_analytics_query').on(table.query),
  index('idx_search_analytics_user').on(table.userId),
  index('idx_search_analytics_timestamp').on(table.timestamp),
  index('idx_search_analytics_clicked').on(table.clicked),
]);

export const insertSearchAnalyticsSchema = createInsertSchema(searchAnalytics).omit({
  id: true,
  timestamp: true,
});

export type SearchAnalytics = typeof searchAnalytics.$inferSelect;
export type InsertSearchAnalytics = z.infer<typeof insertSearchAnalyticsSchema>;

/**
 * Dismissed announcements - Track which users have dismissed which announcements
 * Allows for one-time popups and announcements that don't show repeatedly
 */
export const dismissedAnnouncements = pgTable('dismissed_announcements', {
  id: serial('id').primaryKey(),
  userId: varchar('user_id').notNull(), // FK to users.id
  announcementId: varchar('announcement_id').notNull(), // Unique identifier for the announcement (e.g., 'sms_launch_2024')
  dismissedAt: timestamp('dismissed_at').defaultNow().notNull(),
}, (table) => [
  index('idx_dismissed_announcements_user').on(table.userId),
  unique('unique_user_announcement').on(table.userId, table.announcementId),
]);

export const insertDismissedAnnouncementSchema = createInsertSchema(dismissedAnnouncements).omit({
  id: true,
  dismissedAt: true,
});

export type DismissedAnnouncement = typeof dismissedAnnouncements.$inferSelect;
export type InsertDismissedAnnouncement = z.infer<typeof insertDismissedAnnouncementSchema>;

// ============================================================================
// NEW REFACTOR TYPES - Assignment and meeting-project junction tables
// ============================================================================

// Project Assignments
export const insertProjectAssignmentSchema = createInsertSchema(projectAssignments).omit({
  id: true,
  addedAt: true,
});

export type ProjectAssignment = typeof projectAssignments.$inferSelect;
export type InsertProjectAssignment = z.infer<typeof insertProjectAssignmentSchema>;

// Task Assignments
export const insertTaskAssignmentSchema = createInsertSchema(taskAssignments).omit({
  id: true,
  addedAt: true,
});

export type TaskAssignment = typeof taskAssignments.$inferSelect;
export type InsertTaskAssignment = z.infer<typeof insertTaskAssignmentSchema>;

// Team Board Assignments
export const insertTeamBoardAssignmentSchema = createInsertSchema(teamBoardAssignments).omit({
  id: true,
  addedAt: true,
});

export type TeamBoardAssignment = typeof teamBoardAssignments.$inferSelect;
export type InsertTeamBoardAssignment = z.infer<typeof insertTeamBoardAssignmentSchema>;

// Meeting Projects
export const insertMeetingProjectSchema = createInsertSchema(meetingProjects).omit({
  id: true,
  addedAt: true,
});

export type MeetingProject = typeof meetingProjects.$inferSelect;
export type InsertMeetingProject = z.infer<typeof insertMeetingProjectSchema>;

// ============================================================================
// ALERT REQUESTS - User-submitted requests for new alert types
// ============================================================================

/**
 * Alert Requests - Track user requests for new notification types
 * Allows users to suggest alerts they'd like to receive and track status
 */
export const alertRequests = pgTable('alert_requests', {
  id: serial('id').primaryKey(),
  userId: varchar('user_id').notNull().references(() => users.id), // FK to users.id - who submitted the request
  alertDescription: text('alert_description').notNull(), // What the user wants to be alerted about
  preferredChannel: varchar('preferred_channel').notNull().default('no_preference'), // 'email', 'sms', 'both', 'no_preference'
  frequency: varchar('frequency').notNull().default('immediate'), // 'immediate', 'daily', 'weekly', 'custom'
  additionalNotes: text('additional_notes'), // Any extra details
  status: varchar('status').notNull().default('pending'), // 'pending', 'in_progress', 'implemented', 'rejected'
  adminNotes: text('admin_notes'), // Admin response/notes
  reviewedBy: varchar('reviewed_by').references(() => users.id), // Admin who reviewed the request
  reviewedAt: timestamp('reviewed_at'), // When the request was reviewed
  implementedAt: timestamp('implemented_at'), // When the alert was implemented
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('idx_alert_requests_user').on(table.userId),
  index('idx_alert_requests_status').on(table.status),
  index('idx_alert_requests_created').on(table.createdAt),
]);

export const insertAlertRequestSchema = createInsertSchema(alertRequests).omit({
  id: true,
  status: true,
  adminNotes: true,
  reviewedBy: true,
  reviewedAt: true,
  implementedAt: true,
  createdAt: true,
  updatedAt: true,
});

export const updateAlertRequestSchema = createInsertSchema(alertRequests)
  .omit({
    id: true,
    status: true,
    adminNotes: true,
    reviewedBy: true,
    reviewedAt: true,
    implementedAt: true,
    createdAt: true,
    updatedAt: true,
  })
  .partial();

export type AlertRequest = typeof alertRequests.$inferSelect;
export type InsertAlertRequest = z.infer<typeof insertAlertRequestSchema>;
export type UpdateAlertRequest = z.infer<typeof updateAlertRequestSchema>;

// ============================================================================
// ORGANIZATION ENGAGEMENT SCORES - AI-powered group engagement insights
// ============================================================================

/**
 * Organization Engagement Scores - Track and score organization engagement
 * Used for identifying under-engaged groups and prioritizing outreach
 */
export const organizationEngagementScores = pgTable('organization_engagement_scores', {
  id: serial('id').primaryKey(),

  // Organization identification (uses canonical name for matching)
  organizationName: varchar('organization_name').notNull(), // Display name
  canonicalName: varchar('canonical_name').notNull().unique(), // Lowercase, normalized for matching
  category: varchar('category'), // 'corp', 'school', 'church_faith', 'nonprofit', 'government', 'hospital', etc.

  // Core engagement metrics (0-100 scale)
  overallEngagementScore: decimal('overall_engagement_score', { precision: 5, scale: 2 }).notNull().default('50.00'),

  // Component scores (0-100 scale each)
  frequencyScore: decimal('frequency_score', { precision: 5, scale: 2 }).default('0'), // Based on request/event frequency
  recencyScore: decimal('recency_score', { precision: 5, scale: 2 }).default('0'), // Based on days since last activity
  volumeScore: decimal('volume_score', { precision: 5, scale: 2 }).default('0'), // Based on sandwiches distributed
  completionScore: decimal('completion_score', { precision: 5, scale: 2 }).default('0'), // Based on event completion rate
  consistencyScore: decimal('consistency_score', { precision: 5, scale: 2 }).default('0'), // Based on regular engagement pattern

  // Engagement trend
  engagementTrend: varchar('engagement_trend').default('stable'), // 'increasing', 'decreasing', 'stable', 'new'
  trendPercentChange: decimal('trend_percent_change', { precision: 5, scale: 2 }).default('0'),

  // Raw metrics used for scoring
  totalEvents: integer('total_events').notNull().default(0),
  completedEvents: integer('completed_events').notNull().default(0),
  totalSandwiches: integer('total_sandwiches').notNull().default(0),
  daysSinceLastEvent: integer('days_since_last_event'),
  daysSinceFirstEvent: integer('days_since_first_event'),
  lastEventDate: timestamp('last_event_date'),
  firstEventDate: timestamp('first_event_date'),
  averageEventInterval: integer('average_event_interval'), // Average days between events

  // AI-generated insights and recommendations
  engagementLevel: varchar('engagement_level').notNull().default('unknown'), // 'active', 'at_risk', 'dormant', 'new'
  outreachPriority: varchar('outreach_priority').default('normal'), // 'urgent', 'high', 'normal', 'low'
  recommendedActions: jsonb('recommended_actions').default('[]'), // Array of suggested actions
  insights: jsonb('insights').default('[]'), // Array of AI-generated insights
  programSuitability: jsonb('program_suitability').default('[]'), // Array of programs this org might be good for

  // Score calculation metadata
  lastCalculatedAt: timestamp('last_calculated_at').defaultNow().notNull(),
  calculationVersion: varchar('calculation_version').default('1.0'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('idx_org_engagement_canonical').on(table.canonicalName),
  index('idx_org_engagement_score').on(table.overallEngagementScore),
  index('idx_org_engagement_level').on(table.engagementLevel),
  index('idx_org_engagement_priority').on(table.outreachPriority),
  index('idx_org_engagement_category').on(table.category),
  index('idx_org_engagement_last_calc').on(table.lastCalculatedAt),
]);

export const insertOrganizationEngagementScoreSchema = createInsertSchema(organizationEngagementScores).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const updateOrganizationEngagementScoreSchema = createInsertSchema(organizationEngagementScores)
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  })
  .partial();

export type OrganizationEngagementScore = typeof organizationEngagementScores.$inferSelect;
export type InsertOrganizationEngagementScore = z.infer<typeof insertOrganizationEngagementScoreSchema>;
export type UpdateOrganizationEngagementScore = z.infer<typeof updateOrganizationEngagementScoreSchema>;

// Ambassador Candidates - Track potential ambassador organizations for outreach
export const ambassadorCandidates = pgTable('ambassador_candidates', {
  id: serial('id').primaryKey(),

  // Organization identification (links to engagement scores via canonical name)
  organizationName: varchar('organization_name').notNull(),
  canonicalName: varchar('canonical_name').notNull().unique(),
  category: varchar('category'),

  // Outreach tracking
  status: varchar('status').notNull().default('identified'), // 'identified', 'contacted', 'in_discussion', 'confirmed', 'declined', 'on_hold'
  priority: varchar('priority').default('normal'), // 'high', 'normal', 'low'

  // Outreach history
  addedBy: varchar('added_by').references(() => users.id),
  addedAt: timestamp('added_at').defaultNow().notNull(),
  addedReason: text('added_reason'), // Why this org was added (e.g., "High engagement score", "Referred by X")

  // Contact attempts
  lastContactedAt: timestamp('last_contacted_at'),
  lastContactedBy: varchar('last_contacted_by').references(() => users.id),
  contactMethod: varchar('contact_method'), // 'email', 'phone', 'in_person', 'event'
  nextFollowUpDate: timestamp('next_follow_up_date'),

  // Notes and context
  notes: text('notes'),
  contactInfo: jsonb('contact_info'), // { email, phone, contactName, etc. }

  // Metrics snapshot at time of addition (for reference)
  engagementScoreAtAdd: decimal('engagement_score_at_add', { precision: 5, scale: 2 }),
  totalEventsAtAdd: integer('total_events_at_add'),
  totalSandwichesAtAdd: integer('total_sandwiches_at_add'),

  // Outcome tracking
  outcomeNotes: text('outcome_notes'),
  confirmedAt: timestamp('confirmed_at'),
  declinedAt: timestamp('declined_at'),
  declineReason: text('decline_reason'),

  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('idx_ambassador_canonical').on(table.canonicalName),
  index('idx_ambassador_status').on(table.status),
  index('idx_ambassador_priority').on(table.priority),
  index('idx_ambassador_next_followup').on(table.nextFollowUpDate),
]);

export const insertAmbassadorCandidateSchema = createInsertSchema(ambassadorCandidates).omit({
  id: true,
  addedAt: true,
  updatedAt: true,
});

export const updateAmbassadorCandidateSchema = createInsertSchema(ambassadorCandidates)
  .omit({
    id: true,
    addedAt: true,
    updatedAt: true,
  })
  .partial();

export type AmbassadorCandidate = typeof ambassadorCandidates.$inferSelect;
export type InsertAmbassadorCandidate = z.infer<typeof insertAmbassadorCandidateSchema>;
export type UpdateAmbassadorCandidate = z.infer<typeof updateAmbassadorCandidateSchema>;

// Email Template Sections - Customizable text sections for HTML email templates
// Allows users to personalize key text areas while keeping HTML structure intact
export const emailTemplateSections = pgTable('email_template_sections', {
  id: serial('id').primaryKey(),
  templateType: varchar('template_type').notNull(), // 'follow_up_email', 'toolkit_email', 'event_reminder', etc.
  sectionKey: varchar('section_key').notNull(), // 'greeting', 'intro', 'contact_instructions', 'closing', etc.
  sectionLabel: varchar('section_label').notNull(), // Human-readable label for the UI
  defaultContent: text('default_content').notNull(), // Default text content
  currentContent: text('current_content'), // User-customized content (null = use default)
  description: text('description'), // Help text explaining what this section is for
  placeholderHints: text('placeholder_hints'), // Example: "Available placeholders: {{firstName}}, {{organizationName}}"
  lastUpdatedBy: varchar('last_updated_by'),
  lastUpdatedAt: timestamp('last_updated_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('idx_email_template_type').on(table.templateType),
  uniqueIndex('idx_email_template_section_unique').on(table.templateType, table.sectionKey),
]);

export const insertEmailTemplateSectionSchema = createInsertSchema(emailTemplateSections).omit({
  id: true,
  createdAt: true,
});

export const updateEmailTemplateSectionSchema = createInsertSchema(emailTemplateSections)
  .omit({
    id: true,
    templateType: true,
    sectionKey: true,
    createdAt: true,
  })
  .partial();

export type EmailTemplateSection = typeof emailTemplateSections.$inferSelect;
export type InsertEmailTemplateSection = z.infer<typeof insertEmailTemplateSectionSchema>;
export type UpdateEmailTemplateSection = z.infer<typeof updateEmailTemplateSectionSchema>;

// User Email Templates - Per-user customizable templates for new org / returning contact emails
export const userEmailTemplates = pgTable('user_email_templates', {
  id: serial('id').primaryKey(),
  userId: varchar('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  newOrgSubject: text('new_org_subject'),
  newOrgBody: text('new_org_body'),
  returningContactSubject: text('returning_contact_subject'),
  returningContactBody: text('returning_contact_body'),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => [
  uniqueIndex('idx_user_email_templates_user_id').on(table.userId),
]);

export const insertUserEmailTemplateSchema = createInsertSchema(userEmailTemplates).omit({
  id: true,
});
export const updateUserEmailTemplateSchema = createInsertSchema(userEmailTemplates)
  .omit({ id: true, userId: true })
  .partial();

export type UserEmailTemplate = typeof userEmailTemplates.$inferSelect;
export type InsertUserEmailTemplate = z.infer<typeof insertUserEmailTemplateSchema>;
export type UpdateUserEmailTemplate = z.infer<typeof updateUserEmailTemplateSchema>;

// Email Logs - Tracks all outbound emails sent via the event system
export const emailLogs = pgTable('email_logs', {
  id: serial('id').primaryKey(),
  eventId: integer('event_id').references(() => eventRequests.id, { onDelete: 'set null' }),
  sentAt: timestamp('sent_at').defaultNow(),
  sentBy: varchar('sent_by').references(() => users.id, { onDelete: 'set null' }),
  recipientEmail: text('recipient_email').notNull(),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  templateType: text('template_type'), // 'new_org' | 'returning_contact'
}, (table) => [
  index('idx_email_logs_event_id').on(table.eventId),
  index('idx_email_logs_sent_by').on(table.sentBy),
]);

export const insertEmailLogSchema = createInsertSchema(emailLogs).omit({
  id: true,
  sentAt: true,
});

export type EmailLog = typeof emailLogs.$inferSelect;
export type InsertEmailLog = z.infer<typeof insertEmailLogSchema>;

// Password reset and initial password setup tokens
// Replaces in-memory token storage for production scalability
export const passwordResetTokens = pgTable('password_reset_tokens', {
  id: serial('id').primaryKey(),
  token: varchar('token', { length: 64 }).notNull().unique(),
  userId: varchar('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  email: varchar('email').notNull(),
  tokenType: varchar('token_type', { length: 32 }).notNull().default('password_reset'), // 'password_reset' or 'initial_password'
  expiresAt: timestamp('expires_at').notNull(),
  usedAt: timestamp('used_at'), // Set when token is used
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('idx_password_reset_tokens_token').on(table.token),
  index('idx_password_reset_tokens_user_id').on(table.userId),
  index('idx_password_reset_tokens_expires').on(table.expiresAt),
]);

export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;
export type InsertPasswordResetToken = typeof passwordResetTokens.$inferInsert;

// ============================================================================
// TSP CONTACT FOLLOWUP NOTIFICATIONS - Track automated reminders to TSP contacts
// ============================================================================

/**
 * TSP Contact Followup Notifications - Prevents duplicate automated reminders
 * Tracks when notifications were sent to TSP contacts for specific reminder types
 */
export const tspContactFollowups = pgTable('tsp_contact_followups', {
  id: serial('id').primaryKey(),
  
  // Event and contact identification
  eventRequestId: integer('event_request_id').notNull().references(() => eventRequests.id, { onDelete: 'cascade' }),
  tspContactUserId: varchar('tsp_contact_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  
  // Reminder type: 'approaching_event' | 'toolkit_followup'
  reminderType: varchar('reminder_type').notNull(),
  
  // Delivery tracking
  deliveryChannel: varchar('delivery_channel').notNull(), // 'sms' | 'email'
  sentAt: timestamp('sent_at').defaultNow().notNull(),
  deliveryStatus: varchar('delivery_status').default('sent'), // 'sent' | 'delivered' | 'failed'
  
  // Context snapshot (for audit/debugging)
  eventOrganization: varchar('event_organization'),
  eventDate: timestamp('event_date'),
  messagePreview: text('message_preview'),
  
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('idx_tsp_followup_event').on(table.eventRequestId),
  index('idx_tsp_followup_contact').on(table.tspContactUserId),
  index('idx_tsp_followup_type').on(table.reminderType),
  index('idx_tsp_followup_sent').on(table.sentAt),
  uniqueIndex('idx_tsp_followup_unique').on(table.eventRequestId, table.tspContactUserId, table.reminderType),
]);

export const insertTspContactFollowupSchema = createInsertSchema(tspContactFollowups).omit({
  id: true,
  createdAt: true,
});

export type TspContactFollowup = typeof tspContactFollowups.$inferSelect;
export type InsertTspContactFollowup = z.infer<typeof insertTspContactFollowupSchema>;

// ============================================================================
// HOST RESOURCES - Manageable reference materials for the Host Resources page
// ============================================================================

export const hostResources = pgTable('host_resources', {
  id: serial('id').primaryKey(),
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description').notNull(),
  category: varchar('category', { length: 50 }).notNull(), // 'document' | 'image' | 'link'
  fileType: varchar('file_type', { length: 20 }), // 'PDF', 'JPEG', 'PNG', etc.
  fileUrl: text('file_url').notNull(), // URL path like /documents/foo.pdf or /images/bar.png
  fileName: varchar('file_name', { length: 255 }), // Download filename
  sortOrder: integer('sort_order').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const insertHostResourceSchema = createInsertSchema(hostResources).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type HostResource = typeof hostResources.$inferSelect;
export type InsertHostResource = z.infer<typeof insertHostResourceSchema>;

// ============================================================================
// EVENT CONTACTS DIRECTORY - Aggregated view of contacts from event requests
// ============================================================================

/**
 * EventContact - Deduplicated contact from event requests
 * Aggregates primary, backup, and TSP contacts across all events
 */
export interface EventContact {
  id: string; // Composite key: `${email}|${phone}` or generated UUID
  firstName: string;
  lastName: string;
  fullName: string;
  email: string | null;
  phone: string | null;

  // Contact role indicators
  contactRoles: ('primary' | 'backup' | 'tsp')[];

  // For TSP contacts, store the user ID
  tspUserId?: string;

  // Aggregate statistics
  totalEvents: number;
  completedEvents: number;
  hasOnlyIncompleteEvents: boolean; // true if only 'new' or 'in_process' events

  // Organization connections
  organizations: string[];
  organizationCategories: string[]; // Unique categories from all associated organizations

  // Timing
  lastEventDate: string | null;
  firstEventDate: string | null;
}

/**
 * EventContactEvent - Event details for a contact's event history
 */
export interface EventContactEvent {
  eventId: number;
  organizationName: string;
  scheduledEventDate: string | null;
  eventAddress: string | null;
  status: string;
  sandwichCount: number; // actualSandwichCount || estimatedSandwichCount
  contactRole: 'primary' | 'backup' | 'tsp';
}

/**
 * EventContactDetail - Full contact details including event history
 */
export interface EventContactDetail extends EventContact {
  events: EventContactEvent[];
}

export const appSettings = pgTable('app_settings', {
  key: varchar('key', { length: 100 }).primaryKey(),
  value: text('value').notNull(),
  description: text('description'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  updatedBy: varchar('updated_by'),
});

export type AppSetting = typeof appSettings.$inferSelect;
export const insertAppSettingSchema = createInsertSchema(appSettings).omit({
  updatedAt: true,
});
export type InsertAppSetting = z.infer<typeof insertAppSettingSchema>;

export const ANNUAL_SANDWICH_GOAL_KEY = 'annual_sandwich_goal';
export const DEFAULT_ANNUAL_SANDWICH_GOAL = 500000;
