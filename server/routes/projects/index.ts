import { Router, type Response } from 'express';
import {
  createProjectService,
  type ProjectService,
} from '../../services/projects';
import { createErrorHandler, projectFilesUpload } from '../../middleware';
import { logger } from '../../middleware/logger';
import type { IStorage } from '../../storage';
// REFACTOR: Import assignment services for new endpoints
import { projectAssignmentService, taskAssignmentService } from '../../services/assignments';
import type { AuthenticatedRequest } from '../../types/express';

// Factory function to create project routes
export default function createProjectRoutes(options: {
  storage: IStorage;
  isAuthenticated: any;
  requirePermission: any;
}): Router {
  const projectsRouter = Router();
  const { storage, isAuthenticated, requirePermission } = options;

  // Create project service instance
  const projectService = createProjectService(storage);

  // Error handling for this module (standard middleware applied at mount level)
  const errorHandler = createErrorHandler('projects');

  // Helper function to get user from request
  const getUser = (req: AuthenticatedRequest) => {
    return req.user || req.session?.user;
  };

  // GET / - List all projects
  projectsRouter.get('/', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const projects = await projectService.getAllProjects();
      res.json(projects);
    } catch (error) {
      logger.error('Failed to fetch projects', error);
      res.status(500).json({ message: 'Failed to fetch projects' });
    }
  });

  // GET /for-review - Get projects for review
  projectsRouter.get('/for-review', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const projects = await storage.getProjectsForReview();
      res.json(projects);
    } catch (error) {
      logger.error('Failed to get projects for review', error);
      res.json([]);
    }
  });

  // GET /archived - Get archived projects
  projectsRouter.get(
    '/archived',
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const archivedProjects = await projectService.getArchivedProjects();
        res.json(archivedProjects);
      } catch (error) {
        logger.error('Failed to fetch archived projects', error);
        res.status(500).json({ message: 'Failed to fetch archived projects' });
      }
    }
  );

  // POST / - Create new project
  projectsRouter.post(
    '/',
    isAuthenticated,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const user = getUser(req);
        if (!user) {
          return res.status(401).json({ message: 'Authentication required' });
        }

        const project = await projectService.createProject({
          data: req.body,
          user,
        });

        res.status(201).json(project);
      } catch (error) {
        logger.error('Failed to create project', error);

        const message =
          error instanceof Error ? error.message : 'Unknown error';
        const status = message.includes('Permission denied') ? 403 : 400;

        res.status(status).json({
          message: status === 403 ? message : 'Invalid project data',
          error: message,
        });
      }
    }
  );

  // POST /:id/claim - Claim a project
  projectsRouter.post(
    '/:id/claim',
    isAuthenticated,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const id = parseInt(req.params.id);
        const { assigneeName } = req.body;

        const updatedProject = await projectService.claimProject(
          id,
          assigneeName
        );

        if (!updatedProject) {
          return res.status(404).json({ message: 'Project not found' });
        }

        res.json(updatedProject);
      } catch (error) {
        logger.error('Failed to claim project', error);
        res.status(500).json({ message: 'Failed to claim project' });
      }
    }
  );

  // PUT /:id - Full project update (requires special permission)
  projectsRouter.put(
    '/:id',
    requirePermission('PROJECTS_EDIT_ALL'),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const id = parseInt(req.params.id);
        const user = getUser(req);

        if (!user) {
          return res.status(401).json({ message: 'Authentication required' });
        }

        const updatedProject = await projectService.updateProject({
          id,
          updates: req.body,
          user,
        });

        if (!updatedProject) {
          return res.status(404).json({ message: 'Project not found' });
        }

        res.json(updatedProject);
      } catch (error) {
        logger.error('Failed to update project', error);

        const message =
          error instanceof Error ? error.message : 'Failed to update project';
        const status = message.includes('Permission denied') ? 403 : 500;

        res.status(status).json({ message });
      }
    }
  );

  // PATCH /:id - Partial project update
  projectsRouter.patch(
    '/:id',
    isAuthenticated,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const id = parseInt(req.params.id);
        const updates = req.body;
        const user = getUser(req);

        console.log(`\n========== PATCH /api/projects/${id} ==========`);
        console.log('Request body (updates):', JSON.stringify(updates, null, 2));
        console.log('User:', user?.email);
        console.log('='.repeat(50) + '\n');

        logger.info(`[PATCH /api/projects/${id}] Request received`, {
          projectId: id,
          updates: updates,
          userId: user?.id,
          userEmail: user?.email,
        });

        if (!user) {
          return res.status(401).json({ message: 'Authentication required' });
        }

        if (isNaN(id)) {
          logger.error(`[PATCH /api/projects/${id}] Invalid project ID`);
          return res.status(400).json({ message: 'Invalid project ID' });
        }

        const updatedProject = await projectService.updateProject({
          id,
          updates,
          user,
        });

        if (!updatedProject) {
          logger.error(`[PATCH /api/projects/${id}] Project not found in database`);
          return res.status(404).json({ message: 'Project not found' });
        }

        logger.info(`[PATCH /api/projects/${id}] Successfully updated`);
        res.json(updatedProject);
      } catch (error) {
        logger.error(`[PATCH /api/projects/${req.params.id}] Failed to update project`, error);

        const message =
          error instanceof Error ? error.message : 'Failed to update project';
        const status = message.includes('Permission denied') ? 403 : 500;

        res.status(status).json({ message });
      }
    }
  );

  // DELETE /:id - Delete project
  projectsRouter.delete(
    '/:id',
    isAuthenticated,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const id = parseInt(req.params.id);
        const user = getUser(req);

        if (!user) {
          return res.status(401).json({ message: 'Authentication required' });
        }

        if (isNaN(id)) {
          return res.status(400).json({ message: 'Invalid project ID' });
        }

        const deleted = await projectService.deleteProject(id, user);
        if (!deleted) {
          return res.status(404).json({ message: 'Project not found' });
        }

        res.status(204).send();
      } catch (error) {
        logger.error('Failed to delete project', error);

        const message =
          error instanceof Error ? error.message : 'Failed to delete project';
        const status = message.includes('Permission denied') ? 403 : 500;

        res.status(status).json({ message });
      }
    }
  );

  // POST /:id/archive - Archive completed project
  projectsRouter.post(
    '/:id/archive',
    isAuthenticated,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const id = parseInt(req.params.id);
        const user = getUser(req);

        if (!user) {
          return res.status(401).json({ message: 'Authentication required' });
        }

        if (isNaN(id)) {
          return res.status(400).json({ message: 'Invalid project ID' });
        }

        const archived = await projectService.archiveProject(id, user);
        if (!archived) {
          return res.status(500).json({ message: 'Failed to archive project' });
        }

        res.json({ message: 'Project archived successfully' });
      } catch (error) {
        logger.error('Failed to archive project', error);

        const message =
          error instanceof Error ? error.message : 'Failed to archive project';
        const status = message.includes('Permission denied')
          ? 403
          : message.includes('not found')
            ? 404
            : message.includes('Only completed')
              ? 400
              : 500;

        res.status(status).json({ message });
      }
    }
  );

  // GET /:id - Get single project by ID
  projectsRouter.get(
    '/:id',
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) {
          return res.status(400).json({ message: 'Invalid project ID' });
        }

        const project = await projectService.getProjectById(id);
        if (!project) {
          return res.status(404).json({ message: 'Project not found' });
        }

        // REFACTOR: Include assignments from normalized table
        try {
          const assignments = await projectAssignmentService.getProjectAssignments(id);
          res.json({
            ...project,
            assignments,
          });
        } catch (assignmentError) {
          logger.error('Failed to fetch project assignments, returning project without assignments', assignmentError);
          res.json(project);
        }
      } catch (error) {
        logger.error('Failed to fetch project', error);
        res.status(500).json({ message: 'Failed to fetch project' });
      }
    }
  );

  // GET /:id/tasks - Get tasks for a project
  projectsRouter.get(
    '/:id/tasks',
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const projectId = parseInt(req.params.id);
        if (isNaN(projectId)) {
          return res.status(400).json({ message: 'Invalid project ID' });
        }

        const tasks = await projectService.getProjectTasks(projectId);

        // REFACTOR: Include assignments from normalized table for each task
        try {
          const tasksWithAssignments = await Promise.all(
            tasks.map(async (task) => {
              try {
                const assignments = await taskAssignmentService.getTaskAssignments(task.id);
                return {
                  ...task,
                  assignments,
                };
              } catch (err) {
                logger.error(`Failed to fetch assignments for task ${task.id}`, err);
                return task;
              }
            })
          );
          res.json(tasksWithAssignments);
        } catch (assignmentError) {
          logger.error('Failed to fetch task assignments, returning tasks without assignments', assignmentError);
          res.json(tasks);
        }
      } catch (error) {
        logger.error('Failed to fetch project tasks', error);
        res.status(500).json({ message: 'Failed to fetch tasks' });
      }
    }
  );

  // POST /:id/tasks - Create task for a project
  projectsRouter.post(
    '/:id/tasks',
    isAuthenticated,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const projectId = parseInt(req.params.id);
        const user = getUser(req);

        if (!user) {
          return res.status(401).json({ message: 'Authentication required' });
        }

        if (isNaN(projectId)) {
          return res.status(400).json({ message: 'Invalid project ID' });
        }

        const task = await projectService.createProjectTask(
          projectId,
          req.body,
          user
        );
        res.status(201).json(task);
      } catch (error) {
        logger.error('Failed to create project task', error);

        const message =
          error instanceof Error ? error.message : 'Failed to create task';
        const status = message.includes('Permission denied') ? 403 : 400;

        res.status(status).json({ message });
      }
    }
  );

  // POST /:id/files - Upload files for a project
  projectsRouter.post(
    '/:id/files',
    isAuthenticated,
    projectFilesUpload.array('files'),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const projectId = parseInt(req.params.id);
        const user = getUser(req);

        if (!user) {
          return res.status(401).json({ message: 'Authentication required' });
        }

        if (isNaN(projectId)) {
          return res.status(400).json({ message: 'Invalid project ID' });
        }

        const files = req.files as Express.Multer.File[];
        if (!files || files.length === 0) {
          return res.status(400).json({ message: 'No files uploaded' });
        }

        // Process uploaded files and return metadata
        const fileMetadata = files.map((file) => ({
          name: file.originalname,
          size: file.size,
          mimetype: file.mimetype,
          path: file.path,
          uploadedAt: new Date().toISOString(),
        }));

        res.status(201).json({
          message: 'Files uploaded successfully',
          files: fileMetadata,
        });
      } catch (error) {
        logger.error('Failed to upload project files', error);
        res.status(500).json({ message: 'Failed to upload files' });
      }
    }
  );

  // GET /:id/files - Get project files
  projectsRouter.get(
    '/:id/files',
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const projectId = parseInt(req.params.id);
        if (isNaN(projectId)) {
          return res.status(400).json({ message: 'Invalid project ID' });
        }

        // TODO: Implement actual file retrieval from storage
        // For now, return empty array as the original route does
        res.json([]);
      } catch (error) {
        logger.error('Failed to fetch project files', error);
        res.status(500).json({ message: 'Failed to fetch files' });
      }
    }
  );

  // POST /:id/assignments - Add assignment to project
  projectsRouter.post(
    '/:id/assignments',
    isAuthenticated,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const projectId = parseInt(req.params.id);
        const user = getUser(req);

        if (!user) {
          return res.status(401).json({ message: 'Authentication required' });
        }

        if (isNaN(projectId)) {
          return res.status(400).json({ message: 'Invalid project ID' });
        }

        const { userId, userName, role } = req.body;

        if (!userId || !userName || !role) {
          return res.status(400).json({
            message: 'Missing required fields: userId, userName, and role are required'
          });
        }

        if (role !== 'owner' && role !== 'support') {
          return res.status(400).json({
            message: 'Invalid role. Must be either "owner" or "support"'
          });
        }

        const assignment = await projectAssignmentService.addAssignment(
          projectId,
          userId,
          role,
          user.id
        );

        logger.info('Successfully added project assignment', {
          projectId,
          userId,
          role,
          addedBy: user.id
        });

        res.status(201).json(assignment);
      } catch (error) {
        logger.error('Failed to add project assignment', error);
        res.status(500).json({ message: 'Failed to add project assignment' });
      }
    }
  );

  // DELETE /:id/assignments/:userId - Remove assignment from project
  projectsRouter.delete(
    '/:id/assignments/:userId',
    isAuthenticated,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const projectId = parseInt(req.params.id);
        const { userId } = req.params;
        const user = getUser(req);

        if (!user) {
          return res.status(401).json({ message: 'Authentication required' });
        }

        if (isNaN(projectId)) {
          return res.status(400).json({ message: 'Invalid project ID' });
        }

        if (!userId) {
          return res.status(400).json({ message: 'User ID is required' });
        }

        const success = await projectAssignmentService.removeAssignment(projectId, userId);

        if (!success) {
          return res.status(404).json({ message: 'Assignment not found' });
        }

        logger.info('Successfully removed project assignment', {
          projectId,
          userId,
          removedBy: user.id
        });

        res.status(204).send();
      } catch (error) {
        logger.error('Failed to remove project assignment', error);
        res.status(500).json({ message: 'Failed to remove project assignment' });
      }
    }
  );

  // GET /:id/assignments - Get all assignments for a project
  projectsRouter.get(
    '/:id/assignments',
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const projectId = parseInt(req.params.id);

        if (isNaN(projectId)) {
          return res.status(400).json({ message: 'Invalid project ID' });
        }

        const assignments = await projectAssignmentService.getProjectAssignments(projectId);

        logger.info('Successfully fetched project assignments', {
          projectId,
          count: assignments.length
        });

        res.json(assignments);
      } catch (error) {
        logger.error('Failed to fetch project assignments', error);
        res.status(500).json({ message: 'Failed to fetch project assignments' });
      }
    }
  );

  // GET /standalone-tasks - Get all standalone tasks (not tied to any project)
  projectsRouter.get('/standalone-tasks', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { db } = await import('../db');
      const { projectTasks, users } = await import('../../shared/schema');
      const { isNull, eq, desc } = await import('drizzle-orm');

      logger.info('Fetching standalone tasks');

      // Fetch tasks where projectId is null
      const standaloneTasks = await db
        .select({
          id: projectTasks.id,
          projectId: projectTasks.projectId,
          title: projectTasks.title,
          description: projectTasks.description,
          status: projectTasks.status,
          priority: projectTasks.priority,
          assigneeId: projectTasks.assigneeId,
          assigneeName: projectTasks.assigneeName,
          assigneeIds: projectTasks.assigneeIds,
          assigneeNames: projectTasks.assigneeNames,
          dueDate: projectTasks.dueDate,
          completedAt: projectTasks.completedAt,
          originType: projectTasks.originType,
          sourceTeamBoardId: projectTasks.sourceTeamBoardId,
          createdAt: projectTasks.createdAt,
          updatedAt: projectTasks.updatedAt,
        })
        .from(projectTasks)
        .where(isNull(projectTasks.projectId))
        .orderBy(desc(projectTasks.createdAt));

      logger.info(`Found ${standaloneTasks.length} standalone tasks`);

      res.json(standaloneTasks);
    } catch (error) {
      logger.error('Failed to fetch standalone tasks', error);
      res.status(500).json({ message: 'Failed to fetch standalone tasks' });
    }
  });

  // PATCH /standalone-tasks/:id - Update a standalone task
  projectsRouter.patch('/standalone-tasks/:id', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const taskId = parseInt(req.params.id);
      if (isNaN(taskId)) {
        return res.status(400).json({ message: 'Invalid task ID' });
      }

      const { db } = await import('../db');
      const { projectTasks } = await import('../../shared/schema');
      const { eq, isNull, and } = await import('drizzle-orm');

      const { status, priority, title, description, dueDate, assigneeIds, assigneeNames } = req.body;

      logger.info('Updating standalone task', { taskId, updates: req.body });

      // Build update object
      const updates: any = {
        updatedAt: new Date(),
      };

      if (status) updates.status = status;
      if (priority) updates.priority = priority;
      if (title) updates.title = title;
      if (description !== undefined) updates.description = description;
      if (dueDate !== undefined) updates.dueDate = dueDate;
      if (assigneeIds !== undefined) updates.assigneeIds = assigneeIds;
      if (assigneeNames !== undefined) updates.assigneeNames = assigneeNames;
      if (status === 'completed') updates.completedAt = new Date();

      // Update the task (only if it's standalone)
      const [updatedTask] = await db
        .update(projectTasks)
        .set(updates)
        .where(and(eq(projectTasks.id, taskId), isNull(projectTasks.projectId)))
        .returning();

      if (!updatedTask) {
        return res.status(404).json({ message: 'Standalone task not found' });
      }

      logger.info('Successfully updated standalone task', { taskId });
      res.json(updatedTask);
    } catch (error) {
      logger.error('Failed to update standalone task', error);
      res.status(500).json({ message: 'Failed to update standalone task' });
    }
  });

  // DELETE /standalone-tasks/:id - Delete a standalone task
  projectsRouter.delete('/standalone-tasks/:id', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const taskId = parseInt(req.params.id);
      if (isNaN(taskId)) {
        return res.status(400).json({ message: 'Invalid task ID' });
      }

      const { db } = await import('../db');
      const { projectTasks } = await import('../../shared/schema');
      const { eq, isNull, and } = await import('drizzle-orm');

      logger.info('Deleting standalone task', { taskId });

      // Delete the task (only if it's standalone)
      const [deletedTask] = await db
        .delete(projectTasks)
        .where(and(eq(projectTasks.id, taskId), isNull(projectTasks.projectId)))
        .returning();

      if (!deletedTask) {
        return res.status(404).json({ message: 'Standalone task not found' });
      }

      logger.info('Successfully deleted standalone task', { taskId });
      res.json({ success: true, message: 'Task deleted' });
    } catch (error) {
      logger.error('Failed to delete standalone task', error);
      res.status(500).json({ message: 'Failed to delete standalone task' });
    }
  });

  // Apply error handling middleware
  projectsRouter.use(errorHandler);

  return projectsRouter;
}

// Standalone router creation for direct use
export function createStandaloneProjectRoutes(
  storage: IStorage,
  middleware: {
    isAuthenticated: any;
    requirePermission: any;
  }
): Router {
  return createProjectRoutes({
    storage,
    isAuthenticated: middleware.isAuthenticated,
    requirePermission: middleware.requirePermission,
  });
}
