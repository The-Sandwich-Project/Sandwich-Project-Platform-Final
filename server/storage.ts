import { normalizeEventContactPatch } from '@shared/event-contact-resolution';
import { normalizeToolkitPatch } from '@shared/toolkit-state';
import fs from 'fs';
import path from 'path';
import {
  users,
  projects,
  projectTasks,
  projectComments,
  taskCompletions,
  messages,
  weeklyReports,
  meetingMinutes,
  driveLinks,
  sandwichCollections,
  sandwichDistributions,
  agendaItems,
  meetings,
  driverAgreements,
  drivers,
  driverVehicles,
  volunteers,
  hosts,
  hostContacts,
  recipients,
  contacts,
  notifications,
  committees,
  committeeMemberships,
  announcements,
  suggestions,
  suggestionResponses,
  wishlistSuggestions,
  documents,
  documentPermissions,
  documentAccessLogs,
  confidentialDocuments,
  eventRequests,
  organizations,
  eventVolunteers,
  eventReminders,
  meetingNotes,
  importedExternalIds,
  availabilitySlots,
  searchAnalytics,
  type User,
  type InsertUser,
  type UpsertUser,
  type Project,
  type InsertProject,
  type ProjectTask,
  type InsertProjectTask,
  type ProjectComment,
  type InsertProjectComment,
  type TaskCompletion,
  type InsertTaskCompletion,
  type Message,
  type InsertMessage,
  type WeeklyReport,
  type InsertWeeklyReport,
  type SandwichCollection,
  type InsertSandwichCollection,
  type MeetingMinutes,
  type InsertMeetingMinutes,
  type DriveLink,
  type InsertDriveLink,
  type AgendaItem,
  type InsertAgendaItem,
  type Meeting,
  type InsertMeeting,
  type DriverAgreement,
  type InsertDriverAgreement,
  type Driver,
  type InsertDriver,
  type DriverVehicle,
  type InsertDriverVehicle,
  type Volunteer,
  type InsertVolunteer,
  type Host,
  type InsertHost,
  type HostContact,
  type InsertHostContact,
  type Recipient,
  type InsertRecipient,
  type Contact,
  type InsertContact,
  type Notification,
  type InsertNotification,
  type Committee,
  type InsertCommittee,
  type CommitteeMembership,
  type InsertCommitteeMembership,
  type Suggestion,
  type InsertSuggestion,
  type SuggestionResponse,
  type InsertSuggestionResponse,
  type ChatMessageLike,
  type InsertChatMessageLike,
  type SandwichDistribution,
  type InsertSandwichDistribution,
  type WishlistSuggestion,
  type InsertWishlistSuggestion,
  type Document,
  type InsertDocument,
  type DocumentPermission,
  type InsertDocumentPermission,
  type DocumentAccessLog,
  type InsertDocumentAccessLog,
  type ConfidentialDocument,
  type InsertConfidentialDocument,
  type EventRequest,
  type InsertEventRequest,
  type Organization,
  type InsertOrganization,
  type EventVolunteer,
  type InsertEventVolunteer,
  type MeetingNote,
  type InsertMeetingNote,
  type ImportedExternalId,
  type InsertImportedExternalId,
  type AvailabilitySlot,
  type InsertAvailabilitySlot,
  type SearchAnalytics,
  type InsertSearchAnalytics,
  type EventCollaborationComment,
  type InsertEventCollaborationComment,
  type EventFieldLock,
  type InsertEventFieldLock,
  type EventEditRevision,
  type InsertEventEditRevision,
  type CompiledAgenda,
  type UserActivityLog,
  type InsertUserActivityLog,
  type EmailTemplateSection,
  type InsertEmailTemplateSection,
  type UpdateEmailTemplateSection,
  type HostResource,
  type InsertHostResource,
} from '@shared/schema';

export interface IStorage {
  // Users (required for authentication)
  getUser(id: string): Promise<User | undefined>;
  getUserById(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  getAllUsers(): Promise<User[]>;
  updateUser(id: string, updates: Partial<User>): Promise<User | undefined>;
  setUserPassword(id: string, password: string): Promise<boolean>;
  findUserByPhoneNumber(phoneNumber: string): Promise<User | undefined>;
  getUsersByNameOrEmail(searchTerms: string[]): Promise<User[]>;

  // User activity tracking
  updateUserLastActive(userId: string): Promise<void>;
  getOnlineUsers(sinceMinutes?: number): Promise<Pick<User, 'id' | 'firstName' | 'lastName' | 'displayName' | 'email' | 'profileImageUrl' | 'lastActiveAt'>[]>;

  // Legacy user methods (for backwards compatibility)
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  // Projects
  getAllProjects(): Promise<Project[]>;
  getProject(id: number): Promise<Project | undefined>;
  createProject(project: InsertProject): Promise<Project>;
  updateProject(
    id: number,
    updates: Partial<Project>
  ): Promise<Project | undefined>;
  deleteProject(id: number): Promise<boolean>;
  getArchivedProjects(): Promise<any[]>;
  archiveProject(id: number, userId?: string, userName?: string): Promise<any>;
  getProjectsForReview(): Promise<Project[]>;

  // Project Tasks
  getProjectTasks(projectId: number): Promise<ProjectTask[]>;
  getTaskById(id: number): Promise<ProjectTask | undefined>;
  getProjectTask(taskId: number): Promise<ProjectTask | undefined>;
  getAssignedTasks(userId: string): Promise<ProjectTask[]>;
  createProjectTask(task: InsertProjectTask): Promise<ProjectTask>;
  updateProjectTask(
    id: number,
    updates: Partial<ProjectTask>
  ): Promise<ProjectTask | undefined>;
  updateTaskStatus(id: number, status: string): Promise<boolean>;
  deleteProjectTask(id: number): Promise<boolean>;
  getProjectCongratulations(projectId: number): Promise<any[]>;

  // Subtasks
  getSubtasks(parentTaskId: number): Promise<ProjectTask[]>;
  createSubtask(data: {
    parentTaskId: number;
    projectId: number | null;
    title: string;
    description?: string;
    priority?: string;
    dueDate?: string;
    assigneeIds?: string[];
    assigneeNames?: string[];
  }): Promise<ProjectTask>;
  promoteTaskToTodo(taskId: number): Promise<ProjectTask>;
  demoteTaskFromTodo(taskId: number): Promise<ProjectTask>;
  getTasksPromotedToTodo(): Promise<ProjectTask[]>;

  // Task Completions
  createTaskCompletion(
    completion: InsertTaskCompletion
  ): Promise<TaskCompletion>;
  getTaskCompletions(taskId: number): Promise<TaskCompletion[]>;
  removeTaskCompletion(taskId: number, userId: string): Promise<boolean>;

  // Project Comments
  getProjectComments(projectId: number): Promise<ProjectComment[]>;
  createProjectComment(comment: InsertProjectComment): Promise<ProjectComment>;
  deleteProjectComment(id: number): Promise<boolean>;

  // Committee management
  getAllCommittees(): Promise<Committee[]>;
  getCommittee(id: string): Promise<Committee | undefined>;
  createCommittee(committee: InsertCommittee): Promise<Committee>;
  updateCommittee(
    id: string,
    updates: Partial<Committee>
  ): Promise<Committee | undefined>;
  deleteCommittee(id: string): Promise<boolean>;

  // Committee membership management
  getUserCommittees(
    userId: string
  ): Promise<Array<Committee & { membership: CommitteeMembership }>>;
  getCommitteeMembers(
    committeeId: string
  ): Promise<Array<User & { membership: CommitteeMembership }>>;
  addUserToCommittee(
    membership: InsertCommitteeMembership
  ): Promise<CommitteeMembership>;
  updateCommitteeMembership(
    id: number,
    updates: Partial<CommitteeMembership>
  ): Promise<CommitteeMembership | undefined>;
  removeUserFromCommittee(
    userId: string,
    committeeId: string
  ): Promise<boolean>;
  isUserCommitteeMember(userId: string, committeeId: string): Promise<boolean>;

  // Messages
  getAllMessages(): Promise<Message[]>;
  getRecentMessages(limit: number): Promise<Message[]>;
  getMessagesByCommittee(committee: string): Promise<Message[]>;
  getDirectMessages(userId1: string, userId2: string): Promise<Message[]>;
  getMessageById(id: number): Promise<Message | undefined>;
  markMessageAsRead(messageId: number, userId: string): Promise<void>;
  createMessage(message: InsertMessage): Promise<Message>;
  createReply(message: InsertMessage, parentId: number): Promise<Message>;
  updateReplyCount(messageId: number): Promise<void>;
  deleteMessage(id: number): Promise<boolean>;
  getMessagesBySender(senderId: string): Promise<Message[]>;
  getMessagesBySenderWithReadStatus(senderId: string): Promise<any[]>;
  getMessagesForRecipient(recipientId: string): Promise<Message[]>;

  // Group messaging with individual thread management
  getUserMessageGroups(userId: string): Promise<any[]>;
  getMessageGroupMessages(groupId: number, userId: string): Promise<Message[]>;
  createMessageGroup(group: any): Promise<any>;
  addUserToMessageGroup(
    groupId: number,
    userId: string,
    role?: string
  ): Promise<any>;

  // Conversation methods
  createConversation(
    conversationData: any,
    participants: string[]
  ): Promise<any>;
  getConversationMessages(
    conversationId: number,
    userId: string
  ): Promise<any[]>;
  addConversationMessage(messageData: any): Promise<any>;
  updateConversationMessage(
    messageId: number,
    userId: string,
    updates: any
  ): Promise<any>;
  deleteConversationMessage(
    messageId: number,
    userId: string
  ): Promise<boolean>;
  getConversationParticipants(conversationId: number): Promise<any[]>;

  // Message likes methods
  likeMessage(
    messageId: number,
    userId: string,
    userName: string
  ): Promise<any>;
  unlikeMessage(messageId: number, userId: string): Promise<boolean>;
  getMessageLikes(messageId: number): Promise<any[]>;
  hasUserLikedMessage(messageId: number, userId: string): Promise<boolean>;

  // Chat message likes methods (for Socket.IO chat messages)
  likeChatMessage(
    messageId: number,
    userId: string,
    userName: string
  ): Promise<ChatMessageLike | null>;
  unlikeChatMessage(messageId: number, userId: string): Promise<boolean>;
  getChatMessageLikes(messageId: number): Promise<ChatMessageLike[]>;
  hasUserLikedChatMessage(messageId: number, userId: string): Promise<boolean>;

  // Weekly Reports
  getAllWeeklyReports(): Promise<WeeklyReport[]>;
  createWeeklyReport(report: InsertWeeklyReport): Promise<WeeklyReport>;

  // Sandwich Collections
  getAllSandwichCollections(): Promise<SandwichCollection[]>;
  getSandwichCollections(
    limit: number,
    offset: number,
    sortField?: string,
    sortOrder?: string
  ): Promise<SandwichCollection[]>;
  getSandwichCollectionById(id: number): Promise<SandwichCollection | null>;
  getSandwichCollectionsByEventRequestId(
    eventRequestId: number
  ): Promise<SandwichCollection[]>;
  getSandwichCollectionsCount(): Promise<number>;
  getCollectionStats(): Promise<{
    totalEntries: number;
    totalSandwiches: number;
  }>;
  createSandwichCollection(
    collection: InsertSandwichCollection
  ): Promise<SandwichCollection>;
  updateSandwichCollection(
    id: number,
    updates: Partial<SandwichCollection>
  ): Promise<SandwichCollection | undefined>;
  deleteSandwichCollection(id: number): Promise<boolean>;
  updateCollectionHostNames(
    oldHostName: string,
    newHostName: string
  ): Promise<number>;

  // Meeting Minutes
  getAllMeetingMinutes(): Promise<MeetingMinutes[]>;
  getRecentMeetingMinutes(limit: number): Promise<MeetingMinutes[]>;
  createMeetingMinutes(minutes: InsertMeetingMinutes): Promise<MeetingMinutes>;
  deleteMeetingMinutes(id: number): Promise<boolean>;

  // Drive Links
  getAllDriveLinks(): Promise<DriveLink[]>;
  createDriveLink(link: InsertDriveLink): Promise<DriveLink>;

  // Agenda Items
  getAllAgendaItems(): Promise<AgendaItem[]>;
  createAgendaItem(item: InsertAgendaItem): Promise<AgendaItem>;
  updateAgendaItemStatus(
    id: number,
    status: string
  ): Promise<AgendaItem | undefined>;
  updateAgendaItem(
    id: number,
    updates: Partial<AgendaItem>
  ): Promise<AgendaItem | undefined>;
  deleteAgendaItem(id: number): Promise<boolean>;

  // Meetings
  getCurrentMeeting(): Promise<Meeting | undefined>;
  getAllMeetings(): Promise<Meeting[]>;
  getMeeting(id: number): Promise<Meeting | undefined>;
  getMeetingsByType(type: string): Promise<Meeting[]>;
  createMeeting(meeting: InsertMeeting): Promise<Meeting>;
  updateMeetingAgenda(id: number, agenda: string): Promise<Meeting | undefined>;
  updateMeeting(
    id: number,
    updates: Partial<Meeting>
  ): Promise<Meeting | undefined>;
  deleteMeeting(id: number): Promise<boolean>;
  getCompiledAgendasByMeeting(meetingId: number): Promise<CompiledAgenda[]>;

  // Meeting Notes
  getAllMeetingNotes(): Promise<MeetingNote[]>;
  getMeetingNote(id: number): Promise<MeetingNote | undefined>;
  getMeetingNotesByProject(projectId: number): Promise<MeetingNote[]>;
  getMeetingNotesByMeeting(meetingId: number): Promise<MeetingNote[]>;
  getMeetingNotesByFilters(filters: {
    projectId?: number;
    meetingId?: number;
    type?: string;
    status?: string;
  }): Promise<MeetingNote[]>;
  createMeetingNote(note: InsertMeetingNote): Promise<MeetingNote>;
  updateMeetingNote(
    id: number,
    updates: Partial<MeetingNote>
  ): Promise<MeetingNote | undefined>;
  deleteMeetingNote(id: number): Promise<boolean>;

  // Driver Agreements (admin access only)
  createDriverAgreement(
    agreement: InsertDriverAgreement
  ): Promise<DriverAgreement>;

  // Drivers
  getAllDrivers(): Promise<Driver[]>;
  getAllDriversUnlimited(): Promise<Driver[]>;
  getDriver(id: number): Promise<Driver | undefined>;
  createDriver(driver: InsertDriver): Promise<Driver>;
  updateDriver(
    id: number,
    updates: Partial<Driver>
  ): Promise<Driver | undefined>;
  deleteDriver(id: number): Promise<boolean>;

  // Driver Vehicles
  getDriverVehicles(driverId: number): Promise<DriverVehicle[]>;
  getDriverVehicle(id: number): Promise<DriverVehicle | undefined>;
  createDriverVehicle(vehicle: InsertDriverVehicle): Promise<DriverVehicle>;
  updateDriverVehicle(
    id: number,
    updates: Partial<DriverVehicle>
  ): Promise<DriverVehicle | undefined>;
  deleteDriverVehicle(id: number): Promise<boolean>;

  // Volunteers
  getAllVolunteers(): Promise<Volunteer[]>;
  getVolunteer(id: number): Promise<Volunteer | undefined>;
  createVolunteer(volunteer: InsertVolunteer): Promise<Volunteer>;
  updateVolunteer(
    id: number,
    updates: Partial<Volunteer>
  ): Promise<Volunteer | undefined>;
  deleteVolunteer(id: number): Promise<boolean>;

  // Hosts
  getAllHosts(): Promise<Host[]>;
  getAllHostsWithContacts(): Promise<Array<Host & { contacts: HostContact[] }>>;
  getHost(id: number): Promise<Host | undefined>;
  createHost(host: InsertHost): Promise<Host>;
  updateHost(id: number, updates: Partial<Host>): Promise<Host | undefined>;
  deleteHost(id: number): Promise<boolean>;

  // Recipients
  getAllRecipients(): Promise<Recipient[]>;
  getRecipient(id: number): Promise<Recipient | undefined>;
  createRecipient(recipient: InsertRecipient): Promise<Recipient>;
  updateRecipient(
    id: number,
    updates: Partial<Recipient>
  ): Promise<Recipient | undefined>;
  deleteRecipient(id: number): Promise<boolean>;

  // General Contacts
  getAllContacts(): Promise<Contact[]>;
  getContact(id: number): Promise<Contact | undefined>;
  createContact(contact: InsertContact): Promise<Contact>;
  updateContact(
    id: number,
    updates: Partial<Contact>
  ): Promise<Contact | undefined>;
  deleteContact(id: number): Promise<boolean>;

  // Host Contacts
  createHostContact(contact: InsertHostContact): Promise<HostContact>;
  getHostContact(id: number): Promise<HostContact | undefined>;
  getHostContacts(hostId: number): Promise<HostContact[]>;
  updateHostContact(
    id: number,
    updates: Partial<HostContact>
  ): Promise<HostContact | undefined>;
  deleteHostContact(id: number): Promise<boolean>;
  getAllHostsWithContacts(): Promise<Array<Host & { contacts: HostContact[] }>>;

  // Notifications & Celebrations
  getUserNotifications(userId: string): Promise<Notification[]>;
  createNotification(notification: InsertNotification): Promise<Notification>;
  markNotificationRead(id: number): Promise<boolean>;
  deleteNotification(id: number): Promise<boolean>;
  createCelebration(
    userId: string,
    taskId: number,
    message: string
  ): Promise<Notification>;

  // Announcements
  getAllAnnouncements(): Promise<any[]>;
  createAnnouncement(announcement: any): Promise<any>;
  updateAnnouncement(id: number, updates: any): Promise<any | undefined>;
  deleteAnnouncement(id: number): Promise<boolean>;

  // Suggestions Portal
  getAllSuggestions(): Promise<Suggestion[]>;
  getSuggestion(id: number): Promise<Suggestion | undefined>;
  createSuggestion(suggestion: InsertSuggestion): Promise<Suggestion>;
  updateSuggestion(
    id: number,
    updates: Partial<Suggestion>
  ): Promise<Suggestion | undefined>;
  deleteSuggestion(id: number): Promise<boolean>;
  upvoteSuggestion(id: number): Promise<boolean>;

  // Wishlist Suggestions
  getAllWishlistSuggestions(): Promise<WishlistSuggestion[]>;
  getWishlistSuggestion(id: number): Promise<WishlistSuggestion | undefined>;
  createWishlistSuggestion(
    suggestion: InsertWishlistSuggestion
  ): Promise<WishlistSuggestion>;
  updateWishlistSuggestion(
    id: number,
    updates: Partial<WishlistSuggestion>
  ): Promise<WishlistSuggestion | undefined>;
  deleteWishlistSuggestion(id: number): Promise<boolean>;
  getRecentWishlistActivity(limit?: number): Promise<WishlistSuggestion[]>;

  // Suggestion Responses
  getSuggestionResponses(suggestionId: number): Promise<SuggestionResponse[]>;
  createSuggestionResponse(
    response: InsertSuggestionResponse
  ): Promise<SuggestionResponse>;
  deleteSuggestionResponse(id: number): Promise<boolean>;

  // Project assignments
  getProjectAssignments(projectId: number): Promise<any[]>;
  addProjectAssignment(assignment: {
    projectId: number;
    userId: string;
    role: string;
  }): Promise<any>;
  removeProjectAssignment(projectId: number, userId: string): Promise<boolean>;
  updateProjectAssignment(
    projectId: number,
    userId: string,
    updates: { role: string }
  ): Promise<any>;

  // Chat message methods for Socket.IO
  createChatMessage(data: {
    channel: string;
    userId: string;
    userName: string;
    content: string;
  }): Promise<any>;
  getChatMessages(channel: string, limit?: number): Promise<any[]>;
  updateChatMessage(id: number, updates: { content: string }): Promise<void>;
  deleteChatMessage(id: number): Promise<void>;
  markChannelMessagesAsRead(userId: string, channel: string): Promise<void>;

  // Document Management
  getAllDocuments(): Promise<Document[]>;
  getDocument(id: number): Promise<Document | undefined>;
  getDocumentsForUser(userId: string): Promise<Document[]>; // Get documents user can access
  createDocument(document: InsertDocument): Promise<Document>;
  updateDocument(
    id: number,
    updates: Partial<Document>
  ): Promise<Document | undefined>;
  deleteDocument(id: number): Promise<boolean>;

  // Document Permissions
  getDocumentPermissions(documentId: number): Promise<DocumentPermission[]>;
  getUserDocumentPermission(
    documentId: number,
    userId: string
  ): Promise<DocumentPermission | undefined>;
  checkUserDocumentAccess(
    documentId: number,
    userId: string,
    permission: string
  ): Promise<boolean>;
  grantDocumentPermission(
    permission: InsertDocumentPermission
  ): Promise<DocumentPermission>;
  revokeDocumentPermission(
    documentId: number,
    userId: string,
    permissionType: string
  ): Promise<boolean>;
  updateDocumentPermission(
    id: number,
    updates: Partial<DocumentPermission>
  ): Promise<DocumentPermission | undefined>;

  // Document Access Logging
  logDocumentAccess(
    access: InsertDocumentAccessLog
  ): Promise<DocumentAccessLog>;
  getDocumentAccessLogs(documentId: number): Promise<DocumentAccessLog[]>;

  // Confidential Document Management
  createConfidentialDocument(data: InsertConfidentialDocument): Promise<ConfidentialDocument>;
  getConfidentialDocumentsForUser(userEmail: string): Promise<ConfidentialDocument[]>;
  getConfidentialDocumentById(id: number, userEmail: string): Promise<ConfidentialDocument | null>;
  deleteConfidentialDocument(id: number, userEmail: string): Promise<boolean>;

  // Shoutout methods
  createShoutoutLog(log: {
    templateName: string;
    subject: string;
    message: string;
    recipientCount: number;
    sentAt: string;
    status: string;
    sentBy: string;
    successCount?: number;
    failureCount?: number;
  }): Promise<any>;
  getShoutoutHistory(): Promise<any[]>;

  // User Activity methods
  logUserActivity(activity: InsertUserActivityLog): Promise<UserActivityLog>;
  getUserActivityStats(
    userId: string,
    days?: number
  ): Promise<{
    totalActions: number;
    sectionsUsed: string[];
    topActions: { action: string; count: number }[];
    dailyActivity: { date: string; count: number }[];
  }>;
  getAllUsersActivitySummary(days?: number): Promise<
    {
      userId: string;
      email: string;
      firstName: string;
      lastName: string;
      totalActions: number;
      lastActive: Date | null;
      topSection: string;
    }[]
  >;

  // Sandwich Distributions (Distribution Tracking)
  getAllSandwichDistributions(): Promise<SandwichDistribution[]>;
  getSandwichDistribution(
    id: number
  ): Promise<SandwichDistribution | undefined>;
  createSandwichDistribution(
    insertDistribution: InsertSandwichDistribution
  ): Promise<SandwichDistribution>;
  updateSandwichDistribution(
    id: number,
    updates: Partial<SandwichDistribution>
  ): Promise<SandwichDistribution | undefined>;
  deleteSandwichDistribution(id: number): Promise<boolean>;
  getSandwichDistributionsByWeek(
    weekEnding: string
  ): Promise<SandwichDistribution[]>;
  getSandwichDistributionsByHost(
    hostId: number
  ): Promise<SandwichDistribution[]>;
  getSandwichDistributionsByRecipient(
    recipientId: number
  ): Promise<SandwichDistribution[]>;

  // Event Requests (Event Planning)
  getAllEventRequests(): Promise<EventRequest[]>;
  getEventRequestsByStatuses(statuses: string[]): Promise<EventRequest[]>;
  getEventRequest(id: number): Promise<EventRequest | undefined>;
  createEventRequest(
    insertEventRequest: InsertEventRequest
  ): Promise<EventRequest>;
  updateEventRequest(
    id: number,
    updates: Partial<EventRequest>
  ): Promise<EventRequest | undefined>;
  deleteEventRequest(id: number): Promise<boolean>;
  getEventRequestsByStatus(status: string): Promise<EventRequest[]>;
  getEventRequestsByOrganization(
    organizationName: string
  ): Promise<EventRequest[]>;
  checkOrganizationDuplicates(
    organizationName: string
  ): Promise<{ exists: boolean; matches: Organization[] }>;

  // Event Collaboration Comments
  getEventCollaborationComments(eventRequestId: number): Promise<EventCollaborationComment[]>;
  getBulkEventCollaborationComments(eventRequestIds: number[]): Promise<Map<number, EventCollaborationComment[]>>;
  createEventCollaborationComment(data: InsertEventCollaborationComment): Promise<EventCollaborationComment>;
  updateEventCollaborationComment(id: number, content: string, userId: string): Promise<EventCollaborationComment | undefined>;
  deleteEventCollaborationComment(id: number, userId: string): Promise<boolean>;

  // Event Field Locks
  getEventFieldLocks(eventRequestId: number): Promise<EventFieldLock[]>;
  getBulkEventFieldLocks(eventRequestIds: number[]): Promise<Map<number, EventFieldLock[]>>;
  createEventFieldLock(data: InsertEventFieldLock): Promise<EventFieldLock>;
  releaseEventFieldLock(eventRequestId: number, fieldName: string, userId: string): Promise<boolean>;
  deleteEventFieldLock(eventRequestId: number, fieldName: string): Promise<boolean>;
  cleanupExpiredLocks(): Promise<number>;

  // Event Edit Revisions
  getEventEditRevisions(eventRequestId: number, options?: { fieldName?: string; limit?: number }): Promise<EventEditRevision[]>;
  getEventFieldRevisions(eventRequestId: number, fieldName: string, limit?: number, offset?: number): Promise<EventEditRevision[]>;
  createEventEditRevision(data: InsertEventEditRevision): Promise<EventEditRevision>;

  // Organizations (for duplicate detection)
  getAllOrganizations(): Promise<Organization[]>;
  getOrganization(id: number): Promise<Organization | undefined>;
  createOrganization(
    insertOrganization: InsertOrganization
  ): Promise<Organization>;
  updateOrganization(
    id: number,
    updates: Partial<Organization>
  ): Promise<Organization | undefined>;
  deleteOrganization(id: number): Promise<boolean>;
  searchOrganizations(query: string): Promise<Organization[]>;

  // Event volunteers
  getAllEventVolunteers(): Promise<EventVolunteer[]>;
  getEventVolunteersByEventId(
    eventRequestId: number
  ): Promise<EventVolunteer[]>;
  getEventVolunteersByUserId(userId: string): Promise<EventVolunteer[]>;
  createEventVolunteer(
    volunteer: InsertEventVolunteer
  ): Promise<EventVolunteer>;
  updateEventVolunteer(
    id: number,
    updates: Partial<EventVolunteer>
  ): Promise<EventVolunteer | undefined>;
  deleteEventVolunteer(id: number): Promise<boolean>;

  // Event reminders
  getEventRemindersCount(userId?: string): Promise<number>;
  getAllEventReminders(userId?: string): Promise<any[]>;
  createEventReminder(reminderData: any): Promise<any>;
  updateEventReminder(id: number, updates: any): Promise<any>;
  deleteEventReminder(id: number): Promise<boolean>;

  // Imported External IDs (Permanent Blacklist System)
  // These methods manage the permanent blacklist to prevent re-importing external_ids
  checkExternalIdExists(externalId: string, sourceTable?: string): Promise<boolean>;
  addExternalIdToBlacklist(
    externalId: string,
    sourceTable?: string,
    notes?: string
  ): Promise<ImportedExternalId>;
  getAllImportedExternalIds(sourceTable?: string): Promise<ImportedExternalId[]>;
  getImportedExternalId(
    externalId: string,
    sourceTable?: string
  ): Promise<ImportedExternalId | undefined>;
  backfillExistingExternalIds(): Promise<number>;

  // Availability Slots (Team member availability calendar)
  getAllAvailabilitySlots(): Promise<AvailabilitySlot[]>;
  getAvailabilitySlotById(id: number): Promise<AvailabilitySlot | undefined>;
  getAvailabilitySlotsByUserId(userId: string): Promise<AvailabilitySlot[]>;
  getAvailabilitySlotsByDateRange(
    startDate: Date,
    endDate: Date
  ): Promise<AvailabilitySlot[]>;
  createAvailabilitySlot(
    slot: InsertAvailabilitySlot
  ): Promise<AvailabilitySlot>;
  updateAvailabilitySlot(
    id: number,
    updates: Partial<InsertAvailabilitySlot>
  ): Promise<AvailabilitySlot>;
  deleteAvailabilitySlot(id: number): Promise<void>;

  // Dashboard Documents (Configure which documents appear on dashboard)
  getDashboardDocuments(): Promise<any[]>;
  addDashboardDocument(
    documentId: string,
    displayOrder: number,
    userId: string
  ): Promise<any>;
  removeDashboardDocument(documentId: string): Promise<boolean>;
  updateDashboardDocumentOrder(
    updates: Array<{ documentId: string; displayOrder: number }>
  ): Promise<void>;

  // Search Analytics (SmartSearch usage tracking for ML improvements)
  logSearchAnalytics(data: InsertSearchAnalytics): Promise<void>;
  getSearchAnalytics(options?: { limit?: number; userId?: string }): Promise<SearchAnalytics[]>;

  // Email Template Sections
  getEmailTemplateSections(templateType?: string): Promise<EmailTemplateSection[]>;
  getEmailTemplateSection(templateType: string, sectionKey: string): Promise<EmailTemplateSection | undefined>;
  getEmailTemplateSectionById(id: number): Promise<EmailTemplateSection | undefined>;
  createEmailTemplateSection(data: InsertEmailTemplateSection): Promise<EmailTemplateSection>;
  updateEmailTemplateSection(id: number, data: UpdateEmailTemplateSection): Promise<EmailTemplateSection | undefined>;
  resetEmailTemplateSectionToDefault(id: number): Promise<EmailTemplateSection | undefined>;

  // Host Resources (manageable reference materials)
  getHostResources(): Promise<HostResource[]>;
  getHostResource(id: number): Promise<HostResource | undefined>;
  createHostResource(data: InsertHostResource): Promise<HostResource>;
  updateHostResource(id: number, data: Partial<InsertHostResource>): Promise<HostResource | undefined>;
  deleteHostResource(id: number): Promise<boolean>;
}

export class MemStorage implements IStorage {
  private users: Map<string, User>;
  private projects: Map<number, Project>;
  private projectTasks: Map<number, ProjectTask>;
  private projectComments: Map<number, ProjectComment>;
  private messages: Map<number, Message>;
  private weeklyReports: Map<number, WeeklyReport>;
  private sandwichCollections: Map<number, SandwichCollection>;
  private meetingMinutes: Map<number, MeetingMinutes>;
  private driveLinks: Map<number, DriveLink>;
  private agendaItems: Map<number, AgendaItem>;
  private meetings: Map<number, Meeting>;
  private driverAgreements: Map<number, DriverAgreement>;
  private drivers: Map<number, Driver>;
  private volunteers: Map<number, Volunteer>;
  private hosts: Map<number, Host>;
  private hostContacts: Map<number, HostContact>;
  private recipients: Map<number, Recipient>;
  private contacts: Map<number, Contact>;
  private notifications: Map<number, Notification>;
  private committees: Map<string, Committee>;
  private committeeMemberships: Map<number, CommitteeMembership>;
  private announcements: Map<number, any>;
  private suggestions: Map<number, Suggestion>;
  private suggestionResponses: Map<number, SuggestionResponse>;
  private sandwichDistributions: Map<number, SandwichDistribution>;
  private shoutoutLogs: Map<number, any>;
  private taskCompletions: Map<number, TaskCompletion>;
  private documents: Map<number, Document>;
  private documentPermissions: Map<number, DocumentPermission>;
  private documentAccessLogs: Map<number, DocumentAccessLog>;
  private eventRequests: Map<number, EventRequest>;
  private organizations: Map<number, Organization>;
  private eventVolunteers: Map<number, EventVolunteer>;
  private dashboardDocuments: Map<number, any>;
  private currentIds: {
    user: number;
    project: number;
    projectTask: number;
    projectComment: number;
    message: number;
    weeklyReport: number;
    sandwichCollection: number;
    meetingMinutes: number;
    driveLink: number;
    agendaItem: number;
    meeting: number;
    driverAgreement: number;
    driver: number;
    volunteer: number;
    host: number;
    hostContact: number;
    recipient: number;
    contact: number;
    notification: number;
    committeeMembership: number;
    announcement: number;
    suggestion: number;
    suggestionResponse: number;
    sandwichDistribution: number;
    shoutoutLog: number;
    taskCompletion: number;
    document: number;
    documentPermission: number;
    documentAccessLog: number;
    eventRequest: number;
    organization: number;
    eventVolunteer: number;
    dashboardDocument: number;
  };

  constructor() {
    this.users = new Map();
    this.projects = new Map();
    this.projectTasks = new Map();
    this.projectComments = new Map();
    this.messages = new Map();
    this.weeklyReports = new Map();
    this.sandwichCollections = new Map();
    this.meetingMinutes = new Map();
    this.driveLinks = new Map();
    this.agendaItems = new Map();
    this.meetings = new Map();
    this.driverAgreements = new Map();
    this.drivers = new Map();
    this.volunteers = new Map();
    this.hosts = new Map();
    this.hostContacts = new Map();
    this.recipients = new Map();
    this.contacts = new Map();
    this.notifications = new Map();
    this.committees = new Map();
    this.committeeMemberships = new Map();
    this.announcements = new Map();
    this.suggestions = new Map();
    this.suggestionResponses = new Map();
    this.sandwichDistributions = new Map();
    this.shoutoutLogs = new Map();
    this.taskCompletions = new Map();
    this.documents = new Map();
    this.documentPermissions = new Map();
    this.documentAccessLogs = new Map();
    this.eventRequests = new Map();
    this.organizations = new Map();
    this.eventVolunteers = new Map();
    this.dashboardDocuments = new Map();
    this.currentIds = {
      user: 1,
      project: 1,
      projectTask: 1,
      projectComment: 1,
      message: 1,
      weeklyReport: 1,
      sandwichCollection: 1,
      meetingMinutes: 1,
      driveLink: 1,
      agendaItem: 1,
      meeting: 1,
      driverAgreement: 1,
      driver: 1,
      volunteer: 1,
      host: 1,
      hostContact: 1,
      recipient: 1,
      contact: 1,
      notification: 1,
      committeeMembership: 1,
      announcement: 1,
      suggestion: 1,
      suggestionResponse: 1,
      sandwichDistribution: 1,
      shoutoutLog: 1,
      taskCompletion: 1,
      document: 1,
      documentPermission: 1,
      documentAccessLog: 1,
      eventRequest: 1,
      organization: 1,
      eventVolunteer: 1,
      dashboardDocument: 1,
    };

    // No sample data - start with clean storage
  }

  // User methods (required for authentication)
  async getUser(id: string): Promise<User | undefined> {
    for (const user of Array.from(this.users.values())) {
      if (user.id === id) {
        return user;
      }
    }
    return undefined;
  }

  async getUserById(id: string): Promise<User | undefined> {
    for (const user of Array.from(this.users.values())) {
      if (user.id === id) {
        return user;
      }
    }
    return undefined;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    for (const user of Array.from(this.users.values())) {
      if (user.email === email) {
        return user;
      }
    }
    return undefined;
  }

  async getUsersByNameOrEmail(searchTerms: string[]): Promise<User[]> {
    if (!searchTerms || searchTerms.length === 0) {
      return [];
    }

    const matchedUsers: User[] = [];
    const lowerSearchTerms = searchTerms.map(term => term.toLowerCase().trim());

    for (const user of Array.from(this.users.values())) {
      // SECURITY: Only search active users to prevent info leakage about inactive accounts
      if (!user.isActive) {
        continue;
      }

      // Build user's full name for comparison
      const fullName = user.firstName && user.lastName
        ? `${user.firstName} ${user.lastName}`.toLowerCase()
        : (user.firstName || '').toLowerCase();
      const email = (user.email || '').toLowerCase();
      const displayName = (user.displayName || '').toLowerCase();

      // Check if any search term matches the user
      for (const searchTerm of lowerSearchTerms) {
        let matched = false;

        // SECURITY: Require minimum length for substring matching to prevent info leakage
        if (searchTerm.length < 3) {
          // For short search terms (< 3 chars), only allow exact matching
          if (fullName === searchTerm || email === searchTerm || displayName === searchTerm) {
            matched = true;
          }
        } else {
          // For longer search terms, allow substring matching on names
          // but still require exact match for email (prevent email enumeration)
          if (
            fullName.includes(searchTerm) ||
            displayName.includes(searchTerm) ||
            email === searchTerm
          ) {
            matched = true;
          }
        }

        if (matched) {
          matchedUsers.push(user);
          break; // Don't add the same user multiple times
        }
      }
    }

    return matchedUsers;
  }

  async createUser(userData: InsertUser): Promise<User> {
    const id = (userData as any).id || `user_${this.currentIds.user++}`;
    const newUser: User = {
      id,
      email: userData.email || null,
      password: userData.password || null,
      firstName: userData.firstName || null,
      lastName: userData.lastName || null,
      displayName: userData.displayName || null,
      profileImageUrl: userData.profileImageUrl || null,
      phoneNumber: userData.phoneNumber || null,
      preferredEmail: userData.preferredEmail || null,
      role: userData.role || 'volunteer',
      permissions: userData.permissions ?? [],
      permissionsModifiedAt: userData.permissionsModifiedAt || null,
      permissionsModifiedBy: userData.permissionsModifiedBy || null,
      metadata: userData.metadata ?? {},
      isActive: userData.isActive ?? true,
      lastLoginAt: userData.lastLoginAt || null,
      lastActiveAt: userData.lastActiveAt || null,
      createdAt: new Date(),
      updatedAt: new Date(),
      passwordBackup20241023: null,
    };
    this.users.set(id, newUser);
    return newUser;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const existingUser = await this.getUser(userData.id);
    if (existingUser) {
      const updated: User = {
        ...existingUser,
        ...userData,
        permissions: userData.permissions ?? existingUser.permissions,
        updatedAt: new Date(),
      };
      this.users.set(userData.id, updated);
      return updated;
    } else {
      const newUser: User = {
        id: userData.id,
        email: userData.email || null,
        password: userData.password || null,
        firstName: userData.firstName || null,
        lastName: userData.lastName || null,
        displayName: userData.displayName || null,
        profileImageUrl: userData.profileImageUrl || null,
        phoneNumber: userData.phoneNumber || null,
        preferredEmail: userData.preferredEmail || null,
        role: userData.role || 'volunteer',
        permissions: userData.permissions ?? [],
        permissionsModifiedAt: userData.permissionsModifiedAt || null,
        permissionsModifiedBy: userData.permissionsModifiedBy || null,
        metadata: userData.metadata ?? {},
        isActive: userData.isActive ?? true,
        lastLoginAt: userData.lastLoginAt || null,
        lastActiveAt: userData.lastActiveAt || null,
        createdAt: new Date(),
        updatedAt: new Date(),
        passwordBackup20241023: null,
      };
      this.users.set(userData.id, newUser);
      return newUser;
    }
  }

  async getAllUsers(): Promise<User[]> {
    return Array.from(this.users.values());
  }

  async updateUser(
    id: string,
    updates: Partial<User>
  ): Promise<User | undefined> {
    const user = await this.getUser(id);
    if (!user) return undefined;

    const updated: User = { ...user, ...updates, updatedAt: new Date() };
    this.users.set(id, updated);
    return updated;
  }

  async setUserPassword(id: string, password: string): Promise<boolean> {
    const user = await this.getUser(id);
    if (user) {
      const updated: User = {
        ...user,
        password: password,
        needsPasswordSetup: false,
        updatedAt: new Date(),
      };
      this.users.set(id, updated);
      return true;
    }
    return false;
  }

  async deleteUser(id: string): Promise<boolean> {
    if (this.users.has(id)) {
      this.users.delete(id);
      return true;
    }
    return false;
  }

  // User activity tracking
  async updateUserLastActive(userId: string): Promise<void> {
    const user = this.users.get(userId);
    if (user) {
      user.lastActiveAt = new Date();
      this.users.set(userId, user);
    }
  }

  async getOnlineUsers(sinceMinutes: number = 5): Promise<Pick<User, 'id' | 'firstName' | 'lastName' | 'displayName' | 'email' | 'profileImageUrl' | 'lastActiveAt'>[]> {
    const cutoff = new Date(Date.now() - sinceMinutes * 60 * 1000);
    return Array.from(this.users.values())
      .filter(user => user.isActive && user.lastActiveAt && user.lastActiveAt > cutoff)
      .map(user => ({
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        displayName: user.displayName,
        email: user.email,
        profileImageUrl: user.profileImageUrl,
        lastActiveAt: user.lastActiveAt,
      }));
  }

  // Legacy user methods (for backwards compatibility)
  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.email === username
    );
  }

  // Project methods
  async getAllProjects(): Promise<Project[]> {
    return Array.from(this.projects.values());
  }

  async getProject(id: number): Promise<Project | undefined> {
    return this.projects.get(id);
  }

  async createProject(insertProject: InsertProject): Promise<Project> {
    const id = this.currentIds.project++;
    const project: Project = { ...insertProject, id };
    this.projects.set(id, project);
    return project;
  }

  async updateProject(
    id: number,
    updates: Partial<Project>
  ): Promise<Project | undefined> {
    const project = this.projects.get(id);
    if (!project) return undefined;

    const updatedProject = { ...project, ...updates };
    this.projects.set(id, updatedProject);
    return updatedProject;
  }

  async deleteProject(id: number): Promise<boolean> {
    return this.projects.delete(id);
  }

  async getArchivedProjects(): Promise<any[]> {
    // For MemStorage, return empty array for now
    return [];
  }

  async archiveProject(
    id: number,
    userId?: string,
    userName?: string
  ): Promise<boolean> {
    // For MemStorage, just delete the project (simulating archive)
    return this.deleteProject(id);
  }

  async getProjectsForReview(): Promise<Project[]> {
    return Array.from(this.projects.values())
      .filter(
        (project) =>
          project.reviewInNextMeeting === true &&
          project.status !== 'completed' &&
          project.status !== 'archived'
      )
      .sort((a, b) => {
        // Sort by priority first, then by creation date
        const priorityOrder = { high: 3, medium: 2, low: 1 };
        const aPriority =
          priorityOrder[a.priority as keyof typeof priorityOrder] || 1;
        const bPriority =
          priorityOrder[b.priority as keyof typeof priorityOrder] || 1;

        if (aPriority !== bPriority) {
          return bPriority - aPriority;
        }

        return (
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
      });
  }

  // Project Task methods
  async getProjectTasks(projectId: number): Promise<ProjectTask[]> {
    return Array.from(this.projectTasks.values())
      .filter((task) => task.projectId === projectId)
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
  }

  async createProjectTask(insertTask: InsertProjectTask): Promise<ProjectTask> {
    const id = this.currentIds.projectTask++;
    const task: ProjectTask = {
      ...insertTask,
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.projectTasks.set(id, task);
    return task;
  }

  async updateProjectTask(
    id: number,
    updates: Partial<ProjectTask>
  ): Promise<ProjectTask | undefined> {
    const task = this.projectTasks.get(id);
    if (!task) return undefined;

    const updatedTask = { ...task, ...updates, updatedAt: new Date() };
    this.projectTasks.set(id, updatedTask);
    return updatedTask;
  }

  async deleteProjectTask(id: number): Promise<boolean> {
    return this.projectTasks.delete(id);
  }

  async getTaskById(id: number): Promise<ProjectTask | undefined> {
    return this.projectTasks.get(id);
  }

  async getProjectTask(taskId: number): Promise<ProjectTask | undefined> {
    return this.projectTasks.get(taskId);
  }

  async getAssignedTasks(userId: string): Promise<ProjectTask[]> {
    return Array.from(this.projectTasks.values())
      .filter((task) => {
        // Check if user is assigned via assigneeId or assigneeIds array
        return (
          (task.assigneeId && task.assigneeId === userId) ||
          (task.assigneeIds && Array.isArray(task.assigneeIds) && task.assigneeIds.includes(userId))
        );
      })
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
  }

  async updateTaskStatus(id: number, status: string): Promise<boolean> {
    const task = this.projectTasks.get(id);
    if (!task) return false;
    task.status = status;
    this.projectTasks.set(id, task);
    return true;
  }

  // Task completion methods (for fallback storage)
  async createTaskCompletion(
    completion: InsertTaskCompletion
  ): Promise<TaskCompletion> {
    // For fallback storage, we'll just return a mock completion
    const mockCompletion: TaskCompletion = {
      id: Date.now(),
      taskId: completion.taskId,
      userId: completion.userId,
      userName: completion.userName,
      completedAt: new Date(),
      notes: completion.notes,
    };
    return mockCompletion;
  }

  async getTaskCompletions(taskId: number): Promise<TaskCompletion[]> {
    // For fallback storage, return empty array
    return [];
  }

  async removeTaskCompletion(taskId: number, userId: string): Promise<boolean> {
    // For fallback storage, always return true
    return true;
  }

  // Subtask methods (for fallback storage)
  async getSubtasks(parentTaskId: number): Promise<ProjectTask[]> {
    return Array.from(this.projectTasks.values())
      .filter((task) => task.parentTaskId === parentTaskId)
      .sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
  }

  async createSubtask(data: {
    parentTaskId: number;
    projectId: number | null;
    title: string;
    description?: string;
    priority?: string;
    dueDate?: string;
    assigneeIds?: string[];
    assigneeNames?: string[];
  }): Promise<ProjectTask> {
    const id = this.currentIds.projectTask++;
    const subtask: ProjectTask = {
      id,
      projectId: data.projectId,
      parentTaskId: data.parentTaskId,
      title: data.title,
      description: data.description || null,
      status: 'pending',
      priority: data.priority || 'medium',
      assigneeId: null,
      assigneeName: null,
      assigneeIds: data.assigneeIds || null,
      assigneeNames: data.assigneeNames || null,
      dueDate: data.dueDate || null,
      completedAt: null,
      attachments: null,
      order: 0,
      orderNum: 0,
      completedBy: null,
      completedByName: null,
      originType: 'manual',
      sourceNoteId: null,
      sourceMeetingId: null,
      sourceTeamBoardId: null,
      selectedForAgenda: false,
      promotedToTodo: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.projectTasks.set(id, subtask);
    return subtask;
  }

  async promoteTaskToTodo(taskId: number): Promise<ProjectTask> {
    const task = this.projectTasks.get(taskId);
    if (!task) throw new Error('Task not found');
    task.promotedToTodo = true;
    task.updatedAt = new Date();
    this.projectTasks.set(taskId, task);
    return task;
  }

  async demoteTaskFromTodo(taskId: number): Promise<ProjectTask> {
    const task = this.projectTasks.get(taskId);
    if (!task) throw new Error('Task not found');
    task.promotedToTodo = false;
    task.updatedAt = new Date();
    this.projectTasks.set(taskId, task);
    return task;
  }

  async getTasksPromotedToTodo(): Promise<ProjectTask[]> {
    return Array.from(this.projectTasks.values())
      .filter((task) => task.promotedToTodo === true)
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
  }

  // Project Comment methods
  async getProjectComments(projectId: number): Promise<ProjectComment[]> {
    return Array.from(this.projectComments.values())
      .filter((comment) => comment.projectId === projectId)
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
  }

  async createProjectComment(
    insertComment: InsertProjectComment
  ): Promise<ProjectComment> {
    const id = this.currentIds.projectComment++;
    const comment: ProjectComment = {
      ...insertComment,
      id,
      createdAt: new Date(),
    };
    this.projectComments.set(id, comment);
    return comment;
  }

  async deleteProjectComment(id: number): Promise<boolean> {
    return this.projectComments.delete(id);
  }

  // Message methods
  async getAllMessages(): Promise<Message[]> {
    return Array.from(this.messages.values()).sort(
      (a, b) =>
        new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
    );
  }

  async getRecentMessages(limit: number): Promise<Message[]> {
    const allMessages = await this.getAllMessages();
    return allMessages.slice(0, limit);
  }

  async getMessagesByCommittee(_committee: string): Promise<Message[]> {
    // Committee field no longer exists in Message schema - return empty for MemStorage
    return [];
  }

  async getDirectMessages(
    userId1: string,
    userId2: string
  ): Promise<Message[]> {
    // Direct messaging now uses contextType='direct' - filter by that
    return Array.from(this.messages.values())
      .filter(
        (message) =>
          message.contextType === 'direct' &&
          (message.userId === userId1 || message.userId === userId2)
      )
      .sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());
  }

  async getMessageById(id: number): Promise<Message | undefined> {
    return this.messages.get(id);
  }

  async markMessageAsRead(messageId: number, userId: string): Promise<void> {
    const message = this.messages.get(messageId);
    if (message) {
      this.messages.set(messageId, { ...message, read: true });
    }
    logger.log(
      `MemStorage: Marking message ${messageId} as read for user ${userId}`
    );
  }

  async createMessage(insertMessage: InsertMessage): Promise<Message> {
    const id = this.currentIds.message++;
    const message: Message = {
      id,
      userId: insertMessage.userId,
      senderId: insertMessage.senderId,
      content: insertMessage.content,
      sender: insertMessage.sender || null,
      conversationId: insertMessage.conversationId || null,
      contextType: insertMessage.contextType || null,
      contextId: insertMessage.contextId || null,
      contextTitle: insertMessage.contextTitle || null,
      read: insertMessage.read ?? false,
      editedAt: insertMessage.editedAt || null,
      editedContent: insertMessage.editedContent || null,
      deletedAt: insertMessage.deletedAt || null,
      deletedBy: insertMessage.deletedBy || null,
      replyToMessageId: insertMessage.replyToMessageId || null,
      replyToContent: insertMessage.replyToContent || null,
      replyToSender: insertMessage.replyToSender || null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.messages.set(id, message);
    return message;
  }

  async createReply(
    insertMessage: InsertMessage,
    parentId: number
  ): Promise<Message> {
    const parentMessage = this.messages.get(parentId);
    if (!parentMessage) {
      throw new Error('Parent message not found');
    }

    const id = this.currentIds.message++;
    const message: Message = {
      id,
      userId: insertMessage.userId,
      senderId: insertMessage.senderId,
      content: insertMessage.content,
      sender: insertMessage.sender || null,
      conversationId: insertMessage.conversationId || parentMessage.conversationId,
      contextType: insertMessage.contextType || parentMessage.contextType,
      contextId: insertMessage.contextId || parentMessage.contextId,
      contextTitle: insertMessage.contextTitle || parentMessage.contextTitle,
      read: false,
      editedAt: null,
      editedContent: null,
      deletedAt: null,
      deletedBy: null,
      replyToMessageId: parentId,
      replyToContent: parentMessage.content,
      replyToSender: parentMessage.sender,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.messages.set(id, message);
    return message;
  }

  async updateReplyCount(_messageId: number): Promise<void> {
    // Reply count is no longer stored in Message schema
    // This is now a computed value from replyToMessageId references
  }

  async deleteMessage(id: number): Promise<boolean> {
    return this.messages.delete(id);
  }

  async getMessagesBySender(senderId: string): Promise<Message[]> {
    return Array.from(this.messages.values())
      .filter(
        (message) =>
          message.senderId === senderId || message.userId === senderId
      )
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
  }

  async getMessagesBySenderWithReadStatus(senderId: string): Promise<any[]> {
    // For memory storage, return messages with mock read status since we don't have recipient tracking
    const messages = await this.getMessagesBySender(senderId);
    return messages.map((message) => ({
      message,
      recipientRead: false, // Always unread in memory storage since we don't track recipients
      recipientReadAt: null,
      recipientId: message.contextId || 'unknown',
    }));
  }

  async getMessagesForRecipient(recipientId: string): Promise<Message[]> {
    return Array.from(this.messages.values())
      .filter((message) => message.contextId === recipientId)
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
  }

  // Committee management methods
  async getAllCommittees(): Promise<Committee[]> {
    return Array.from(this.committees.values());
  }

  async getCommittee(id: string): Promise<Committee | undefined> {
    return this.committees.get(id);
  }

  async createCommittee(committee: InsertCommittee): Promise<Committee> {
    const newCommittee: Committee = {
      ...committee,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.committees.set(newCommittee.id, newCommittee);
    return newCommittee;
  }

  async updateCommittee(
    id: string,
    updates: Partial<Committee>
  ): Promise<Committee | undefined> {
    const committee = this.committees.get(id);
    if (!committee) return undefined;

    const updatedCommittee = {
      ...committee,
      ...updates,
      updatedAt: new Date(),
    };
    this.committees.set(id, updatedCommittee);
    return updatedCommittee;
  }

  async deleteCommittee(id: string): Promise<boolean> {
    return this.committees.delete(id);
  }

  // Committee membership management methods
  async getUserCommittees(
    userId: string
  ): Promise<Array<Committee & { membership: CommitteeMembership }>> {
    const memberships = Array.from(this.committeeMemberships.values()).filter(
      (membership) => membership.userId === userId
    );

    const result: Array<Committee & { membership: CommitteeMembership }> = [];
    for (const membership of memberships) {
      const committee = this.committees.get(membership.committeeId);
      if (committee) {
        result.push({ ...committee, membership });
      }
    }
    return result;
  }

  async getCommitteeMembers(
    committeeId: string
  ): Promise<Array<User & { membership: CommitteeMembership }>> {
    const memberships = Array.from(this.committeeMemberships.values()).filter(
      (membership) => membership.committeeId === committeeId
    );

    const result: Array<User & { membership: CommitteeMembership }> = [];
    for (const membership of memberships) {
      const user = await this.getUser(membership.userId);
      if (user) {
        result.push({ ...user, membership });
      }
    }
    return result;
  }

  async addUserToCommittee(
    membership: InsertCommitteeMembership
  ): Promise<CommitteeMembership> {
    const id = this.currentIds.committeeMembership++;
    const newMembership: CommitteeMembership = {
      ...membership,
      id,
      joinedAt: new Date(),
    };
    this.committeeMemberships.set(id, newMembership);
    return newMembership;
  }

  async updateCommitteeMembership(
    id: number,
    updates: Partial<CommitteeMembership>
  ): Promise<CommitteeMembership | undefined> {
    const membership = this.committeeMemberships.get(id);
    if (!membership) return undefined;

    const updatedMembership = { ...membership, ...updates };
    this.committeeMemberships.set(id, updatedMembership);
    return updatedMembership;
  }

  async removeUserFromCommittee(
    userId: string,
    committeeId: string
  ): Promise<boolean> {
    for (const [id, membership] of this.committeeMemberships.entries()) {
      if (
        membership.userId === userId &&
        membership.committeeId === committeeId
      ) {
        return this.committeeMemberships.delete(id);
      }
    }
    return false;
  }

  async isUserCommitteeMember(
    userId: string,
    committeeId: string
  ): Promise<boolean> {
    for (const membership of this.committeeMemberships.values()) {
      if (
        membership.userId === userId &&
        membership.committeeId === committeeId
      ) {
        return true;
      }
    }
    return false;
  }

  // Weekly Report methods
  async getAllWeeklyReports(): Promise<WeeklyReport[]> {
    return Array.from(this.weeklyReports.values()).sort(
      (a, b) =>
        new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
    );
  }

  async createWeeklyReport(
    insertReport: InsertWeeklyReport
  ): Promise<WeeklyReport> {
    const id = this.currentIds.weeklyReport++;
    const report: WeeklyReport = {
      ...insertReport,
      id,
      submittedAt: new Date(),
    };
    this.weeklyReports.set(id, report);
    return report;
  }

  // Sandwich Collection methods
  async getAllSandwichCollections(): Promise<SandwichCollection[]> {
    return Array.from(this.sandwichCollections.values()).sort(
      (a, b) =>
        new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
    );
  }

  async getSandwichCollections(
    limit: number,
    offset: number,
    sortField = 'collectionDate',
    sortOrder = 'desc'
  ): Promise<SandwichCollection[]> {
    const all = await this.getAllSandwichCollections();

    // Sort the data
    all.sort((a: any, b: any) => {
      const aVal = a[sortField];
      const bVal = b[sortField];

      if (aVal === bVal) return 0;
      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;

      const comparison = aVal < bVal ? -1 : 1;
      return sortOrder === 'asc' ? comparison : -comparison;
    });

    return all.slice(offset, offset + limit);
  }

  async getSandwichCollectionById(
    id: number
  ): Promise<SandwichCollection | null> {
    return this.sandwichCollections.get(id) || null;
  }

  async getSandwichCollectionsByEventRequestId(
    eventRequestId: number
  ): Promise<SandwichCollection[]> {
    return Array.from(this.sandwichCollections.values())
      .filter((c: any) => c.eventRequestId === eventRequestId && !c.deletedAt)
      .sort((a: any, b: any) => {
        // Newest first; return 0 on equal dates to honor the Array.sort
        // comparator contract (stable, engine-independent ordering).
        const av = a.collectionDate ?? '';
        const bv = b.collectionDate ?? '';
        if (av === bv) return 0;
        return av < bv ? 1 : -1;
      });
  }

  async getSandwichCollectionsCount(): Promise<number> {
    return this.sandwichCollections.size;
  }

  async getCollectionStats(): Promise<{
    totalEntries: number;
    totalSandwiches: number;
  }> {
    const collections = Array.from(this.sandwichCollections.values());
    // PHASE 5: Use ONLY new columns - no JSON parsing
    const totalSandwiches = collections.reduce((sum, collection) => {
      const individual = collection.individualSandwiches || 0;
      const group1 = (collection as any).group1Count || 0;
      const group2 = (collection as any).group2Count || 0;
      return sum + individual + group1 + group2;
    }, 0);
    return {
      totalEntries: collections.length,
      totalSandwiches,
    };
  }

  async createSandwichCollection(
    insertCollection: InsertSandwichCollection & { id?: number }
  ): Promise<SandwichCollection> {
    const id = insertCollection.id || this.currentIds.sandwichCollection++;
    // Update currentIds if a higher ID is provided
    if (
      insertCollection.id &&
      insertCollection.id >= this.currentIds.sandwichCollection
    ) {
      this.currentIds.sandwichCollection = insertCollection.id + 1;
    }
    const collection: SandwichCollection = {
      ...insertCollection,
      id,
      submittedAt: new Date(),
    };
    this.sandwichCollections.set(id, collection);
    return collection;
  }

  async updateSandwichCollection(
    id: number,
    updates: Partial<SandwichCollection>
  ): Promise<SandwichCollection | undefined> {
    const existing = this.sandwichCollections.get(id);
    if (!existing) return undefined;

    const updated: SandwichCollection = { ...existing, ...updates };
    this.sandwichCollections.set(id, updated);
    return updated;
  }

  async deleteSandwichCollection(id: number): Promise<boolean> {
    return this.sandwichCollections.delete(id);
  }

  async updateCollectionHostNames(
    oldHostName: string,
    newHostName: string
  ): Promise<number> {
    let updatedCount = 0;
    for (const collection of this.sandwichCollections.values()) {
      if (collection.hostName === oldHostName) {
        collection.hostName = newHostName;
        updatedCount++;
      }
    }
    return updatedCount;
  }

  // Meeting Minutes methods
  async getAllMeetingMinutes(): Promise<MeetingMinutes[]> {
    return Array.from(this.meetingMinutes.values());
  }

  async getRecentMeetingMinutes(limit: number): Promise<MeetingMinutes[]> {
    const allMinutes = await this.getAllMeetingMinutes();
    return allMinutes.slice(0, limit);
  }

  async createMeetingMinutes(
    insertMinutes: InsertMeetingMinutes
  ): Promise<MeetingMinutes> {
    const id = this.currentIds.meetingMinutes++;
    const minutes: MeetingMinutes = { ...insertMinutes, id };
    this.meetingMinutes.set(id, minutes);
    return minutes;
  }

  async deleteMeetingMinutes(id: number): Promise<boolean> {
    return this.meetingMinutes.delete(id);
  }

  // Drive Link methods
  async getAllDriveLinks(): Promise<DriveLink[]> {
    return Array.from(this.driveLinks.values());
  }

  async createDriveLink(insertLink: InsertDriveLink): Promise<DriveLink> {
    const id = this.currentIds.driveLink++;
    const link: DriveLink = { ...insertLink, id };
    this.driveLinks.set(id, link);
    return link;
  }

  // Agenda Items
  async getAllAgendaItems(): Promise<AgendaItem[]> {
    return Array.from(this.agendaItems.values()).sort(
      (a, b) =>
        new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
    );
  }

  async createAgendaItem(insertItem: InsertAgendaItem): Promise<AgendaItem> {
    const id = this.currentIds.agendaItem++;
    const item: AgendaItem = {
      ...insertItem,
      id,
      submittedAt: new Date(),
    };
    this.agendaItems.set(id, item);
    return item;
  }

  async updateAgendaItemStatus(
    id: number,
    status: string
  ): Promise<AgendaItem | undefined> {
    const item = this.agendaItems.get(id);
    if (!item) return undefined;

    const updated: AgendaItem = { ...item, status };
    this.agendaItems.set(id, updated);
    return updated;
  }

  async updateAgendaItem(
    id: number,
    updates: Partial<AgendaItem>
  ): Promise<AgendaItem | undefined> {
    const item = this.agendaItems.get(id);
    if (!item) return undefined;

    const updated: AgendaItem = { ...item, ...updates };
    this.agendaItems.set(id, updated);
    return updated;
  }

  async deleteAgendaItem(id: number): Promise<boolean> {
    return this.agendaItems.delete(id);
  }

  // Meetings
  async getCurrentMeeting(): Promise<Meeting | undefined> {
    const meetings = Array.from(this.meetings.values());
    return meetings.find((m) => m.status === 'planning') || meetings[0];
  }

  async getAllMeetings(): Promise<Meeting[]> {
    return Array.from(this.meetings.values()).sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );
  }

  async getMeeting(id: number): Promise<Meeting | undefined> {
    return this.meetings.get(id);
  }

  async getMeetingsByType(type: string): Promise<Meeting[]> {
    return Array.from(this.meetings.values())
      .filter((m) => m.type === type)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }

  async getCompiledAgendasByMeeting(meetingId: number): Promise<CompiledAgenda[]> {
    return [];
  }

  async createMeeting(insertMeeting: InsertMeeting): Promise<Meeting> {
    const id = this.currentIds.meeting++;
    const meeting: Meeting = {
      ...insertMeeting,
      id,
      createdAt: new Date(),
    };
    this.meetings.set(id, meeting);
    return meeting;
  }

  async updateMeetingAgenda(
    id: number,
    agenda: string
  ): Promise<Meeting | undefined> {
    const meeting = this.meetings.get(id);
    if (!meeting) return undefined;

    const updated: Meeting = {
      ...meeting,
      finalAgenda: agenda,
      status: 'agenda_set',
    };
    this.meetings.set(id, updated);
    return updated;
  }

  async updateMeeting(
    id: number,
    updates: Partial<Meeting>
  ): Promise<Meeting | undefined> {
    const meeting = this.meetings.get(id);
    if (!meeting) return undefined;

    const updated: Meeting = {
      ...meeting,
      ...updates,
    };
    this.meetings.set(id, updated);
    return updated;
  }

  async deleteMeeting(id: number): Promise<boolean> {
    return this.meetings.delete(id);
  }

  async createDriverAgreement(
    insertAgreement: InsertDriverAgreement
  ): Promise<DriverAgreement> {
    const id = this.currentIds.driverAgreement++;
    const agreement: DriverAgreement = {
      ...insertAgreement,
      id,
      submittedAt: new Date(),
    };
    this.driverAgreements.set(id, agreement);
    return agreement;
  }

  // Driver methods
  async getAllDrivers(): Promise<Driver[]> {
    const drivers = Array.from(this.drivers.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
    
    // Apply same limit as database storage for consistency
    const results = drivers.slice(0, 2000);
    
    if (results.length === 2000) {
      console.warn('getAllDrivers() returned exactly 2000 drivers - limit may have been reached, some data could be missing');
    }
    
    return results;
  }

  async getAllDriversUnlimited(): Promise<Driver[]> {
    return Array.from(this.drivers.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }

  async getDriver(id: number): Promise<Driver | undefined> {
    return this.drivers.get(id);
  }

  async createDriver(insertDriver: InsertDriver): Promise<Driver> {
    const id = this.currentIds.driver++;
    const driver: Driver = {
      ...insertDriver,
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.drivers.set(id, driver);
    return driver;
  }

  async updateDriver(
    id: number,
    updates: Partial<Driver>
  ): Promise<Driver | undefined> {
    const driver = this.drivers.get(id);
    if (!driver) return undefined;

    const updatedDriver: Driver = {
      ...driver,
      ...updates,
      updatedAt: new Date(),
    };
    this.drivers.set(id, updatedDriver);
    return updatedDriver;
  }

  async deleteDriver(id: number): Promise<boolean> {
    return this.drivers.delete(id);
  }

  // Driver vehicle methods (in-memory implementation)
  private driverVehiclesMap = new Map<number, DriverVehicle>();
  private currentDriverVehicleId = 1;

  async getDriverVehicles(driverId: number): Promise<DriverVehicle[]> {
    return Array.from(this.driverVehiclesMap.values()).filter(
      (v) => v.driverId === driverId
    );
  }

  async getDriverVehicle(id: number): Promise<DriverVehicle | undefined> {
    return this.driverVehiclesMap.get(id);
  }

  async createDriverVehicle(
    vehicle: InsertDriverVehicle
  ): Promise<DriverVehicle> {
    const id = this.currentDriverVehicleId++;
    const now = new Date();
    const newVehicle: DriverVehicle = {
      id,
      ...vehicle,
      year: vehicle.year ?? null,
      color: vehicle.color ?? null,
      coolerCapacity: vehicle.coolerCapacity ?? null,
      isPrimary: vehicle.isPrimary ?? false,
      notes: vehicle.notes ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.driverVehiclesMap.set(id, newVehicle);
    return newVehicle;
  }

  async updateDriverVehicle(
    id: number,
    updates: Partial<DriverVehicle>
  ): Promise<DriverVehicle | undefined> {
    const vehicle = this.driverVehiclesMap.get(id);
    if (!vehicle) return undefined;

    const updatedVehicle: DriverVehicle = {
      ...vehicle,
      ...updates,
      updatedAt: new Date(),
    };
    this.driverVehiclesMap.set(id, updatedVehicle);
    return updatedVehicle;
  }

  async deleteDriverVehicle(id: number): Promise<boolean> {
    return this.driverVehiclesMap.delete(id);
  }

  // Volunteer methods
  async getAllVolunteers(): Promise<Volunteer[]> {
    return Array.from(this.volunteers.values());
  }

  async getVolunteer(id: number): Promise<Volunteer | undefined> {
    return this.volunteers.get(id);
  }

  async createVolunteer(insertVolunteer: InsertVolunteer): Promise<Volunteer> {
    const id = this.currentIds.volunteer++;
    const volunteer: Volunteer = {
      ...insertVolunteer,
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.volunteers.set(id, volunteer);
    return volunteer;
  }

  async updateVolunteer(
    id: number,
    updates: Partial<Volunteer>
  ): Promise<Volunteer | undefined> {
    const volunteer = this.volunteers.get(id);
    if (!volunteer) return undefined;

    const updatedVolunteer: Volunteer = {
      ...volunteer,
      ...updates,
      updatedAt: new Date(),
    };
    this.volunteers.set(id, updatedVolunteer);
    return updatedVolunteer;
  }

  async deleteVolunteer(id: number): Promise<boolean> {
    return this.volunteers.delete(id);
  }

  // Host methods
  async getAllHosts(): Promise<Host[]> {
    return Array.from(this.hosts.values());
  }

  async getHost(id: number): Promise<Host | undefined> {
    return this.hosts.get(id);
  }

  async createHost(insertHost: InsertHost): Promise<Host> {
    const id = this.currentIds.host++;
    const host: Host = {
      ...insertHost,
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.hosts.set(id, host);
    return host;
  }

  async updateHost(
    id: number,
    updates: Partial<Host>
  ): Promise<Host | undefined> {
    const host = this.hosts.get(id);
    if (!host) return undefined;

    const updatedHost: Host = {
      ...host,
      ...updates,
      updatedAt: new Date(),
    };
    this.hosts.set(id, updatedHost);
    return updatedHost;
  }

  async deleteHost(id: number): Promise<boolean> {
    return this.hosts.delete(id);
  }

  // Recipients
  async getAllRecipients(): Promise<Recipient[]> {
    return Array.from(this.recipients.values());
  }

  async getRecipient(id: number): Promise<Recipient | undefined> {
    return this.recipients.get(id);
  }

  async createRecipient(insertRecipient: InsertRecipient): Promise<Recipient> {
    const id = this.currentIds.recipient++;
    const recipient: Recipient = {
      ...insertRecipient,
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.recipients.set(id, recipient);
    return recipient;
  }

  async updateRecipient(
    id: number,
    updates: Partial<Recipient>
  ): Promise<Recipient | undefined> {
    const recipient = this.recipients.get(id);
    if (!recipient) return undefined;

    const updatedRecipient: Recipient = {
      ...recipient,
      ...updates,
      updatedAt: new Date(),
    };
    this.recipients.set(id, updatedRecipient);
    return updatedRecipient;
  }

  async deleteRecipient(id: number): Promise<boolean> {
    return this.recipients.delete(id);
  }

  // General Contacts methods
  async getAllContacts(): Promise<Contact[]> {
    return Array.from(this.contacts.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }

  async getContact(id: number): Promise<Contact | undefined> {
    return this.contacts.get(id);
  }

  async createContact(insertContact: InsertContact): Promise<Contact> {
    const id = this.currentIds.contact++;
    const now = new Date();
    const contact: Contact = {
      id,
      ...insertContact,
      createdAt: now,
      updatedAt: now,
      status: insertContact.status || 'active',
      email: insertContact.email || null,
      address: insertContact.address || null,
      organization: insertContact.organization || null,
      role: insertContact.role || null,
      notes: insertContact.notes || null,
    };
    this.contacts.set(id, contact);
    return contact;
  }

  async updateContact(
    id: number,
    updates: Partial<Contact>
  ): Promise<Contact | undefined> {
    const contact = this.contacts.get(id);
    if (!contact) return undefined;

    const updatedContact: Contact = {
      ...contact,
      ...updates,
      updatedAt: new Date(),
    };
    this.contacts.set(id, updatedContact);
    return updatedContact;
  }

  async deleteContact(id: number): Promise<boolean> {
    return this.contacts.delete(id);
  }

  // Host Contact methods
  async createHostContact(
    insertContact: InsertHostContact
  ): Promise<HostContact> {
    // Check for existing contact with same name and email to prevent duplicates
    if (insertContact.name && insertContact.email) {
      for (const contact of this.hostContacts.values()) {
        if (
          contact.name === insertContact.name &&
          contact.email === insertContact.email
        ) {
          logger.log(
            `Duplicate host contact prevented in memory: ${insertContact.name} (${insertContact.email})`
          );
          return contact;
        }
      }
    }

    const id = this.currentIds.hostContact++;
    const now = new Date();
    const contact: HostContact = {
      id,
      ...insertContact,
      createdAt: now,
      updatedAt: now,
    };
    this.hostContacts.set(id, contact);
    return contact;
  }

  async getHostContact(id: number): Promise<HostContact | undefined> {
    return this.hostContacts.get(id);
  }

  async getHostContacts(hostId: number): Promise<HostContact[]> {
    return Array.from(this.hostContacts.values())
      .filter((contact) => contact.hostId === hostId)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async updateHostContact(
    id: number,
    updates: Partial<HostContact>
  ): Promise<HostContact | undefined> {
    const contact = this.hostContacts.get(id);
    if (!contact) return undefined;

    const updatedContact: HostContact = {
      ...contact,
      ...updates,
      updatedAt: new Date(),
    };
    this.hostContacts.set(id, updatedContact);
    return updatedContact;
  }

  async deleteHostContact(id: number): Promise<boolean> {
    return this.hostContacts.delete(id);
  }

  async getAllHostsWithContacts(): Promise<
    Array<Host & { contacts: HostContact[] }>
  > {
    const allHosts = Array.from(this.hosts.values());
    return allHosts.map((host) => ({
      ...host,
      contacts: Array.from(this.hostContacts.values()).filter(
        (contact) => contact.hostId === host.id
      ),
    }));
  }

  // Notifications & Celebrations
  async getUserNotifications(userId: string): Promise<Notification[]> {
    return Array.from(this.notifications.values()).filter(
      (n) => n.userId === userId
    );
  }

  async createNotification(
    notification: InsertNotification
  ): Promise<Notification> {
    const id = this.currentIds.notification++;
    const newNotification: Notification = {
      id,
      ...notification,
      createdAt: new Date(),
    };
    this.notifications.set(id, newNotification);
    return newNotification;
  }

  async markNotificationRead(id: number): Promise<boolean> {
    const notification = this.notifications.get(id);
    if (notification) {
      notification.isRead = true;
      this.notifications.set(id, notification);
      return true;
    }
    return false;
  }

  async deleteNotification(id: number): Promise<boolean> {
    return this.notifications.delete(id);
  }

  async createCelebration(
    userId: string,
    taskId: number,
    message: string
  ): Promise<Notification> {
    const celebrationEmojis = ['🎉', '🌟', '🎊', '🥳', '🏆', '✨', '👏', '💪'];
    const randomEmoji =
      celebrationEmojis[Math.floor(Math.random() * celebrationEmojis.length)];

    return this.createNotification({
      userId,
      type: 'celebration',
      title: `${randomEmoji} Task Completed!`,
      message: `Thanks for completing your task! ${message}`,
      isRead: false,
      relatedType: 'task',
      relatedId: taskId,
      celebrationData: {
        emoji: randomEmoji,
        achievementType: 'task_completion',
        taskId,
        completedAt: new Date().toISOString(),
      },
    });
  }

  // Announcement methods
  async getAllAnnouncements(): Promise<any[]> {
    return Array.from(this.announcements.values());
  }

  async createAnnouncement(announcement: any): Promise<any> {
    const id = this.currentIds.announcement++;
    const newAnnouncement = {
      id,
      ...announcement,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.announcements.set(id, newAnnouncement);
    return newAnnouncement;
  }

  async updateAnnouncement(id: number, updates: any): Promise<any | undefined> {
    const announcement = this.announcements.get(id);
    if (announcement) {
      const updatedAnnouncement = {
        ...announcement,
        ...updates,
        updatedAt: new Date(),
      };
      this.announcements.set(id, updatedAnnouncement);
      return updatedAnnouncement;
    }
    return undefined;
  }

  async deleteAnnouncement(id: number): Promise<boolean> {
    return this.announcements.delete(id);
  }

  // Project assignments
  async getProjectAssignments(projectId: number): Promise<any[]> {
    // For MemStorage, return empty array for now
    return [];
  }

  async addProjectAssignment(assignment: {
    projectId: number;
    userId: string;
    role: string;
  }): Promise<any> {
    // For MemStorage, return basic assignment object
    return {
      id: Date.now(),
      projectId: assignment.projectId,
      userId: assignment.userId,
      role: assignment.role,
      assignedAt: new Date(),
    };
  }

  async removeProjectAssignment(
    projectId: number,
    userId: string
  ): Promise<boolean> {
    // For MemStorage, return true
    return true;
  }

  async updateProjectAssignment(
    projectId: number,
    userId: string,
    updates: { role: string }
  ): Promise<any> {
    // For MemStorage, return updated assignment
    return {
      id: Date.now(),
      projectId,
      userId,
      role: updates.role,
      assignedAt: new Date(),
    };
  }

  // Suggestions Portal methods
  async getAllSuggestions(): Promise<Suggestion[]> {
    return Array.from(this.suggestions.values()).sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  async getSuggestion(id: number): Promise<Suggestion | undefined> {
    return this.suggestions.get(id);
  }

  async createSuggestion(suggestion: InsertSuggestion): Promise<Suggestion> {
    const id = this.currentIds.suggestion++;
    const now = new Date();
    const newSuggestion: Suggestion = {
      id,
      ...suggestion,
      createdAt: now,
      updatedAt: now,
    };
    this.suggestions.set(id, newSuggestion);
    return newSuggestion;
  }

  async updateSuggestion(
    id: number,
    updates: Partial<Suggestion>
  ): Promise<Suggestion | undefined> {
    const suggestion = this.suggestions.get(id);
    if (!suggestion) return undefined;

    const updatedSuggestion: Suggestion = {
      ...suggestion,
      ...updates,
      updatedAt: new Date(),
    };
    this.suggestions.set(id, updatedSuggestion);
    return updatedSuggestion;
  }

  async deleteSuggestion(id: number): Promise<boolean> {
    // First delete all responses
    for (const [responseId, response] of this.suggestionResponses) {
      if (response.suggestionId === id) {
        this.suggestionResponses.delete(responseId);
      }
    }
    // Then delete the suggestion
    return this.suggestions.delete(id);
  }

  async upvoteSuggestion(id: number): Promise<boolean> {
    const suggestion = this.suggestions.get(id);
    if (suggestion) {
      suggestion.upvotes = (suggestion.upvotes || 0) + 1;
      this.suggestions.set(id, suggestion);
      return true;
    }
    return false;
  }

  async getSuggestionResponses(
    suggestionId: number
  ): Promise<SuggestionResponse[]> {
    return Array.from(this.suggestionResponses.values())
      .filter((response) => response.suggestionId === suggestionId)
      .sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
  }

  async createSuggestionResponse(
    response: InsertSuggestionResponse
  ): Promise<SuggestionResponse> {
    const id = this.currentIds.suggestionResponse++;
    const newResponse: SuggestionResponse = {
      id,
      ...response,
      createdAt: new Date(),
    };
    this.suggestionResponses.set(id, newResponse);
    return newResponse;
  }

  async deleteSuggestionResponse(id: number): Promise<boolean> {
    return this.suggestionResponses.delete(id);
  }

  // Shoutout methods
  async createShoutoutLog(log: {
    templateName: string;
    subject: string;
    message: string;
    recipientCount: number;
    sentAt: string;
    status: string;
    sentBy: string;
    successCount?: number;
    failureCount?: number;
  }): Promise<any> {
    const id = this.currentIds.shoutoutLog++;
    const newLog = {
      id,
      ...log,
      createdAt: new Date().toISOString(),
    };
    this.shoutoutLogs.set(id, newLog);
    return newLog;
  }

  async getShoutoutHistory(): Promise<any[]> {
    return Array.from(this.shoutoutLogs.values()).sort(
      (a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime()
    );
  }

  // User Activity Tracking methods (memory storage implementations)
  async logUserActivity(
    activity: InsertUserActivityLog
  ): Promise<UserActivityLog> {
    const id = this.currentIds.userActivity++;
    const log: UserActivityLog = {
      id,
      ...activity,
      createdAt: new Date(),
    };
    // Store in temporary memory for demo purposes
    return log;
  }

  async getUserActivityStats(
    userId: string,
    days: number = 30
  ): Promise<{
    totalActions: number;
    sectionsUsed: string[];
    topActions: { action: string; count: number }[];
    dailyActivity: { date: string; count: number }[];
  }> {
    // Return demo data for memory storage
    return {
      totalActions: 0,
      sectionsUsed: [],
      topActions: [],
      dailyActivity: [],
    };
  }

  async getAllUsersActivitySummary(days: number = 30): Promise<
    {
      userId: string;
      email: string;
      firstName: string;
      lastName: string;
      totalActions: number;
      lastActive: Date | null;
      topSection: string;
    }[]
  > {
    // Return user list with empty activity for memory storage
    const users = Array.from(this.users.values());
    return users.map((user) => ({
      userId: user.id,
      email: user.email || '',
      firstName: user.firstName || '',
      lastName: user.lastName || '',
      totalActions: 0,
      lastActive: null,
      topSection: 'none',
    }));
  }

  // Conversation methods (stub implementations for memory storage)
  async createConversation(conversationData: any, participants: string[]) {
    // TODO: Implement in memory storage
    return null;
  }

  async getConversationMessages(conversationId: number, userId: string) {
    // TODO: Implement in memory storage
    return [];
  }

  async addConversationMessage(messageData: any) {
    // TODO: Implement in memory storage
    return null;
  }

  async updateConversationMessage(
    messageId: number,
    userId: string,
    updates: any
  ) {
    // TODO: Implement in memory storage
    return null;
  }

  async deleteConversationMessage(messageId: number, userId: string) {
    // TODO: Implement in memory storage
    return false;
  }

  async getConversationParticipants(conversationId: number) {
    // TODO: Implement in memory storage
    return [];
  }

  // Chat message methods for Socket.IO (fallback implementations)
  async createChatMessage(data: {
    channel: string;
    userId: string;
    userName: string;
    content: string;
  }): Promise<any> {
    return {
      id: Date.now(),
      ...data,
      createdAt: new Date(),
    };
  }

  async updateChatMessage(
    id: number,
    updates: { content: string }
  ): Promise<void> {
    // In-memory storage doesn't persist anyway, so just log
    logger.log(
      `[MemStorage] Updated chat message ${id} with content: ${updates.content}`
    );
  }

  async getChatMessages(channel: string, limit?: number): Promise<any[]> {
    return [];
  }

  async deleteChatMessage(id: number): Promise<void> {
    // No-op for memory storage
  }

  async markChannelMessagesAsRead(
    userId: string,
    channel: string
  ): Promise<void> {
    // No-op for memory storage since it doesn't persist anyway
    logger.log(
      `[MemStorage] Marked all messages in ${channel} as read for user ${userId}`
    );
  }

  // Chat message likes methods (stub implementations for memory storage)
  async likeChatMessage(
    messageId: number,
    userId: string,
    userName: string
  ): Promise<ChatMessageLike | null> {
    // Return a mock like object for memory storage
    return {
      id: Date.now(),
      messageId,
      userId,
      userName,
      likedAt: new Date(),
    } as ChatMessageLike;
  }

  async unlikeChatMessage(messageId: number, userId: string): Promise<boolean> {
    // Always return true for memory storage
    return true;
  }

  async getChatMessageLikes(messageId: number): Promise<ChatMessageLike[]> {
    // Return empty array for memory storage
    return [];
  }

  async hasUserLikedChatMessage(
    messageId: number,
    userId: string
  ): Promise<boolean> {
    // Return false for memory storage
    return false;
  }

  // Message likes methods (stub implementations)
  async likeMessage(
    messageId: number,
    userId: string,
    userName: string
  ): Promise<any> {
    return {
      id: Date.now(),
      messageId,
      userId,
      userName,
      likedAt: new Date(),
    };
  }

  async unlikeMessage(messageId: number, userId: string): Promise<boolean> {
    return true;
  }

  async getMessageLikes(messageId: number): Promise<any[]> {
    return [];
  }

  async hasUserLikedMessage(
    messageId: number,
    userId: string
  ): Promise<boolean> {
    return false;
  }

  // Sandwich Distribution Methods
  async getAllSandwichDistributions(): Promise<SandwichDistribution[]> {
    return Array.from(this.sandwichDistributions.values());
  }

  async getSandwichDistribution(
    id: number
  ): Promise<SandwichDistribution | undefined> {
    return this.sandwichDistributions.get(id);
  }

  async createSandwichDistribution(
    insertDistribution: InsertSandwichDistribution
  ): Promise<SandwichDistribution> {
    const id = this.currentIds.sandwichDistribution++;
    const now = new Date();
    const distribution: SandwichDistribution = {
      id,
      ...insertDistribution,
      createdAt: now,
      updatedAt: now,
    };
    this.sandwichDistributions.set(id, distribution);
    return distribution;
  }

  async updateSandwichDistribution(
    id: number,
    updates: Partial<SandwichDistribution>
  ): Promise<SandwichDistribution | undefined> {
    const distribution = this.sandwichDistributions.get(id);
    if (!distribution) return undefined;

    const updated = {
      ...distribution,
      ...updates,
      updatedAt: new Date(),
    };
    this.sandwichDistributions.set(id, updated);
    return updated;
  }

  async deleteSandwichDistribution(id: number): Promise<boolean> {
    return this.sandwichDistributions.delete(id);
  }

  async getSandwichDistributionsByWeek(
    weekEnding: string
  ): Promise<SandwichDistribution[]> {
    const distributions = Array.from(this.sandwichDistributions.values());
    return distributions.filter((d) => d.weekEnding === weekEnding);
  }

  async getSandwichDistributionsByHost(
    hostId: number
  ): Promise<SandwichDistribution[]> {
    const distributions = Array.from(this.sandwichDistributions.values());
    return distributions.filter((d) => d.hostId === hostId);
  }

  async getSandwichDistributionsByRecipient(
    recipientId: number
  ): Promise<SandwichDistribution[]> {
    const distributions = Array.from(this.sandwichDistributions.values());
    return distributions.filter((d) => d.recipientId === recipientId);
  }

  // Document Management Methods
  async getAllDocuments(): Promise<Document[]> {
    const docs = Array.from(this.documents.values()).filter((doc) => doc.isActive);
    
    // If no documents exist, try to populate from public folders
    if (docs.length === 0) {
      await this.populateDocumentsFromPublicFolders();
      return Array.from(this.documents.values()).filter((doc) => doc.isActive);
    }
    
    return docs;
  }

  // Helper method to populate documents from public folders
  private async populateDocumentsFromPublicFolders(): Promise<void> {
    try {
      const DOCUMENT_CATEGORIES = {
        'toolkit': {
          folder: path.join(process.cwd(), 'public/toolkit'),
          description: 'Event toolkit documents for hosts'
        },
        'documents': {
          folder: path.join(process.cwd(), 'public/documents'), 
          description: 'General organization documents'
        }
      };

      const MIME_TYPES = {
        '.pdf': 'application/pdf',
        '.doc': 'application/msword',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        '.xls': 'application/vnd.ms-excel',
        '.txt': 'text/plain',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.webp': 'image/webp'
      };

      const getMimeType = (filePath: string) => {
        const ext = path.extname(filePath).toLowerCase();
        return MIME_TYPES[ext] || 'application/octet-stream';
      };

      const generateTitle = (fileName: string) => {
        const nameWithoutExt = path.parse(fileName).name;
        return nameWithoutExt
          .replace(/[-_]/g, ' ')
          .replace(/\b\w/g, l => l.toUpperCase());
      };

      const determineCategory = (fileName: string, folderCategory: string) => {
        const lowerName = fileName.toLowerCase();
        
        if (lowerName.includes('food safety') || lowerName.includes('safety')) {
          return 'food-safety';
        }
        if (lowerName.includes('sandwich making') || lowerName.includes('making')) {
          return 'sandwich-making';
        }
        if (lowerName.includes('pbj') || lowerName.includes('pb&j')) {
          return 'pbj-guide';
        }
        if (lowerName.includes('deli')) {
          return 'deli-guide';
        }
        if (lowerName.includes('label')) {
          return 'labels';
        }
        if (lowerName.includes('inventory') || lowerName.includes('calculator')) {
          return 'inventory';
        }
        if (lowerName.includes('bylaw') || lowerName.includes('incorporation') || lowerName.includes('501c3') || lowerName.includes('tax exempt')) {
          return 'governance';
        }
        
        return folderCategory;
      };

      let addedCount = 0;

      for (const [categoryKey, categoryInfo] of Object.entries(DOCUMENT_CATEGORIES)) {
        if (!fs.existsSync(categoryInfo.folder)) {
          continue;
        }
        
        const files = fs.readdirSync(categoryInfo.folder);
        
        for (const fileName of files) {
          const filePath = path.join(categoryInfo.folder, fileName);
          const stat = fs.statSync(filePath);
          
          // Skip directories, hidden files, and README files
          if (stat.isDirectory() || fileName.startsWith('.') || fileName.toLowerCase().includes('readme')) {
            continue;
          }
          
          // Check if document already exists
          const existingDoc = Array.from(this.documents.values()).find(doc => 
            doc.fileName === fileName && doc.filePath === filePath
          );
          
          if (existingDoc) {
            continue;
          }
          
          // Create document entry
          const documentData = {
            title: generateTitle(fileName),
            description: `${categoryInfo.description} - ${fileName}`,
            fileName: fileName,
            originalName: fileName,
            filePath: filePath,
            fileSize: stat.size,
            mimeType: getMimeType(fileName),
            category: determineCategory(fileName, categoryKey),
            isActive: true,
            uploadedBy: 'system',
            uploadedByName: 'System Import'
          };
          
          await this.createDocument(documentData);
          addedCount++;
        }
      }
      
      if (addedCount > 0) {
        logger.log(`📄 Auto-populated ${addedCount} documents from public folders`);
      }
      
    } catch (error) {
      logger.error('Error auto-populating documents:', error);
    }
  }

  async getDocument(id: number): Promise<Document | undefined> {
    return this.documents.get(id);
  }

  async getDocumentsForUser(userId: string): Promise<Document[]> {
    // Check if user has confidential documents access
    const user = await this.getUserById(userId);
    const hasConfidentialAccess =
      user?.permissions?.includes('DOCUMENTS_CONFIDENTIAL') || false;

    // For memory storage, filter documents based on confidential access
    return Array.from(this.documents.values()).filter(
      (doc) =>
        doc.isActive &&
        (hasConfidentialAccess || doc.category !== 'confidential')
    );
  }

  async createDocument(insertDocument: InsertDocument): Promise<Document> {
    const id = this.currentIds.document++;
    const now = new Date();
    const document: Document = {
      id,
      ...insertDocument,
      createdAt: now,
      updatedAt: now,
    };
    this.documents.set(id, document);
    return document;
  }

  async updateDocument(
    id: number,
    updates: Partial<Document>
  ): Promise<Document | undefined> {
    const document = this.documents.get(id);
    if (!document) return undefined;

    const updated = {
      ...document,
      ...updates,
      updatedAt: new Date(),
    };
    this.documents.set(id, updated);
    return updated;
  }

  async deleteDocument(id: number): Promise<boolean> {
    const document = this.documents.get(id);
    if (!document) return false;

    // Soft delete
    document.isActive = false;
    document.updatedAt = new Date();
    this.documents.set(id, document);
    return true;
  }

  // Document Permissions Methods
  async getDocumentPermissions(
    documentId: number
  ): Promise<DocumentPermission[]> {
    return Array.from(this.documentPermissions.values()).filter(
      (p) => p.documentId === documentId && p.isActive
    );
  }

  async getUserDocumentPermission(
    documentId: number,
    userId: string
  ): Promise<DocumentPermission | undefined> {
    return Array.from(this.documentPermissions.values()).find(
      (p) => p.documentId === documentId && p.userId === userId && p.isActive
    );
  }

  async checkUserDocumentAccess(
    documentId: number,
    userId: string,
    permission: string
  ): Promise<boolean> {
    const userPermission = await this.getUserDocumentPermission(
      documentId,
      userId
    );
    if (!userPermission) return false;

    // Check if permission type allows the requested action
    const permissionHierarchy = ['view', 'download', 'edit', 'admin'];
    const userLevel = permissionHierarchy.indexOf(
      userPermission.permissionType
    );
    const requiredLevel = permissionHierarchy.indexOf(permission);

    return userLevel >= requiredLevel;
  }

  async grantDocumentPermission(
    insertPermission: InsertDocumentPermission
  ): Promise<DocumentPermission> {
    const id = this.currentIds.documentPermission++;
    const permission: DocumentPermission = {
      id,
      ...insertPermission,
      grantedAt: new Date(),
    };
    this.documentPermissions.set(id, permission);
    return permission;
  }

  async revokeDocumentPermission(
    documentId: number,
    userId: string,
    permissionType: string
  ): Promise<boolean> {
    const permission = Array.from(this.documentPermissions.values()).find(
      (p) =>
        p.documentId === documentId &&
        p.userId === userId &&
        p.permissionType === permissionType &&
        p.isActive
    );

    if (!permission) return false;

    permission.isActive = false;
    this.documentPermissions.set(permission.id, permission);
    return true;
  }

  async updateDocumentPermission(
    id: number,
    updates: Partial<DocumentPermission>
  ): Promise<DocumentPermission | undefined> {
    const permission = this.documentPermissions.get(id);
    if (!permission) return undefined;

    const updated = { ...permission, ...updates };
    this.documentPermissions.set(id, updated);
    return updated;
  }

  // Document Access Logging Methods
  async logDocumentAccess(
    insertAccess: InsertDocumentAccessLog
  ): Promise<DocumentAccessLog> {
    const id = this.currentIds.documentAccessLog++;
    const accessLog: DocumentAccessLog = {
      id,
      ...insertAccess,
      accessedAt: new Date(),
    };
    this.documentAccessLogs.set(id, accessLog);
    return accessLog;
  }

  async getDocumentAccessLogs(
    documentId: number
  ): Promise<DocumentAccessLog[]> {
    return Array.from(this.documentAccessLogs.values())
      .filter((log) => log.documentId === documentId)
      .sort(
        (a, b) =>
          new Date(b.accessedAt).getTime() - new Date(a.accessedAt).getTime()
      );
  }

  // Event Request methods
  async getAllEventRequests(): Promise<EventRequest[]> {
    return Array.from(this.eventRequests.values()).sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  async getEventRequestsByStatuses(statuses: string[]): Promise<EventRequest[]> {
    return Array.from(this.eventRequests.values())
      .filter((request) => statuses.includes(request.status))
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
  }

  async getEventRequest(id: number): Promise<EventRequest | undefined> {
    return this.eventRequests.get(id);
  }

  async createEventRequest(
    insertEventRequest: InsertEventRequest
  ): Promise<EventRequest> {
    const id = this.currentIds.eventRequest++;
    const eventRequest: EventRequest = {
      ...normalizeToolkitPatch(normalizeEventContactPatch(insertEventRequest, Array.from(this.users.values()))),
      id,
      createdAt: new Date(),
      lastUpdated: new Date(),
      status: insertEventRequest.status || 'new',
    };
    this.eventRequests.set(id, eventRequest);
    return eventRequest;
  }

  async updateEventRequest(
    id: number,
    updates: Partial<EventRequest>
  ): Promise<EventRequest | undefined> {
    const eventRequest = this.eventRequests.get(id);
    if (!eventRequest) return undefined;

    const updated = { ...eventRequest, ...normalizeToolkitPatch(normalizeEventContactPatch(updates, Array.from(this.users.values()), eventRequest), eventRequest), lastUpdated: new Date() };
    this.eventRequests.set(id, updated);
    return updated;
  }

  async deleteEventRequest(id: number): Promise<boolean> {
    return this.eventRequests.delete(id);
  }

  async getEventRequestsByStatus(status: string): Promise<EventRequest[]> {
    return Array.from(this.eventRequests.values())
      .filter((request) => request.status === status)
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
  }

  async getEventRequestsByOrganization(
    organizationName: string
  ): Promise<EventRequest[]> {
    return Array.from(this.eventRequests.values())
      .filter((request) =>
        request.organizationName
          .toLowerCase()
          .includes(organizationName.toLowerCase())
      )
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
  }

  async checkOrganizationDuplicates(
    organizationName: string
  ): Promise<{ exists: boolean; matches: Organization[] }> {
    const matches = Array.from(this.organizations.values()).filter((org) =>
      org.name.toLowerCase().includes(organizationName.toLowerCase())
    );
    return { exists: matches.length > 0, matches };
  }

  // Organization methods
  async getAllOrganizations(): Promise<Organization[]> {
    return Array.from(this.organizations.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }

  async getOrganization(id: number): Promise<Organization | undefined> {
    return this.organizations.get(id);
  }

  async createOrganization(
    insertOrganization: InsertOrganization
  ): Promise<Organization> {
    const id = this.currentIds.organization++;
    const organization: Organization = {
      ...insertOrganization,
      id,
      createdAt: new Date(),
      lastUpdated: new Date(),
    };
    this.organizations.set(id, organization);
    return organization;
  }

  async updateOrganization(
    id: number,
    updates: Partial<Organization>
  ): Promise<Organization | undefined> {
    const organization = this.organizations.get(id);
    if (!organization) return undefined;

    const updated = { ...organization, ...updates, lastUpdated: new Date() };
    this.organizations.set(id, updated);
    return updated;
  }

  async deleteOrganization(id: number): Promise<boolean> {
    return this.organizations.delete(id);
  }

  async searchOrganizations(query: string): Promise<Organization[]> {
    const lowerQuery = query.toLowerCase();
    return Array.from(this.organizations.values())
      .filter(
        (org) =>
          org.name.toLowerCase().includes(lowerQuery) ||
          org.category?.toLowerCase().includes(lowerQuery) ||
          org.description?.toLowerCase().includes(lowerQuery)
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  // Event volunteers methods
  async getAllEventVolunteers(): Promise<EventVolunteer[]> {
    return Array.from(this.eventVolunteers.values()).sort(
      (a, b) =>
        new Date(b.signedUpAt).getTime() - new Date(a.signedUpAt).getTime()
    );
  }

  async getEventVolunteersByEventId(
    eventRequestId: number
  ): Promise<EventVolunteer[]> {
    return Array.from(this.eventVolunteers.values())
      .filter((volunteer) => volunteer.eventRequestId === eventRequestId)
      .sort((a, b) => a.role.localeCompare(b.role));
  }

  async getEventVolunteersByUserId(userId: string): Promise<EventVolunteer[]> {
    return Array.from(this.eventVolunteers.values())
      .filter((volunteer) => volunteer.volunteerUserId === userId)
      .sort(
        (a, b) =>
          new Date(b.signedUpAt).getTime() - new Date(a.signedUpAt).getTime()
      );
  }

  async createEventVolunteer(
    volunteer: InsertEventVolunteer
  ): Promise<EventVolunteer> {
    const id = this.currentIds.eventVolunteer++;
    const now = new Date();
    const newVolunteer: EventVolunteer = {
      id,
      ...volunteer,
      signedUpAt: now,
      createdAt: now,
      updatedAt: now,
      confirmedAt: null,
    };
    this.eventVolunteers.set(id, newVolunteer);
    return newVolunteer;
  }

  async updateEventVolunteer(
    id: number,
    updates: Partial<EventVolunteer>
  ): Promise<EventVolunteer | undefined> {
    const existing = this.eventVolunteers.get(id);
    if (!existing) return undefined;

    const updated: EventVolunteer = {
      ...existing,
      ...updates,
      updatedAt: new Date(),
    };
    this.eventVolunteers.set(id, updated);
    return updated;
  }

  async deleteEventVolunteer(id: number): Promise<boolean> {
    return this.eventVolunteers.delete(id);
  }

  // Event reminders methods - Database implementation
  async getEventRemindersCount(userId?: string): Promise<number> {
    try {
      let query = this.db
        .select({ count: sql<number>`count(*)` })
        .from(eventReminders)
        .where(eq(eventReminders.status, 'pending'));
      
      if (userId) {
        query = query.where(eq(eventReminders.assignedToUserId, userId)) as any;
      }
      
      const result = await query;
      return Number(result[0]?.count || 0);
    } catch (error) {
      logger.error('Error getting event reminders count:', error);
      throw error;
    }
  }

  async getAllEventReminders(userId?: string): Promise<any[]> {
    try {
      let query = this.db
        .select()
        .from(eventReminders)
        .orderBy(desc(eventReminders.createdAt));
      
      if (userId) {
        query = query.where(
          or(
            eq(eventReminders.assignedToUserId, userId),
            eq(eventReminders.createdBy, userId)
          )
        ) as any;
      }
      
      return await query;
    } catch (error) {
      logger.error('Error getting all event reminders:', error);
      throw error;
    }
  }

  async createEventReminder(reminderData: any): Promise<any> {
    try {
      const [reminder] = await this.db
        .insert(eventReminders)
        .values({
          ...reminderData,
          status: reminderData.status || 'pending',
          priority: reminderData.priority || 'medium',
        })
        .returning();
      return reminder;
    } catch (error) {
      logger.error('Error creating event reminder:', error);
      throw error;
    }
  }

  async updateEventReminder(id: number, updates: any): Promise<any> {
    try {
      const updateData: any = { ...updates };
      
      // Handle completion
      if (updates.status === 'completed' && !updates.completedAt) {
        updateData.completedAt = new Date();
      }
      
      const [updated] = await this.db
        .update(eventReminders)
        .set(updateData)
        .where(eq(eventReminders.id, id))
        .returning();
      
      return updated || null;
    } catch (error) {
      logger.error('Error updating event reminder:', error);
      throw error;
    }
  }

  async deleteEventReminder(id: number): Promise<boolean> {
    try {
      const result = await this.db
        .delete(eventReminders)
        .where(eq(eventReminders.id, id))
        .returning();
      return result.length > 0;
    } catch (error) {
      logger.error('Error deleting event reminder:', error);
      throw error;
    }
  }

  // External ID Blacklist methods (stub implementations for memory storage)
  async checkExternalIdExists(externalId: string, sourceTable?: string): Promise<boolean> {
    // Memory storage doesn't persist blacklist, always return false
    return false;
  }

  async addExternalIdToBlacklist(externalId: string, sourceTable?: string, notes?: string): Promise<ImportedExternalId> {
    // Memory storage stub - just return a minimal object
    const now = new Date();
    return {
      id: Date.now(),
      externalId,
      sourceTable: sourceTable || 'event_requests',
      importedAt: now,
      notes: notes || null,
    };
  }

  async getAllImportedExternalIds(sourceTable?: string): Promise<ImportedExternalId[]> {
    // Memory storage doesn't persist blacklist, always return empty
    return [];
  }

  async getImportedExternalId(externalId: string, sourceTable?: string): Promise<ImportedExternalId | undefined> {
    // Memory storage doesn't persist blacklist, always return undefined
    return undefined;
  }

  async backfillExistingExternalIds(): Promise<number> {
    // Memory storage stub - no backfill needed
    return 0;
  }

  // Confidential Document Methods (fallback implementations for memory storage)
  async createConfidentialDocument(data: InsertConfidentialDocument): Promise<ConfidentialDocument> {
    // For memory storage, create a minimal implementation
    const id = Date.now(); // Simple ID generation
    const now = new Date();
    const document: ConfidentialDocument = {
      id,
      fileName: data.fileName,
      filePath: data.filePath,
      originalName: data.originalName,
      allowedEmails: data.allowedEmails,
      uploadedBy: data.uploadedBy,
      uploadedAt: now,
      ...data,
    };
    return document;
  }

  async getConfidentialDocumentsForUser(userEmail: string): Promise<ConfidentialDocument[]> {
    // For memory storage fallback, return empty array
    // This prevents the "method not found" error
    return [];
  }

  async getConfidentialDocumentById(id: number, userEmail: string): Promise<ConfidentialDocument | null> {
    // For memory storage fallback, return null
    // This prevents the "method not found" error
    return null;
  }

  async deleteConfidentialDocument(id: number, userEmail: string): Promise<boolean> {
    // For memory storage fallback, return false (not found)
    // This prevents the "method not found" error
    return false;
  }

  // Dashboard Documents Methods (fallback implementations for memory storage)
  async getDashboardDocuments(): Promise<any[]> {
    // Return all active dashboard documents sorted by display order
    return Array.from(this.dashboardDocuments.values())
      .filter((doc) => doc.isActive)
      .sort((a, b) => a.displayOrder - b.displayOrder);
  }

  async addDashboardDocument(
    documentId: string,
    displayOrder: number,
    userId: string
  ): Promise<any> {
    const id = this.currentIds.dashboardDocument++;
    const doc = {
      id,
      documentId,
      displayOrder,
      isActive: true,
      addedBy: userId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.dashboardDocuments.set(id, doc);
    return doc;
  }

  async removeDashboardDocument(documentId: string): Promise<boolean> {
    // Find and delete the document by documentId
    for (const [id, doc] of this.dashboardDocuments.entries()) {
      if (doc.documentId === documentId) {
        this.dashboardDocuments.delete(id);
        return true;
      }
    }
    return false;
  }

  async updateDashboardDocumentOrder(
    updates: Array<{ documentId: string; displayOrder: number }>
  ): Promise<void> {
    // Update display order for each document
    for (const update of updates) {
      for (const [id, doc] of this.dashboardDocuments.entries()) {
        if (doc.documentId === update.documentId) {
          doc.displayOrder = update.displayOrder;
          doc.updatedAt = new Date().toISOString();
          this.dashboardDocuments.set(id, doc);
          break;
        }
      }
    }
  }

  private eventFieldLocks = new Map<number, EventFieldLock>();
  private currentEventFieldLockId = 1;

  async getEventFieldLocks(eventRequestId: number): Promise<EventFieldLock[]> {
    return Array.from(this.eventFieldLocks.values()).filter(
      (lock) => lock.eventRequestId === eventRequestId
    );
  }

  async getBulkEventFieldLocks(eventRequestIds: number[]): Promise<Map<number, EventFieldLock[]>> {
    const result = new Map<number, EventFieldLock[]>();
    for (const id of eventRequestIds) {
      result.set(id, []);
    }
    for (const lock of this.eventFieldLocks.values()) {
      if (eventRequestIds.includes(lock.eventRequestId)) {
        result.get(lock.eventRequestId)!.push(lock);
      }
    }
    return result;
  }

  async createEventFieldLock(data: InsertEventFieldLock): Promise<EventFieldLock> {
    const id = this.currentEventFieldLockId++;
    const lock: EventFieldLock = {
      id,
      eventRequestId: data.eventRequestId,
      fieldName: data.fieldName,
      lockedBy: data.lockedBy,
      lockedByName: data.lockedByName,
      lockedAt: new Date(),
      expiresAt: data.expiresAt,
    };
    this.eventFieldLocks.set(id, lock);
    return lock;
  }

  async releaseEventFieldLock(eventRequestId: number, fieldName: string, userId: string): Promise<boolean> {
    for (const [id, lock] of this.eventFieldLocks.entries()) {
      if (lock.eventRequestId === eventRequestId && lock.fieldName === fieldName && lock.lockedBy === userId) {
        this.eventFieldLocks.delete(id);
        return true;
      }
    }
    return false;
  }

  async deleteEventFieldLock(eventRequestId: number, fieldName: string): Promise<boolean> {
    for (const [id, lock] of this.eventFieldLocks.entries()) {
      if (lock.eventRequestId === eventRequestId && lock.fieldName === fieldName) {
        this.eventFieldLocks.delete(id);
        return true;
      }
    }
    return false;
  }

  async cleanupExpiredLocks(): Promise<number> {
    const now = new Date();
    let deletedCount = 0;

    const expiredLocks: number[] = [];
    for (const [id, lock] of this.eventFieldLocks) {
      if (lock.expiresAt && lock.expiresAt < now) {
        expiredLocks.push(id);
      }
    }

    for (const id of expiredLocks) {
      this.eventFieldLocks.delete(id);
      deletedCount++;
    }

    return deletedCount;
  }

  // Availability Slots (stub implementations for MemStorage fallback)
  private availabilitySlots = new Map<number, AvailabilitySlot>();
  private currentAvailabilitySlotId = 1;

  async getAllAvailabilitySlots(): Promise<AvailabilitySlot[]> {
    return Array.from(this.availabilitySlots.values());
  }

  async getAvailabilitySlotById(id: number): Promise<AvailabilitySlot | undefined> {
    return this.availabilitySlots.get(id);
  }

  async getAvailabilitySlotsByUserId(userId: string): Promise<AvailabilitySlot[]> {
    return Array.from(this.availabilitySlots.values()).filter(
      (slot) => slot.userId === userId
    );
  }

  async getAvailabilitySlotsByDateRange(
    startDate: Date,
    endDate: Date
  ): Promise<AvailabilitySlot[]> {
    return Array.from(this.availabilitySlots.values()).filter(
      (slot) =>
        new Date(slot.startAt) <= endDate && new Date(slot.endAt) >= startDate
    );
  }

  async createAvailabilitySlot(
    slot: InsertAvailabilitySlot
  ): Promise<AvailabilitySlot> {
    const id = this.currentAvailabilitySlotId++;
    const now = new Date();
    const newSlot: AvailabilitySlot = {
      id,
      userId: slot.userId,
      type: slot.type,
      startAt: slot.startAt,
      endAt: slot.endAt,
      notes: slot.notes ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.availabilitySlots.set(id, newSlot);
    return newSlot;
  }

  async updateAvailabilitySlot(
    id: number,
    updates: Partial<InsertAvailabilitySlot>
  ): Promise<AvailabilitySlot> {
    const existing = this.availabilitySlots.get(id);
    if (!existing) {
      throw new Error(`Availability slot ${id} not found`);
    }
    const updated: AvailabilitySlot = {
      ...existing,
      ...updates,
      updatedAt: new Date(),
    };
    this.availabilitySlots.set(id, updated);
    return updated;
  }

  async deleteAvailabilitySlot(id: number): Promise<void> {
    this.availabilitySlots.delete(id);
  }

  // Host Resources (in-memory stubs)
  async getHostResources(): Promise<HostResource[]> { return []; }
  async getHostResource(_id: number): Promise<HostResource | undefined> { return undefined; }
  async createHostResource(data: InsertHostResource): Promise<HostResource> {
    return { id: 0, ...data, isActive: true, createdAt: new Date(), updatedAt: new Date() } as HostResource;
  }
  async updateHostResource(_id: number, _data: Partial<InsertHostResource>): Promise<HostResource | undefined> { return undefined; }
  async deleteHostResource(_id: number): Promise<boolean> { return false; }
}

// GoogleSheetsStorage removed completely to prevent conflicts with meeting management system
import { DatabaseStorage } from './database-storage';
import { logger } from './utils/production-safe-logger';

// Create storage instance with error handling
let storageInstance: IStorage;

try {
  // Priority 1: Use database storage if available (for persistence across deployments)
  // Check for database configuration using the centralized variable names
  const hasDbConfig = process.env.DEV_DATABASE_URL || process.env.DATABASE_URL || process.env.PRODUCTION_DATABASE_URL;
  if (hasDbConfig) {
    logger.log('Using database storage for data persistence...');
    storageInstance = new DatabaseStorage();
  }
  // Old Google Sheets storage system completely removed
  // Fallback: Memory storage (data will not persist across deployments)
  else {
    logger.log(
      'No persistent storage configured, using memory storage (data will not persist)'
    );
    storageInstance = new MemStorage();
  }
} catch (error) {
  logger.error(
    'Failed to initialize persistent storage, falling back to memory:',
    error
  );
  storageInstance = new MemStorage();
}

export const storage = storageInstance;
