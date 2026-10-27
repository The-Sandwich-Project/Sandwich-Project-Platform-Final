import { normalizeToolkitPatch } from '@shared/toolkit-state';
import {
  users,
  projects,
  archivedProjects,
  projectTasks,
  projectComments,
  projectAssignments,
  projectDocuments,
  taskCompletions,
  messages,
  messageLikes,
  conversations,
  conversationParticipants,
  weeklyReports,
  meetingMinutes,
  driveLinks,
  sandwichCollections,
  agendaItems,
  meetings,
  compiledAgendas,
  agendaSections,
  driverAgreements,
  drivers,
  driverVehicles,
  volunteers,
  hosts,
  hostContacts,
  recipients,
  contacts,
  committees,
  committeeMemberships,
  notifications,
  suggestions,
  suggestionResponses,
  chatMessages,
  chatMessageLikes,
  userActivityLogs,
  announcements,
  sandwichDistributions,
  wishlistSuggestions,
  documents,
  documentPermissions,
  documentAccessLogs,
  confidentialDocuments,
  eventRequests,
  organizations,
  eventVolunteers,
  eventCollaborationComments,
  eventCollaborationCommentLikes,
  eventFieldLocks,
  eventEditRevisions,
  meetingNotes,
  importedExternalIds,
  availabilitySlots,
  dashboardDocuments,
  searchAnalytics,
  emailTemplateSections,
  ambassadorCandidates,
  hostResources,
  type User,
  type InsertUser,
  type UpsertUser,
  type Project,
  type InsertProject,
  type ProjectTask,
  type InsertProjectTask,
  type ProjectComment,
  type InsertProjectComment,
  type ProjectAssignment,
  type InsertProjectAssignment,
  type TaskCompletion,
  type InsertTaskCompletion,
  type Message,
  type InsertMessage,
  type MessageLike,
  type InsertMessageLike,
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
  type Committee,
  type InsertCommittee,
  type CommitteeMembership,
  type InsertCommitteeMembership,
  type Notification,
  type InsertNotification,
  type Suggestion,
  type InsertSuggestion,
  type SuggestionResponse,
  type InsertSuggestionResponse,
  type ChatMessageLike,
  type InsertChatMessageLike,
  type UserActivityLog,
  type InsertUserActivityLog,
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
  type DashboardDocument,
  type InsertDashboardDocument,
  type SearchAnalytics,
  type InsertSearchAnalytics,
  type EventCollaborationComment,
  type InsertEventCollaborationComment,
  type EventCollaborationCommentLike,
  type InsertEventCollaborationCommentLike,
  type EventFieldLock,
  type InsertEventFieldLock,
  type EventEditRevision,
  type InsertEventEditRevision,
  type EmailTemplateSection,
  type InsertEmailTemplateSection,
  type UpdateEmailTemplateSection,
  type AmbassadorCandidate,
  type InsertAmbassadorCandidate,
  type UpdateAmbassadorCandidate,
  type HostResource,
  type InsertHostResource,
} from '@shared/schema';
import { db } from './db';
import {
  eq,
  desc,
  asc,
  sql,
  and,
  or,
  isNull,
  ne,
  isNotNull,
  gt,
  gte,
  lte,
  inArray,
  notInArray,
  like,
  ilike,
} from 'drizzle-orm';
import type { IStorage } from './storage';
import { logger } from './utils/production-safe-logger';
import { normalizeEmail } from '@shared/email-utils';

const UNASSIGNED_PROJECT_STATUSES: Array<Project['status']> = [
  'waiting',
  'tabled',
  // Support legacy data that may still use the deprecated 'available' status
  'available' as Project['status'],
];

/**
 * Keep the Collective Learning auto-log in step with hand edits to its auto
 * entries (see prepareAutoEntryEdit / syncOverrideFromAutoEntryChange).
 * Imported lazily to avoid a storage <-> service import cycle; failures never
 * block the edit itself.
 */
async function autoLog() {
  return import('./services/collections/collective-learning-auto-log');
}

async function prepareAutoLogEdit<T extends Record<string, unknown>>(id: number, updates: T): Promise<T> {
  try {
    return await (await autoLog()).prepareAutoEntryEdit(id, updates);
  } catch (error) {
    logger.error('Failed to prepare auto-log entry edit', error);
    return updates;
  }
}

async function syncAutoLogOverride(
  id: number,
  change: 'delete' | 'restore',
  userId?: string
): Promise<void> {
  try {
    await (await autoLog()).syncOverrideFromAutoEntryChange(id, change, userId);
  } catch (error) {
    logger.error('Failed to sync auto-log override after collection change', error);
  }
}

export class DatabaseStorage implements IStorage {
  // Users (required for authentication)
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserById(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    // Email lookups are case-insensitive (see shared/email-utils.ts for why).
    // We normalize the input and compare against LOWER(email); the DB has a
    // functional UNIQUE index on LOWER(email) that backs this up.
    const normalized = normalizeEmail(email);
    if (!normalized) return undefined;
    const [user] = await db
      .select()
      .from(users)
      .where(sql`LOWER(${users.email}) = ${normalized}`);
    return user || undefined;
  }

  async createUser(userData: InsertUser): Promise<User> {
    const payload = userData.email
      ? { ...userData, email: normalizeEmail(userData.email) }
      : userData;
    const [user] = await db.insert(users).values(payload).returning();
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const payload = userData.email
      ? { ...userData, email: normalizeEmail(userData.email) }
      : userData;
    const [user] = await db
      .insert(users)
      .values(payload)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          ...payload,
          updatedAt: new Date(),
        },
      })
      .returning();
    return user;
  }

  async getAllUsers(): Promise<User[]> {
    return await db.select().from(users).orderBy(users.createdAt);
  }

  async findUserByPhoneNumber(phoneNumber: string): Promise<User | undefined> {
    // Query the metadata JSON column for users with matching SMS phone number
    // Uses PostgreSQL's JSON operators to search nested field: metadata->'smsConsent'->>'phoneNumber'
    // Normalizes stored phone by stripping formatting characters (spaces, dashes, parentheses) to match input
    const [user] = await db
      .select()
      .from(users)
      .where(sql`regexp_replace(${users.metadata}->'smsConsent'->>'phoneNumber', '[\\s\\-\\(\\)]', '', 'g') = ${phoneNumber}`)
      .limit(1);
    return user || undefined;
  }

  async updateUser(
    id: string,
    updates: Partial<User>
  ): Promise<User | undefined> {
    const normalized = updates.email
      ? { ...updates, email: normalizeEmail(updates.email) }
      : updates;
    const [user] = await db
      .update(users)
      .set({ ...normalized, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return user || undefined;
  }

  async setUserPassword(id: string, password: string): Promise<boolean> {
    const result = await db
      .update(users)
      .set({ password: password, needsPasswordSetup: false, updatedAt: new Date() })
      .where(eq(users.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  async deleteUser(id: string): Promise<boolean> {
    const result = await db.delete(users).where(eq(users.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  // User activity tracking
  async updateUserLastActive(userId: string): Promise<void> {
    await db
      .update(users)
      .set({ lastActiveAt: new Date() })
      .where(eq(users.id, userId));
  }

  async getOnlineUsers(sinceMinutes: number = 5): Promise<Pick<User, 'id' | 'firstName' | 'lastName' | 'displayName' | 'email' | 'profileImageUrl' | 'lastActiveAt'>[]> {
    const cutoff = new Date(Date.now() - sinceMinutes * 60 * 1000);
    
    // Use raw SQL for Neon serverless compatibility
    // Neon's execute returns an array directly, not { rows: [...] }
    const rawResult = await db.execute(sql`
      SELECT id, first_name, last_name, display_name, email, profile_image_url, last_active_at
      FROM users
      WHERE is_active = true
        AND last_active_at IS NOT NULL
        AND last_active_at >= ${cutoff}
      ORDER BY last_active_at DESC
    `);
    
    // Handle both array and object response formats
    const rows = Array.isArray(rawResult) ? rawResult : (rawResult.rows || []);
    
    // Map to expected format
    const onlineUsers = rows.map((row: any) => ({
      id: row.id,
      firstName: row.first_name,
      lastName: row.last_name,
      displayName: row.display_name,
      email: row.email,
      profileImageUrl: row.profile_image_url,
      lastActiveAt: row.last_active_at ? new Date(row.last_active_at) : null,
    }));
    
    return onlineUsers;
  }

  // Legacy user methods (for backwards compatibility)
  async getUserByUsername(username: string): Promise<User | undefined> {
    // Username is the email address; match case-insensitively.
    const normalized = normalizeEmail(username);
    if (!normalized) return undefined;
    const [user] = await db
      .select()
      .from(users)
      .where(sql`LOWER(${users.email}) = ${normalized}`);
    return user || undefined;
  }

  // Projects
  async getAllProjects(): Promise<Project[]> {
    const projectsFromDb = await db
      .select()
      .from(projects)
      .orderBy(desc(projects.createdAt));

    // Populate missing assignee names
    const projectsWithNames = await Promise.all(
      projectsFromDb.map(async (project) => {
        // If assigneeIds exist but assigneeNames is missing or empty, populate them
        if (
          project.assigneeIds &&
          project.assigneeIds.length > 0 &&
          (!project.assigneeNames || !project.assigneeNames.trim())
        ) {
          const names = [];
          for (const assigneeId of project.assigneeIds) {
            if (assigneeId && assigneeId.trim()) {
              const user = await this.getUser(assigneeId);
              if (user) {
                names.push(
                  user.displayName ||
                    user.firstName ||
                    user.email ||
                    'Unknown User'
                );
              } else {
                names.push('Unknown User');
              }
            }
          }

          // Update the database with the resolved names
          if (names.length > 0) {
            const assigneeNames = names.join(', ');
            await db
              .update(projects)
              .set({ assigneeNames })
              .where(eq(projects.id, project.id));

            return { ...project, assigneeNames };
          }
        }

        return project;
      })
    );

    return projectsWithNames;
  }

  async getProject(id: number): Promise<Project | undefined> {
    logger.info(`[Database.getProject] Querying for project ID: ${id}`);
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, id));

    if (project) {
      logger.info(`[Database.getProject] Found project ${id}: "${project.title}"`);
    } else {
      logger.error(`[Database.getProject] Project ${id} NOT FOUND in database`);
    }

    return project || undefined;
  }

  async createProject(insertProject: InsertProject): Promise<Project> {
    const [project] = await db
      .insert(projects)
      .values(insertProject)
      .returning();
    return project;
  }

  async updateProject(
    id: number,
    updates: Partial<Project>
  ): Promise<Project | undefined> {
    // Get the current project to check its current state
    const currentProject = await this.getProject(id);
    if (!currentProject) return undefined;

    // Auto-update status based on assignee changes
    const updateData: Partial<Project> = { ...updates };
    const statusWasProvided = Object.prototype.hasOwnProperty.call(updates, 'status');
    const assigneeWasProvided = Object.prototype.hasOwnProperty.call(
      updates,
      'assigneeName'
    );
    const normalizedAssigneeName =
      typeof updateData.assigneeName === 'string'
        ? updateData.assigneeName.trim()
        : updateData.assigneeName
        ? String(updateData.assigneeName).trim()
        : '';
    const isAssigning = assigneeWasProvided && normalizedAssigneeName.length > 0;
    const isUnassigning = assigneeWasProvided && normalizedAssigneeName.length === 0;

    if (statusWasProvided && updateData.status === 'available') {
      updateData.status = currentProject.reviewInNextMeeting ? 'tabled' : 'waiting';
    }

    // If an assignee is set and the project is currently in an unassigned state, move it to in_progress
    if (
      isAssigning &&
      UNASSIGNED_PROJECT_STATUSES.includes(
        currentProject.status as Project['status']
      ) &&
      !statusWasProvided
    ) {
      updateData.status = 'in_progress';
    }
    // If the assignee is cleared and the project was in progress, move it back to an unassigned state
    else if (isUnassigning && currentProject.status === 'in_progress' && !statusWasProvided) {
      updateData.status = currentProject.reviewInNextMeeting ? 'tabled' : 'waiting';
    }

    try {
      // Drizzle requires camelCase field names (matching the schema), not snake_case
      // Add updatedAt timestamp
      const dbUpdate: Record<string, any> = {
        ...updateData,
        updatedAt: new Date()
      };

      logger.info(`[Database.updateProject] Prepared update for project ${id}:`, {
        originalData: updateData,
        dbUpdate: dbUpdate,
        fieldCount: Object.keys(dbUpdate).length
      });

      // Guard against empty updates
      if (Object.keys(updateData).length === 0) {
        logger.warn(`[Database.updateProject] No fields to update for project ${id}. Skipping update.`);
        // Just return the current project without updating
        return currentProject;
      }

      const [project] = await db
        .update(projects)
        .set(dbUpdate)
        .where(eq(projects.id, id))
        .returning();

      return project || undefined;
    } catch (error) {
      logger.error(`[Database] Failed to update project ${id}:`, error);
      throw error;
    }
  }

  async deleteProject(id: number): Promise<boolean> {
    try {
      // First, delete related data (tasks, comments, assignments, meeting notes, etc.) to avoid foreign key constraints
      // Delete project tasks
      await db.delete(projectTasks).where(eq(projectTasks.projectId, id));
      logger.info(`[Database] Deleted related tasks for project ${id}`);

      // Delete project comments
      await db.delete(projectComments).where(eq(projectComments.projectId, id));
      logger.info(`[Database] Deleted related comments for project ${id}`);

      // Delete project assignments
      await db.delete(projectAssignments).where(eq(projectAssignments.projectId, id));
      logger.info(`[Database] Deleted related assignments for project ${id}`);

      // Delete meeting notes (CRITICAL FIX: prevent orphaned meeting notes)
      await db.delete(meetingNotes).where(eq(meetingNotes.projectId, id));
      logger.info(`[Database] Deleted related meeting notes for project ${id}`);

      // Delete project documents (CRITICAL FIX: prevent foreign key constraint violations on archive)
      await db.delete(projectDocuments).where(eq(projectDocuments.projectId, id));
      logger.info(`[Database] Deleted related documents for project ${id}`);

      // Now delete the project itself
      const result = await db.delete(projects).where(eq(projects.id, id));
      const deleted = (result.rowCount ?? 0) > 0;
      
      if (!deleted) {
        logger.error(`[Database] Delete query returned 0 rows affected for project ${id} - project may not exist`);
        return false;
      }

      logger.info(`[Database] Successfully deleted project ${id} from projects table`);
      return true;
    } catch (error: any) {
      logger.error(`[Database] Error deleting project ${id}:`, error);
      // Check if it's a foreign key constraint violation
      if (error?.code === '23503' || error?.message?.includes('foreign key') || error?.message?.includes('violates foreign key constraint')) {
        logger.error(`[Database] Foreign key constraint violation when deleting project ${id} - related data may still exist`);
        throw new Error(`Cannot delete project ${id}: it is still referenced by other records. Error: ${error.message}`);
      }
      throw error;
    }
  }

  // Archive functionality for completed projects
  async archiveProject(
    id: number,
    userId?: string,
    userName?: string
  ): Promise<boolean> {
    const project = await this.getProject(id);
    if (!project) {
      logger.error(`[Database] Cannot archive project ${id}: project not found`);
      return false;
    }

    try {
      // Create archived version
      const archiveData = {
        originalProjectId: project.id,
        title: project.title,
        description: project.description,
        priority: project.priority,
        category: project.category,
        assigneeId: project.assigneeId,
        assigneeName: project.assigneeName,
        assigneeIds: project.assigneeIds,
        assigneeNames: project.assigneeNames,
        dueDate: project.dueDate,
        startDate: project.startDate,
        completionDate: project.completionDate || new Date().toISOString(),
        progressPercentage: 100,
        notes: project.notes,
        requirements: project.requirements,
        deliverables: project.deliverables,
        resources: project.resources,
        blockers: project.blockers,
        tags: project.tags,
        estimatedHours: project.estimatedHours,
        actualHours: project.actualHours,
        budget: project.budget,
        createdBy: project.createdBy,
        createdByName: project.createdByName,
        createdAt: project.createdAt || new Date(), // Ensure we have a valid timestamp
        originalCreatedAt: project.createdAt,
        originalUpdatedAt: project.updatedAt,
        archivedBy: userId,
        archivedByName: userName,
        googleSheetRowId: project.googleSheetRowId || null, // Preserve Google Sheet row ID to prevent re-import
      };

      // Insert into archived table
      await db.insert(archivedProjects).values(archiveData);
      logger.info(`[Database] Archived project ${id} "${project.title}" to archived_projects table`);

      // Delete from active projects
      const deleteResult = await this.deleteProject(id);
      if (!deleteResult) {
        logger.error(`[Database] Failed to delete project ${id} after archiving - project may still exist in projects table`);
        throw new Error(`Failed to delete project ${id} after archiving`);
      }
      logger.info(`[Database] Deleted project ${id} "${project.title}" from projects table`);

      // Verify deletion
      const verifyProject = await this.getProject(id);
      if (verifyProject) {
        logger.error(`[Database] CRITICAL: Project ${id} still exists in projects table after deletion attempt!`);
        throw new Error(`Project ${id} was not deleted from projects table`);
      }

      return true;
    } catch (error) {
      logger.error(`[Database] Error archiving project ${id}:`, error);
      throw error;
    }
  }

  async getArchivedProjects(): Promise<any[]> {
    return await db
      .select()
      .from(archivedProjects)
      .orderBy(desc(archivedProjects.createdAt));
  }

  async getArchivedProject(id: number): Promise<any | undefined> {
    const [project] = await db
      .select()
      .from(archivedProjects)
      .where(eq(archivedProjects.id, id));
    return project || undefined;
  }

  // Project Tasks
  async getProjectTasks(projectId: number): Promise<ProjectTask[]> {
    return await db
      .select()
      .from(projectTasks)
      .where(eq(projectTasks.projectId, projectId))
      .orderBy(projectTasks.order);
  }

  async getProjectTask(taskId: number): Promise<ProjectTask | undefined> {
    const [task] = await db
      .select()
      .from(projectTasks)
      .where(eq(projectTasks.id, taskId));
    return task || undefined;
  }

  async createProjectTask(insertTask: InsertProjectTask): Promise<ProjectTask> {
    const [task] = await db.insert(projectTasks).values(insertTask).returning();
    return task;
  }

  async updateProjectTask(
    id: number,
    updates: Partial<ProjectTask>
  ): Promise<ProjectTask | undefined> {
    // Log for debugging
    logger.log(`Updating task ${id} with updates:`, updates);

    // Handle timestamp fields properly and filter out fields that shouldn't be updated
    const processedUpdates = { ...updates };

    // Remove fields that shouldn't be updated directly
    delete processedUpdates.id;
    delete processedUpdates.projectId;
    delete processedUpdates.createdAt;

    if (
      processedUpdates.completedAt &&
      typeof processedUpdates.completedAt === 'string'
    ) {
      processedUpdates.completedAt = new Date(processedUpdates.completedAt);
    }
    if (
      processedUpdates.dueDate &&
      typeof processedUpdates.dueDate === 'string'
    ) {
      processedUpdates.dueDate = new Date(processedUpdates.dueDate);
    }

    // Always update the updatedAt timestamp
    processedUpdates.updatedAt = new Date();

    logger.log(`Processed updates for task ${id}:`, processedUpdates);

    try {
      const [task] = await db
        .update(projectTasks)
        .set(processedUpdates)
        .where(eq(projectTasks.id, id))
        .returning();
      logger.log(`Task ${id} updated successfully:`, task);
      return task || undefined;
    } catch (error) {
      logger.error(`Error updating task ${id}:`, error);
      throw error;
    }
  }

  async deleteProjectTask(id: number): Promise<boolean> {
    const result = await db.delete(projectTasks).where(eq(projectTasks.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  async getProjectCongratulations(projectId: number): Promise<any[]> {
    const result = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.relatedType, 'project'),
          eq(notifications.relatedId, projectId),
          eq(notifications.type, 'congratulations')
        )
      )
      .orderBy(desc(notifications.createdAt));
    return result;
  }

  async getTaskById(id: number): Promise<ProjectTask | undefined> {
    const result = await db
      .select()
      .from(projectTasks)
      .where(eq(projectTasks.id, id))
      .limit(1);
    return result[0];
  }

  async getAssignedTasks(userId: string): Promise<ProjectTask[]> {
    return await db
      .select()
      .from(projectTasks)
      .where(
        or(
          eq(projectTasks.assigneeId, userId),
          sql`${userId} = ANY(${projectTasks.assigneeIds})`
        )
      )
      .orderBy(desc(projectTasks.createdAt));
  }

  async updateTaskStatus(id: number, status: string): Promise<boolean> {
    const result = await db
      .update(projectTasks)
      .set({ status: status })
      .where(eq(projectTasks.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  // Task completion methods
  async createTaskCompletion(
    completion: InsertTaskCompletion
  ): Promise<TaskCompletion> {
    const [result] = await db
      .insert(taskCompletions)
      .values(completion)
      .returning();
    return result;
  }

  async getTaskCompletions(taskId: number): Promise<TaskCompletion[]> {
    return await db
      .select()
      .from(taskCompletions)
      .where(eq(taskCompletions.taskId, taskId))
      .orderBy(taskCompletions.completedAt);
  }

  async removeTaskCompletion(taskId: number, userId: string): Promise<boolean> {
    const result = await db
      .delete(taskCompletions)
      .where(
        and(
          eq(taskCompletions.taskId, taskId),
          eq(taskCompletions.userId, userId)
        )
      );
    return (result.rowCount ?? 0) > 0;
  }

  // Subtask methods
  async getSubtasks(parentTaskId: number): Promise<ProjectTask[]> {
    return await db
      .select()
      .from(projectTasks)
      .where(eq(projectTasks.parentTaskId, parentTaskId))
      .orderBy(projectTasks.createdAt);
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
    const [subtask] = await db
      .insert(projectTasks)
      .values({
        projectId: data.projectId,
        parentTaskId: data.parentTaskId,
        title: data.title,
        description: data.description || null,
        status: 'pending',
        priority: data.priority || 'medium',
        dueDate: data.dueDate || null,
        assigneeIds: data.assigneeIds || null,
        assigneeNames: data.assigneeNames || null,
        originType: 'manual',
        promotedToTodo: false,
      })
      .returning();
    return subtask;
  }

  async promoteTaskToTodo(taskId: number): Promise<ProjectTask> {
    const [task] = await db
      .update(projectTasks)
      .set({
        promotedToTodo: true,
        updatedAt: new Date(),
      })
      .where(eq(projectTasks.id, taskId))
      .returning();
    return task;
  }

  async demoteTaskFromTodo(taskId: number): Promise<ProjectTask> {
    const [task] = await db
      .update(projectTasks)
      .set({
        promotedToTodo: false,
        updatedAt: new Date(),
      })
      .where(eq(projectTasks.id, taskId))
      .returning();
    return task;
  }

  async getTasksPromotedToTodo(): Promise<ProjectTask[]> {
    return await db
      .select()
      .from(projectTasks)
      .where(eq(projectTasks.promotedToTodo, true))
      .orderBy(desc(projectTasks.updatedAt));
  }

  // Project Comments
  async getProjectComments(projectId: number): Promise<ProjectComment[]> {
    return await db
      .select()
      .from(projectComments)
      .where(eq(projectComments.projectId, projectId))
      .orderBy(desc(projectComments.createdAt));
  }

  async createProjectComment(
    insertComment: InsertProjectComment
  ): Promise<ProjectComment> {
    const [comment] = await db
      .insert(projectComments)
      .values(insertComment)
      .returning();
    return comment;
  }

  async deleteProjectComment(id: number): Promise<boolean> {
    const result = await db
      .delete(projectComments)
      .where(eq(projectComments.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  // Messages
  async getAllMessages(): Promise<Message[]> {
    try {
      const result = await db
        .select({
          id: messages.id,
          content: messages.content,
          sender: messages.sender,
          timestamp: messages.createdAt,
          userId: messages.userId,
          conversationId: messages.conversationId,
        })
        .from(messages)
        .orderBy(messages.createdAt);

      return result;
    } catch (error) {
      // If sender column doesn't exist, query without it and add default sender
      logger.log('Sender column not found, using fallback query');
      const result = await db
        .select({
          id: messages.id,
          content: messages.content,
          timestamp: messages.createdAt,
          userId: messages.userId,
          conversationId: messages.conversationId,
        })
        .from(messages)
        .orderBy(messages.createdAt);

      // Add default sender for compatibility
      return result.map((msg) => ({
        ...msg,
        sender: 'Unknown User',
      }));
    }
  }

  async getRecentMessages(limit: number): Promise<Message[]> {
    return await db.select().from(messages).orderBy(messages.id).limit(limit);
  }

  // REMOVED: getMessagesByCommittee - no longer needed with new conversation system

  // UPDATED: Get messages by conversationId (preferred method)
  async getMessagesByConversationId(
    conversationId: number
  ): Promise<Message[]> {
    const results = await db
      .select({
        id: messages.id,
        conversationId: messages.conversationId,
        userId: messages.userId,
        senderId: messages.senderId,
        content: messages.content,
        sender: sql<string>`COALESCE(CONCAT(${users.firstName}, ' ', ${users.lastName}), ${users.firstName}, ${users.email}, ${messages.sender}, 'Member')`,
        contextType: messages.contextType,
        contextId: messages.contextId,
        editedAt: messages.editedAt,
        editedContent: messages.editedContent,
        deletedAt: messages.deletedAt,
        deletedBy: messages.deletedBy,
        createdAt: messages.createdAt,
        updatedAt: messages.updatedAt,
      })
      .from(messages)
      .leftJoin(users, eq(users.id, messages.senderId))
      .where(eq(messages.conversationId, conversationId))
      .orderBy(messages.createdAt);

    return results.map((row) => ({
      ...row,
      sender: row.sender || 'Member',
    }));
  }

  // Get participants for a conversation
  async getConversationParticipants(conversationId: number): Promise<
    Array<{
      userId: string;
      role: string;
      firstName: string;
      lastName: string;
      email: string;
    }>
  > {
    // Note: conversationParticipants table doesn't have role column, so we'll default to 'member'
    const results = await db
      .select({
        userId: conversationParticipants.userId,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
      })
      .from(conversationParticipants)
      .leftJoin(users, eq(users.id, conversationParticipants.userId))
      .where(eq(conversationParticipants.conversationId, conversationId));

    logger.log(
      `[DB] Found ${results.length} participants for conversation ${conversationId}`
    );
    return results.map((row) => ({
      userId: row.userId,
      role: 'member', // Default role since table doesn't have role column
      firstName: row.firstName || '',
      lastName: row.lastName || '',
      email: row.email || '',
    }));
  }

  // ALIAS: getMessagesByThreadId for backwards compatibility
  async getMessagesByThreadId(threadId: number): Promise<Message[]> {
    return await this.getMessagesByConversationId(threadId);
  }

  // ALIAS: getMessages for backwards compatibility
  async getMessages(
    messageContext: string,
    limit?: number
  ): Promise<Message[]> {
    if (limit) {
      return await this.getRecentMessages(limit);
    } else {
      // For backwards compatibility, return all messages since committee filtering is removed
      return await this.getAllMessages();
    }
  }

  // NEW: Get or create conversation for specific conversation types
  async getOrCreateThreadId(
    type: string,
    referenceId?: string
  ): Promise<number> {
    try {
      // For the new simple system, we'll use conversation IDs as thread IDs
      // Check if conversation already exists
      const [existing] = await db
        .select()
        .from(conversations)
        .where(
          and(
            eq(conversations.type, type),
            referenceId
              ? eq(conversations.name, referenceId)
              : isNull(conversations.name)
          )
        );

      if (existing) {
        return existing.id;
      }

      // Create new conversation
      const [newConversation] = await db
        .insert(conversations)
        .values({
          type,
          name: referenceId || this.generateThreadTitle(type, referenceId),
        })
        .returning();

      return newConversation.id;
    } catch (error) {
      logger.error('Error getting/creating conversation:', error);
      throw error;
    }
  }

  private generateThreadTitle(type: string, referenceId?: string): string {
    switch (type) {
      case 'general':
        return 'General Chat';
      case 'committee':
        return `Committee Chat - ${referenceId}`;
      case 'host':
        return 'Host Chat';
      case 'driver':
        return 'Driver Chat';
      case 'recipient':
        return 'Recipient Chat';
      case 'core_team':
        return 'Core Team';
      case 'direct':
        return `Direct Messages - ${referenceId}`;
      case 'group':
        return `Group Chat - ${referenceId}`;
      default:
        return `${type} Chat`;
    }
  }

  // FIXED: Direct messages must use conversationId for proper isolation
  async getDirectMessages(
    userId1: string,
    userId2: string
  ): Promise<Message[]> {
    // Create consistent reference ID for direct message conversation
    const userIds = [userId1, userId2].sort();
    const referenceId = userIds.join('_');
    const conversationId = await this.getOrCreateThreadId(
      'direct',
      referenceId
    );

    logger.log(
      `🔍 QUERY: getDirectMessages - conversationId: ${conversationId}, users: ${userId1} <-> ${userId2}, referenceId: ${referenceId}`
    );

    const messageResults = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(messages.createdAt);

    logger.log(
      `🔍 RESULT: Found ${messageResults.length} direct messages for conversationId ${conversationId}`
    );
    return messageResults;
  }

  async getMessageById(id: number): Promise<Message | undefined> {
    logger.log(`[DEBUG] getMessageById called with id: ${id}`);
    try {
      const [message] = await db
        .select()
        .from(messages)
        .where(eq(messages.id, id));
      logger.log(`[DEBUG] getMessageById result:`, message);
      return message || undefined;
    } catch (error) {
      logger.error(`[ERROR] getMessageById failed for id ${id}:`, error);
      return undefined;
    }
  }

  async markMessageAsRead(messageId: string, userId: string): Promise<void> {
    logger.log(`[DB] Marking message ${messageId} as read for user ${userId}`);
    try {
      // Update the message read status
      await db
        .update(messages)
        .set({ read: true })
        .where(eq(messages.id, parseInt(messageId)));
      logger.log(
        `[DB] Message ${messageId} marked as read for user ${userId}`
      );
    } catch (error) {
      logger.error(
        `[ERROR] Failed to mark message ${messageId} as read for user ${userId}:`,
        error
      );
      throw error;
    }
  }

  async createMessage(insertMessage: InsertMessage): Promise<Message> {
    // Ensure conversationId is set for proper conversation isolation
    if (!insertMessage.conversationId) {
      // Auto-assign conversationId based on message type
      let conversationType = 'channel';
      let conversationName = 'general'; // Default to general chat

      // For now, create a general conversation if none exists
      const [conversation] = await db
        .select()
        .from(conversations)
        .where(
          and(
            eq(conversations.type, 'channel'),
            eq(conversations.name, 'general')
          )
        )
        .limit(1);

      if (conversation) {
        insertMessage.conversationId = conversation.id;
        logger.log(
          `✅ SEND: Using existing conversationId ${conversation.id} for general message from ${insertMessage.userId}`
        );
      } else {
        // Create new general conversation
        const [newConversation] = await db
          .insert(conversations)
          .values({
            type: 'channel',
            name: 'general',
          })
          .returning();

        insertMessage.conversationId = newConversation.id;
        logger.log(
          `✅ SEND: Created new conversationId ${newConversation.id} for general message from ${insertMessage.userId}`
        );
      }
    } else {
      logger.log(
        `🔄 SEND: Using existing conversationId ${insertMessage.conversationId} for message from ${insertMessage.userId}`
      );
    }

    const [message] = await db
      .insert(messages)
      .values(insertMessage)
      .returning();
    logger.log(
      `📤 MESSAGE SENT: id=${message.id}, conversationId=${message.conversationId}, sender=${message.userId}`
    );
    return message;
  }

  async createReply(
    insertMessage: InsertMessage,
    parentId: number
  ): Promise<Message> {
    const [message] = await db
      .insert(messages)
      .values(insertMessage)
      .returning();
    await this.updateReplyCount(parentId);
    return message;
  }

  async updateReplyCount(messageId: number): Promise<void> {
    await db
      .update(messages)
      .set({ replyCount: sql`${messages.replyCount} + 1` })
      .where(eq(messages.id, messageId));
  }

  async deleteMessage(id: number): Promise<boolean> {
    logger.log(`[DEBUG] deleteMessage called with id: ${id}`);
    try {
      const result = await db.delete(messages).where(eq(messages.id, id));
      logger.log(`[DEBUG] deleteMessage result:`, result);
      const success = (result.rowCount ?? 0) > 0;
      logger.log(`[DEBUG] deleteMessage success: ${success}`);
      return success;
    } catch (error) {
      logger.error(`[ERROR] deleteMessage failed for id ${id}:`, error);
      return false;
    }
  }

  async getMessagesBySender(senderId: string): Promise<Message[]> {
    logger.log(
      `[DEBUG] getMessagesBySender called with senderId: ${senderId}`
    );
    try {
      const result = await db
        .select()
        .from(messages)
        .where(eq(messages.senderId, senderId))
        .orderBy(desc(messages.createdAt));
      logger.log(
        `[DEBUG] Found ${result.length} messages sent by ${senderId}`
      );
      return result;
    } catch (error) {
      logger.error(
        `[ERROR] getMessagesBySender failed for senderId ${senderId}:`,
        error
      );
      return [];
    }
  }

  async getMessagesBySenderWithReadStatus(senderId: string): Promise<any[]> {
    logger.log(
      `[DEBUG] getMessagesBySenderWithReadStatus called with senderId: ${senderId}`
    );
    try {
      const { messageRecipients } = await import('@shared/schema');

      // Get messages with recipient read status
      const result = await db
        .select({
          message: messages,
          recipientRead: messageRecipients.read,
          recipientReadAt: messageRecipients.readAt,
          recipientId: messageRecipients.recipientId,
        })
        .from(messages)
        .leftJoin(
          messageRecipients,
          eq(messages.id, messageRecipients.messageId)
        )
        .where(eq(messages.senderId, senderId))
        .orderBy(desc(messages.createdAt));

      logger.log(
        `[DEBUG] Found ${result.length} message-recipient pairs for sender ${senderId}`
      );
      return result;
    } catch (error) {
      logger.error(
        `[ERROR] getMessagesBySenderWithReadStatus failed for senderId ${senderId}:`,
        error
      );
      return [];
    }
  }

  async getMessagesForRecipient(recipientId: string): Promise<Message[]> {
    logger.log(
      `[DEBUG] getMessagesForRecipient called with recipientId: ${recipientId}`
    );
    try {
      const result = await db
        .select()
        .from(messages)
        .where(eq(messages.contextId, recipientId))
        .orderBy(desc(messages.createdAt));
      logger.log(
        `[DEBUG] Found ${result.length} messages for recipient ${recipientId}`
      );
      return result;
    } catch (error) {
      logger.error(
        `[ERROR] getMessagesForRecipient failed for recipientId ${recipientId}:`,
        error
      );
      return [];
    }
  }

  // Conversation management methods
  async getDirectConversation(
    userId1: string,
    userId2: string
  ): Promise<any | undefined> {
    try {
      // Find direct conversations where both users are participants
      const directConversations = await db
        .select({ conversation: conversations })
        .from(conversations)
        .innerJoin(
          conversationParticipants,
          eq(conversations.id, conversationParticipants.conversationId)
        )
        .where(
          and(
            eq(conversations.type, 'direct'),
            eq(conversationParticipants.userId, userId1)
          )
        );

      // Check if any of these conversations also include userId2
      for (const conv of directConversations) {
        const participant2 = await db
          .select()
          .from(conversationParticipants)
          .where(
            and(
              eq(conversationParticipants.conversationId, conv.conversation.id),
              eq(conversationParticipants.userId, userId2)
            )
          )
          .limit(1);

        if (participant2.length > 0) {
          return conv.conversation;
        }
      }

      return undefined;
    } catch (error) {
      logger.error('Error finding direct conversation:', error);
      return undefined;
    }
  }

  async addConversationParticipant(participantData: any): Promise<any> {
    const [participant] = await db
      .insert(conversationParticipants)
      .values(participantData)
      .returning();
    return participant;
  }

  // REMOVED: Old group messaging methods - replaced with simple conversation system
  // These methods referenced non-existent tables (messageGroups, groupMessageParticipants)
  // The new system uses conversations, conversationParticipants, and messages tables

  // Weekly Reports
  async getAllWeeklyReports(): Promise<WeeklyReport[]> {
    return await db.select().from(weeklyReports).orderBy(weeklyReports.id);
  }

  async createWeeklyReport(
    insertReport: InsertWeeklyReport
  ): Promise<WeeklyReport> {
    const [report] = await db
      .insert(weeklyReports)
      .values(insertReport)
      .returning();
    return report;
  }

  // Sandwich Collections
  async getAllSandwichCollections(): Promise<SandwichCollection[]> {
    return await db
      .select()
      .from(sandwichCollections)
      .where(isNull(sandwichCollections.deletedAt)) // Exclude soft-deleted records
      .orderBy(desc(sandwichCollections.collectionDate));
  }

  async getSandwichCollections(
    limit: number,
    offset: number,
    sortField = 'collectionDate',
    sortOrder = 'desc'
  ): Promise<SandwichCollection[]> {
    const orderByClause =
      sortOrder === 'asc'
        ? asc(
            sandwichCollections[sortField as keyof typeof sandwichCollections]
          )
        : desc(
            sandwichCollections[sortField as keyof typeof sandwichCollections]
          );

    return await db
      .select()
      .from(sandwichCollections)
      .where(isNull(sandwichCollections.deletedAt)) // Exclude soft-deleted records
      .orderBy(orderByClause)
      .limit(limit)
      .offset(offset);
  }

  async getSandwichCollectionById(
    id: number
  ): Promise<SandwichCollection | null> {
    const result = await db
      .select()
      .from(sandwichCollections)
      .where(eq(sandwichCollections.id, id));
    return result[0] || null;
  }

  async getSandwichCollectionsByEventRequestId(
    eventRequestId: number
  ): Promise<SandwichCollection[]> {
    return await db
      .select()
      .from(sandwichCollections)
      .where(
        and(
          eq(sandwichCollections.eventRequestId, eventRequestId),
          isNull(sandwichCollections.deletedAt) // Exclude soft-deleted records
        )
      )
      .orderBy(desc(sandwichCollections.collectionDate));
  }

  async getSandwichCollectionsCount(): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(sandwichCollections)
      .where(isNull(sandwichCollections.deletedAt)); // Exclude soft-deleted records
    return Number(result[0].count);
  }

  async getCollectionStats(): Promise<{
    totalEntries: number;
    totalSandwiches: number;
  }> {
    const result = await db
      .select({
        totalEntries: sql<number>`count(*)::int`,
        totalSandwiches: sql<number>`
          coalesce(sum(individual_sandwiches), 0)::int
          + coalesce(sum(group1_count), 0)::int
          + coalesce(sum(group2_count), 0)::int
          + coalesce(sum(
              (
                SELECT sum((elem->>'count')::int)
                FROM jsonb_array_elements(group_collections) AS elem
              )
            ), 0)::int
        `,
      })
      .from(sandwichCollections)
      .where(isNull(sandwichCollections.deletedAt)); // Exclude soft-deleted records

    return {
      totalEntries: Number(result[0].totalEntries),
      totalSandwiches: Number(result[0].totalSandwiches),
    };
  }

  async createSandwichCollection(
    insertCollection: InsertSandwichCollection
  ): Promise<SandwichCollection> {
    const [collection] = await db
      .insert(sandwichCollections)
      .values(insertCollection)
      .returning();
    return collection;
  }

  async updateSandwichCollection(
    id: number,
    updates: Partial<SandwichCollection>
  ): Promise<SandwichCollection | undefined> {
    const finalUpdates = await prepareAutoLogEdit(id, updates);
    const [collection] = await db
      .update(sandwichCollections)
      .set(finalUpdates)
      .where(eq(sandwichCollections.id, id))
      .returning();
    return collection || undefined;
  }

  async deleteSandwichCollection(id: number, userId?: string): Promise<boolean> {
    // Soft delete: set deletedAt and deletedBy instead of actually deleting
    const result = await db
      .update(sandwichCollections)
      .set({
        deletedAt: new Date(),
        deletedBy: userId || null,
      })
      .where(eq(sandwichCollections.id, id));
    const deleted = (result.rowCount ?? 0) > 0;
    if (deleted) await syncAutoLogOverride(id, 'delete', userId);
    return deleted;
  }

  async restoreSandwichCollection(id: number): Promise<boolean> {
    // Restore a soft-deleted sandwich collection
    const result = await db
      .update(sandwichCollections)
      .set({
        deletedAt: null,
        deletedBy: null,
      })
      .where(eq(sandwichCollections.id, id));
    const restored = (result.rowCount ?? 0) > 0;
    if (restored) await syncAutoLogOverride(id, 'restore');
    return restored;
  }

  // Meeting Minutes
  async getAllMeetingMinutes(): Promise<MeetingMinutes[]> {
    return await db.select().from(meetingMinutes).orderBy(meetingMinutes.id);
  }

  async getRecentMeetingMinutes(limit: number): Promise<MeetingMinutes[]> {
    return await db
      .select()
      .from(meetingMinutes)
      .orderBy(meetingMinutes.id)
      .limit(limit);
  }

  async createMeetingMinutes(
    insertMinutes: InsertMeetingMinutes
  ): Promise<MeetingMinutes> {
    const [minutes] = await db
      .insert(meetingMinutes)
      .values(insertMinutes)
      .returning();
    return minutes;
  }

  async deleteMeetingMinutes(id: number): Promise<boolean> {
    const result = await db
      .delete(meetingMinutes)
      .where(eq(meetingMinutes.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  // Drive Links
  async getAllDriveLinks(): Promise<DriveLink[]> {
    return await db.select().from(driveLinks).orderBy(driveLinks.id);
  }

  async createDriveLink(insertLink: InsertDriveLink): Promise<DriveLink> {
    const [link] = await db.insert(driveLinks).values(insertLink).returning();
    return link;
  }

  // Agenda Items
  async getAllAgendaItems(): Promise<AgendaItem[]> {
    return await db.select().from(agendaItems).orderBy(agendaItems.id);
  }

  async createAgendaItem(insertItem: InsertAgendaItem): Promise<AgendaItem> {
    const [item] = await db.insert(agendaItems).values(insertItem).returning();
    return item;
  }

  async updateAgendaItemStatus(
    id: number,
    status: string
  ): Promise<AgendaItem | undefined> {
    const [item] = await db
      .update(agendaItems)
      .set({ status })
      .where(eq(agendaItems.id, id))
      .returning();
    return item || undefined;
  }

  async updateAgendaItem(
    id: number,
    updates: Partial<AgendaItem>
  ): Promise<AgendaItem | undefined> {
    const [item] = await db
      .update(agendaItems)
      .set(updates)
      .where(eq(agendaItems.id, id))
      .returning();
    return item || undefined;
  }

  async deleteAgendaItem(id: number): Promise<boolean> {
    const result = await db.delete(agendaItems).where(eq(agendaItems.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  // Meetings
  async getCurrentMeeting(): Promise<Meeting | undefined> {
    const [meeting] = await db
      .select()
      .from(meetings)
      .where(eq(meetings.status, 'active'))
      .limit(1);
    return meeting || undefined;
  }

  async getAllMeetings(): Promise<Meeting[]> {
    return await db.select().from(meetings).orderBy(desc(meetings.date));
  }

  async getMeetingsByType(type: string): Promise<Meeting[]> {
    return await db
      .select()
      .from(meetings)
      .where(eq(meetings.type, type))
      .orderBy(desc(meetings.date));
  }

  async createMeeting(insertMeeting: InsertMeeting): Promise<Meeting> {
    const [meeting] = await db
      .insert(meetings)
      .values(insertMeeting)
      .returning();
    return meeting;
  }

  async updateMeetingAgenda(
    id: number,
    agenda: string
  ): Promise<Meeting | undefined> {
    const [meeting] = await db
      .update(meetings)
      .set({ finalAgenda: agenda })
      .where(eq(meetings.id, id))
      .returning();
    return meeting || undefined;
  }

  async updateMeeting(
    id: number,
    updates: Partial<Meeting>
  ): Promise<Meeting | undefined> {
    const [meeting] = await db
      .update(meetings)
      .set(updates)
      .where(eq(meetings.id, id))
      .returning();
    return meeting || undefined;
  }

  async deleteMeeting(id: number): Promise<boolean> {
    const result = await db.delete(meetings).where(eq(meetings.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  // Meeting Notes
  async getAllMeetingNotes(): Promise<MeetingNote[]> {
    return await db.select().from(meetingNotes).orderBy(desc(meetingNotes.createdAt));
  }

  async getMeetingNote(id: number): Promise<MeetingNote | undefined> {
    const [note] = await db.select().from(meetingNotes).where(eq(meetingNotes.id, id));
    return note || undefined;
  }

  async getMeetingNotesByProject(projectId: number): Promise<MeetingNote[]> {
    return await db
      .select()
      .from(meetingNotes)
      .where(eq(meetingNotes.projectId, projectId))
      .orderBy(desc(meetingNotes.createdAt));
  }

  async getMeetingNotesByMeeting(meetingId: number): Promise<MeetingNote[]> {
    return await db
      .select()
      .from(meetingNotes)
      .where(eq(meetingNotes.meetingId, meetingId))
      .orderBy(desc(meetingNotes.createdAt));
  }

  async getMeetingNotesByFilters(filters: {
    projectId?: number;
    meetingId?: number;
    type?: string;
    status?: string;
  }): Promise<MeetingNote[]> {
    const conditions = [];
    
    if (filters.projectId !== undefined) {
      conditions.push(eq(meetingNotes.projectId, filters.projectId));
    }
    if (filters.meetingId !== undefined) {
      conditions.push(eq(meetingNotes.meetingId, filters.meetingId));
    }
    if (filters.type) {
      conditions.push(eq(meetingNotes.type, filters.type));
    }
    if (filters.status) {
      conditions.push(eq(meetingNotes.status, filters.status));
    }

    let query = db.select().from(meetingNotes);
    
    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }
    
    return await query.orderBy(desc(meetingNotes.createdAt));
  }

  async createMeetingNote(insertNote: InsertMeetingNote): Promise<MeetingNote> {
    const [note] = await db
      .insert(meetingNotes)
      .values(insertNote)
      .returning();
    return note;
  }

  async updateMeetingNote(
    id: number,
    updates: Partial<MeetingNote>
  ): Promise<MeetingNote | undefined> {
    const [note] = await db
      .update(meetingNotes)
      .set(updates)
      .where(eq(meetingNotes.id, id))
      .returning();
    return note || undefined;
  }

  async deleteMeetingNote(id: number): Promise<boolean> {
    const result = await db.delete(meetingNotes).where(eq(meetingNotes.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  // Driver Agreements
  async createDriverAgreement(
    insertAgreement: InsertDriverAgreement
  ): Promise<DriverAgreement> {
    const [agreement] = await db
      .insert(driverAgreements)
      .values(insertAgreement)
      .returning();
    return agreement;
  }

  // Drivers
  async getAllDrivers(): Promise<Driver[]> {
    // Safety limit to prevent unbounded queries - drivers table should be small
    const results = await db.select().from(drivers).orderBy(drivers.name).limit(2000);
    
    // Log warning if we hit the limit (indicating potential data truncation)
    if (results.length === 2000) {
      console.warn('getAllDrivers() returned exactly 2000 drivers - limit may have been reached, some data could be missing');
    }
    
    return results;
  }

  // Get all drivers without limit - ONLY for backups and operations requiring complete data
  async getAllDriversUnlimited(): Promise<Driver[]> {
    return await db.select().from(drivers).orderBy(drivers.name);
  }

  async getDriver(id: number): Promise<Driver | undefined> {
    const [driver] = await db.select().from(drivers).where(eq(drivers.id, id));
    return driver || undefined;
  }

  async createDriver(insertDriver: InsertDriver): Promise<Driver> {
    const [driver] = await db.insert(drivers).values(insertDriver).returning();
    return driver;
  }

  async updateDriver(
    id: number,
    updates: Partial<Driver>
  ): Promise<Driver | undefined> {
    const [driver] = await db
      .update(drivers)
      .set(updates)
      .where(eq(drivers.id, id))
      .returning();
    return driver || undefined;
  }

  async deleteDriver(id: number): Promise<boolean> {
    const result = await db.delete(drivers).where(eq(drivers.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  // Driver Vehicles
  async getDriverVehicles(driverId: number): Promise<DriverVehicle[]> {
    return await db
      .select()
      .from(driverVehicles)
      .where(eq(driverVehicles.driverId, driverId))
      .orderBy(driverVehicles.isPrimary);
  }

  async getDriverVehicle(id: number): Promise<DriverVehicle | undefined> {
    const [vehicle] = await db
      .select()
      .from(driverVehicles)
      .where(eq(driverVehicles.id, id));
    return vehicle || undefined;
  }

  async createDriverVehicle(
    vehicle: InsertDriverVehicle
  ): Promise<DriverVehicle> {
    const [newVehicle] = await db
      .insert(driverVehicles)
      .values(vehicle)
      .returning();
    return newVehicle;
  }

  async updateDriverVehicle(
    id: number,
    updates: Partial<DriverVehicle>
  ): Promise<DriverVehicle | undefined> {
    const [vehicle] = await db
      .update(driverVehicles)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(driverVehicles.id, id))
      .returning();
    return vehicle || undefined;
  }

  async deleteDriverVehicle(id: number): Promise<boolean> {
    const result = await db
      .delete(driverVehicles)
      .where(eq(driverVehicles.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  // Volunteers
  async getAllVolunteers(): Promise<Volunteer[]> {
    return await db.select().from(volunteers).orderBy(volunteers.name);
  }

  async getVolunteer(id: number): Promise<Volunteer | undefined> {
    const [volunteer] = await db
      .select()
      .from(volunteers)
      .where(eq(volunteers.id, id));
    return volunteer || undefined;
  }

  async createVolunteer(insertVolunteer: InsertVolunteer): Promise<Volunteer> {
    const [volunteer] = await db
      .insert(volunteers)
      .values(insertVolunteer)
      .returning();
    return volunteer;
  }

  async updateVolunteer(
    id: number,
    updates: Partial<Volunteer>
  ): Promise<Volunteer | undefined> {
    const [volunteer] = await db
      .update(volunteers)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(volunteers.id, id))
      .returning();
    return volunteer || undefined;
  }

  async deleteVolunteer(id: number): Promise<boolean> {
    const result = await db.delete(volunteers).where(eq(volunteers.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  // Hosts
  async getAllHosts(): Promise<Host[]> {
    return await db.select().from(hosts).orderBy(hosts.name);
  }

  async getHost(id: number): Promise<Host | undefined> {
    const [host] = await db.select().from(hosts).where(eq(hosts.id, id));
    return host || undefined;
  }

  async createHost(insertHost: InsertHost): Promise<Host> {
    const [host] = await db.insert(hosts).values(insertHost).returning();
    return host;
  }

  async updateHost(
    id: number,
    updates: Partial<Host>
  ): Promise<Host | undefined> {
    const [host] = await db
      .update(hosts)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(hosts.id, id))
      .returning();
    return host || undefined;
  }

  async deleteHost(id: number): Promise<boolean> {
    // First check if this host has any associated sandwich collections
    const host = await db.select().from(hosts).where(eq(hosts.id, id)).limit(1);
    if (host.length === 0) {
      return false; // Host doesn't exist
    }

    const hostName = host[0].name;
    const [collectionCount] = await db
      .select({ count: sql`count(*)` })
      .from(sandwichCollections)
      .where(and(
        eq(sandwichCollections.hostName, hostName),
        isNull(sandwichCollections.deletedAt) // Exclude soft-deleted collections
      ));

    if (Number(collectionCount.count) > 0) {
      throw new Error(
        `Cannot delete host "${hostName}" because it has ${collectionCount.count} associated collection records. Please update or remove these records first.`
      );
    }

    // Also delete any host contacts first
    await db.delete(hostContacts).where(eq(hostContacts.hostId, id));

    // Now delete the host
    const result = await db.delete(hosts).where(eq(hosts.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  async updateCollectionHostNames(
    oldHostName: string,
    newHostName: string
  ): Promise<number> {
    const result = await db
      .update(sandwichCollections)
      .set({ hostName: newHostName })
      .where(eq(sandwichCollections.hostName, oldHostName));
    return result.rowCount ?? 0;
  }

  // Recipients
  async getAllRecipients(): Promise<Recipient[]> {
    return await db.select().from(recipients).orderBy(recipients.name);
  }

  async getRecipient(id: number): Promise<Recipient | undefined> {
    const [recipient] = await db
      .select()
      .from(recipients)
      .where(eq(recipients.id, id));
    return recipient || undefined;
  }

  async createRecipient(insertRecipient: InsertRecipient): Promise<Recipient> {
    const [recipient] = await db
      .insert(recipients)
      .values(insertRecipient)
      .returning();
    return recipient;
  }

  async updateRecipient(
    id: number,
    updates: Partial<Recipient>
  ): Promise<Recipient | undefined> {
    const [recipient] = await db
      .update(recipients)
      .set(updates)
      .where(eq(recipients.id, id))
      .returning();
    return recipient || undefined;
  }

  async deleteRecipient(id: number): Promise<boolean> {
    const result = await db.delete(recipients).where(eq(recipients.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  // Sandwich Distributions
  async getAllSandwichDistributions(): Promise<SandwichDistribution[]> {
    return await db
      .select()
      .from(sandwichDistributions)
      .orderBy(desc(sandwichDistributions.distributionDate));
  }

  async getSandwichDistribution(
    id: number
  ): Promise<SandwichDistribution | undefined> {
    const [distribution] = await db
      .select()
      .from(sandwichDistributions)
      .where(eq(sandwichDistributions.id, id));
    return distribution || undefined;
  }

  async createSandwichDistribution(
    insertDistribution: InsertSandwichDistribution
  ): Promise<SandwichDistribution> {
    const [distribution] = await db
      .insert(sandwichDistributions)
      .values(insertDistribution)
      .returning();
    return distribution;
  }

  async updateSandwichDistribution(
    id: number,
    updates: Partial<SandwichDistribution>
  ): Promise<SandwichDistribution | undefined> {
    const [distribution] = await db
      .update(sandwichDistributions)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(sandwichDistributions.id, id))
      .returning();
    return distribution || undefined;
  }

  async deleteSandwichDistribution(id: number): Promise<boolean> {
    const result = await db
      .delete(sandwichDistributions)
      .where(eq(sandwichDistributions.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  async getSandwichDistributionsByWeek(
    weekEnding: string
  ): Promise<SandwichDistribution[]> {
    return await db
      .select()
      .from(sandwichDistributions)
      .where(eq(sandwichDistributions.weekEnding, weekEnding))
      .orderBy(
        sandwichDistributions.hostName,
        sandwichDistributions.recipientName
      );
  }

  async getSandwichDistributionsByHost(
    hostId: number
  ): Promise<SandwichDistribution[]> {
    return await db
      .select()
      .from(sandwichDistributions)
      .where(eq(sandwichDistributions.hostId, hostId))
      .orderBy(desc(sandwichDistributions.distributionDate));
  }

  async getSandwichDistributionsByRecipient(
    recipientId: number
  ): Promise<SandwichDistribution[]> {
    return await db
      .select()
      .from(sandwichDistributions)
      .where(eq(sandwichDistributions.recipientId, recipientId))
      .orderBy(desc(sandwichDistributions.distributionDate));
  }

  // General Contacts
  async getAllContacts(): Promise<Contact[]> {
    return await db.select().from(contacts).orderBy(contacts.name);
  }

  async getContact(id: number): Promise<Contact | undefined> {
    const [contact] = await db
      .select()
      .from(contacts)
      .where(eq(contacts.id, id));
    return contact || undefined;
  }

  async createContact(insertContact: InsertContact): Promise<Contact> {
    const [contact] = await db
      .insert(contacts)
      .values(insertContact)
      .returning();
    return contact;
  }

  async updateContact(
    id: number,
    updates: Partial<Contact>
  ): Promise<Contact | undefined> {
    const [contact] = await db
      .update(contacts)
      .set(updates)
      .where(eq(contacts.id, id))
      .returning();
    return contact || undefined;
  }

  async deleteContact(id: number): Promise<boolean> {
    const result = await db.delete(contacts).where(eq(contacts.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  // Cross-table duplicate checking helper
  private async checkCrossTableDuplicate(
    name: string,
    email?: string,
    phone?: string
  ): Promise<{
    exists: boolean;
    source: string;
    contactId?: number;
  }> {
    // Normalize phone for comparison (remove non-digits)
    const normalizePhone = (phoneStr?: string) =>
      phoneStr?.replace(/\D/g, '') || '';
    const normalizedPhone = normalizePhone(phone);

    // Check volunteers table
    if (email) {
      const volunteerMatch = await db
        .select()
        .from(volunteers)
        .where(and(eq(volunteers.name, name), eq(volunteers.email, email)))
        .limit(1);

      if (volunteerMatch.length > 0) {
        return {
          exists: true,
          source: 'volunteers',
          contactId: volunteerMatch[0].id,
        };
      }
    }

    // Check by phone across tables if provided
    if (normalizedPhone) {
      const volunteerPhoneMatch = await db
        .select()
        .from(volunteers)
        .where(
          and(
            eq(volunteers.name, name),
            or(
              eq(volunteers.phone, phone || ''),
              eq(volunteers.phone, normalizedPhone),
              eq(
                sql`REGEXP_REPLACE(${volunteers.phone}, '[^0-9]', '', 'g')`,
                normalizedPhone
              )
            )
          )
        )
        .limit(1);

      if (volunteerPhoneMatch.length > 0) {
        return {
          exists: true,
          source: 'volunteers',
          contactId: volunteerPhoneMatch[0].id,
        };
      }
    }

    // Check general contacts table
    if (email) {
      const contactMatch = await db
        .select()
        .from(contacts)
        .where(and(eq(contacts.name, name), eq(contacts.email, email)))
        .limit(1);

      if (contactMatch.length > 0) {
        return {
          exists: true,
          source: 'contacts',
          contactId: contactMatch[0].id,
        };
      }
    }

    return { exists: false, source: '' };
  }

  // Host Contact methods
  async createHostContact(
    insertContact: InsertHostContact
  ): Promise<HostContact> {
    // Check for existing contact within host_contacts table
    if (insertContact.name && insertContact.email) {
      const existingContact = await db
        .select()
        .from(hostContacts)
        .where(
          and(
            eq(hostContacts.name, insertContact.name),
            eq(hostContacts.email, insertContact.email)
          )
        )
        .limit(1);

      if (existingContact.length > 0) {
        logger.log(
          `Duplicate host contact prevented: ${insertContact.name} (${insertContact.email})`
        );
        throw new Error(
          `Contact "${insertContact.name}" with email "${insertContact.email}" already exists for this host. Each contact must have a unique name and email combination.`
        );
      }
    }

    // Check for cross-table duplicates
    const crossTableCheck = await this.checkCrossTableDuplicate(
      insertContact.name,
      insertContact.email,
      insertContact.phone
    );

    if (crossTableCheck.exists) {
      logger.log(
        `❌ CROSS-TABLE DUPLICATE DETECTED: ${insertContact.name} already exists in ${crossTableCheck.source} table (ID: ${crossTableCheck.contactId})`
      );
      logger.log(
        `   - Attempted to create in host_contacts: ${insertContact.email}, ${insertContact.phone}`
      );
      logger.log(
        `   - Use contact assignment/linking instead of creating duplicate records`
      );

      // Instead of creating a duplicate, throw an error or return a special response
      throw new Error(
        `Contact "${insertContact.name}" already exists in ${crossTableCheck.source} table. Use contact assignment instead of creating duplicates.`
      );
    }

    const [contact] = await db
      .insert(hostContacts)
      .values(insertContact)
      .returning();
    logger.log(
      `✅ New host contact created: ${contact.name} (${contact.email})`
    );
    return contact;
  }

  async getHostContact(id: number): Promise<HostContact | undefined> {
    const [contact] = await db
      .select()
      .from(hostContacts)
      .where(eq(hostContacts.id, id));
    return contact;
  }

  async getHostContacts(hostId: number): Promise<HostContact[]> {
    return await db
      .select()
      .from(hostContacts)
      .where(eq(hostContacts.hostId, hostId));
  }

  async updateHostContact(
    id: number,
    updates: Partial<HostContact>
  ): Promise<HostContact | undefined> {
    // Ensure updatedAt is properly formatted as a Date object
    const updateData = {
      ...updates,
      updatedAt: new Date(),
    };

    const [contact] = await db
      .update(hostContacts)
      .set(updateData)
      .where(eq(hostContacts.id, id))
      .returning();
    return contact;
  }

  async deleteHostContact(id: number): Promise<boolean> {
    const result = await db.delete(hostContacts).where(eq(hostContacts.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  // Optimized query to get all hosts with their contacts in one call
  async getAllHostsWithContacts(): Promise<
    Array<Host & { contacts: HostContact[] }>
  > {
    const hostsData = await db.select().from(hosts).orderBy(hosts.name);
    const contactsData = await db.select().from(hostContacts);

    return hostsData.map((host) => ({
      ...host,
      contacts: contactsData.filter((contact) => contact.hostId === host.id),
    }));
  }

  // Project Assignments
  async getProjectAssignments(projectId: number): Promise<ProjectAssignment[]> {
    return await db
      .select()
      .from(projectAssignments)
      .where(eq(projectAssignments.projectId, projectId));
  }

  async createProjectAssignment(
    assignment: InsertProjectAssignment
  ): Promise<ProjectAssignment> {
    const [created] = await db
      .insert(projectAssignments)
      .values(assignment)
      .returning();
    return created;
  }

  async deleteProjectAssignment(
    projectId: number,
    userId: string
  ): Promise<boolean> {
    const result = await db
      .delete(projectAssignments)
      .where(
        and(
          eq(projectAssignments.projectId, projectId),
          eq(projectAssignments.userId, userId)
        )
      );
    return (result.rowCount ?? 0) > 0;
  }

  async getUserProjectAssignments(
    userId: string
  ): Promise<ProjectAssignment[]> {
    return await db
      .select()
      .from(projectAssignments)
      .where(eq(projectAssignments.userId, userId));
  }

  // Modified project methods to support user-specific visibility
  async getProjectsForUser(userId: string): Promise<Project[]> {
    // Get projects where user is assigned
    const assignedProjects = await db
      .select()
      .from(projects)
      .innerJoin(
        projectAssignments,
        eq(projects.id, projectAssignments.projectId)
      )
      .where(eq(projectAssignments.userId, userId));

    return assignedProjects.map((result) => result.projects);
  }

  async getAllProjectsWithAssignments(): Promise<
    Array<Project & { assignments: ProjectAssignment[] }>
  > {
    const projectsData = await db
      .select()
      .from(projects)
      .orderBy(projects.createdAt);
    const assignmentsData = await db.select().from(projectAssignments);

    return projectsData.map((project) => ({
      ...project,
      assignments: assignmentsData.filter(
        (assignment) => assignment.projectId === project.id
      ),
    }));
  }

  // Committee management
  async getAllCommittees(): Promise<Committee[]> {
    return await db.select().from(committees).orderBy(committees.createdAt);
  }

  async getCommittee(id: number): Promise<Committee | undefined> {
    const [committee] = await db
      .select()
      .from(committees)
      .where(eq(committees.id, id));
    return committee || undefined;
  }

  async createCommittee(committee: InsertCommittee): Promise<Committee> {
    const [newCommittee] = await db
      .insert(committees)
      .values(committee)
      .returning();
    return newCommittee;
  }

  async updateCommittee(
    id: number,
    updates: Partial<Committee>
  ): Promise<Committee | undefined> {
    const [committee] = await db
      .update(committees)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(committees.id, id))
      .returning();
    return committee || undefined;
  }

  async deleteCommittee(id: number): Promise<boolean> {
    const result = await db.delete(committees).where(eq(committees.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  // Committee membership management
  async getUserCommittees(
    userId: string
  ): Promise<Array<Committee & { membership: CommitteeMembership }>> {
    const userCommittees = await db
      .select()
      .from(committeeMemberships)
      .innerJoin(
        committees,
        eq(committeeMemberships.committeeId, committees.id)
      )
      .where(eq(committeeMemberships.userId, userId));

    return userCommittees.map((result) => ({
      ...result.committees,
      membership: result.committee_memberships,
    }));
  }

  async getCommitteeMembers(
    committeeId: number
  ): Promise<Array<User & { membership: CommitteeMembership }>> {
    const members = await db
      .select()
      .from(committeeMemberships)
      .innerJoin(users, eq(committeeMemberships.userId, users.id))
      .where(eq(committeeMemberships.committeeId, committeeId));

    return members.map((result) => ({
      ...result.users,
      membership: result.committee_memberships,
    }));
  }

  async addUserToCommittee(
    membership: InsertCommitteeMembership
  ): Promise<CommitteeMembership> {
    const [newMembership] = await db
      .insert(committeeMemberships)
      .values(membership)
      .returning();
    return newMembership;
  }

  async updateCommitteeMembership(
    id: number,
    updates: Partial<CommitteeMembership>
  ): Promise<CommitteeMembership | undefined> {
    const [membership] = await db
      .update(committeeMemberships)
      .set(updates)
      .where(eq(committeeMemberships.id, id))
      .returning();
    return membership || undefined;
  }

  async removeUserFromCommittee(
    userId: string,
    committeeId: number
  ): Promise<boolean> {
    const result = await db
      .delete(committeeMemberships)
      .where(
        and(
          eq(committeeMemberships.userId, userId),
          eq(committeeMemberships.committeeId, committeeId)
        )
      );
    return (result.rowCount ?? 0) > 0;
  }

  async isUserCommitteeMember(
    userId: string,
    committeeId: number
  ): Promise<boolean> {
    const [membership] = await db
      .select()
      .from(committeeMemberships)
      .where(
        and(
          eq(committeeMemberships.userId, userId),
          eq(committeeMemberships.committeeId, committeeId)
        )
      );
    return !!membership;
  }

  // Notifications & Celebrations
  async getUserNotifications(userId: string): Promise<Notification[]> {
    try {
      return await db
        .select()
        .from(notifications)
        .where(eq(notifications.userId, userId))
        .orderBy(desc(notifications.createdAt));
    } catch (error) {
      logger.error('Failed to get user notifications:', error);
      return [];
    }
  }

  async createNotification(
    notification: InsertNotification
  ): Promise<Notification> {
    try {
      const [createdNotification] = await db
        .insert(notifications)
        .values(notification)
        .returning();
      return createdNotification;
    } catch (error) {
      logger.error('Failed to create notification:', error);
      throw error;
    }
  }

  async markNotificationRead(id: number): Promise<boolean> {
    try {
      const result = await db
        .update(notifications)
        .set({ isRead: true })
        .where(eq(notifications.id, id));
      return (result.rowCount ?? 0) > 0;
    } catch (error) {
      logger.error('Failed to mark notification as read:', error);
      return false;
    }
  }

  async deleteNotification(id: number): Promise<boolean> {
    try {
      const result = await db
        .delete(notifications)
        .where(eq(notifications.id, id));
      return (result.rowCount ?? 0) > 0;
    } catch (error) {
      logger.error('Failed to delete notification:', error);
      return false;
    }
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
      priority: 'medium',
      title: `${randomEmoji} Task Completed!`,
      message: `Thanks for completing your task! ${message}`,
      isRead: false,
      category: 'social',
      relatedType: 'task',
      relatedId: taskId,
      metadata: {
        emoji: randomEmoji,
        achievementType: 'task_completion',
        taskId,
        completedAt: new Date().toISOString(),
      },
    });
  }

  // Enhanced notification methods for the new system
  async getUserNotificationsPaginated(
    userId: string,
    options: {
      limit?: number;
      offset?: number;
      category?: string;
      unreadOnly?: boolean;
      includeArchived?: boolean;
    } = {}
  ): Promise<{
    notifications: Notification[];
    totalCount: number;
    unreadCount: number;
  }> {
    const {
      limit = 50,
      offset = 0,
      category,
      unreadOnly = false,
      includeArchived = false,
    } = options;

    try {
      // Build conditions
      const conditions = [
        eq(notifications.userId, userId),
        !includeArchived ? eq(notifications.isArchived, false) : undefined,
        unreadOnly ? eq(notifications.isRead, false) : undefined,
        category ? eq(notifications.category, category) : undefined,
      ].filter(Boolean) as any[];

      // Get paginated notifications
      const userNotifications = await db
        .select()
        .from(notifications)
        .where(and(...conditions))
        .orderBy(desc(notifications.createdAt))
        .limit(limit)
        .offset(offset);

      // Get total count
      const [totalResult] = await db
        .select({ count: sql`count(*)` })
        .from(notifications)
        .where(and(...conditions));

      // Get unread count
      const [unreadResult] = await db
        .select({ count: sql`count(*)` })
        .from(notifications)
        .where(
          and(
            eq(notifications.userId, userId),
            eq(notifications.isRead, false),
            eq(notifications.isArchived, false)
          )
        );

      return {
        notifications: userNotifications,
        totalCount: parseInt(totalResult?.count as string) || 0,
        unreadCount: parseInt(unreadResult?.count as string) || 0,
      };
    } catch (error) {
      logger.error('Failed to get paginated user notifications:', error);
      return { notifications: [], totalCount: 0, unreadCount: 0 };
    }
  }

  async archiveNotification(notificationId: number, userId?: string): Promise<boolean> {
    try {
      const conditions = [eq(notifications.id, notificationId)];
      if (userId) {
        conditions.push(eq(notifications.userId, userId));
      }

      const result = await db
        .update(notifications)
        .set({ isArchived: true, isRead: true })
        .where(and(...conditions));
      
      return (result.rowCount ?? 0) > 0;
    } catch (error) {
      logger.error('Failed to archive notification:', error);
      return false;
    }
  }

  async bulkMarkNotificationsRead(
    notificationIds: number[],
    userId?: string
  ): Promise<number> {
    try {
      const conditions = [
        sql`${notifications.id} = ANY(${notificationIds})`,
        userId ? eq(notifications.userId, userId) : undefined,
      ].filter(Boolean) as any[];

      const result = await db
        .update(notifications)
        .set({ isRead: true })
        .where(and(...conditions));

      return result.rowCount ?? 0;
    } catch (error) {
      logger.error('Failed to bulk mark notifications as read:', error);
      return 0;
    }
  }

  async getNotificationCounts(userId: string): Promise<{
    total: number;
    byCategory: Record<string, number>;
    byPriority: Record<string, number>;
  }> {
    try {
      const counts = await db
        .select({
          category: notifications.category,
          priority: notifications.priority,
          count: sql`count(*)`
        })
        .from(notifications)
        .where(
          and(
            eq(notifications.userId, userId),
            eq(notifications.isRead, false),
            eq(notifications.isArchived, false)
          )
        )
        .groupBy(notifications.category, notifications.priority);

      const total = counts.reduce((sum, item) => sum + parseInt(item.count as string), 0);

      const byCategory = counts.reduce((acc, item) => {
        const category = item.category || 'general';
        if (!acc[category]) acc[category] = 0;
        acc[category] += parseInt(item.count as string);
        return acc;
      }, {} as Record<string, number>);

      const byPriority = counts.reduce((acc, item) => {
        const priority = item.priority || 'medium';
        if (!acc[priority]) acc[priority] = 0;
        acc[priority] += parseInt(item.count as string);
        return acc;
      }, {} as Record<string, number>);

      return { total, byCategory, byPriority };
    } catch (error) {
      logger.error('Failed to get notification counts:', error);
      return { total: 0, byCategory: {}, byPriority: {} };
    }
  }

  async createSystemNotification(
    userId: string,
    title: string,
    message: string,
    options: {
      type?: string;
      priority?: 'low' | 'medium' | 'high' | 'urgent';
      category?: string;
      actionUrl?: string;
      actionText?: string;
      expiresAt?: Date;
      metadata?: any;
    } = {}
  ): Promise<Notification> {
    return this.createNotification({
      userId,
      type: options.type || 'system_update',
      priority: options.priority || 'medium',
      title,
      message,
      category: options.category || 'system',
      actionUrl: options.actionUrl,
      actionText: options.actionText,
      expiresAt: options.expiresAt,
      metadata: options.metadata || {},
      isRead: false,
    });
  }

  // Announcements
  async getAllAnnouncements(): Promise<any[]> {
    const result = await db
      .select()
      .from(announcements)
      .orderBy(desc(announcements.createdAt));
    return result;
  }

  async createAnnouncement(announcement: any): Promise<any> {
    const [result] = await db
      .insert(announcements)
      .values(announcement)
      .returning();
    return result;
  }

  async updateAnnouncement(id: number, updates: any): Promise<any | undefined> {
    const [result] = await db
      .update(announcements)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(announcements.id, id))
      .returning();
    return result;
  }

  async deleteAnnouncement(id: number): Promise<boolean> {
    const result = await db
      .delete(announcements)
      .where(eq(announcements.id, id));
    return result.rowCount! > 0;
  }

  // Consolidated notification methods (removing duplicates)
  async markNotificationAsRead(notificationId: number): Promise<boolean> {
    try {
      const result = await db
        .update(notifications)
        .set({ isRead: true })
        .where(eq(notifications.id, notificationId));
      return (result.rowCount ?? 0) > 0;
    } catch (error) {
      logger.error('Error marking notification as read:', error);
      return false;
    }
  }

  async markAllNotificationsAsRead(userId: string): Promise<boolean> {
    try {
      const result = await db
        .update(notifications)
        .set({ isRead: true })
        .where(
          and(eq(notifications.userId, userId), eq(notifications.isRead, false))
        );
      return (result.rowCount ?? 0) > 0;
    } catch (error) {
      logger.error('Error marking all notifications as read:', error);
      return false;
    }
  }

  async addProjectAssignment(assignment: {
    projectId: number;
    userId: string;
    role: string;
  }): Promise<any> {
    try {
      const [newAssignment] = await db
        .insert(projectAssignments)
        .values({
          projectId: assignment.projectId,
          userId: assignment.userId,
          role: assignment.role,
          assignedAt: new Date(),
        })
        .returning();

      return newAssignment;
    } catch (error) {
      logger.error('Error adding project assignment:', error);
      return null;
    }
  }

  async removeProjectAssignment(
    projectId: number,
    userId: string
  ): Promise<boolean> {
    try {
      const result = await db
        .delete(projectAssignments)
        .where(
          and(
            eq(projectAssignments.projectId, projectId),
            eq(projectAssignments.userId, userId)
          )
        );

      return (result.rowCount ?? 0) > 0;
    } catch (error) {
      logger.error('Error removing project assignment:', error);
      return false;
    }
  }

  async updateProjectAssignment(
    projectId: number,
    userId: string,
    updates: { role: string }
  ): Promise<any> {
    try {
      const [updatedAssignment] = await db
        .update(projectAssignments)
        .set({ role: updates.role })
        .where(
          and(
            eq(projectAssignments.projectId, projectId),
            eq(projectAssignments.userId, userId)
          )
        )
        .returning();

      return updatedAssignment;
    } catch (error) {
      logger.error('Error updating project assignment:', error);
      return null;
    }
  }

  async initialize(): Promise<void> {
    try {
      logger.log('Initializing database storage...');

      // Test database connection
      await this.testConnection();

      // Check and add missing sender column if needed
      try {
        await db.execute(sql`SELECT sender FROM messages LIMIT 1`);
        logger.log('Sender column exists');
      } catch (error) {
        logger.log('Adding missing sender column to messages table...');
        try {
          await db.execute(
            sql`ALTER TABLE messages ADD COLUMN sender TEXT DEFAULT 'Unknown User'`
          );
          logger.log('Sender column added successfully');
        } catch (alterError) {
          logger.log('Could not add sender column, will use fallback queries');
        }
      }

      logger.log('Database storage initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize database storage:', error);
      throw error;
    }
  }

  // Suggestions Portal methods
  async getAllSuggestions(): Promise<Suggestion[]> {
    try {
      const result = await db
        .select()
        .from(suggestions)
        .orderBy(suggestions.createdAt);
      return result as Suggestion[];
    } catch (error) {
      logger.error('Error fetching suggestions:', error);
      return [];
    }
  }

  async getSuggestion(id: number): Promise<Suggestion | undefined> {
    try {
      const result = await db
        .select()
        .from(suggestions)
        .where(eq(suggestions.id, id))
        .limit(1);
      return result[0] as Suggestion | undefined;
    } catch (error) {
      logger.error('Error fetching suggestion:', error);
      return undefined;
    }
  }

  async createSuggestion(suggestion: InsertSuggestion): Promise<Suggestion> {
    try {
      const result = await db
        .insert(suggestions)
        .values(suggestion)
        .returning();
      return result[0] as Suggestion;
    } catch (error) {
      logger.error('Error creating suggestion:', error);
      throw error;
    }
  }

  async updateSuggestion(
    id: number,
    updates: Partial<Suggestion>
  ): Promise<Suggestion | undefined> {
    try {
      const result = await db
        .update(suggestions)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(suggestions.id, id))
        .returning();
      return result[0] as Suggestion | undefined;
    } catch (error) {
      logger.error('Error updating suggestion:', error);
      return undefined;
    }
  }

  async deleteSuggestion(id: number): Promise<boolean> {
    try {
      // First delete all responses
      await db
        .delete(suggestionResponses)
        .where(eq(suggestionResponses.suggestionId, id));
      // Then delete the suggestion
      const result = await db.delete(suggestions).where(eq(suggestions.id, id));
      return true;
    } catch (error) {
      logger.error('Error deleting suggestion:', error);
      return false;
    }
  }

  async upvoteSuggestion(id: number): Promise<boolean> {
    try {
      await db
        .update(suggestions)
        .set({ upvotes: sql`${suggestions.upvotes} + 1` })
        .where(eq(suggestions.id, id));
      return true;
    } catch (error) {
      logger.error('Error upvoting suggestion:', error);
      return false;
    }
  }

  // Suggestion responses
  async getSuggestionResponses(
    suggestionId: number
  ): Promise<SuggestionResponse[]> {
    try {
      const result = await db
        .select()
        .from(suggestionResponses)
        .where(eq(suggestionResponses.suggestionId, suggestionId))
        .orderBy(suggestionResponses.createdAt);
      return result as SuggestionResponse[];
    } catch (error) {
      logger.error('Error fetching suggestion responses:', error);
      return [];
    }
  }

  async createSuggestionResponse(
    response: InsertSuggestionResponse
  ): Promise<SuggestionResponse> {
    try {
      const result = await db
        .insert(suggestionResponses)
        .values(response)
        .returning();
      return result[0] as SuggestionResponse;
    } catch (error) {
      logger.error('Error creating suggestion response:', error);
      throw error;
    }
  }

  async deleteSuggestionResponse(id: number): Promise<boolean> {
    try {
      await db
        .delete(suggestionResponses)
        .where(eq(suggestionResponses.id, id));
      return true;
    } catch (error) {
      logger.error('Error deleting suggestion response:', error);
      return false;
    }
  }

  // Messaging System methods
  async getUserConversations(userId: string): Promise<any[]> {
    try {
      logger.log(`[DB] Getting conversations for user: ${userId}`);

      // Get all conversations where the user is a participant
      const userConversations = await db
        .select({
          id: conversations.id,
          type: conversations.type,
          name: conversations.name,
          createdAt: conversations.createdAt,
          lastReadAt: conversationParticipants.lastReadAt,
          joinedAt: conversationParticipants.joinedAt,
        })
        .from(conversations)
        .innerJoin(
          conversationParticipants,
          eq(conversations.id, conversationParticipants.conversationId)
        )
        .where(eq(conversationParticipants.userId, userId))
        .orderBy(conversations.createdAt);

      logger.log(
        `[DB] Found ${userConversations.length} conversations for user ${userId}`
      );

      // For each conversation, get additional metadata
      const enrichedConversations = await Promise.all(
        userConversations.map(async (conv) => {
          // Get member count
          const memberCount = await db
            .select({ count: sql<number>`count(*)` })
            .from(conversationParticipants)
            .where(eq(conversationParticipants.conversationId, conv.id));

          // Get last message
          const lastMessage = await db
            .select({
              id: messages.id,
              content: messages.content,
              createdAt: messages.createdAt,
              sender: messages.sender,
              userId: messages.userId,
            })
            .from(messages)
            .where(eq(messages.conversationId, conv.id))
            .orderBy(messages.createdAt)
            .limit(1);

          return {
            ...conv,
            memberCount: memberCount[0]?.count || 0,
            lastMessage: lastMessage[0] || null,
          };
        })
      );

      return enrichedConversations;
    } catch (error) {
      logger.error('Error getting user conversations:', error);
      return [];
    }
  }

  async createConversation(
    conversationData: {
      type: string;
      name?: string;
      createdBy: string;
    },
    participants: string[]
  ): Promise<any> {
    try {
      logger.log(`[DB] Creating conversation:`, conversationData);

      // Create the conversation
      const [newConversation] = await db
        .insert(conversations)
        .values({
          type: conversationData.type,
          name: conversationData.name,
        })
        .returning();

      logger.log(`[DB] Created conversation with ID: ${newConversation.id}`);

      // Add participants
      const participantData = participants.map((userId) => ({
        conversationId: newConversation.id,
        userId: userId,
      }));

      await db.insert(conversationParticipants).values(participantData);

      logger.log(
        `[DB] Added ${participants.length} participants to conversation ${newConversation.id}`
      );

      return {
        ...newConversation,
        memberCount: participants.length,
      };
    } catch (error) {
      logger.error('Error creating conversation:', error);
      throw error;
    }
  }

  async getConversationMessages(
    conversationId: number,
    userId: string
  ): Promise<any[]> {
    try {
      logger.log(
        `[DB] Getting messages for conversation ${conversationId} and user ${userId}`
      );

      // First verify user has access to this conversation
      const hasAccess = await db
        .select()
        .from(conversationParticipants)
        .where(
          and(
            eq(conversationParticipants.conversationId, conversationId),
            eq(conversationParticipants.userId, userId)
          )
        )
        .limit(1);

      if (hasAccess.length === 0) {
        logger.log(
          `[DB] User ${userId} does not have access to conversation ${conversationId}`
        );
        return [];
      }

      // Get messages with sender information
      const messages = await db
        .select({
          id: messages.id,
          conversationId: messages.conversationId,
          userId: messages.userId,
          senderId: messages.senderId,
          content: messages.content,
          sender: messages.sender,
          contextType: messages.contextType,
          contextId: messages.contextId,
          createdAt: messages.createdAt,
          updatedAt: messages.updatedAt,
          editedAt: messages.editedAt,
          deletedAt: messages.deletedAt,
        })
        .from(messages)
        .where(
          and(
            eq(messages.conversationId, conversationId),
            isNull(messages.deletedAt)
          )
        )
        .orderBy(messages.createdAt);

      logger.log(
        `[DB] Found ${messages.length} messages for conversation ${conversationId}`
      );
      return messages;
    } catch (error) {
      logger.error('Error getting conversation messages:', error);
      return [];
    }
  }

  async addConversationMessage(messageData: {
    conversationId: number;
    userId: string;
    content: string;
    sender?: string;
    contextType?: string;
    contextId?: string;
    replyToMessageId?: number | null;
    replyToContent?: string | null;
    replyToSender?: string | null;
  }): Promise<any> {
    try {
      logger.log(
        `[DB] Adding message to conversation ${messageData.conversationId}`
      );

      const [newMessage] = await db
        .insert(messages)
        .values({
          conversationId: messageData.conversationId,
          userId: messageData.userId,
          senderId: messageData.userId,
          content: messageData.content,
          sender: messageData.sender || 'Unknown User',
          contextType: messageData.contextType || 'direct',
          contextId: messageData.contextId,
          replyToMessageId: messageData.replyToMessageId,
          replyToContent: messageData.replyToContent,
          replyToSender: messageData.replyToSender,
        })
        .returning();

      logger.log(`[DB] Created message with ID: ${newMessage.id}`);
      return newMessage;
    } catch (error) {
      logger.error('Error adding conversation message:', error);
      throw error;
    }
  }

  async updateConversationMessage(
    messageId: number,
    userId: string,
    updates: {
      content?: string;
      editedAt?: Date;
    }
  ): Promise<any> {
    try {
      logger.log(`[DB] Updating message ${messageId} by user ${userId}`);

      const [updatedMessage] = await db
        .update(messages)
        .set({
          ...updates,
          editedAt: new Date(),
        })
        .where(and(eq(messages.id, messageId), eq(messages.userId, userId)))
        .returning();

      return updatedMessage;
    } catch (error) {
      logger.error('Error updating conversation message:', error);
      throw error;
    }
  }

  async deleteConversationMessage(
    messageId: number,
    userId: string
  ): Promise<boolean> {
    try {
      logger.log(`[DB] Deleting message ${messageId} by user ${userId}`);

      const result = await db
        .update(messages)
        .set({
          deletedAt: new Date(),
          deletedBy: userId,
        })
        .where(and(eq(messages.id, messageId), eq(messages.userId, userId)));

      return (result.rowCount ?? 0) > 0;
    } catch (error) {
      logger.error('Error deleting conversation message:', error);
      return false;
    }
  }

  // Message Like methods
  async likeMessage(
    messageId: number,
    userId: string,
    userName: string
  ): Promise<MessageLike | null> {
    try {
      const [like] = await db
        .insert(messageLikes)
        .values({
          messageId,
          userId,
          userName,
        })
        .returning();

      return like;
    } catch (error: any) {
      if (error.code === '23505') {
        // Unique constraint violation
        return null; // Already liked
      }
      logger.error('Error liking message:', error);
      throw error;
    }
  }

  async unlikeMessage(messageId: number, userId: string): Promise<boolean> {
    try {
      const result = await db
        .delete(messageLikes)
        .where(
          and(
            eq(messageLikes.messageId, messageId),
            eq(messageLikes.userId, userId)
          )
        );

      return (result.rowCount ?? 0) > 0;
    } catch (error) {
      logger.error('Error unliking message:', error);
      return false;
    }
  }

  async getMessageLikes(messageId: number): Promise<MessageLike[]> {
    try {
      const likes = await db
        .select()
        .from(messageLikes)
        .where(eq(messageLikes.messageId, messageId))
        .orderBy(messageLikes.likedAt);

      return likes;
    } catch (error) {
      logger.error('Error getting message likes:', error);
      return [];
    }
  }

  async hasUserLikedMessage(
    messageId: number,
    userId: string
  ): Promise<boolean> {
    try {
      const [like] = await db
        .select()
        .from(messageLikes)
        .where(
          and(
            eq(messageLikes.messageId, messageId),
            eq(messageLikes.userId, userId)
          )
        )
        .limit(1);

      return !!like;
    } catch (error) {
      logger.error('Error checking if user liked message:', error);
      return false;
    }
  }

  // Chat Message Like methods
  async likeChatMessage(
    messageId: number,
    userId: string,
    userName: string
  ): Promise<ChatMessageLike | null> {
    try {
      const [like] = await db
        .insert(chatMessageLikes)
        .values({
          messageId,
          userId,
          userName,
        })
        .returning();

      return like;
    } catch (error: any) {
      if (error.code === '23505') {
        // Unique constraint violation
        return null; // Already liked
      }
      logger.error('Error liking chat message:', error);
      throw error;
    }
  }

  async unlikeChatMessage(messageId: number, userId: string): Promise<boolean> {
    try {
      const result = await db
        .delete(chatMessageLikes)
        .where(
          and(
            eq(chatMessageLikes.messageId, messageId),
            eq(chatMessageLikes.userId, userId)
          )
        );

      return (result.rowCount ?? 0) > 0;
    } catch (error) {
      logger.error('Error unliking chat message:', error);
      return false;
    }
  }

  async getChatMessageLikes(messageId: number): Promise<ChatMessageLike[]> {
    try {
      const likes = await db
        .select()
        .from(chatMessageLikes)
        .where(eq(chatMessageLikes.messageId, messageId))
        .orderBy(chatMessageLikes.likedAt);

      return likes;
    } catch (error) {
      logger.error('Error getting chat message likes:', error);
      return [];
    }
  }

  async hasUserLikedChatMessage(
    messageId: number,
    userId: string
  ): Promise<boolean> {
    try {
      const [like] = await db
        .select()
        .from(chatMessageLikes)
        .where(
          and(
            eq(chatMessageLikes.messageId, messageId),
            eq(chatMessageLikes.userId, userId)
          )
        )
        .limit(1);

      return !!like;
    } catch (error) {
      logger.error('Error checking if user liked chat message:', error);
      return false;
    }
  }

  // Chat message methods for Socket.IO
  async createChatMessage(data: {
    channel: string;
    userId: string;
    userName: string;
    content: string;
  }): Promise<any> {
    try {
      const [message] = await db
        .insert(chatMessages)
        .values({
          channel: data.channel,
          userId: data.userId,
          userName: data.userName,
          content: data.content,
          createdAt: new Date(),
        })
        .returning();
      return message;
    } catch (error: any) {
      if (error.code === '23505') {
        // Retry with a small delay to avoid ID collision
        await new Promise((resolve) => setTimeout(resolve, 10));
        const [message] = await db
          .insert(chatMessages)
          .values({
            channel: data.channel,
            userId: data.userId,
            userName: data.userName,
            content: data.content,
            createdAt: new Date(),
          })
          .returning();
        return message;
      }
      throw error;
    }
  }

  async getChatMessages(channel: string, limit: number = 50): Promise<any[]> {
    return await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.channel, channel)) // CRITICAL: Filter by channel field in chatMessages table
      .orderBy(desc(chatMessages.createdAt))
      .limit(limit);
  }

  async updateChatMessage(
    id: number,
    updates: { content: string }
  ): Promise<void> {
    await db
      .update(chatMessages)
      .set({
        content: updates.content,
        editedAt: new Date(),
      })
      .where(eq(chatMessages.id, id));
  }

  async deleteChatMessage(id: number): Promise<void> {
    await db.delete(chatMessages).where(eq(chatMessages.id, id));
  }

  async markChannelMessagesAsRead(
    userId: string,
    channel: string
  ): Promise<void> {
    try {
      const { chatMessages, chatMessageReads } = await import('@shared/schema');

      // Get all messages in this channel that the user hasn't already marked as read
      const unreadMessages = await db
        .select({ id: chatMessages.id })
        .from(chatMessages)
        .leftJoin(
          chatMessageReads,
          and(
            eq(chatMessageReads.messageId, chatMessages.id),
            eq(chatMessageReads.userId, userId)
          )
        )
        .where(
          and(
            eq(chatMessages.channel, channel),
            isNull(chatMessageReads.id) // Not already read
          )
        );

      // Mark all unread messages as read
      if (unreadMessages.length > 0) {
        const readEntries = unreadMessages.map((msg) => ({
          messageId: msg.id,
          userId,
          channel,
          readAt: new Date(),
        }));

        await db.insert(chatMessageReads).values(readEntries);
        logger.log(
          `Marked ${unreadMessages.length} messages as read for user ${userId} in channel ${channel}`
        );
      }
    } catch (error) {
      logger.error(
        `Error marking channel messages as read for user ${userId} in channel ${channel}:`,
        error
      );
    }
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
    // Store in memory as a simple fallback since there's no shoutout_logs table
    // This will work with the fallback storage system
    throw new Error(
      'Database shoutout logging not implemented - using memory storage'
    );
  }

  async getShoutoutHistory(): Promise<any[]> {
    // Fallback to memory storage for shoutout history
    throw new Error(
      'Database shoutout history not implemented - using memory storage'
    );
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
    const { userActivityLogs, users } = await import('@shared/schema');
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Get all users with their activity summary
    const userActivities = await db
      .select({
        userId: userActivityLogs.userId,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
        activityCount: sql<number>`COUNT(${userActivityLogs.id})::int`,
        lastActive: sql<Date>`MAX(${userActivityLogs.createdAt})`,
        topSection: sql<string>`
          COALESCE(
            (SELECT ${userActivityLogs.section} 
             FROM ${userActivityLogs} u2 
             WHERE u2.user_id = ${users.id} 
             AND u2.created_at >= ${startDate}
             GROUP BY ${userActivityLogs.section} 
             ORDER BY COUNT(*) DESC 
             LIMIT 1), 
            'none'
          )
        `,
      })
      .from(users)
      .leftJoin(
        userActivityLogs,
        and(
          eq(users.id, userActivityLogs.userId),
          sql`${userActivityLogs.createdAt} >= ${startDate}`
        )
      )
      .groupBy(users.id, users.email, users.firstName, users.lastName);

    return userActivities.map((user) => ({
      userId: user.userId || '',
      email: user.email || '',
      firstName: user.firstName || '',
      lastName: user.lastName || '',
      totalActions: user.activityCount || 0,
      lastActive: user.lastActive,
      topSection: user.topSection || 'none',
    }));
  }

  // User Activity Tracking methods
  async logUserActivity(
    activity: InsertUserActivityLog
  ): Promise<UserActivityLog> {
    const [log] = await db
      .insert(userActivityLogs)
      .values(activity)
      .returning();
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
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - days);

    // Get total actions
    const totalResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(userActivityLogs)
      .where(
        and(
          eq(userActivityLogs.userId, userId),
          gte(userActivityLogs.createdAt, sinceDate)
        )
      );

    // Get sections used
    const sectionsResult = await db
      .select({ section: userActivityLogs.section })
      .from(userActivityLogs)
      .where(
        and(
          eq(userActivityLogs.userId, userId),
          gte(userActivityLogs.createdAt, sinceDate)
        )
      )
      .groupBy(userActivityLogs.section);

    // Get top actions
    const actionsResult = await db
      .select({
        action: userActivityLogs.action,
        count: sql<number>`count(*)`,
      })
      .from(userActivityLogs)
      .where(
        and(
          eq(userActivityLogs.userId, userId),
          gte(userActivityLogs.createdAt, sinceDate)
        )
      )
      .groupBy(userActivityLogs.action)
      .orderBy(desc(sql`count(*)`))
      .limit(5);

    // Get daily activity
    const dailyResult = await db
      .select({
        date: sql<string>`date(created_at)`,
        count: sql<number>`count(*)`,
      })
      .from(userActivityLogs)
      .where(
        and(
          eq(userActivityLogs.userId, userId),
          gte(userActivityLogs.createdAt, sinceDate)
        )
      )
      .groupBy(sql`date(created_at)`)
      .orderBy(sql`date(created_at)`);

    return {
      totalActions: totalResult[0]?.count || 0,
      sectionsUsed: sectionsResult.map((r) => r.section),
      topActions: actionsResult.map((r) => ({
        action: r.action,
        count: r.count,
      })),
      dailyActivity: dailyResult.map((r) => ({ date: r.date, count: r.count })),
    };
  }

  // Wishlist Suggestions
  async getAllWishlistSuggestions(): Promise<WishlistSuggestion[]> {
    const results = await db
      .select()
      .from(wishlistSuggestions)
      .orderBy(desc(wishlistSuggestions.createdAt));
    return results;
  }

  async getWishlistSuggestion(
    id: number
  ): Promise<WishlistSuggestion | undefined> {
    const [result] = await db
      .select()
      .from(wishlistSuggestions)
      .where(eq(wishlistSuggestions.id, id));
    return result || undefined;
  }

  async createWishlistSuggestion(
    suggestion: InsertWishlistSuggestion
  ): Promise<WishlistSuggestion> {
    const [result] = await db
      .insert(wishlistSuggestions)
      .values(suggestion)
      .returning();
    return result;
  }

  async updateWishlistSuggestion(
    id: number,
    updates: Partial<WishlistSuggestion>
  ): Promise<WishlistSuggestion | undefined> {
    const [result] = await db
      .update(wishlistSuggestions)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(wishlistSuggestions.id, id))
      .returning();
    return result || undefined;
  }

  async deleteWishlistSuggestion(id: number): Promise<boolean> {
    const result = await db
      .delete(wishlistSuggestions)
      .where(eq(wishlistSuggestions.id, id));
    return result.rowCount > 0;
  }

  async getRecentWishlistActivity(
    limit: number = 10
  ): Promise<WishlistSuggestion[]> {
    const results = await db
      .select()
      .from(wishlistSuggestions)
      .where(
        or(
          eq(wishlistSuggestions.status, 'approved'),
          eq(wishlistSuggestions.status, 'added')
        )
      )
      .orderBy(desc(wishlistSuggestions.updatedAt))
      .limit(limit);
    return results;
  }

  // Meeting Management - Enhanced methods for comprehensive meeting workflow
  async getMeeting(id: number): Promise<Meeting | undefined> {
    const [result] = await db
      .select()
      .from(meetings)
      .where(eq(meetings.id, id));
    return result || undefined;
  }

  async getAgendaItemsByMeeting(meetingId: number): Promise<AgendaItem[]> {
    const results = await db
      .select()
      .from(agendaItems)
      .where(eq(agendaItems.meetingId, meetingId))
      .orderBy(agendaItems.submittedAt);
    return results;
  }

  async getProjectsForReview(): Promise<Project[]> {
    const results = await db
      .select()
      .from(projects)
      .where(
        and(
          eq(projects.reviewInNextMeeting, true),
          ne(projects.status, 'completed'),
          ne(projects.status, 'archived')
        )
      )
      .orderBy(desc(projects.priority), desc(projects.createdAt));
    return results;
  }

  async createCompiledAgenda(agenda: any): Promise<number> {
    const [result] = await db
      .insert(compiledAgendas)
      .values(agenda)
      .returning({ id: compiledAgendas.id });
    return result.id;
  }

  async getCompiledAgenda(id: number): Promise<any | undefined> {
    const [result] = await db
      .select()
      .from(compiledAgendas)
      .where(eq(compiledAgendas.id, id));
    return result || undefined;
  }

  async createAgendaSection(section: any): Promise<number> {
    const [result] = await db
      .insert(agendaSections)
      .values(section)
      .returning({ id: agendaSections.id });
    return result.id;
  }

  async getAgendaSectionsByCompiledAgenda(
    compiledAgendaId: number
  ): Promise<any[]> {
    const results = await db
      .select()
      .from(agendaSections)
      .where(eq(agendaSections.compiledAgendaId, compiledAgendaId))
      .orderBy(agendaSections.orderIndex);
    return results;
  }

  async updateMeetingStatus(
    id: number,
    status: string
  ): Promise<Meeting | undefined> {
    const [result] = await db
      .update(meetings)
      .set({ status })
      .where(eq(meetings.id, id))
      .returning();
    return result || undefined;
  }

  async finalizeCompiledAgenda(
    id: number,
    finalizedBy: string
  ): Promise<any | undefined> {
    const [result] = await db
      .update(compiledAgendas)
      .set({
        status: 'finalized',
        finalizedAt: new Date(),
      })
      .where(eq(compiledAgendas.id, id))
      .returning();
    return result || undefined;
  }

  async getCompiledAgendasByMeeting(meetingId: number): Promise<any[]> {
    const results = await db
      .select()
      .from(compiledAgendas)
      .where(eq(compiledAgendas.meetingId, meetingId))
      .orderBy(desc(compiledAgendas.compiledAt));
    return results;
  }

  // Document Management Methods
  async getAllDocuments(): Promise<Document[]> {
    return await db
      .select()
      .from(documents)
      .where(eq(documents.isActive, true))
      .orderBy(desc(documents.createdAt));
  }

  async getDocument(id: number): Promise<Document | undefined> {
    const [result] = await db
      .select()
      .from(documents)
      .where(and(eq(documents.id, id), eq(documents.isActive, true)));
    return result || undefined;
  }

  async getDocumentsForUser(userId: string): Promise<Document[]> {
    // Check if user has confidential documents access
    const user = await this.getUserById(userId);
    const hasConfidentialAccess =
      user?.permissions?.includes('DOCUMENTS_CONFIDENTIAL') || false;

    // Get documents that the user has permissions for or that they uploaded
    const results = await db
      .select({
        id: documents.id,
        title: documents.title,
        description: documents.description,
        fileName: documents.fileName,
        originalName: documents.originalName,
        filePath: documents.filePath,
        fileSize: documents.fileSize,
        mimeType: documents.mimeType,
        category: documents.category,
        isActive: documents.isActive,
        uploadedBy: documents.uploadedBy,
        uploadedByName: documents.uploadedByName,
        createdAt: documents.createdAt,
        updatedAt: documents.updatedAt,
      })
      .from(documents)
      .leftJoin(
        documentPermissions,
        and(
          eq(documentPermissions.documentId, documents.id),
          eq(documentPermissions.userId, userId),
          eq(documentPermissions.isActive, true)
        )
      )
      .where(
        and(
          eq(documents.isActive, true),
          // Exclude confidential documents unless user has special permission
          hasConfidentialAccess
            ? undefined
            : ne(documents.category, 'confidential'),
          or(
            eq(documents.uploadedBy, userId), // User uploaded this document
            isNotNull(documentPermissions.id) // User has explicit permission
          )
        )
      )
      .orderBy(desc(documents.createdAt));

    return results;
  }

  async createDocument(insertDocument: InsertDocument): Promise<Document> {
    const [result] = await db
      .insert(documents)
      .values(insertDocument)
      .returning();
    return result;
  }

  async updateDocument(
    id: number,
    updates: Partial<Document>
  ): Promise<Document | undefined> {
    const [result] = await db
      .update(documents)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(documents.id, id))
      .returning();
    return result || undefined;
  }

  async deleteDocument(id: number): Promise<boolean> {
    // Soft delete
    const result = await db
      .update(documents)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(documents.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  // Document Permissions Methods
  async getDocumentPermissions(
    documentId: number
  ): Promise<DocumentPermission[]> {
    return await db
      .select()
      .from(documentPermissions)
      .where(
        and(
          eq(documentPermissions.documentId, documentId),
          eq(documentPermissions.isActive, true)
        )
      )
      .orderBy(documentPermissions.grantedAt);
  }

  async getUserDocumentPermission(
    documentId: number,
    userId: string
  ): Promise<DocumentPermission | undefined> {
    const [result] = await db
      .select()
      .from(documentPermissions)
      .where(
        and(
          eq(documentPermissions.documentId, documentId),
          eq(documentPermissions.userId, userId),
          eq(documentPermissions.isActive, true)
        )
      );
    return result || undefined;
  }

  async checkUserDocumentAccess(
    documentId: number,
    userId: string,
    permission: string
  ): Promise<boolean> {
    // Check if user is the uploader
    const [document] = await db
      .select()
      .from(documents)
      .where(eq(documents.id, documentId));

    if (document && document.uploadedBy === userId) {
      return true; // Uploaders have full access
    }

    // Check explicit permissions
    const [userPermission] = await db
      .select()
      .from(documentPermissions)
      .where(
        and(
          eq(documentPermissions.documentId, documentId),
          eq(documentPermissions.userId, userId),
          eq(documentPermissions.isActive, true)
        )
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
    const [result] = await db
      .insert(documentPermissions)
      .values(insertPermission)
      .returning();
    return result;
  }

  async revokeDocumentPermission(
    documentId: number,
    userId: string,
    permissionType: string
  ): Promise<boolean> {
    const result = await db
      .update(documentPermissions)
      .set({ isActive: false })
      .where(
        and(
          eq(documentPermissions.documentId, documentId),
          eq(documentPermissions.userId, userId),
          eq(documentPermissions.permissionType, permissionType),
          eq(documentPermissions.isActive, true)
        )
      );
    return (result.rowCount ?? 0) > 0;
  }

  async updateDocumentPermission(
    id: number,
    updates: Partial<DocumentPermission>
  ): Promise<DocumentPermission | undefined> {
    const [result] = await db
      .update(documentPermissions)
      .set(updates)
      .where(eq(documentPermissions.id, id))
      .returning();
    return result || undefined;
  }

  // Document Access Logging Methods
  async logDocumentAccess(
    insertAccess: InsertDocumentAccessLog
  ): Promise<DocumentAccessLog> {
    const [result] = await db
      .insert(documentAccessLogs)
      .values(insertAccess)
      .returning();
    return result;
  }

  async getDocumentAccessLogs(
    documentId: number
  ): Promise<DocumentAccessLog[]> {
    return await db
      .select()
      .from(documentAccessLogs)
      .where(eq(documentAccessLogs.documentId, documentId))
      .orderBy(desc(documentAccessLogs.accessedAt));
  }

  // Confidential Document Management Methods
  async createConfidentialDocument(data: InsertConfidentialDocument): Promise<ConfidentialDocument> {
    const [result] = await db
      .insert(confidentialDocuments)
      .values(data)
      .returning();
    return result;
  }

  async getConfidentialDocumentsForUser(userEmail: string): Promise<ConfidentialDocument[]> {
    return await db
      .select()
      .from(confidentialDocuments)
      .where(
        sql`${confidentialDocuments.allowedEmails} @> ${JSON.stringify([userEmail])}`
      )
      .orderBy(desc(confidentialDocuments.uploadedAt));
  }

  async getConfidentialDocumentById(id: number, userEmail: string): Promise<ConfidentialDocument | null> {
    const [result] = await db
      .select()
      .from(confidentialDocuments)
      .where(
        and(
          eq(confidentialDocuments.id, id),
          sql`${confidentialDocuments.allowedEmails} @> ${JSON.stringify([userEmail])}`
        )
      );
    return result || null;
  }

  async deleteConfidentialDocument(id: number, userEmail: string): Promise<boolean> {
    // First check if user has access to this document
    const document = await this.getConfidentialDocumentById(id, userEmail);
    if (!document) {
      return false; // User doesn't have access or document doesn't exist
    }

    const result = await db
      .delete(confidentialDocuments)
      .where(eq(confidentialDocuments.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  // Event Request Management Methods
  async getAllEventRequests(): Promise<EventRequest[]> {
    const results = await db
      .select()
      .from(eventRequests)
      .where(isNull(eventRequests.deletedAt)) // Exclude soft-deleted records
      .orderBy(desc(eventRequests.createdAt));

    logger.log(`🔍 getAllEventRequests: Database returned ${results.length} rows`);

    return results;
  }

  async getEventRequestsByStatuses(statuses: string[]): Promise<EventRequest[]> {
    if (statuses.length === 0) {
      return [];
    }
    const results = await db
      .select()
      .from(eventRequests)
      .where(
        and(
          isNull(eventRequests.deletedAt),
          inArray(eventRequests.status, statuses)
        )
      )
      .orderBy(desc(eventRequests.createdAt));

    logger.log(`🔍 getEventRequestsByStatuses(${statuses.join(',')}): Database returned ${results.length} rows`);
    return results;
  }

  async getEventRequest(id: number): Promise<EventRequest | undefined> {
    logger.log(`🔍 getEventRequest called with id: ${id}, type: ${typeof id}`);
    const [result] = await db
      .select()
      .from(eventRequests)
      .where(eq(eventRequests.id, id));
    logger.log(`🔍 getEventRequest result for id ${id}:`, result ? `Found (${result.organizationName})` : 'NOT FOUND');
    return result || undefined;
  }

  async createEventRequest(
    insertEventRequest: InsertEventRequest
  ): Promise<EventRequest> {
    const [result] = await db
      .insert(eventRequests)
      .values({
        ...normalizeToolkitPatch(insertEventRequest),
        updatedAt: new Date(),
      })
      .returning();
    return result;
  }

  async updateEventRequest(
    id: number,
    updates: Partial<EventRequest> & { expectedVersion?: Date }
  ): Promise<EventRequest | undefined> {
    const { expectedVersion, ...rawUpdateData } = updates;
    const previousToolkit = typeof rawUpdateData.toolkitSent === 'boolean' && !rawUpdateData.toolkitStatus
      ? await this.getEventRequest(id)
      : undefined;
    const updateData = normalizeToolkitPatch(rawUpdateData, previousToolkit);

    // DEBUG: Log incoming updates for speaker assignment debugging
    logger.info(`[DB updateEventRequest] Event ${id} - Received update keys: ${Object.keys(updateData).join(', ')}`);
    if (updateData.speakerDetails !== undefined) {
      logger.info(`[DB updateEventRequest] Event ${id} - speakerDetails value: ${JSON.stringify(updateData.speakerDetails)}`);
    }

    if (expectedVersion) {
      const current = await this.getEventRequest(id);
      if (!current) {
        throw new Error(`Event request ${id} not found`);
      }

      if (current.updatedAt && new Date(current.updatedAt).getTime() !== new Date(expectedVersion).getTime()) {
        throw new Error('Conflict: Event request has been modified by another user. Please refresh and try again.');
      }
    }

    // Filter out undefined values to prevent Drizzle from writing NULL
    // This preserves existing database values when a field is not explicitly updated
    const filteredData = Object.fromEntries(
      Object.entries(updateData).filter(([_, value]) => value !== undefined)
    );

    // DEBUG: Log filtered data
    logger.info(`[DB updateEventRequest] Event ${id} - Filtered data keys: ${Object.keys(filteredData).join(', ')}`);
    if (filteredData.speakerDetails !== undefined) {
      logger.info(`[DB updateEventRequest] Event ${id} - Filtered speakerDetails: ${JSON.stringify(filteredData.speakerDetails)}`);
    }

    // PRIMARY PATH: UPDATE ... RETURNING. On the neon-http driver every statement
    // is its own request to the PRIMARY, so the returned row is the authoritative
    // post-write state: it reflects any DB-side triggers/defaults/coercions and is
    // immune to the read-replica lag that a separate verify-SELECT can hit.
    // (createEventRequest relies on .returning() the same way.)
    //
    // An empty result is NOT assumed to be success — it means the driver gave us no
    // row back (either nothing matched, or a rare flake), so we fall through to the
    // verify-and-heal path rather than fabricating a saved record.
    const updatedRows = await db
      .update(eventRequests)
      .set({
        ...filteredData,
        updatedAt: new Date(),
      })
      .where(eq(eventRequests.id, id))
      .returning();

    if (updatedRows.length > 0) {
      const updated = updatedRows[0] as EventRequest;
      logger.info(`[DB updateEventRequest] Event ${id} - persisted via RETURNING (authoritative). speakerDetails: ${JSON.stringify(updated.speakerDetails)}`);
      return updated;
    }

    // FALLBACK: RETURNING came back empty. Rare. Re-read to find out what actually
    // happened — and never report success for a row we can't confirm.
    logger.warn(`[DB updateEventRequest] Event ${id} - UPDATE returned no rows; falling back to a verify-read.`);
    let result = await this.getEventRequest(id);

    if (!result) {
      // No RETURNING row AND no readable row: the record is gone (e.g. concurrently
      // deleted) or the write never landed. Report failure honestly instead of
      // synthesizing a "saved" object from the intended values.
      logger.error(`[DB updateEventRequest] ⚠️ Event ${id} — no RETURNING row and not found on read; treating as a failed write.`);
      return undefined;
    }

    // The row demonstrably exists. Verify the fields we intended to write actually
    // landed; on a stale replica read, retry once, then — only because the row is
    // confirmed to exist — trust the write and merge the intended values so the
    // client doesn't see a ghost revert from replica lag. This residual merge now
    // only runs in the rare empty-RETURNING case.
    const findMismatches = (current: any) =>
      Object.entries(filteredData).filter(([key, expected]) => {
        // Drizzle stores Date objects as timestamptz; compare by .getTime() for those.
        const actual = current?.[key];
        if (expected instanceof Date && actual instanceof Date) {
          return expected.getTime() !== actual.getTime();
        }
        // JSON columns: compare by stringification (cheap, handles arrays + objects).
        if (typeof expected === 'object' && expected !== null) {
          return JSON.stringify(expected) !== JSON.stringify(actual);
        }
        return expected !== actual;
      });

    let mismatches = findMismatches(result);
    if (mismatches.length > 0) {
      logger.warn(
        `[DB updateEventRequest] Event ${id} — post-save read shows ${mismatches.length} field(s) stale, retrying after 150ms: ${mismatches.map(([k]) => k).join(', ')}`
      );
      await new Promise((r) => setTimeout(r, 150));
      result = await this.getEventRequest(id);
      mismatches = result ? findMismatches(result) : [];

      if (mismatches.length > 0 && result) {
        logger.error(
          `[DB updateEventRequest] ⚠️ Event ${id} — read still stale after retry. Trusting the write and merging filteredData. Stale fields: ${mismatches.map(([k]) => k).join(', ')}`
        );
        result = { ...result, ...(filteredData as Partial<EventRequest>) } as EventRequest;
      } else if (result) {
        logger.info(`[DB updateEventRequest] ✅ Event ${id} — retry succeeded, fields verified`);
      }
    }

    return result;
  }

  async deleteEventRequest(id: number, userId?: string): Promise<boolean> {
    // Soft delete: set deletedAt and deletedBy instead of actually deleting
    const result = await db
      .update(eventRequests)
      .set({
        deletedAt: new Date(),
        deletedBy: userId || null,
      })
      .where(eq(eventRequests.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  async restoreEventRequest(id: number): Promise<boolean> {
    // Restore a soft-deleted event request
    // First, get the event to check if needs fields should be restored based on assignments
    const event = await db
      .select()
      .from(eventRequests)
      .where(eq(eventRequests.id, id))
      .limit(1);
    
    if (event.length === 0) {
      return false;
    }
    
    const existingEvent = event[0];
    const updateData: any = {
      deletedAt: null,
      deletedBy: null,
    };
    
    // Auto-restore needs fields if assignments exist but needs are 0/null
    // This prevents losing needs when an event is restored
    if (existingEvent.assignedDriverIds && Array.isArray(existingEvent.assignedDriverIds) && existingEvent.assignedDriverIds.length > 0) {
      const hasVanDriver = (existingEvent as any).assignedVanDriverId || (existingEvent as any).isDhlVan;
      const totalAssignedDrivers = existingEvent.assignedDriverIds.length + (hasVanDriver ? 1 : 0);
      if ((existingEvent.driversNeeded || 0) < totalAssignedDrivers) {
        updateData.driversNeeded = totalAssignedDrivers;
      }
    }
    
    if (existingEvent.speakerDetails) {
      const speakerDetails = typeof existingEvent.speakerDetails === 'string' 
        ? JSON.parse(existingEvent.speakerDetails || '{}')
        : existingEvent.speakerDetails;
      const assignedSpeakerCount = Object.keys(speakerDetails || {}).length;
      if (assignedSpeakerCount > 0 && (existingEvent.speakersNeeded || 0) < assignedSpeakerCount) {
        updateData.speakersNeeded = assignedSpeakerCount;
      }
    }
    
    if (existingEvent.assignedVolunteerIds && Array.isArray(existingEvent.assignedVolunteerIds) && existingEvent.assignedVolunteerIds.length > 0) {
      const assignedVolunteerCount = existingEvent.assignedVolunteerIds.length;
      if ((existingEvent.volunteersNeeded || 0) < assignedVolunteerCount) {
        updateData.volunteersNeeded = assignedVolunteerCount;
      }
    }
    
    const result = await db
      .update(eventRequests)
      .set(updateData)
      .where(eq(eventRequests.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  async getEventRequestsByStatus(status: string): Promise<EventRequest[]> {
    return await db
      .select()
      .from(eventRequests)
      .where(and(
        eq(eventRequests.status, status),
        isNull(eventRequests.deletedAt) // Exclude soft-deleted records
      ))
      .orderBy(desc(eventRequests.createdAt));
  }

  async getEventRequestsByOrganization(
    organizationName: string
  ): Promise<EventRequest[]> {
    return await db
      .select()
      .from(eventRequests)
      .where(and(
        ilike(eventRequests.organizationName, `%${organizationName}%`),
        isNull(eventRequests.deletedAt) // Exclude soft-deleted records
      ))
      .orderBy(desc(eventRequests.createdAt));
  }

  // Event reminders count - returns count of pending reminders for a user
  async getEventRemindersCount(userId?: string): Promise<number> {
    // For now, return 0 as there's no specific event reminders table structure
    // This could be enhanced to count pending tasks, upcoming events, etc.
    return 0;
  }

  async checkOrganizationDuplicates(
    organizationName: string
  ): Promise<{ exists: boolean; matches: Organization[] }> {
    const matches = await db
      .select()
      .from(organizations)
      .where(
        or(
          ilike(organizations.name, `%${organizationName}%`),
          sql`${organizations.alternateNames} && ARRAY[${organizationName}]::text[]`
        )
      );

    return {
      exists: matches.length > 0,
      matches,
    };
  }

  // Event Collaboration Comments
  async getEventCollaborationComments(eventRequestId: number): Promise<EventCollaborationComment[]> {
    return await db
      .select()
      .from(eventCollaborationComments)
      .where(eq(eventCollaborationComments.eventRequestId, eventRequestId))
      .orderBy(asc(eventCollaborationComments.createdAt));
  }

  async getBulkEventCollaborationComments(eventRequestIds: number[]): Promise<Map<number, EventCollaborationComment[]>> {
    if (eventRequestIds.length === 0) {
      return new Map();
    }

    const comments = await db
      .select()
      .from(eventCollaborationComments)
      .where(inArray(eventCollaborationComments.eventRequestId, eventRequestIds))
      .orderBy(asc(eventCollaborationComments.createdAt));

    const result = new Map<number, EventCollaborationComment[]>();
    eventRequestIds.forEach(id => result.set(id, []));
    comments.forEach(comment => {
      const list = result.get(comment.eventRequestId) || [];
      list.push(comment);
      result.set(comment.eventRequestId, list);
    });

    return result;
  }

  async createEventCollaborationComment(data: InsertEventCollaborationComment): Promise<EventCollaborationComment> {
    try {
      const [comment] = await db
        .insert(eventCollaborationComments)
        .values(data)
        .returning();
      return comment;
    } catch (error) {
      console.error('[DatabaseStorage] Error creating event collaboration comment:', error);
      console.error('[DatabaseStorage] Data:', JSON.stringify(data, null, 2));
      throw error;
    }
  }

  async updateEventCollaborationComment(id: number, content: string, userId: string): Promise<EventCollaborationComment | undefined> {
    const [comment] = await db
      .update(eventCollaborationComments)
      .set({
        content,
        editedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(eventCollaborationComments.id, id),
          eq(eventCollaborationComments.userId, userId)
        )
      )
      .returning();
    return comment || undefined;
  }

  async deleteEventCollaborationComment(id: number, userId: string): Promise<boolean> {
    const result = await db
      .delete(eventCollaborationComments)
      .where(
        and(
          eq(eventCollaborationComments.id, id),
          eq(eventCollaborationComments.userId, userId)
        )
      );
    return (result.rowCount ?? 0) > 0;
  }

  // Event Collaboration Comment Likes
  async getCommentLikes(commentId: number): Promise<EventCollaborationCommentLike[]> {
    return await db
      .select()
      .from(eventCollaborationCommentLikes)
      .where(eq(eventCollaborationCommentLikes.commentId, commentId))
      .orderBy(asc(eventCollaborationCommentLikes.createdAt));
  }

  async toggleCommentLike(commentId: number, userId: string): Promise<{ liked: boolean; likeCount: number }> {
    // Check if already liked
    const existing = await db
      .select()
      .from(eventCollaborationCommentLikes)
      .where(
        and(
          eq(eventCollaborationCommentLikes.commentId, commentId),
          eq(eventCollaborationCommentLikes.userId, userId)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      // Unlike: delete the like
      await db
        .delete(eventCollaborationCommentLikes)
        .where(
          and(
            eq(eventCollaborationCommentLikes.commentId, commentId),
            eq(eventCollaborationCommentLikes.userId, userId)
          )
        );

      // Get updated count
      const likes = await this.getCommentLikes(commentId);
      return { liked: false, likeCount: likes.length };
    } else {
      // Like: insert new like
      await db
        .insert(eventCollaborationCommentLikes)
        .values({ commentId, userId });

      // Get updated count
      const likes = await this.getCommentLikes(commentId);
      return { liked: true, likeCount: likes.length };
    }
  }

  // Event Field Locks
  async getEventFieldLocks(eventRequestId: number): Promise<EventFieldLock[]> {
    const now = new Date();
    return await db
      .select()
      .from(eventFieldLocks)
      .where(
        and(
          eq(eventFieldLocks.eventRequestId, eventRequestId),
          gt(eventFieldLocks.expiresAt, now)
        )
      )
      .orderBy(desc(eventFieldLocks.lockedAt));
  }

  async getBulkEventFieldLocks(eventRequestIds: number[]): Promise<Map<number, EventFieldLock[]>> {
    if (eventRequestIds.length === 0) {
      return new Map();
    }

    const now = new Date();
    const locks = await db
      .select()
      .from(eventFieldLocks)
      .where(
        and(
          inArray(eventFieldLocks.eventRequestId, eventRequestIds),
          gt(eventFieldLocks.expiresAt, now)
        )
      )
      .orderBy(desc(eventFieldLocks.lockedAt));

    const result = new Map<number, EventFieldLock[]>();
    eventRequestIds.forEach(id => result.set(id, []));
    locks.forEach(lock => {
      const list = result.get(lock.eventRequestId) || [];
      list.push(lock);
      result.set(lock.eventRequestId, list);
    });

    return result;
  }

  async createEventFieldLock(data: InsertEventFieldLock): Promise<EventFieldLock> {
    const expiresAt = data.expiresAt || new Date(Date.now() + 5 * 60 * 1000);
    const [lock] = await db
      .insert(eventFieldLocks)
      .values({
        ...data,
        expiresAt,
      })
      .returning();
    return lock;
  }

  async releaseEventFieldLock(eventRequestId: number, fieldName: string, userId: string): Promise<boolean> {
    // Verify ownership and delete the lock in a single query
    const result = await db
      .delete(eventFieldLocks)
      .where(
        and(
          eq(eventFieldLocks.eventRequestId, eventRequestId),
          eq(eventFieldLocks.fieldName, fieldName),
          eq(eventFieldLocks.lockedBy, userId)
        )
      );
    return (result.rowCount ?? 0) > 0;
  }

  async deleteEventFieldLock(eventRequestId: number, fieldName: string): Promise<boolean> {
    const result = await db
      .delete(eventFieldLocks)
      .where(
        and(
          eq(eventFieldLocks.eventRequestId, eventRequestId),
          eq(eventFieldLocks.fieldName, fieldName)
        )
      );
    return (result.rowCount ?? 0) > 0;
  }

  async cleanupExpiredLocks(): Promise<number> {
    const now = new Date();
    const result = await db
      .delete(eventFieldLocks)
      .where(lte(eventFieldLocks.expiresAt, now));
    return result.rowCount ?? 0;
  }

  // Event Edit Revisions
  async getEventEditRevisions(
    eventRequestId: number, 
    options?: { fieldName?: string; limit?: number }
  ): Promise<EventEditRevision[]> {
    let query = db
      .select()
      .from(eventEditRevisions)
      .where(eq(eventEditRevisions.eventRequestId, eventRequestId))
      .$dynamic();

    if (options?.fieldName) {
      query = query.where(eq(eventEditRevisions.fieldName, options.fieldName));
    }

    query = query.orderBy(desc(eventEditRevisions.createdAt));

    if (options?.limit) {
      query = query.limit(options.limit);
    }

    const revisions = await query;
    
    return revisions.map(revision => ({
      ...revision,
      oldValue: this.parseJsonValue(revision.oldValue),
      newValue: this.parseJsonValue(revision.newValue),
    }));
  }

  async getEventFieldRevisions(
    eventRequestId: number,
    fieldName: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<EventEditRevision[]> {
    const revisions = await db
      .select()
      .from(eventEditRevisions)
      .where(
        and(
          eq(eventEditRevisions.eventRequestId, eventRequestId),
          eq(eventEditRevisions.fieldName, fieldName)
        )
      )
      .orderBy(desc(eventEditRevisions.createdAt))
      .limit(limit)
      .offset(offset);

    return revisions.map(revision => ({
      ...revision,
      oldValue: this.parseJsonValue(revision.oldValue),
      newValue: this.parseJsonValue(revision.newValue),
    }));
  }

  private parseJsonValue(value: string | null): any {
    if (!value) return null;
    
    try {
      return JSON.parse(value);
    } catch (error) {
      return value;
    }
  }

  async createEventEditRevision(data: InsertEventEditRevision): Promise<EventEditRevision> {
    const [revision] = await db
      .insert(eventEditRevisions)
      .values(data)
      .returning();
    return revision;
  }

  // Organization Management Methods
  async getAllOrganizations(): Promise<Organization[]> {
    return await db.select().from(organizations).orderBy(organizations.name);
  }

  async getOrganization(id: number): Promise<Organization | undefined> {
    const [result] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, id));
    return result || undefined;
  }

  async createOrganization(
    insertOrganization: InsertOrganization
  ): Promise<Organization> {
    const [result] = await db
      .insert(organizations)
      .values({
        ...insertOrganization,
        updatedAt: new Date(),
      })
      .returning();
    return result;
  }

  async updateOrganization(
    id: number,
    updates: Partial<Organization>
  ): Promise<Organization | undefined> {
    const [result] = await db
      .update(organizations)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(eq(organizations.id, id))
      .returning();
    return result || undefined;
  }

  async deleteOrganization(id: number): Promise<boolean> {
    const result = await db
      .delete(organizations)
      .where(eq(organizations.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  async searchOrganizations(query: string): Promise<Organization[]> {
    return await db
      .select()
      .from(organizations)
      .where(
        or(
          ilike(organizations.name, `%${query}%`),
          sql`${organizations.alternateNames} && ARRAY[${query}]::text[]`
        )
      )
      .orderBy(organizations.name);
  }

  // Event volunteers methods
  async getAllEventVolunteers(): Promise<EventVolunteer[]> {
    return await db
      .select()
      .from(eventVolunteers)
      .orderBy(desc(eventVolunteers.signedUpAt));
  }

  async getEventVolunteersByEventId(
    eventRequestId: number
  ): Promise<EventVolunteer[]> {
    return await db
      .select()
      .from(eventVolunteers)
      .where(eq(eventVolunteers.eventRequestId, eventRequestId))
      .orderBy(eventVolunteers.role, eventVolunteers.signedUpAt);
  }

  async getEventVolunteersByUserId(userId: string): Promise<EventVolunteer[]> {
    return await db
      .select()
      .from(eventVolunteers)
      .where(eq(eventVolunteers.volunteerUserId, userId))
      .orderBy(desc(eventVolunteers.signedUpAt));
  }

  async createEventVolunteer(
    volunteer: InsertEventVolunteer
  ): Promise<EventVolunteer> {
    const [result] = await db
      .insert(eventVolunteers)
      .values({
        ...volunteer,
        updatedAt: new Date(),
      })
      .returning();
    return result;
  }

  async updateEventVolunteer(
    id: number,
    updates: Partial<EventVolunteer>
  ): Promise<EventVolunteer | undefined> {
    const [result] = await db
      .update(eventVolunteers)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(eq(eventVolunteers.id, id))
      .returning();
    return result || undefined;
  }

  async deleteEventVolunteer(id: number): Promise<boolean> {
    const result = await db
      .delete(eventVolunteers)
      .where(eq(eventVolunteers.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  // Imported External IDs (Permanent Blacklist System) Methods
  // These methods manage the permanent blacklist to prevent re-importing external_ids

  async checkExternalIdExists(
    externalId: string,
    sourceTable: string = 'event_requests'
  ): Promise<boolean> {
    try {
      const [result] = await db
        .select({ id: importedExternalIds.id })
        .from(importedExternalIds)
        .where(
          and(
            eq(importedExternalIds.externalId, externalId),
            eq(importedExternalIds.sourceTable, sourceTable)
          )
        )
        .limit(1);

      return !!result;
    } catch (error) {
      logger.error('❌ Error checking if external_id exists:', error);
      return false;
    }
  }

  async addExternalIdToBlacklist(
    externalId: string,
    sourceTable: string = 'event_requests',
    notes?: string
  ): Promise<ImportedExternalId> {
    try {
      const [result] = await db
        .insert(importedExternalIds)
        .values({
          externalId,
          sourceTable,
          notes,
        })
        .onConflictDoNothing({
          target: importedExternalIds.externalId,
        })
        .returning();

      // If insert was skipped due to conflict, get the existing record
      if (!result) {
        const [existing] = await db
          .select()
          .from(importedExternalIds)
          .where(eq(importedExternalIds.externalId, externalId))
          .limit(1);
        
        if (existing) {
          return existing;
        }
      }

      return result;
    } catch (error) {
      logger.error('❌ Error adding external_id to blacklist:', error);
      throw error;
    }
  }

  async getAllImportedExternalIds(
    sourceTable?: string
  ): Promise<ImportedExternalId[]> {
    try {
      const query = db.select().from(importedExternalIds);
      
      if (sourceTable) {
        return await query
          .where(eq(importedExternalIds.sourceTable, sourceTable))
          .orderBy(desc(importedExternalIds.importedAt));
      }

      return await query.orderBy(desc(importedExternalIds.importedAt));
    } catch (error) {
      logger.error('❌ Error getting all imported external_ids:', error);
      return [];
    }
  }

  async getImportedExternalId(
    externalId: string,
    sourceTable: string = 'event_requests'
  ): Promise<ImportedExternalId | undefined> {
    try {
      const [result] = await db
        .select()
        .from(importedExternalIds)
        .where(
          and(
            eq(importedExternalIds.externalId, externalId),
            eq(importedExternalIds.sourceTable, sourceTable)
          )
        )
        .limit(1);

      return result || undefined;
    } catch (error) {
      logger.error('❌ Error getting imported external_id:', error);
      return undefined;
    }
  }

  async backfillExistingExternalIds(): Promise<number> {
    try {
      logger.log('🔄 Starting backfill of existing external_ids...');

      // Get all existing external_ids from event_requests table
      const existingExternalIds = await db
        .select({
          externalId: eventRequests.externalId,
        })
        .from(eventRequests)
        .where(isNotNull(eventRequests.externalId));

      logger.log(`📊 Found ${existingExternalIds.length} existing external_ids to backfill`);

      let backfilledCount = 0;

      // Insert each external_id into the blacklist table
      for (const { externalId } of existingExternalIds) {
        if (externalId && externalId.trim()) {
          try {
            await this.addExternalIdToBlacklist(
              externalId,
              'event_requests',
              'Backfilled from existing data'
            );
            backfilledCount++;
          } catch (error) {
            // Skip if already exists or other error
            logger.warn(`⚠️ Failed to backfill external_id ${externalId}:`, error);
          }
        }
      }

      logger.log(`✅ Successfully backfilled ${backfilledCount} external_ids`);
      return backfilledCount;
    } catch (error) {
      logger.error('❌ Error during backfill process:', error);
      throw error;
    }
  }

  // Availability Slots Methods
  async getAllAvailabilitySlots(): Promise<AvailabilitySlot[]> {
    return await db
      .select()
      .from(availabilitySlots)
      .orderBy(desc(availabilitySlots.startAt));
  }

  async getAvailabilitySlotById(id: number): Promise<AvailabilitySlot | undefined> {
    const [slot] = await db
      .select()
      .from(availabilitySlots)
      .where(eq(availabilitySlots.id, id))
      .limit(1);
    return slot;
  }

  async getAvailabilitySlotsByUserId(
    userId: string
  ): Promise<AvailabilitySlot[]> {
    return await db
      .select()
      .from(availabilitySlots)
      .where(eq(availabilitySlots.userId, userId))
      .orderBy(desc(availabilitySlots.startAt));
  }

  async getAvailabilitySlotsByDateRange(
    startDate: Date,
    endDate: Date
  ): Promise<AvailabilitySlot[]> {
    return await db
      .select()
      .from(availabilitySlots)
      .where(
        and(
          lte(availabilitySlots.startAt, endDate),
          gte(availabilitySlots.endAt, startDate)
        )
      )
      .orderBy(availabilitySlots.startAt);
  }

  async createAvailabilitySlot(
    slot: InsertAvailabilitySlot
  ): Promise<AvailabilitySlot> {
    const [newSlot] = await db
      .insert(availabilitySlots)
      .values(slot)
      .returning();
    return newSlot;
  }

  async updateAvailabilitySlot(
    id: number,
    updates: Partial<InsertAvailabilitySlot>
  ): Promise<AvailabilitySlot> {
    const [updatedSlot] = await db
      .update(availabilitySlots)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(availabilitySlots.id, id))
      .returning();
    return updatedSlot;
  }

  async deleteAvailabilitySlot(id: number): Promise<void> {
    await db.delete(availabilitySlots).where(eq(availabilitySlots.id, id));
  }

  // Dashboard Documents
  async getDashboardDocuments(): Promise<DashboardDocument[]> {
    return await db
      .select()
      .from(dashboardDocuments)
      .where(eq(dashboardDocuments.isActive, true))
      .orderBy(asc(dashboardDocuments.displayOrder));
  }

  async addDashboardDocument(
    documentId: string,
    displayOrder: number,
    userId: string
  ): Promise<DashboardDocument> {
    const [doc] = await db
      .insert(dashboardDocuments)
      .values({
        documentId,
        displayOrder,
        addedBy: userId,
        isActive: true,
      })
      .returning();
    return doc;
  }

  async removeDashboardDocument(documentId: string): Promise<boolean> {
    const result = await db
      .delete(dashboardDocuments)
      .where(eq(dashboardDocuments.documentId, documentId));
    return (result.rowCount ?? 0) > 0;
  }

  async updateDashboardDocumentOrder(
    updates: Array<{ documentId: string; displayOrder: number }>
  ): Promise<void> {
    for (const update of updates) {
      await db
        .update(dashboardDocuments)
        .set({ 
          displayOrder: update.displayOrder,
          updatedAt: new Date(),
        })
        .where(eq(dashboardDocuments.documentId, update.documentId));
    }
  }

  // Search Analytics (SmartSearch usage tracking for ML improvements)
  async logSearchAnalytics(data: InsertSearchAnalytics): Promise<void> {
    await db.insert(searchAnalytics).values(data);
  }

  async getSearchAnalytics(options?: { limit?: number; userId?: string }): Promise<SearchAnalytics[]> {
    let query = db.select().from(searchAnalytics);

    // Filter by user if specified
    if (options?.userId) {
      query = query.where(eq(searchAnalytics.userId, options.userId)) as typeof query;
    }

    // Order by most recent first
    query = query.orderBy(desc(searchAnalytics.timestamp)) as typeof query;

    // Apply limit if specified
    if (options?.limit) {
      query = query.limit(options.limit) as typeof query;
    }

    return await query;
  }

  // ==================== Holding Zone Collaboration ====================

  async getHoldingZoneCollaborationComments(holdingZoneId: string): Promise<any[]> {
    // For now, return empty array since we don't have holding zone collaboration tables yet
    // This prevents the 500 error and allows the UI to work
    return [];
  }

  async createHoldingZoneCollaborationComment(data: {
    holdingZoneId: string;
    userId: string;
    userName: string;
    content: string;
    parentCommentId?: number;
  }): Promise<any> {
    // Placeholder implementation
    return {
      id: Date.now(),
      ...data,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  async updateHoldingZoneCollaborationComment(
    commentId: number,
    userId: string,
    content: string
  ): Promise<any> {
    // Placeholder implementation
    return {
      id: commentId,
      userId,
      content,
      updatedAt: new Date(),
    };
  }

  async deleteHoldingZoneCollaborationComment(
    commentId: number,
    userId: string
  ): Promise<boolean> {
    // Placeholder implementation
    return true;
  }

  async getHoldingZoneFieldLocks(holdingZoneId: string): Promise<any[]> {
    // Placeholder implementation
    return [];
  }

  async acquireHoldingZoneFieldLock(data: {
    holdingZoneId: string;
    userId: string;
    userName: string;
    fieldName: string;
    expiresInMinutes: number;
  }): Promise<any> {
    // Placeholder implementation
    return {
      id: Date.now(),
      ...data,
      lockedAt: new Date(),
      expiresAt: new Date(Date.now() + data.expiresInMinutes * 60 * 1000),
    };
  }

  async releaseHoldingZoneFieldLock(
    holdingZoneId: string,
    fieldName: string,
    userId: string
  ): Promise<boolean> {
    // Placeholder implementation
    return true;
  }

  // ==================== Email Template Sections ====================

  async getEmailTemplateSections(templateType?: string): Promise<EmailTemplateSection[]> {
    if (templateType) {
      return await db
        .select()
        .from(emailTemplateSections)
        .where(eq(emailTemplateSections.templateType, templateType))
        .orderBy(asc(emailTemplateSections.sectionKey));
    }
    return await db
      .select()
      .from(emailTemplateSections)
      .orderBy(asc(emailTemplateSections.templateType), asc(emailTemplateSections.sectionKey));
  }

  async getEmailTemplateSection(templateType: string, sectionKey: string): Promise<EmailTemplateSection | undefined> {
    const [section] = await db
      .select()
      .from(emailTemplateSections)
      .where(
        and(
          eq(emailTemplateSections.templateType, templateType),
          eq(emailTemplateSections.sectionKey, sectionKey)
        )
      );
    return section || undefined;
  }

  async getEmailTemplateSectionById(id: number): Promise<EmailTemplateSection | undefined> {
    const [section] = await db
      .select()
      .from(emailTemplateSections)
      .where(eq(emailTemplateSections.id, id));
    return section || undefined;
  }

  async createEmailTemplateSection(data: InsertEmailTemplateSection): Promise<EmailTemplateSection> {
    const [section] = await db
      .insert(emailTemplateSections)
      .values(data)
      .returning();
    return section;
  }

  async updateEmailTemplateSection(id: number, data: UpdateEmailTemplateSection): Promise<EmailTemplateSection | undefined> {
    await db
      .update(emailTemplateSections)
      .set({
        ...data,
        lastUpdatedAt: new Date(),
      })
      .where(eq(emailTemplateSections.id, id));
    // Neon serverless pattern: explicit fetch after update
    return await this.getEmailTemplateSectionById(id);
  }

  async resetEmailTemplateSectionToDefault(id: number): Promise<EmailTemplateSection | undefined> {
    await db
      .update(emailTemplateSections)
      .set({
        currentContent: null,
        lastUpdatedAt: new Date(),
      })
      .where(eq(emailTemplateSections.id, id));
    // Neon serverless pattern: explicit fetch after update
    return await this.getEmailTemplateSectionById(id);
  }

  // ==================== Ambassador Candidates ====================

  async getAllAmbassadorCandidates(): Promise<AmbassadorCandidate[]> {
    return await db
      .select()
      .from(ambassadorCandidates)
      .orderBy(desc(ambassadorCandidates.addedAt));
  }

  async getAmbassadorCandidatesByStatus(status: string): Promise<AmbassadorCandidate[]> {
    return await db
      .select()
      .from(ambassadorCandidates)
      .where(eq(ambassadorCandidates.status, status))
      .orderBy(desc(ambassadorCandidates.addedAt));
  }

  async getAmbassadorCandidate(id: number): Promise<AmbassadorCandidate | undefined> {
    const [candidate] = await db
      .select()
      .from(ambassadorCandidates)
      .where(eq(ambassadorCandidates.id, id));
    return candidate || undefined;
  }

  async getAmbassadorCandidateByCanonicalName(canonicalName: string): Promise<AmbassadorCandidate | undefined> {
    const [candidate] = await db
      .select()
      .from(ambassadorCandidates)
      .where(eq(ambassadorCandidates.canonicalName, canonicalName));
    return candidate || undefined;
  }

  async createAmbassadorCandidate(data: InsertAmbassadorCandidate): Promise<AmbassadorCandidate> {
    const [candidate] = await db
      .insert(ambassadorCandidates)
      .values(data)
      .returning();
    return candidate;
  }

  async updateAmbassadorCandidate(id: number, data: UpdateAmbassadorCandidate): Promise<AmbassadorCandidate | undefined> {
    await db
      .update(ambassadorCandidates)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(ambassadorCandidates.id, id));
    return await this.getAmbassadorCandidate(id);
  }

  async deleteAmbassadorCandidate(id: number): Promise<boolean> {
    const result = await db
      .delete(ambassadorCandidates)
      .where(eq(ambassadorCandidates.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  async getAmbassadorCandidatesWithFollowUpDue(): Promise<AmbassadorCandidate[]> {
    const now = new Date();
    return await db
      .select()
      .from(ambassadorCandidates)
      .where(
        and(
          isNotNull(ambassadorCandidates.nextFollowUpDate),
          lte(ambassadorCandidates.nextFollowUpDate, now),
          notInArray(ambassadorCandidates.status, ['confirmed', 'declined'])
        )
      )
      .orderBy(asc(ambassadorCandidates.nextFollowUpDate));
  }

  // Host Resources
  async getHostResources(): Promise<HostResource[]> {
    return await db
      .select()
      .from(hostResources)
      .where(eq(hostResources.isActive, true))
      .orderBy(asc(hostResources.category), asc(hostResources.sortOrder));
  }

  async getHostResource(id: number): Promise<HostResource | undefined> {
    const [resource] = await db
      .select()
      .from(hostResources)
      .where(eq(hostResources.id, id));
    return resource || undefined;
  }

  async createHostResource(data: InsertHostResource): Promise<HostResource> {
    const [resource] = await db
      .insert(hostResources)
      .values(data)
      .returning();
    return resource;
  }

  async updateHostResource(id: number, data: Partial<InsertHostResource>): Promise<HostResource | undefined> {
    const [resource] = await db
      .update(hostResources)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(hostResources.id, id))
      .returning();
    return resource || undefined;
  }

  async deleteHostResource(id: number): Promise<boolean> {
    const result = await db
      .delete(hostResources)
      .where(eq(hostResources.id, id));
    return (result.rowCount ?? 0) > 0;
  }
}
