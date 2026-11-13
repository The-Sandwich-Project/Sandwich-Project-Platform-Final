import type { IStorage } from './storage';
import { MemStorage } from './storage';
// Removed GoogleSheetsStorage import - old implementation deleted to prevent conflicts
import { DatabaseStorage } from './database-storage';
import { logger } from './utils/production-safe-logger';
import type {
  InsertEventCollaborationComment,
  InsertEventFieldLock,
  InsertEventEditRevision,
  InsertAvailabilitySlot,
  EventRequest,
  InsertEventRequest,
  InsertEmailTemplateSection,
  UpdateEmailTemplateSection,
} from '@shared/schema';

class StorageWrapper implements IStorage {
  private primaryStorage: IStorage;
  private fallbackStorage: IStorage;
  private useGoogleSheets = false; // Disabled to prevent conflict with meeting management Google Sheets system
  private deletedIds = new Set<number>(); // Track deleted items to prevent re-sync

  constructor() {
    this.fallbackStorage = new MemStorage();

    try {
      // Use database storage as primary for persistence across deployments
      this.primaryStorage = new DatabaseStorage();
      logger.log('Database storage initialized');
    } catch (error) {
      logger.log(
        'Failed to initialize database storage, using memory storage'
      );
      this.primaryStorage = this.fallbackStorage;
    }
  }

  private async syncDataFromGoogleSheets() {
    if (!this.useGoogleSheets) return;

    try {
      // Sync sandwich collections to memory storage
      const collections = await this.primaryStorage.getAllSandwichCollections();
      let syncedCount = 0;

      for (const collection of collections) {
        // Skip items that have been deleted
        if (this.deletedIds.has(collection.id)) {
          continue;
        }

        try {
          await this.fallbackStorage.createSandwichCollection(collection);
          syncedCount++;
        } catch (error) {
          // Ignore duplicates or other sync errors
        }
      }
      logger.log(
        `Synchronized ${syncedCount} sandwich collections to memory storage`
      );
    } catch (error) {
      logger.warn('Failed to sync data from Google Sheets:', error);
    }
  }

  private hasGoogleSheetsCredentials(): boolean {
    return !!(
      process.env.GOOGLE_SPREADSHEET_ID &&
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
      process.env.GOOGLE_PRIVATE_KEY
    );
  }

  /**
   * Execute a storage operation with automatic retry on transient failures.
   * Retries up to 2 times with exponential backoff before falling back.
   *
   * IMPORTANT: For write operations (update/create/delete), we retry the
   * primary storage but do NOT silently fall back to MemStorage, because
   * MemStorage writes are lost on restart. Instead we throw the error so
   * the API route can return a proper error to the client.
   */
  /** Transient DB errors worth retrying (Neon cold start, brief connection hiccups). */
  private isTransientError(error: any): boolean {
    return error?.message?.includes('connection') ||
      error?.message?.includes('timeout') ||
      error?.message?.includes('ECONNREFUSED') ||
      error?.message?.includes('ECONNRESET') ||
      error?.message?.includes('socket hang up') ||
      error?.message?.includes('fetch failed') ||
      error?.code === 'ETIMEDOUT' ||
      error?.code === 'ECONNRESET' ||
      // PostgreSQL transient error codes
      error?.code === '40001' || // serialization_failure
      error?.code === '40P01' || // deadlock_detected
      error?.code === '08006' || // connection_failure
      error?.code === '08001' || // sqlclient_unable_to_establish_sqlconnection
      error?.code === '57P01';   // admin_shutdown (Neon cold start)
  }

  /**
   * Retry a PRIMARY-storage operation on transient errors with the same
   * backoff as executeWithFallback, but WITHOUT a MemStorage fallback. Use for
   * operations MemStorage can't serve (falling back would just throw) and where
   * a valid `undefined` result (not-found) must NOT be treated as a fallback
   * trigger. Non-transient errors and exhausted retries re-throw so the route
   * can handle them.
   */
  private async executePrimaryWithRetry<T>(operation: () => Promise<T>): Promise<T> {
    const maxRetries = 2;
    let lastError: any = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error: any) {
        lastError = error;
        if (!this.isTransientError(error) || attempt === maxRetries) {
          break;
        }
        const delay = Math.min(200 * Math.pow(2, attempt), 2000);
        // Log the full error object (not just .message) so Winston preserves
        // the stack/structured context for diagnosing repeated transient failures.
        logger.warn(`Primary storage operation failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms:`, error);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw lastError;
  }

  private async executeWithFallback<T>(
    operation: () => Promise<T>,
    fallbackOperation: () => Promise<T>,
    options?: { isWriteOperation?: boolean }
  ): Promise<T> {
    const maxRetries = 2;
    let lastError: any = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await operation();
        // For delete operations that return false, try fallback (for reads only)
        if (typeof result === 'boolean' && result === false && !options?.isWriteOperation) {
          logger.log('Primary storage operation returned false, using fallback storage');
          return fallbackOperation();
        }
        // For operations that return undefined, try fallback (for reads only)
        if (result === undefined && !options?.isWriteOperation) {
          logger.log('Primary storage operation returned undefined, using fallback storage');
          return fallbackOperation();
        }
        return result;
      } catch (error: any) {
        lastError = error;
        // Don't retry non-transient errors (validation, not-found, etc.)
        const isTransient = this.isTransientError(error);

        if (!isTransient || attempt === maxRetries) {
          break; // Don't retry non-transient errors or if we've exhausted retries
        }

        // Start with 200ms for fast recovery on brief connection hiccups
        const delay = Math.min(200 * Math.pow(2, attempt), 2000);
        logger.warn(`Primary storage operation failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms:`, error?.message);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    // For write operations, do NOT fall back to MemStorage - the data would be lost.
    // Throw the error so the API route can return a proper 500 to the client.
    if (options?.isWriteOperation) {
      logger.error('Primary storage WRITE operation failed after retries. NOT falling back to MemStorage:', lastError?.message);
      throw lastError;
    }

    // For read operations, fall back to MemStorage (better to show stale/empty than crash)
    logger.error('Primary storage READ operation failed after retries, using fallback:', lastError?.message);
    return fallbackOperation();
  }

  // User methods (required for authentication)
  async getUser(id: string) {
    try {
      // For user lookups, null/undefined is a valid result (user not found)
      const result = await this.primaryStorage.getUser(id);
      return result; // Return null/undefined as-is, don't fall back
    } catch (error) {
      logger.warn('Primary storage getUser failed, using fallback:', error);
      return this.fallbackStorage.getUser(id);
    }
  }

  async getUserById(id: string) {
    try {
      // For user lookups, null/undefined is a valid result (user not found)
      const result = await this.primaryStorage.getUserById(id);
      return result; // Return null/undefined as-is, don't fall back
    } catch (error) {
      logger.warn(
        'Primary storage getUserById failed, using fallback:',
        error
      );
      return this.fallbackStorage.getUserById(id);
    }
  }

  async getUserByEmail(email: string) {
    try {
      // For user lookups, null/undefined is a valid result (user not found)
      const result = await this.primaryStorage.getUserByEmail(email);
      return result; // Return null/undefined as-is, don't fall back
    } catch (error) {
      logger.warn(
        'Primary storage getUserByEmail failed, using fallback:',
        error
      );
      return this.fallbackStorage.getUserByEmail(email);
    }
  }

  async upsertUser(user: any) {
    return this.executeWithFallback(
      () => this.primaryStorage.upsertUser(user),
      () => this.fallbackStorage.upsertUser(user)
    );
  }

  async getAllUsers() {
    return this.executeWithFallback(
      () => this.primaryStorage.getAllUsers(),
      () => this.fallbackStorage.getAllUsers()
    );
  }

  async updateUser(id: string, updates: any) {
    return this.executeWithFallback(
      () => this.primaryStorage.updateUser(id, updates),
      () => this.fallbackStorage.updateUser(id, updates)
    );
  }

  async setUserPassword(id: string, password: string): Promise<boolean> {
    return this.executeWithFallback(
      () => this.primaryStorage.setUserPassword(id, password),
      () => this.fallbackStorage.setUserPassword(id, password)
    );
  }

  async deleteUser(id: string) {
    return this.executeWithFallback(
      () => this.primaryStorage.deleteUser(id),
      () => this.fallbackStorage.deleteUser(id)
    );
  }

  // Legacy user methods (for backwards compatibility)
  async getUserByUsername(username: string) {
    return this.executeWithFallback(
      () => this.primaryStorage.getUserByUsername(username),
      () => this.fallbackStorage.getUserByUsername(username)
    );
  }

  async createUser(user: any) {
    return this.executeWithFallback(
      () => this.primaryStorage.createUser(user),
      () => this.fallbackStorage.createUser(user)
    );
  }

  // User activity tracking
  async updateUserLastActive(userId: string): Promise<void> {
    return this.executeWithFallback(
      () => this.primaryStorage.updateUserLastActive(userId),
      () => this.fallbackStorage.updateUserLastActive(userId)
    );
  }

  async getOnlineUsers(sinceMinutes?: number) {
    return this.executeWithFallback(
      () => this.primaryStorage.getOnlineUsers(sinceMinutes),
      () => this.fallbackStorage.getOnlineUsers(sinceMinutes)
    );
  }

  async findUserByPhoneNumber(phoneNumber: string) {
    return this.executeWithFallback(
      () => this.primaryStorage.findUserByPhoneNumber(phoneNumber),
      () => this.fallbackStorage.findUserByPhoneNumber(phoneNumber)
    );
  }

  async getUsersByNameOrEmail(searchTerms: string[]) {
    return this.executeWithFallback(
      () => this.primaryStorage.getUsersByNameOrEmail(searchTerms),
      () => this.fallbackStorage.getUsersByNameOrEmail(searchTerms)
    );
  }

  // Project methods
  async getAllProjects() {
    return this.executeWithFallback(
      () => this.primaryStorage.getAllProjects(),
      () => this.fallbackStorage.getAllProjects()
    );
  }

  async getProject(id: number) {
    return this.executeWithFallback(
      () => this.primaryStorage.getProject(id),
      () => this.fallbackStorage.getProject(id)
    );
  }

  async createProject(project: any) {
    return this.executeWithFallback(
      () => this.primaryStorage.createProject(project),
      () => this.fallbackStorage.createProject(project)
    );
  }

  async updateProject(id: number, updates: any) {
    return this.executeWithFallback(
      () => this.primaryStorage.updateProject(id, updates),
      () => this.fallbackStorage.updateProject(id, updates)
    );
  }

  async deleteProject(id: number) {
    return this.executeWithFallback(
      () => this.primaryStorage.deleteProject(id),
      () => this.fallbackStorage.deleteProject(id)
    );
  }

  async getArchivedProjects() {
    return this.executeWithFallback(
      () => this.primaryStorage.getArchivedProjects(),
      () => this.fallbackStorage.getArchivedProjects()
    );
  }

  async archiveProject(id: number, userId?: string, userName?: string) {
    return this.executeWithFallback(
      () => this.primaryStorage.archiveProject(id, userId, userName),
      () => this.fallbackStorage.archiveProject(id, userId, userName)
    );
  }

  async getProjectsForReview() {
    return this.executeWithFallback(
      () => this.primaryStorage.getProjectsForReview(),
      () => this.fallbackStorage.getProjectsForReview()
    );
  }

  // Project Task methods
  async getProjectTasks(projectId: number) {
    return this.executeWithFallback(
      () => this.primaryStorage.getProjectTasks(projectId),
      () => this.fallbackStorage.getProjectTasks(projectId)
    );
  }

  async createProjectTask(task: any) {
    return this.executeWithFallback(
      () => this.primaryStorage.createProjectTask(task),
      () => this.fallbackStorage.createProjectTask(task)
    );
  }

  async updateProjectTask(id: number, updates: any) {
    return this.executeWithFallback(
      () => this.primaryStorage.updateProjectTask(id, updates),
      () => this.fallbackStorage.updateProjectTask(id, updates)
    );
  }

  async deleteProjectTask(id: number) {
    return this.executeWithFallback(
      () => this.primaryStorage.deleteProjectTask(id),
      () => this.fallbackStorage.deleteProjectTask(id)
    );
  }

  async getTaskById(id: number) {
    return this.executeWithFallback(
      () => this.primaryStorage.getTaskById(id),
      () => this.fallbackStorage.getTaskById(id)
    );
  }

  async getProjectTask(taskId: number) {
    return this.executeWithFallback(
      () => this.primaryStorage.getProjectTask(taskId),
      () => this.fallbackStorage.getTaskById(taskId)
    );
  }

  async getAssignedTasks(userId: string) {
    return this.executeWithFallback(
      () => this.primaryStorage.getAssignedTasks(userId),
      () => this.fallbackStorage.getAssignedTasks(userId)
    );
  }

  async getProjectCongratulations(projectId: number) {
    return this.executeWithFallback(
      () => this.primaryStorage.getProjectCongratulations(projectId),
      () => this.fallbackStorage.getProjectCongratulations(projectId)
    );
  }

  async updateTaskStatus(id: number, status: string) {
    return this.executeWithFallback(
      () => this.primaryStorage.updateTaskStatus(id, status),
      () => this.fallbackStorage.updateTaskStatus(id, status)
    );
  }

  // Task completion methods
  async createTaskCompletion(completion: any) {
    return this.executeWithFallback(
      () => this.primaryStorage.createTaskCompletion(completion),
      () => this.fallbackStorage.createTaskCompletion(completion)
    );
  }

  async getTaskCompletions(taskId: number) {
    return this.executeWithFallback(
      () => this.primaryStorage.getTaskCompletions(taskId),
      () => this.fallbackStorage.getTaskCompletions(taskId)
    );
  }

  async removeTaskCompletion(taskId: number, userId: string) {
    return this.executeWithFallback(
      () => this.primaryStorage.removeTaskCompletion(taskId, userId),
      () => this.fallbackStorage.removeTaskCompletion(taskId, userId)
    );
  }

  // Project Comment methods
  async getProjectComments(projectId: number) {
    return this.executeWithFallback(
      () => this.primaryStorage.getProjectComments(projectId),
      () => this.fallbackStorage.getProjectComments(projectId)
    );
  }

  async createProjectComment(comment: any) {
    return this.executeWithFallback(
      () => this.primaryStorage.createProjectComment(comment),
      () => this.fallbackStorage.createProjectComment(comment)
    );
  }

  async deleteProjectComment(id: number) {
    return this.executeWithFallback(
      () => this.primaryStorage.deleteProjectComment(id),
      () => this.fallbackStorage.deleteProjectComment(id)
    );
  }

  // Message methods
  async getAllMessages() {
    return this.executeWithFallback(
      () => this.primaryStorage.getAllMessages(),
      () => this.fallbackStorage.getAllMessages()
    );
  }

  async getRecentMessages(limit: number) {
    return this.executeWithFallback(
      () => this.primaryStorage.getRecentMessages(limit),
      () => this.fallbackStorage.getRecentMessages(limit)
    );
  }

  async getMessagesByCommittee(committee: string) {
    return this.executeWithFallback(
      () => this.primaryStorage.getMessagesByCommittee(committee),
      () => this.fallbackStorage.getMessagesByCommittee(committee)
    );
  }

  async getDirectMessages(userId1: string, userId2: string) {
    return this.executeWithFallback(
      () => this.primaryStorage.getDirectMessages(userId1, userId2),
      () => this.fallbackStorage.getDirectMessages(userId1, userId2)
    );
  }

  async getMessageById(id: number) {
    return this.executeWithFallback(
      () => this.primaryStorage.getMessageById(id),
      () => this.fallbackStorage.getMessageById(id)
    );
  }

  async createMessage(message: any) {
    return this.executeWithFallback(
      () => this.primaryStorage.createMessage(message),
      () => this.fallbackStorage.createMessage(message)
    );
  }

  async createReply(message: any, parentId: number) {
    return this.executeWithFallback(
      () => this.primaryStorage.createReply(message, parentId),
      () => this.fallbackStorage.createReply(message, parentId)
    );
  }

  async updateReplyCount(messageId: number) {
    return this.executeWithFallback(
      () => this.primaryStorage.updateReplyCount(messageId),
      () => this.fallbackStorage.updateReplyCount(messageId)
    );
  }

  async deleteMessage(id: number) {
    return this.executeWithFallback(
      () => this.primaryStorage.deleteMessage(id),
      () => this.fallbackStorage.deleteMessage(id)
    );
  }

  async getMessagesBySender(senderId: string) {
    return this.executeWithFallback(
      () => this.primaryStorage.getMessagesBySender(senderId),
      () => this.fallbackStorage.getMessagesBySender(senderId)
    );
  }

  async markMessageAsRead(messageId: number, userId: string) {
    return this.executeWithFallback(
      () => this.primaryStorage.markMessageAsRead(messageId, userId),
      () => this.fallbackStorage.markMessageAsRead(messageId, userId)
    );
  }

  async getMessagesForRecipient(recipientId: string) {
    return this.executeWithFallback(
      () => this.primaryStorage.getMessagesForRecipient(recipientId),
      () => this.fallbackStorage.getMessagesForRecipient(recipientId)
    );
  }

  async getMessagesBySenderWithReadStatus(senderId: string) {
    return this.executeWithFallback(
      () => this.primaryStorage.getMessagesBySenderWithReadStatus(senderId),
      () => this.fallbackStorage.getMessagesBySenderWithReadStatus(senderId)
    );
  }

  async getUserMessageGroups(userId: string) {
    return this.executeWithFallback(
      () => this.primaryStorage.getUserMessageGroups(userId),
      () => this.fallbackStorage.getUserMessageGroups(userId)
    );
  }

  // Weekly Reports methods
  async getAllWeeklyReports() {
    return this.executeWithFallback(
      () => this.primaryStorage.getAllWeeklyReports(),
      () => this.fallbackStorage.getAllWeeklyReports()
    );
  }

  async createWeeklyReport(report: any) {
    return this.executeWithFallback(
      () => this.primaryStorage.createWeeklyReport(report),
      () => this.fallbackStorage.createWeeklyReport(report)
    );
  }

  // Sandwich Collections methods
  async getAllSandwichCollections() {
    const collections = await this.executeWithFallback(
      () => this.primaryStorage.getAllSandwichCollections(),
      () => this.fallbackStorage.getAllSandwichCollections()
    );

    // Filter out deleted items
    return collections.filter(
      (collection) => !this.deletedIds.has(collection.id)
    );
  }

  async getSandwichCollections(
    limit: number,
    offset: number,
    sortField?: string,
    sortOrder?: string
  ) {
    return await this.executeWithFallback(
      () =>
        this.primaryStorage.getSandwichCollections(
          limit,
          offset,
          sortField,
          sortOrder
        ),
      async () => {
        // Fallback: get all and slice manually with sorting
        const all = await this.fallbackStorage.getAllSandwichCollections();
        return this.fallbackStorage.getSandwichCollections(
          limit,
          offset,
          sortField,
          sortOrder
        );
      }
    );
  }

  async getSandwichCollectionsByEventRequestId(eventRequestId: number) {
    return await this.executeWithFallback(
      () =>
        this.primaryStorage.getSandwichCollectionsByEventRequestId(
          eventRequestId
        ),
      () =>
        this.fallbackStorage.getSandwichCollectionsByEventRequestId(
          eventRequestId
        )
    );
  }

  async getSandwichCollectionById(id: number) {
    return await this.executeWithFallback(
      () => this.primaryStorage.getSandwichCollectionById(id),
      () => this.fallbackStorage.getSandwichCollectionById(id)
    );
  }

  async getSandwichCollectionsCount() {
    const result = await this.executeWithFallback(
      () => this.primaryStorage.getSandwichCollectionsCount(),
      async () => {
        // Fallback: get all and count
        const all = await this.fallbackStorage.getAllSandwichCollections();
        return all.length;
      }
    );
    return Number(result);
  }

  async getCollectionStats() {
    return this.executeWithFallback(
      () => this.primaryStorage.getCollectionStats(),
      async () => {
        // Fallback: calculate stats from all collections using ONLY new columns
        const all = await this.fallbackStorage.getAllSandwichCollections();
        const totalSandwiches = all.reduce((sum, collection) => {
          const individual = collection.individualSandwiches || 0;
          const group1 = (collection as any).group1Count || 0;
          const group2 = (collection as any).group2Count || 0;
          return sum + individual + group1 + group2;
        }, 0);
        return {
          totalEntries: all.length,
          totalSandwiches,
        };
      }
    );
  }

  async createSandwichCollection(collection: any) {
    return this.executeWithFallback(
      async () => {
        const result =
          await this.primaryStorage.createSandwichCollection(collection);
        // Also create in fallback storage to keep them synchronized
        try {
          await this.fallbackStorage.createSandwichCollection({
            ...collection,
            id: result.id,
          });
        } catch (error) {
          logger.warn('Failed to sync collection to fallback storage:', error);
        }
        return result;
      },
      () => this.fallbackStorage.createSandwichCollection(collection)
    );
  }

  async updateSandwichCollection(id: number, updates: any) {
    return this.executeWithFallback(
      () => this.primaryStorage.updateSandwichCollection(id, updates),
      () => this.fallbackStorage.updateSandwichCollection(id, updates)
    );
  }

  async deleteSandwichCollection(id: number) {
    // Track the deleted ID to prevent re-sync
    this.deletedIds.add(id);

    try {
      // Use only database storage for faster deletes
      const result = await this.primaryStorage.deleteSandwichCollection(id);

      // If deletion fails, remove from tracking
      if (!result) {
        this.deletedIds.delete(id);
      }

      return result;
    } catch (error) {
      // If database fails, remove from tracking and fallback
      this.deletedIds.delete(id);
      logger.warn('Database delete failed, trying fallback storage:', error);
      return this.fallbackStorage.deleteSandwichCollection(id);
    }
  }

  // Meeting Minutes methods
  async getAllMeetingMinutes() {
    return this.executeWithFallback(
      () => this.primaryStorage.getAllMeetingMinutes(),
      () => this.fallbackStorage.getAllMeetingMinutes()
    );
  }

  async getRecentMeetingMinutes(limit: number) {
    return this.executeWithFallback(
      () => this.primaryStorage.getRecentMeetingMinutes(limit),
      () => this.fallbackStorage.getRecentMeetingMinutes(limit)
    );
  }

  async createMeetingMinutes(minutes: any) {
    return this.executeWithFallback(
      () => this.primaryStorage.createMeetingMinutes(minutes),
      () => this.fallbackStorage.createMeetingMinutes(minutes)
    );
  }

  async deleteMeetingMinutes(id: number) {
    return this.executeWithFallback(
      () => this.primaryStorage.deleteMeetingMinutes(id),
      () => this.fallbackStorage.deleteMeetingMinutes(id)
    );
  }

  // Drive Links methods
  async getAllDriveLinks() {
    return this.executeWithFallback(
      () => this.primaryStorage.getAllDriveLinks(),
      () => this.fallbackStorage.getAllDriveLinks()
    );
  }

  async createDriveLink(link: any) {
    return this.executeWithFallback(
      () => this.primaryStorage.createDriveLink(link),
      () => this.fallbackStorage.createDriveLink(link)
    );
  }

  async getAllAgendaItems() {
    return this.executeWithFallback(
      () => this.primaryStorage.getAllAgendaItems(),
      () => this.fallbackStorage.getAllAgendaItems()
    );
  }

  async createAgendaItem(item: any) {
    return this.executeWithFallback(
      () => this.primaryStorage.createAgendaItem(item),
      () => this.fallbackStorage.createAgendaItem(item)
    );
  }

  async updateAgendaItemStatus(id: number, status: string) {
    return this.executeWithFallback(
      () => this.primaryStorage.updateAgendaItemStatus(id, status),
      () => this.fallbackStorage.updateAgendaItemStatus(id, status)
    );
  }

  async updateAgendaItem(id: number, updates: any) {
    return this.executeWithFallback(
      () => this.primaryStorage.updateAgendaItem(id, updates),
      () => this.fallbackStorage.updateAgendaItem(id, updates)
    );
  }

  async deleteAgendaItem(id: number) {
    return this.executeWithFallback(
      () => this.primaryStorage.deleteAgendaItem(id),
      () => this.fallbackStorage.deleteAgendaItem(id)
    );
  }

  async getCurrentMeeting() {
    return this.executeWithFallback(
      () => this.primaryStorage.getCurrentMeeting(),
      () => this.fallbackStorage.getCurrentMeeting()
    );
  }

  async getAllMeetings() {
    return this.executeWithFallback(
      () => this.primaryStorage.getAllMeetings(),
      () => this.fallbackStorage.getAllMeetings()
    );
  }

  async getMeetingsByType(type: string) {
    return this.executeWithFallback(
      () => this.primaryStorage.getMeetingsByType(type),
      () => this.fallbackStorage.getMeetingsByType(type)
    );
  }

  async createMeeting(meeting: any) {
    return this.executeWithFallback(
      () => this.primaryStorage.createMeeting(meeting),
      () => this.fallbackStorage.createMeeting(meeting)
    );
  }

  async updateMeetingAgenda(id: number, agenda: string) {
    return this.executeWithFallback(
      () => this.primaryStorage.updateMeetingAgenda(id, agenda),
      () => this.fallbackStorage.updateMeetingAgenda(id, agenda)
    );
  }

  async updateMeeting(id: number, updates: any) {
    return this.executeWithFallback(
      () => this.primaryStorage.updateMeeting(id, updates),
      () => this.fallbackStorage.updateMeeting(id, updates)
    );
  }

  async deleteMeeting(id: number) {
    return this.executeWithFallback(
      () => this.primaryStorage.deleteMeeting(id),
      () => this.fallbackStorage.deleteMeeting(id)
    );
  }

  // Meeting Notes methods
  async getAllMeetingNotes() {
    return this.executeWithFallback(
      () => this.primaryStorage.getAllMeetingNotes(),
      () => this.fallbackStorage.getAllMeetingNotes()
    );
  }

  async getMeetingNote(id: number) {
    return this.executeWithFallback(
      () => this.primaryStorage.getMeetingNote(id),
      () => this.fallbackStorage.getMeetingNote(id)
    );
  }

  async getMeetingNotesByProject(projectId: number) {
    return this.executeWithFallback(
      () => this.primaryStorage.getMeetingNotesByProject(projectId),
      () => this.fallbackStorage.getMeetingNotesByProject(projectId)
    );
  }

  async getMeetingNotesByMeeting(meetingId: number) {
    return this.executeWithFallback(
      () => this.primaryStorage.getMeetingNotesByMeeting(meetingId),
      () => this.fallbackStorage.getMeetingNotesByMeeting(meetingId)
    );
  }

  async getMeetingNotesByFilters(filters: any) {
    return this.executeWithFallback(
      () => this.primaryStorage.getMeetingNotesByFilters(filters),
      () => this.fallbackStorage.getMeetingNotesByFilters(filters)
    );
  }

  async createMeetingNote(note: any) {
    return this.executeWithFallback(
      () => this.primaryStorage.createMeetingNote(note),
      () => this.fallbackStorage.createMeetingNote(note)
    );
  }

  async updateMeetingNote(id: number, updates: any) {
    return this.executeWithFallback(
      () => this.primaryStorage.updateMeetingNote(id, updates),
      () => this.fallbackStorage.updateMeetingNote(id, updates)
    );
  }

  async deleteMeetingNote(id: number) {
    return this.executeWithFallback(
      () => this.primaryStorage.deleteMeetingNote(id),
      () => this.fallbackStorage.deleteMeetingNote(id)
    );
  }

  async createDriverAgreement(agreement: any) {
    return this.executeWithFallback(
      () => this.primaryStorage.createDriverAgreement(agreement),
      () => this.fallbackStorage.createDriverAgreement(agreement)
    );
  }

  // Host methods
  async getAllHosts() {
    return this.executeWithFallback(
      () => this.primaryStorage.getAllHosts(),
      () => this.fallbackStorage.getAllHosts()
    );
  }

  async getAllHostsWithContacts() {
    return this.executeWithFallback(
      () => this.primaryStorage.getAllHostsWithContacts(),
      () => this.fallbackStorage.getAllHostsWithContacts()
    );
  }

  async getHost(id: number) {
    return this.executeWithFallback(
      () => this.primaryStorage.getHost(id),
      () => this.fallbackStorage.getHost(id)
    );
  }

  async createHost(host: any) {
    return this.executeWithFallback(
      () => this.primaryStorage.createHost(host),
      () => this.fallbackStorage.createHost(host)
    );
  }

  async updateHost(id: number, updates: any) {
    return this.executeWithFallback(
      () => this.primaryStorage.updateHost(id, updates),
      () => this.fallbackStorage.updateHost(id, updates)
    );
  }

  async deleteHost(id: number) {
    return this.executeWithFallback(
      () => this.primaryStorage.deleteHost(id),
      () => this.fallbackStorage.deleteHost(id)
    );
  }

  // Recipients methods
  async getAllRecipients() {
    return this.executeWithFallback(
      () => this.primaryStorage.getAllRecipients(),
      () => this.fallbackStorage.getAllRecipients()
    );
  }

  async getRecipient(id: number) {
    return this.executeWithFallback(
      () => this.primaryStorage.getRecipient(id),
      () => this.fallbackStorage.getRecipient(id)
    );
  }

  async createRecipient(recipient: any) {
    return this.executeWithFallback(
      () => this.primaryStorage.createRecipient(recipient),
      () => this.fallbackStorage.createRecipient(recipient)
    );
  }

  async updateRecipient(id: number, updates: any) {
    return this.executeWithFallback(
      () => this.primaryStorage.updateRecipient(id, updates),
      () => this.fallbackStorage.updateRecipient(id, updates)
    );
  }

  async deleteRecipient(id: number) {
    return this.executeWithFallback(
      () => this.primaryStorage.deleteRecipient(id),
      () => this.fallbackStorage.deleteRecipient(id)
    );
  }

  async updateCollectionHostNames(oldHostName: string, newHostName: string) {
    return this.executeWithFallback(
      () =>
        this.primaryStorage.updateCollectionHostNames(oldHostName, newHostName),
      () =>
        this.fallbackStorage.updateCollectionHostNames(oldHostName, newHostName)
    );
  }

  // Sandwich Distributions methods
  async getAllSandwichDistributions() {
    return this.executeWithFallback(
      () => this.primaryStorage.getAllSandwichDistributions(),
      () => this.fallbackStorage.getAllSandwichDistributions()
    );
  }

  async getSandwichDistribution(id: number) {
    return this.executeWithFallback(
      () => this.primaryStorage.getSandwichDistribution(id),
      () => this.fallbackStorage.getSandwichDistribution(id)
    );
  }

  async createSandwichDistribution(insertDistribution: any) {
    return this.executeWithFallback(
      () => this.primaryStorage.createSandwichDistribution(insertDistribution),
      () => this.fallbackStorage.createSandwichDistribution(insertDistribution)
    );
  }

  async updateSandwichDistribution(id: number, updates: any) {
    return this.executeWithFallback(
      () => this.primaryStorage.updateSandwichDistribution(id, updates),
      () => this.fallbackStorage.updateSandwichDistribution(id, updates)
    );
  }

  async deleteSandwichDistribution(id: number) {
    return this.executeWithFallback(
      () => this.primaryStorage.deleteSandwichDistribution(id),
      () => this.fallbackStorage.deleteSandwichDistribution(id)
    );
  }

  async getSandwichDistributionsByWeek(weekEnding: string) {
    return this.executeWithFallback(
      () => this.primaryStorage.getSandwichDistributionsByWeek(weekEnding),
      () => this.fallbackStorage.getSandwichDistributionsByWeek(weekEnding)
    );
  }

  async getSandwichDistributionsByHost(hostId: number) {
    return this.executeWithFallback(
      () => this.primaryStorage.getSandwichDistributionsByHost(hostId),
      () => this.fallbackStorage.getSandwichDistributionsByHost(hostId)
    );
  }

  async getSandwichDistributionsByRecipient(recipientId: number) {
    return this.executeWithFallback(
      () =>
        this.primaryStorage.getSandwichDistributionsByRecipient(recipientId),
      () =>
        this.fallbackStorage.getSandwichDistributionsByRecipient(recipientId)
    );
  }

  // General Contacts methods
  async getAllContacts() {
    return this.executeWithFallback(
      () => this.primaryStorage.getAllContacts(),
      () => this.fallbackStorage.getAllContacts()
    );
  }

  async getContact(id: number) {
    return this.executeWithFallback(
      () => this.primaryStorage.getContact(id),
      () => this.fallbackStorage.getContact(id)
    );
  }

  async createContact(contact: any) {
    return this.executeWithFallback(
      () => this.primaryStorage.createContact(contact),
      () => this.fallbackStorage.createContact(contact)
    );
  }

  async updateContact(id: number, updates: any) {
    return this.executeWithFallback(
      () => this.primaryStorage.updateContact(id, updates),
      () => this.fallbackStorage.updateContact(id, updates)
    );
  }

  async deleteContact(id: number) {
    return this.executeWithFallback(
      () => this.primaryStorage.deleteContact(id),
      () => this.fallbackStorage.deleteContact(id)
    );
  }

  // Volunteer methods
  async getAllVolunteers() {
    return this.executeWithFallback(
      () => this.primaryStorage.getAllVolunteers(),
      () => this.fallbackStorage.getAllVolunteers()
    );
  }

  async getVolunteer(id: number) {
    return this.executeWithFallback(
      () => this.primaryStorage.getVolunteer(id),
      () => this.fallbackStorage.getVolunteer(id)
    );
  }

  async createVolunteer(volunteer: any) {
    return this.executeWithFallback(
      () => this.primaryStorage.createVolunteer(volunteer),
      () => this.fallbackStorage.createVolunteer(volunteer)
    );
  }

  async updateVolunteer(id: number, updates: any) {
    return this.executeWithFallback(
      () => this.primaryStorage.updateVolunteer(id, updates),
      () => this.fallbackStorage.updateVolunteer(id, updates)
    );
  }

  async deleteVolunteer(id: number) {
    return this.executeWithFallback(
      () => this.primaryStorage.deleteVolunteer(id),
      () => this.fallbackStorage.deleteVolunteer(id)
    );
  }

  // Host Contacts methods
  async createHostContact(contact: any) {
    return this.executeWithFallback(
      () => this.primaryStorage.createHostContact(contact),
      () => this.fallbackStorage.createHostContact(contact),
      // Writes must not land in MemStorage: a rejected duplicate would look
      // saved but vanish, and could leave a volunteer linked to a fake id.
      { isWriteOperation: true }
    );
  }

  async getHostContact(id: number) {
    return this.executeWithFallback(
      () => this.primaryStorage.getHostContact(id),
      () => this.fallbackStorage.getHostContact(id)
    );
  }

  async getHostContacts(hostId: number) {
    return this.executeWithFallback(
      () => this.primaryStorage.getHostContacts(hostId),
      () => this.fallbackStorage.getHostContacts(hostId)
    );
  }

  async updateHostContact(id: number, updates: any) {
    return this.executeWithFallback(
      () => this.primaryStorage.updateHostContact(id, updates),
      () => this.fallbackStorage.updateHostContact(id, updates),
      // Writes must not land in MemStorage: a rejected duplicate would look
      // saved but vanish, and could leave a volunteer linked to a fake id.
      { isWriteOperation: true }
    );
  }

  async deleteHostContact(id: number) {
    return this.executeWithFallback(
      () => this.primaryStorage.deleteHostContact(id),
      () => this.fallbackStorage.deleteHostContact(id),
      // Writes must not land in MemStorage: a rejected duplicate would look
      // saved but vanish, and could leave a volunteer linked to a fake id.
      { isWriteOperation: true }
    );
  }

  // Driver methods
  async getAllDrivers() {
    return this.executeWithFallback(
      () => this.primaryStorage.getAllDrivers(),
      () => this.fallbackStorage.getAllDrivers()
    );
  }

  async getAllDriversUnlimited() {
    return this.executeWithFallback(
      () => this.primaryStorage.getAllDriversUnlimited(),
      () => this.fallbackStorage.getAllDriversUnlimited()
    );
  }

  async getDriver(id: number) {
    return this.executeWithFallback(
      () => this.primaryStorage.getDriver(id),
      () => this.fallbackStorage.getDriver(id)
    );
  }

  async createDriver(driver: any) {
    return this.executeWithFallback(
      () => this.primaryStorage.createDriver(driver),
      () => this.fallbackStorage.createDriver(driver)
    );
  }

  async updateDriver(id: number, updates: any) {
    return this.executeWithFallback(
      () => this.primaryStorage.updateDriver(id, updates),
      () => {
        throw new Error('Driver operations not available in fallback storage');
      }
    );
  }

  async deleteDriver(id: number) {
    return this.executeWithFallback(
      () => this.primaryStorage.deleteDriver(id),
      () => this.fallbackStorage.deleteDriver(id)
    );
  }

  // Driver Vehicle methods
  async getDriverVehicles(driverId: number) {
    return this.executeWithFallback(
      () => this.primaryStorage.getDriverVehicles(driverId),
      () => this.fallbackStorage.getDriverVehicles(driverId)
    );
  }

  async getDriverVehicle(id: number) {
    return this.executeWithFallback(
      () => this.primaryStorage.getDriverVehicle(id),
      () => this.fallbackStorage.getDriverVehicle(id)
    );
  }

  async createDriverVehicle(vehicle: any) {
    return this.executeWithFallback(
      () => this.primaryStorage.createDriverVehicle(vehicle),
      () => {
        throw new Error('Driver vehicle operations not available in fallback storage');
      }
    );
  }

  async updateDriverVehicle(id: number, updates: any) {
    return this.executeWithFallback(
      () => this.primaryStorage.updateDriverVehicle(id, updates),
      () => {
        throw new Error('Driver vehicle operations not available in fallback storage');
      }
    );
  }

  async deleteDriverVehicle(id: number) {
    return this.executeWithFallback(
      () => this.primaryStorage.deleteDriverVehicle(id),
      () => this.fallbackStorage.deleteDriverVehicle(id)
    );
  }

  // Committee management methods
  async getAllCommittees() {
    return this.executeWithFallback(
      () => this.primaryStorage.getAllCommittees(),
      () => this.fallbackStorage.getAllCommittees()
    );
  }

  async getCommittee(id: string) {
    return this.executeWithFallback(
      () => this.primaryStorage.getCommittee(id),
      () => this.fallbackStorage.getCommittee(id)
    );
  }

  async createCommittee(committee: any) {
    return this.executeWithFallback(
      () => this.primaryStorage.createCommittee(committee),
      () => this.fallbackStorage.createCommittee(committee)
    );
  }

  async updateCommittee(id: string, updates: any) {
    return this.executeWithFallback(
      () => this.primaryStorage.updateCommittee(id, updates),
      () => this.fallbackStorage.updateCommittee(id, updates)
    );
  }

  async deleteCommittee(id: string) {
    return this.executeWithFallback(
      () => this.primaryStorage.deleteCommittee(id),
      () => this.fallbackStorage.deleteCommittee(id)
    );
  }

  async getUserCommittees(userId: string) {
    return this.executeWithFallback(
      () => this.primaryStorage.getUserCommittees(userId),
      () => this.fallbackStorage.getUserCommittees(userId)
    );
  }

  async getCommitteeMembers(committeeId: string) {
    return this.executeWithFallback(
      () => this.primaryStorage.getCommitteeMembers(committeeId),
      () => this.fallbackStorage.getCommitteeMembers(committeeId)
    );
  }

  async addUserToCommittee(membership: any) {
    return this.executeWithFallback(
      () => this.primaryStorage.addUserToCommittee(membership),
      () => this.fallbackStorage.addUserToCommittee(membership)
    );
  }

  async updateCommitteeMembership(id: number, updates: any) {
    return this.executeWithFallback(
      () => this.primaryStorage.updateCommitteeMembership(id, updates),
      () => this.fallbackStorage.updateCommitteeMembership(id, updates)
    );
  }

  async removeUserFromCommittee(userId: string, committeeId: string) {
    return this.executeWithFallback(
      () => this.primaryStorage.removeUserFromCommittee(userId, committeeId),
      () => this.fallbackStorage.removeUserFromCommittee(userId, committeeId)
    );
  }

  async isUserCommitteeMember(userId: string, committeeId: string) {
    return this.executeWithFallback(
      () => this.primaryStorage.isUserCommitteeMember(userId, committeeId),
      () => this.fallbackStorage.isUserCommitteeMember(userId, committeeId)
    );
  }

  // Announcement methods
  async getAllAnnouncements() {
    return this.executeWithFallback(
      () => this.primaryStorage.getAllAnnouncements(),
      () => this.fallbackStorage.getAllAnnouncements()
    );
  }

  async createAnnouncement(announcement: any) {
    return this.executeWithFallback(
      () => this.primaryStorage.createAnnouncement(announcement),
      () => this.fallbackStorage.createAnnouncement(announcement)
    );
  }

  async updateAnnouncement(id: number, updates: any) {
    return this.executeWithFallback(
      () => this.primaryStorage.updateAnnouncement(id, updates),
      () => this.fallbackStorage.updateAnnouncement(id, updates)
    );
  }

  async deleteAnnouncement(id: number) {
    return this.executeWithFallback(
      () => this.primaryStorage.deleteAnnouncement(id),
      () => this.fallbackStorage.deleteAnnouncement(id)
    );
  }

  // Project assignments
  async getProjectAssignments(projectId: number) {
    return this.executeWithFallback(
      () => this.primaryStorage.getProjectAssignments(projectId),
      () => this.fallbackStorage.getProjectAssignments(projectId)
    );
  }

  async addProjectAssignment(assignment: {
    projectId: number;
    userId: string;
    role: string;
  }) {
    return this.executeWithFallback(
      () => this.primaryStorage.addProjectAssignment(assignment),
      () => this.fallbackStorage.addProjectAssignment(assignment)
    );
  }

  async removeProjectAssignment(projectId: number, userId: string) {
    return this.executeWithFallback(
      () => this.primaryStorage.removeProjectAssignment(projectId, userId),
      () => this.fallbackStorage.removeProjectAssignment(projectId, userId)
    );
  }

  async updateProjectAssignment(
    projectId: number,
    userId: string,
    updates: { role: string }
  ) {
    return this.executeWithFallback(
      () =>
        this.primaryStorage.updateProjectAssignment(projectId, userId, updates),
      () =>
        this.fallbackStorage.updateProjectAssignment(projectId, userId, updates)
    );
  }

  // Notification methods
  async getUserNotifications(userId: string) {
    return this.executeWithFallback(
      () => this.primaryStorage.getUserNotifications(userId),
      () => this.fallbackStorage.getUserNotifications(userId)
    );
  }

  async createNotification(notification: any) {
    return this.executeWithFallback(
      () => this.primaryStorage.createNotification(notification),
      () => this.fallbackStorage.createNotification(notification)
    );
  }

  async markNotificationRead(id: number) {
    return this.executeWithFallback(
      () => this.primaryStorage.markNotificationRead(id),
      () => this.fallbackStorage.markNotificationRead(id)
    );
  }

  async deleteNotification(id: number) {
    return this.executeWithFallback(
      () => this.primaryStorage.deleteNotification(id),
      () => this.fallbackStorage.deleteNotification(id)
    );
  }

  async createCelebration(userId: string, taskId: number, message: string) {
    return this.executeWithFallback(
      () => this.primaryStorage.createCelebration(userId, taskId, message),
      () => this.fallbackStorage.createCelebration(userId, taskId, message)
    );
  }

  // Conversation methods
  async createConversation(conversationData: any, participants: string[]) {
    return this.executeWithFallback(
      () =>
        this.primaryStorage.createConversation(conversationData, participants),
      () =>
        this.fallbackStorage.createConversation(conversationData, participants)
    );
  }

  async getConversationMessages(conversationId: number, userId: string) {
    return this.executeWithFallback(
      () => this.primaryStorage.getConversationMessages(conversationId, userId),
      () => this.fallbackStorage.getConversationMessages(conversationId, userId)
    );
  }

  async addConversationMessage(messageData: any) {
    return this.executeWithFallback(
      () => this.primaryStorage.addConversationMessage(messageData),
      () => this.fallbackStorage.addConversationMessage(messageData)
    );
  }

  async updateConversationMessage(
    messageId: number,
    userId: string,
    updates: any
  ) {
    return this.executeWithFallback(
      () =>
        this.primaryStorage.updateConversationMessage(
          messageId,
          userId,
          updates
        ),
      () =>
        this.fallbackStorage.updateConversationMessage(
          messageId,
          userId,
          updates
        )
    );
  }

  async deleteConversationMessage(messageId: number, userId: string) {
    return this.executeWithFallback(
      () => this.primaryStorage.deleteConversationMessage(messageId, userId),
      () => this.fallbackStorage.deleteConversationMessage(messageId, userId)
    );
  }

  async getConversationParticipants(conversationId: number) {
    return this.executeWithFallback(
      () => this.primaryStorage.getConversationParticipants(conversationId),
      () => this.fallbackStorage.getConversationParticipants(conversationId)
    );
  }

  // Chat message methods for Socket.IO
  async createChatMessage(data: {
    channel: string;
    userId: string;
    userName: string;
    content: string;
  }) {
    return this.executeWithFallback(
      () => this.primaryStorage.createChatMessage(data),
      () => this.fallbackStorage.createChatMessage(data)
    );
  }

  async getChatMessages(channel: string, limit?: number) {
    return this.executeWithFallback(
      () => this.primaryStorage.getChatMessages(channel, limit),
      () => this.fallbackStorage.getChatMessages(channel, limit)
    );
  }

  async updateChatMessage(id: number, updates: { content: string }) {
    return this.executeWithFallback(
      () => this.primaryStorage.updateChatMessage(id, updates),
      () => this.fallbackStorage.updateChatMessage(id, updates)
    );
  }

  async deleteChatMessage(id: number) {
    return this.executeWithFallback(
      () => this.primaryStorage.deleteChatMessage(id),
      () => this.fallbackStorage.deleteChatMessage(id)
    );
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
  }) {
    return this.executeWithFallback(
      () => this.primaryStorage.createShoutoutLog(log),
      () => this.fallbackStorage.createShoutoutLog(log)
    );
  }

  async getShoutoutHistory() {
    return this.executeWithFallback(
      () => this.primaryStorage.getShoutoutHistory(),
      () => this.fallbackStorage.getShoutoutHistory()
    );
  }

  // User Activity Tracking methods
  async logUserActivity(activity: InsertUserActivityLog) {
    return this.executeWithFallback(
      () => this.primaryStorage.logUserActivity(activity),
      () => this.fallbackStorage.logUserActivity(activity)
    );
  }

  async getUserActivityStats(userId: string, days?: number) {
    return this.executeWithFallback(
      () => this.primaryStorage.getUserActivityStats(userId, days),
      () => this.fallbackStorage.getUserActivityStats(userId, days)
    );
  }

  async getAllUsersActivitySummary(days?: number) {
    return this.executeWithFallback(
      () => this.primaryStorage.getAllUsersActivitySummary(days),
      () => this.fallbackStorage.getAllUsersActivitySummary(days)
    );
  }

  // Chat message like methods for Socket.IO chat messages
  async likeChatMessage(messageId: number, userId: string, userName: string) {
    return this.executeWithFallback(
      () => this.primaryStorage.likeChatMessage(messageId, userId, userName),
      () => this.fallbackStorage.likeChatMessage(messageId, userId, userName)
    );
  }

  async unlikeChatMessage(messageId: number, userId: string) {
    return this.executeWithFallback(
      () => this.primaryStorage.unlikeChatMessage(messageId, userId),
      () => this.fallbackStorage.unlikeChatMessage(messageId, userId)
    );
  }

  async getChatMessageLikes(messageId: number) {
    return this.executeWithFallback(
      () => this.primaryStorage.getChatMessageLikes(messageId),
      () => this.fallbackStorage.getChatMessageLikes(messageId)
    );
  }

  async hasUserLikedChatMessage(messageId: number, userId: string) {
    return this.executeWithFallback(
      () => this.primaryStorage.hasUserLikedChatMessage(messageId, userId),
      () => this.fallbackStorage.hasUserLikedChatMessage(messageId, userId)
    );
  }

  // Missing method: Mark all messages in a channel as read for a user
  async markChannelMessagesAsRead(userId: string, channel: string) {
    return this.executeWithFallback(
      () => this.primaryStorage.markChannelMessagesAsRead(userId, channel),
      () => this.fallbackStorage.markChannelMessagesAsRead(userId, channel)
    );
  }

  // Wishlist Suggestions methods
  async getAllWishlistSuggestions() {
    return this.executeWithFallback(
      () => this.primaryStorage.getAllWishlistSuggestions(),
      () => this.fallbackStorage.getAllWishlistSuggestions()
    );
  }

  async getWishlistSuggestion(id: number) {
    return this.executeWithFallback(
      () => this.primaryStorage.getWishlistSuggestion(id),
      () => this.fallbackStorage.getWishlistSuggestion(id)
    );
  }

  async createWishlistSuggestion(suggestion: any) {
    return this.executeWithFallback(
      () => this.primaryStorage.createWishlistSuggestion(suggestion),
      () => this.fallbackStorage.createWishlistSuggestion(suggestion)
    );
  }

  async updateWishlistSuggestion(id: number, updates: any) {
    return this.executeWithFallback(
      () => this.primaryStorage.updateWishlistSuggestion(id, updates),
      () => this.fallbackStorage.updateWishlistSuggestion(id, updates)
    );
  }

  async deleteWishlistSuggestion(id: number) {
    return this.executeWithFallback(
      () => this.primaryStorage.deleteWishlistSuggestion(id),
      () => this.fallbackStorage.deleteWishlistSuggestion(id)
    );
  }

  async getRecentWishlistActivity(limit?: number) {
    return this.executeWithFallback(
      () => this.primaryStorage.getRecentWishlistActivity(limit),
      () => this.fallbackStorage.getRecentWishlistActivity(limit)
    );
  }

  // Event Request methods
  async getAllEventRequests() {
    return this.executeWithFallback(
      () => this.primaryStorage.getAllEventRequests(),
      () => this.fallbackStorage.getAllEventRequests()
    );
  }

  async getEventRequestsByStatuses(statuses: string[]) {
    return this.executeWithFallback(
      () => this.primaryStorage.getEventRequestsByStatuses(statuses),
      () => this.fallbackStorage.getEventRequestsByStatuses(statuses)
    );
  }

  async getEventRequest(id: number) {
    return this.executeWithFallback(
      () => this.primaryStorage.getEventRequest(id),
      () => this.fallbackStorage.getEventRequest(id)
    );
  }

  async createEventRequest(insertEventRequest: InsertEventRequest) {
    return this.executeWithFallback(
      () => this.primaryStorage.createEventRequest(insertEventRequest),
      () => this.fallbackStorage.createEventRequest(insertEventRequest),
      { isWriteOperation: true }
    );
  }

  async updateEventRequest(id: number, updates: Partial<EventRequest>) {
    return this.executeWithFallback(
      () => this.primaryStorage.updateEventRequest(id, updates),
      () => this.fallbackStorage.updateEventRequest(id, updates),
      { isWriteOperation: true }
    );
  }

  async deleteEventRequest(id: number) {
    return this.executeWithFallback(
      () => this.primaryStorage.deleteEventRequest(id),
      () => this.fallbackStorage.deleteEventRequest(id),
      { isWriteOperation: true }
    );
  }

  async getEventRequestsByStatus(status: string) {
    return this.executeWithFallback(
      () => this.primaryStorage.getEventRequestsByStatus(status),
      () => this.fallbackStorage.getEventRequestsByStatus(status)
    );
  }

  async getEventRemindersCount(userId?: string) {
    return this.executeWithFallback(
      () => this.primaryStorage.getEventRemindersCount(userId),
      () => this.fallbackStorage.getEventRemindersCount(userId)
    );
  }

  async getAllEventReminders(userId?: string) {
    return this.executeWithFallback(
      () => this.primaryStorage.getAllEventReminders(userId),
      () => this.fallbackStorage.getAllEventReminders(userId)
    );
  }

  async createEventReminder(reminderData: any) {
    return this.executeWithFallback(
      () => this.primaryStorage.createEventReminder(reminderData),
      () => this.fallbackStorage.createEventReminder(reminderData)
    );
  }

  async updateEventReminder(id: number, updates: any) {
    return this.executeWithFallback(
      () => this.primaryStorage.updateEventReminder(id, updates),
      () => this.fallbackStorage.updateEventReminder(id, updates)
    );
  }

  async deleteEventReminder(id: number) {
    return this.executeWithFallback(
      () => this.primaryStorage.deleteEventReminder(id),
      () => this.fallbackStorage.deleteEventReminder(id)
    );
  }

  async getEventRequestsByOrganization(organizationName: string) {
    return this.executeWithFallback(
      () =>
        this.primaryStorage.getEventRequestsByOrganization(organizationName),
      () =>
        this.fallbackStorage.getEventRequestsByOrganization(organizationName)
    );
  }

  // External ID Blacklist methods for permanent import tracking
  async checkExternalIdExists(externalId: string) {
    return this.executeWithFallback(
      () => this.primaryStorage.checkExternalIdExists(externalId),
      () => this.fallbackStorage.checkExternalIdExists(externalId)
    );
  }

  async addExternalIdToBlacklist(externalId: string, sourceTable: string = 'event_requests', notes?: string) {
    return this.executeWithFallback(
      () => this.primaryStorage.addExternalIdToBlacklist(externalId, sourceTable, notes),
      () => this.fallbackStorage.addExternalIdToBlacklist(externalId, sourceTable, notes)
    );
  }

  async getBlacklistedExternalIds() {
    return this.executeWithFallback(
      () => this.primaryStorage.getBlacklistedExternalIds(),
      () => this.fallbackStorage.getBlacklistedExternalIds()
    );
  }

  async removeExternalIdFromBlacklist(externalId: string) {
    return this.executeWithFallback(
      () => this.primaryStorage.removeExternalIdFromBlacklist(externalId),
      () => this.fallbackStorage.removeExternalIdFromBlacklist(externalId)
    );
  }

  async backfillExistingExternalIds() {
    return this.executeWithFallback(
      () => this.primaryStorage.backfillExistingExternalIds(),
      () => this.fallbackStorage.backfillExistingExternalIds()
    );
  }

  // Organization methods
  async getAllOrganizations() {
    return this.executeWithFallback(
      () => this.primaryStorage.getAllOrganizations(),
      () => this.fallbackStorage.getAllOrganizations()
    );
  }

  async getOrganization(id: number) {
    return this.executeWithFallback(
      () => this.primaryStorage.getOrganization(id),
      () => this.fallbackStorage.getOrganization(id)
    );
  }

  async createOrganization(insertOrganization: any) {
    return this.executeWithFallback(
      () => this.primaryStorage.createOrganization(insertOrganization),
      () => this.fallbackStorage.createOrganization(insertOrganization)
    );
  }

  async updateOrganization(id: number, updates: any) {
    return this.executeWithFallback(
      () => this.primaryStorage.updateOrganization(id, updates),
      () => this.fallbackStorage.updateOrganization(id, updates)
    );
  }

  async deleteOrganization(id: number) {
    return this.executeWithFallback(
      () => this.primaryStorage.deleteOrganization(id),
      () => this.fallbackStorage.deleteOrganization(id)
    );
  }

  async searchOrganizations(query: string) {
    return this.executeWithFallback(
      () => this.primaryStorage.searchOrganizations(query),
      () => this.fallbackStorage.searchOrganizations(query)
    );
  }

  async checkOrganizationDuplicates(organizationName: string) {
    return this.executeWithFallback(
      () => this.primaryStorage.checkOrganizationDuplicates(organizationName),
      () => this.fallbackStorage.checkOrganizationDuplicates(organizationName)
    );
  }

  // Event volunteer methods
  async getAllEventVolunteers() {
    return this.executeWithFallback(
      () => this.primaryStorage.getAllEventVolunteers(),
      () => this.fallbackStorage.getAllEventVolunteers()
    );
  }

  async getEventVolunteersByEventId(eventRequestId: number) {
    return this.executeWithFallback(
      () => this.primaryStorage.getEventVolunteersByEventId(eventRequestId),
      () => this.fallbackStorage.getEventVolunteersByEventId(eventRequestId)
    );
  }

  async getEventVolunteersByUserId(userId: string) {
    return this.executeWithFallback(
      () => this.primaryStorage.getEventVolunteersByUserId(userId),
      () => this.fallbackStorage.getEventVolunteersByUserId(userId)
    );
  }

  async createEventVolunteer(volunteer: any) {
    return this.executeWithFallback(
      () => this.primaryStorage.createEventVolunteer(volunteer),
      () => this.fallbackStorage.createEventVolunteer(volunteer)
    );
  }

  async updateEventVolunteer(id: number, updates: any) {
    return this.executeWithFallback(
      () => this.primaryStorage.updateEventVolunteer(id, updates),
      () => this.fallbackStorage.updateEventVolunteer(id, updates)
    );
  }

  async deleteEventVolunteer(id: number) {
    return this.executeWithFallback(
      () => this.primaryStorage.deleteEventVolunteer(id),
      () => this.fallbackStorage.deleteEventVolunteer(id)
    );
  }

  async getEventRequestById(id: number) {
    return this.executeWithFallback(
      () => this.primaryStorage.getEventRequest(id),
      () => this.fallbackStorage.getEventRequest(id)
    );
  }

  // Document Management Methods
  async getAllDocuments() {
    return this.executeWithFallback(
      () => this.primaryStorage.getAllDocuments(),
      () => this.fallbackStorage.getAllDocuments()
    );
  }

  async getDocument(id: number) {
    return this.executeWithFallback(
      () => this.primaryStorage.getDocument(id),
      () => this.fallbackStorage.getDocument(id)
    );
  }

  async getDocumentsForUser(userId: string) {
    return this.executeWithFallback(
      () => this.primaryStorage.getDocumentsForUser(userId),
      () => this.fallbackStorage.getDocumentsForUser(userId)
    );
  }

  async createDocument(document: any) {
    return this.executeWithFallback(
      () => this.primaryStorage.createDocument(document),
      () => this.fallbackStorage.createDocument(document)
    );
  }

  async updateDocument(id: number, updates: any) {
    return this.executeWithFallback(
      () => this.primaryStorage.updateDocument(id, updates),
      () => this.fallbackStorage.updateDocument(id, updates)
    );
  }

  async deleteDocument(id: number) {
    return this.executeWithFallback(
      () => this.primaryStorage.deleteDocument(id),
      () => this.fallbackStorage.deleteDocument(id)
    );
  }

  async checkUserDocumentAccess(
    documentId: number,
    userId: string,
    permission: string
  ) {
    return this.executeWithFallback(
      () =>
        this.primaryStorage.checkUserDocumentAccess(
          documentId,
          userId,
          permission
        ),
      () =>
        this.fallbackStorage.checkUserDocumentAccess(
          documentId,
          userId,
          permission
        )
    );
  }

  async getDocumentPermissions(documentId: number) {
    return this.executeWithFallback(
      () => this.primaryStorage.getDocumentPermissions(documentId),
      () => this.fallbackStorage.getDocumentPermissions(documentId)
    );
  }

  async grantDocumentPermission(permission: any) {
    return this.executeWithFallback(
      () => this.primaryStorage.grantDocumentPermission(permission),
      () => this.fallbackStorage.grantDocumentPermission(permission)
    );
  }

  async revokeDocumentPermission(
    documentId: number,
    userId: string,
    permissionType: string
  ) {
    return this.executeWithFallback(
      () =>
        this.primaryStorage.revokeDocumentPermission(
          documentId,
          userId,
          permissionType
        ),
      () =>
        this.fallbackStorage.revokeDocumentPermission(
          documentId,
          userId,
          permissionType
        )
    );
  }

  async logDocumentAccess(access: any) {
    return this.executeWithFallback(
      () => this.primaryStorage.logDocumentAccess(access),
      () => this.fallbackStorage.logDocumentAccess(access)
    );
  }

  async getDocumentAccessLogs(documentId: number) {
    return this.executeWithFallback(
      () => this.primaryStorage.getDocumentAccessLogs(documentId),
      () => this.fallbackStorage.getDocumentAccessLogs(documentId)
    );
  }

  async getUserDocumentPermission(documentId: number, userId: string) {
    return this.executeWithFallback(
      () => this.primaryStorage.getUserDocumentPermission(documentId, userId),
      () => this.fallbackStorage.getUserDocumentPermission(documentId, userId)
    );
  }

  async updateDocumentPermission(id: number, updates: any) {
    return this.executeWithFallback(
      () => this.primaryStorage.updateDocumentPermission(id, updates),
      () => this.fallbackStorage.updateDocumentPermission(id, updates)
    );
  }

  // Confidential Document Management Methods
  async createConfidentialDocument(data: any) {
    return this.executeWithFallback(
      () => this.primaryStorage.createConfidentialDocument(data),
      () => this.fallbackStorage.createConfidentialDocument(data)
    );
  }

  async getConfidentialDocumentsForUser(userEmail: string) {
    return this.executeWithFallback(
      () => this.primaryStorage.getConfidentialDocumentsForUser(userEmail),
      () => this.fallbackStorage.getConfidentialDocumentsForUser(userEmail)
    );
  }

  async getConfidentialDocumentById(id: number, userEmail: string) {
    return this.executeWithFallback(
      () => this.primaryStorage.getConfidentialDocumentById(id, userEmail),
      () => this.fallbackStorage.getConfidentialDocumentById(id, userEmail)
    );
  }

  async deleteConfidentialDocument(id: number, userEmail: string) {
    return this.executeWithFallback(
      () => this.primaryStorage.deleteConfidentialDocument(id, userEmail),
      () => this.fallbackStorage.deleteConfidentialDocument(id, userEmail)
    );
  }

  // Dashboard Documents Methods
  async getDashboardDocuments() {
    return this.executeWithFallback(
      () => this.primaryStorage.getDashboardDocuments(),
      () => this.fallbackStorage.getDashboardDocuments()
    );
  }

  async addDashboardDocument(
    documentId: string,
    displayOrder: number,
    userId: string
  ) {
    return this.executeWithFallback(
      () => this.primaryStorage.addDashboardDocument(documentId, displayOrder, userId),
      () => this.fallbackStorage.addDashboardDocument(documentId, displayOrder, userId)
    );
  }

  async removeDashboardDocument(documentId: string) {
    return this.executeWithFallback(
      () => this.primaryStorage.removeDashboardDocument(documentId),
      () => this.fallbackStorage.removeDashboardDocument(documentId)
    );
  }

  async updateDashboardDocumentOrder(
    updates: Array<{ documentId: string; displayOrder: number }>
  ) {
    return this.executeWithFallback(
      () => this.primaryStorage.updateDashboardDocumentOrder(updates),
      () => this.fallbackStorage.updateDashboardDocumentOrder(updates)
    );
  }

  // ==================== Email Template Sections ====================
  // Delegated to primary (database) storage via executePrimaryWithRetry —
  // these are DB-backed admin customizations with no MemStorage implementation,
  // so there is no meaningful in-memory fallback (executeWithFallback would just
  // hit the same missing method, and would also treat a valid `undefined`
  // not-found as a fallback trigger). The retry-only helper still recovers from
  // transient DB errors (Neon cold starts) without those hazards. Errors
  // propagate to the route, which handles the "table missing" case gracefully.
  // Without these passthroughs the wrapper silently lacked the methods and
  // `storage.getEmailTemplateSections is not a function` was thrown at runtime,
  // 500ing the email composer's section fetch.
  async getEmailTemplateSections(templateType?: string) {
    return this.executePrimaryWithRetry(() =>
      this.primaryStorage.getEmailTemplateSections(templateType)
    );
  }

  async getEmailTemplateSection(templateType: string, sectionKey: string) {
    return this.executePrimaryWithRetry(() =>
      this.primaryStorage.getEmailTemplateSection(templateType, sectionKey)
    );
  }

  async getEmailTemplateSectionById(id: number) {
    return this.executePrimaryWithRetry(() =>
      this.primaryStorage.getEmailTemplateSectionById(id)
    );
  }

  async createEmailTemplateSection(data: InsertEmailTemplateSection) {
    return this.executePrimaryWithRetry(() =>
      this.primaryStorage.createEmailTemplateSection(data)
    );
  }

  async updateEmailTemplateSection(id: number, data: UpdateEmailTemplateSection) {
    return this.executePrimaryWithRetry(() =>
      this.primaryStorage.updateEmailTemplateSection(id, data)
    );
  }

  async resetEmailTemplateSectionToDefault(id: number) {
    return this.executePrimaryWithRetry(() =>
      this.primaryStorage.resetEmailTemplateSectionToDefault(id)
    );
  }

  // Event Collaboration Comments
  async getEventCollaborationComments(eventRequestId: number) {
    return this.executeWithFallback(
      () => this.primaryStorage.getEventCollaborationComments(eventRequestId),
      () => this.fallbackStorage.getEventCollaborationComments(eventRequestId)
    );
  }

  async createEventCollaborationComment(data: InsertEventCollaborationComment) {
    return this.executeWithFallback(
      () => this.primaryStorage.createEventCollaborationComment(data),
      () => this.fallbackStorage.createEventCollaborationComment(data)
    );
  }

  async updateEventCollaborationComment(id: number, content: string, userId: string) {
    return this.executeWithFallback(
      () => this.primaryStorage.updateEventCollaborationComment(id, content, userId),
      () => this.fallbackStorage.updateEventCollaborationComment(id, content, userId)
    );
  }

  async deleteEventCollaborationComment(id: number, userId: string) {
    return this.executeWithFallback(
      () => this.primaryStorage.deleteEventCollaborationComment(id, userId),
      () => this.fallbackStorage.deleteEventCollaborationComment(id, userId)
    );
  }

  // Event Field Locks
  async getEventFieldLocks(eventRequestId: number) {
    return this.executeWithFallback(
      () => this.primaryStorage.getEventFieldLocks(eventRequestId),
      () => this.fallbackStorage.getEventFieldLocks(eventRequestId)
    );
  }

  async createEventFieldLock(data: InsertEventFieldLock) {
    return this.executeWithFallback(
      () => this.primaryStorage.createEventFieldLock(data),
      () => this.fallbackStorage.createEventFieldLock(data)
    );
  }

  async acquireEventFieldLock(data: InsertEventFieldLock) {
    // acquireEventFieldLock is a convenience method that wraps createEventFieldLock
    return this.createEventFieldLock(data);
  }

  async releaseEventFieldLock(eventRequestId: number, fieldName: string, userId: string) {
    return this.executeWithFallback(
      () => this.primaryStorage.releaseEventFieldLock(eventRequestId, fieldName, userId),
      () => this.fallbackStorage.releaseEventFieldLock(eventRequestId, fieldName, userId)
    );
  }

  async deleteEventFieldLock(eventRequestId: number, fieldName: string) {
    return this.executeWithFallback(
      () => this.primaryStorage.deleteEventFieldLock(eventRequestId, fieldName),
      () => this.fallbackStorage.deleteEventFieldLock(eventRequestId, fieldName)
    );
  }

  async cleanupExpiredLocks() {
    return this.executeWithFallback(
      () => this.primaryStorage.cleanupExpiredLocks(),
      () => this.fallbackStorage.cleanupExpiredLocks()
    );
  }

  // Event Edit Revisions
  async getEventEditRevisions(eventRequestId: number, options?: { fieldName?: string; limit?: number }) {
    return this.executeWithFallback(
      () => this.primaryStorage.getEventEditRevisions(eventRequestId, options),
      () => this.fallbackStorage.getEventEditRevisions(eventRequestId, options)
    );
  }

  async getEventFieldRevisions(eventRequestId: number, fieldName: string, limit?: number, offset?: number) {
    return this.executeWithFallback(
      () => this.primaryStorage.getEventFieldRevisions(eventRequestId, fieldName, limit, offset),
      () => this.fallbackStorage.getEventFieldRevisions(eventRequestId, fieldName, limit, offset)
    );
  }

  async createEventEditRevision(data: InsertEventEditRevision) {
    return this.executeWithFallback(
      () => this.primaryStorage.createEventEditRevision(data),
      () => this.fallbackStorage.createEventEditRevision(data)
    );
  }

  // Availability Slots
  async getAllAvailabilitySlots() {
    return this.executeWithFallback(
      () => this.primaryStorage.getAllAvailabilitySlots(),
      () => this.fallbackStorage.getAllAvailabilitySlots()
    );
  }

  async getAvailabilitySlotById(id: number) {
    return this.executeWithFallback(
      () => this.primaryStorage.getAvailabilitySlotById(id),
      () => this.fallbackStorage.getAvailabilitySlotById(id)
    );
  }

  async getAvailabilitySlotsByUserId(userId: string) {
    return this.executeWithFallback(
      () => this.primaryStorage.getAvailabilitySlotsByUserId(userId),
      () => this.fallbackStorage.getAvailabilitySlotsByUserId(userId)
    );
  }

  async getAvailabilitySlotsByDateRange(startDate: Date, endDate: Date) {
    return this.executeWithFallback(
      () => this.primaryStorage.getAvailabilitySlotsByDateRange(startDate, endDate),
      () => this.fallbackStorage.getAvailabilitySlotsByDateRange(startDate, endDate)
    );
  }

  async createAvailabilitySlot(slot: InsertAvailabilitySlot) {
    return this.executeWithFallback(
      () => this.primaryStorage.createAvailabilitySlot(slot),
      () => this.fallbackStorage.createAvailabilitySlot(slot)
    );
  }

  async updateAvailabilitySlot(id: number, updates: Partial<InsertAvailabilitySlot>) {
    return this.executeWithFallback(
      () => this.primaryStorage.updateAvailabilitySlot(id, updates),
      () => this.fallbackStorage.updateAvailabilitySlot(id, updates)
    );
  }

  async deleteAvailabilitySlot(id: number) {
    return this.executeWithFallback(
      () => this.primaryStorage.deleteAvailabilitySlot(id),
      () => this.fallbackStorage.deleteAvailabilitySlot(id)
    );
  }
}

export const storage = new StorageWrapper();
