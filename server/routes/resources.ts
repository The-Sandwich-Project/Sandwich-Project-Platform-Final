import { Router, type Response } from 'express';
import { eq, and, desc, asc, sql, or, like, inArray } from 'drizzle-orm';
import { db } from '../db';
import {
  resources,
  userResourceFavorites,
  resourceTags,
  resourceTagAssignments,
  documents,
  users,
} from '../../shared/schema';
import { isAuthenticated } from '../auth';
import { hasPermission } from '@shared/unified-auth-utils';
import { PERMISSIONS } from '@shared/auth-utils';
import { logger } from '../middleware/logger';
import { createStandardMiddleware, createErrorHandler } from '../middleware';
import type { AuthenticatedRequest } from '../types/express';

// Create resources router
const resourcesRouter = Router();

// Apply standard middleware (authentication, logging, sanitization)
resourcesRouter.use(createStandardMiddleware());

// Error handling for this module
const errorHandler = createErrorHandler('resources');

/**
 * A file resource is only listed while its linked document is active and, if
 * that document is confidential, only to users who may see confidential
 * documents — evaluated live, so a document marked confidential or deactivated
 * after its resource was created stops leaking its title/description here.
 * Same rules as GET /api/documents.
 */
function linkedDocumentVisible(user: Parameters<typeof hasPermission>[0]) {
  const canViewConfidential = hasPermission(user, PERMISSIONS.DOCUMENTS_CONFIDENTIAL);
  // Only file resources are gated: a resource converted from file to link
  // can keep its old document_id, and that stale link mustn't hide it.
  return sql`(${resources.type} <> 'file' OR ${resources.documentId} IS NULL OR EXISTS (
    SELECT 1 FROM ${documents} AS linked_doc
    WHERE linked_doc.id = ${resources.documentId}
      AND linked_doc.is_active = true
      ${canViewConfidential ? sql`` : sql`AND linked_doc.category <> 'confidential'`}
  ))`;
}

// Helper function to get user from request
const getUser = (req: AuthenticatedRequest) => {
  return req.user || req.session?.user;
};

// Helper function to check if user is admin.
// Admin and super_admin both get full management access; anyone else needs the
// explicit 'manage_resources' permission.
const isAdmin = (req: AuthenticatedRequest): boolean => {
  const user = getUser(req);
  return (
    user?.role === 'admin' ||
    user?.role === 'super_admin' ||
    user?.permissions?.includes('manage_resources') ||
    false
  );
};

// GET /api/resources - Get all resources with filtering and search
resourcesRouter.get(
  '/',
  isAuthenticated,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const user = getUser(req);
      if (!user) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const {
        category,
        type,
        search,
        tags: tagsParam,
        sort = 'smart',
        limit = 100,
      } = req.query;

      // Build query conditions
      const conditions: any[] = [eq(resources.isActive, true), linkedDocumentVisible(user)];

      if (category) {
        conditions.push(eq(resources.category, category as string));
      }

      if (type) {
        conditions.push(eq(resources.type, type as string));
      }

      if (search) {
        const searchTerm = `%${search}%`;
        conditions.push(
          or(
            like(resources.title, searchTerm),
            like(resources.description, searchTerm)
          )
        );
      }

      // Base query
      let query = db
        .select({
          resource: resources,
          isFavorite: sql<boolean>`EXISTS (
            SELECT 1 FROM ${userResourceFavorites}
            WHERE ${userResourceFavorites.userId} = ${user.id}
            AND ${userResourceFavorites.resourceId} = ${resources.id}
          )`,
          tags: sql<any>`COALESCE(
            json_agg(
              DISTINCT jsonb_build_object(
                'id', ${resourceTags.id},
                'name', ${resourceTags.name},
                'color', ${resourceTags.color}
              )
            ) FILTER (WHERE ${resourceTags.id} IS NOT NULL),
            '[]'
          )`,
          document: sql<any>`
            CASE
              WHEN ${documents.id} IS NOT NULL THEN
                jsonb_build_object(
                  'id', ${documents.id},
                  'mimeType', ${documents.mimeType},
                  'originalName', ${documents.originalName},
                  'fileSize', ${documents.fileSize}
                )
              ELSE NULL
            END
          `,
        })
        .from(resources)
        .leftJoin(documents, eq(resources.documentId, documents.id))
        .leftJoin(
          resourceTagAssignments,
          eq(resources.id, resourceTagAssignments.resourceId)
        )
        .leftJoin(resourceTags, eq(resourceTagAssignments.tagId, resourceTags.id))
        .where(and(...conditions))
        .groupBy(resources.id, documents.id, documents.mimeType, documents.originalName, documents.fileSize);

      // Apply sorting
      switch (sort) {
        case 'smart': // Pinned → Most Used → Recent → Alphabetical
          query = query.orderBy(
            desc(resources.isPinnedGlobal),
            asc(resources.pinnedOrder),
            desc(resources.accessCount),
            desc(resources.lastAccessedAt),
            asc(resources.title)
          );
          break;
        case 'recent':
          query = query.orderBy(desc(resources.lastAccessedAt));
          break;
        case 'popular':
          query = query.orderBy(desc(resources.accessCount));
          break;
        case 'alphabetical':
          query = query.orderBy(asc(resources.title));
          break;
        case 'newest':
          query = query.orderBy(desc(resources.createdAt));
          break;
        default:
          query = query.orderBy(asc(resources.title));
      }

      query = query.limit(Number(limit));

      const results = await query;

      // Filter by tags if specified
      let filteredResults = results;
      if (tagsParam) {
        const tagNames = (tagsParam as string).split(',');
        filteredResults = results.filter((r: any) =>
          r.tags.some((tag: any) => tagNames.includes(tag.name))
        );
      }

      res.json(filteredResults);
    } catch (error) {
      logger.error('Error fetching resources:', error);
      errorHandler(error, req as Request, res);
    }
  }
);

// ============================================
// SPECIFIC STRING ROUTES (MUST COME BEFORE PARAMETERIZED ROUTES)
// ============================================

// GET /api/resources/user/favorites - Get user's favorite resources
resourcesRouter.get(
  '/user/favorites',
  isAuthenticated,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const user = getUser(req);
      if (!user) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const favorites = await db
        .select({
          resource: resources,
          favoritedAt: userResourceFavorites.createdAt,
          tags: sql<any>`COALESCE(
            json_agg(
              DISTINCT jsonb_build_object(
                'id', ${resourceTags.id},
                'name', ${resourceTags.name},
                'color', ${resourceTags.color}
              )
            ) FILTER (WHERE ${resourceTags.id} IS NOT NULL),
            '[]'
          )`,
          document: sql<any>`
            CASE
              WHEN ${documents.id} IS NOT NULL THEN
                jsonb_build_object(
                  'id', ${documents.id},
                  'mimeType', ${documents.mimeType},
                  'originalName', ${documents.originalName},
                  'fileSize', ${documents.fileSize}
                )
              ELSE NULL
            END
          `,
        })
        .from(userResourceFavorites)
        .innerJoin(resources, eq(userResourceFavorites.resourceId, resources.id))
        .leftJoin(documents, eq(resources.documentId, documents.id))
        .leftJoin(
          resourceTagAssignments,
          eq(resources.id, resourceTagAssignments.resourceId)
        )
        .leftJoin(resourceTags, eq(resourceTagAssignments.tagId, resourceTags.id))
        .where(
          and(
            eq(userResourceFavorites.userId, user.id),
            eq(resources.isActive, true),
            linkedDocumentVisible(user)
          )
        )
        .groupBy(resources.id, userResourceFavorites.createdAt, documents.id, documents.mimeType, documents.originalName, documents.fileSize)
        .orderBy(desc(userResourceFavorites.createdAt));

      res.json(favorites);
    } catch (error) {
      logger.error('Error fetching favorites:', error);
      errorHandler(error, req as Request, res);
    }
  }
);

// GET /api/resources/user/recent - Get user's recently accessed resources
resourcesRouter.get(
  '/user/recent',
  isAuthenticated,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const user = getUser(req);
      if (!user) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const limit = parseInt((req.query.limit as string) || '5');

      const recent = await db
        .select({
          resource: resources,
          lastAccessed: resources.lastAccessedAt,
          tags: sql<any>`COALESCE(
            json_agg(
              DISTINCT jsonb_build_object(
                'id', ${resourceTags.id},
                'name', ${resourceTags.name},
                'color', ${resourceTags.color}
              )
            ) FILTER (WHERE ${resourceTags.id} IS NOT NULL),
            '[]'
          )`,
          document: sql<any>`
            CASE
              WHEN ${documents.id} IS NOT NULL THEN
                jsonb_build_object(
                  'id', ${documents.id},
                  'mimeType', ${documents.mimeType},
                  'originalName', ${documents.originalName},
                  'fileSize', ${documents.fileSize}
                )
              ELSE NULL
            END
          `,
        })
        .from(resources)
        .leftJoin(documents, eq(resources.documentId, documents.id))
        .leftJoin(
          resourceTagAssignments,
          eq(resources.id, resourceTagAssignments.resourceId)
        )
        .leftJoin(resourceTags, eq(resourceTagAssignments.tagId, resourceTags.id))
        .where(
          and(
            eq(resources.isActive, true),
            sql`${resources.lastAccessedAt} IS NOT NULL`,
            linkedDocumentVisible(user)
          )
        )
        .groupBy(resources.id, documents.id, documents.mimeType, documents.originalName, documents.fileSize)
        .orderBy(desc(resources.lastAccessedAt))
        .limit(limit);

      res.json(recent);
    } catch (error) {
      logger.error('Error fetching recent resources:', error);
      errorHandler(error, req as Request, res);
    }
  }
);

// GET /api/resources/tags/all - Get all tags
resourcesRouter.get(
  '/tags/all',
  isAuthenticated,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const user = getUser(req);
      if (!user) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const tags = await db
        .select({
          tag: resourceTags,
          usageCount: sql<number>`COUNT(${resourceTagAssignments.id})`,
        })
        .from(resourceTags)
        .leftJoin(
          resourceTagAssignments,
          eq(resourceTags.id, resourceTagAssignments.tagId)
        )
        .groupBy(resourceTags.id)
        .orderBy(asc(resourceTags.name));

      res.json(tags);
    } catch (error) {
      logger.error('Error fetching tags:', error);
      errorHandler(error, req as Request, res);
    }
  }
);

// POST /api/resources/tags - Create new tag (admin only)
resourcesRouter.post(
  '/tags',
  isAuthenticated,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const user = getUser(req);
      if (!user) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      if (!isAdmin(req)) {
        return res.status(403).json({ error: 'Forbidden - Admin access required' });
      }

      const { name, color, description } = req.body;

      if (!name) {
        return res.status(400).json({ error: 'Tag name is required' });
      }

      const [newTag] = await db
        .insert(resourceTags)
        .values({
          name,
          color: color || null,
          description: description || null,
          createdBy: user.id,
        })
        .returning();

      logger.info(`Tag created: ${name} by ${user.email}`);
      res.status(201).json(newTag);
    } catch (error) {
      logger.error('Error creating tag:', error);
      errorHandler(error, req as Request, res);
    }
  }
);

// ============================================
// PARAMETERIZED ROUTES (MUST COME AFTER SPECIFIC STRING ROUTES)
// ============================================

// GET /api/resources/:id - Get specific resource
resourcesRouter.get(
  '/:id',
  isAuthenticated,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const user = getUser(req);
      if (!user) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const resourceId = parseInt(req.params.id);

      const result = await db
        .select({
          resource: resources,
          isFavorite: sql<boolean>`EXISTS (
            SELECT 1 FROM ${userResourceFavorites}
            WHERE ${userResourceFavorites.userId} = ${user.id}
            AND ${userResourceFavorites.resourceId} = ${resources.id}
          )`,
          tags: sql<any>`COALESCE(
            json_agg(
              DISTINCT jsonb_build_object(
                'id', ${resourceTags.id},
                'name', ${resourceTags.name},
                'color', ${resourceTags.color}
              )
            ) FILTER (WHERE ${resourceTags.id} IS NOT NULL),
            '[]'
          )`,
        })
        .from(resources)
        .leftJoin(
          resourceTagAssignments,
          eq(resources.id, resourceTagAssignments.resourceId)
        )
        .leftJoin(resourceTags, eq(resourceTagAssignments.tagId, resourceTags.id))
        .where(and(eq(resources.id, resourceId), linkedDocumentVisible(user)))
        .groupBy(resources.id)
        .limit(1);

      if (result.length === 0) {
        return res.status(404).json({ error: 'Resource not found' });
      }

      res.json(result[0]);
    } catch (error) {
      logger.error('Error fetching resource:', error);
      errorHandler(error, req as Request, res);
    }
  }
);

// POST /api/resources - Create new resource (admin only)
resourcesRouter.post(
  '/',
  isAuthenticated,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const user = getUser(req);
      if (!user) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      if (!isAdmin(req)) {
        return res.status(403).json({ error: 'Forbidden - Admin access required' });
      }

      const {
        title,
        description,
        type,
        category,
        documentId,
        url,
        icon,
        iconColor,
        isPinnedGlobal,
        pinnedOrder,
        tags: tagIds,
      } = req.body;

      // Validate required fields
      if (!title || !type || !category) {
        return res.status(400).json({
          error: 'Missing required fields: title, type, category',
        });
      }

      // Validate type-specific requirements
      if (type === 'file' && !documentId) {
        return res.status(400).json({
          error: 'documentId is required for file type resources',
        });
      }

      if ((type === 'link' || type === 'google_drive') && !url) {
        return res.status(400).json({
          error: 'url is required for link type resources',
        });
      }

      const userName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email;

      // Insert resource
      const [newResource] = await db
        .insert(resources)
        .values({
          title,
          description,
          type,
          category,
          documentId: documentId || null,
          url: url || null,
          icon: icon || null,
          iconColor: iconColor || null,
          isPinnedGlobal: isPinnedGlobal || false,
          pinnedOrder: pinnedOrder || null,
          createdBy: user.id,
          createdByName: userName,
        })
        .returning();

      // Assign tags if provided
      if (tagIds && Array.isArray(tagIds) && tagIds.length > 0) {
        await db.insert(resourceTagAssignments).values(
          tagIds.map((tagId: number) => ({
            resourceId: newResource.id,
            tagId,
          }))
        );
      }

      logger.info(`Resource created: ${title} by ${user.email}`);
      res.status(201).json(newResource);
    } catch (error) {
      logger.error('Error creating resource:', error);
      errorHandler(error, req as Request, res);
    }
  }
);

// PUT /api/resources/:id - Update resource (admin only)
resourcesRouter.put(
  '/:id',
  isAuthenticated,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const user = getUser(req);
      if (!user) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      if (!isAdmin(req)) {
        return res.status(403).json({ error: 'Forbidden - Admin access required' });
      }

      const resourceId = parseInt(req.params.id);
      const {
        title,
        description,
        category,
        type,
        url,
        documentId,
        icon,
        iconColor,
        isPinnedGlobal,
        pinnedOrder,
        isActive,
        tags: tagIds,
      } = req.body;

      const updateData: any = {
        updatedAt: new Date(),
      };

      if (title !== undefined) updateData.title = title;
      if (description !== undefined) updateData.description = description;
      if (category !== undefined) updateData.category = category;
      if (type !== undefined) updateData.type = type;
      if (documentId !== undefined) updateData.documentId = documentId;
      if (url !== undefined) updateData.url = url;
      if (icon !== undefined) updateData.icon = icon;
      if (iconColor !== undefined) updateData.iconColor = iconColor;
      if (isPinnedGlobal !== undefined) updateData.isPinnedGlobal = isPinnedGlobal;
      if (pinnedOrder !== undefined) updateData.pinnedOrder = pinnedOrder;
      if (isActive !== undefined) updateData.isActive = isActive;

      // Update the resource
      const [updatedResource] = await db
        .update(resources)
        .set(updateData)
        .where(eq(resources.id, resourceId))
        .returning();

      if (!updatedResource) {
        return res.status(404).json({ error: 'Resource not found' });
      }

      // Handle tag updates if tags array is provided
      if (tagIds !== undefined && Array.isArray(tagIds)) {
        // Delete existing tag assignments
        await db
          .delete(resourceTagAssignments)
          .where(eq(resourceTagAssignments.resourceId, resourceId));

        // Insert new tag assignments
        if (tagIds.length > 0) {
          await db.insert(resourceTagAssignments).values(
            tagIds.map((tagId: number) => ({
              resourceId,
              tagId,
            }))
          );
        }

        logger.info(
          `Resource ${resourceId} tags updated: ${tagIds.length} tags assigned by ${user.email}`
        );
      }

      logger.info(`Resource updated: ${resourceId} by ${user.email}`);
      res.json(updatedResource);
    } catch (error) {
      logger.error('Error updating resource:', error);
      errorHandler(error, req as Request, res);
    }
  }
);

// DELETE /api/resources/:id - Delete resource (admin only)
resourcesRouter.delete(
  '/:id',
  isAuthenticated,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const user = getUser(req);
      if (!user) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      if (!isAdmin(req)) {
        return res.status(403).json({ error: 'Forbidden - Admin access required' });
      }

      const resourceId = parseInt(req.params.id);

      // Soft delete by marking as inactive
      const [deletedResource] = await db
        .update(resources)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(resources.id, resourceId))
        .returning();

      if (!deletedResource) {
        return res.status(404).json({ error: 'Resource not found' });
      }

      logger.info(`Resource deleted: ${resourceId} by ${user.email}`);
      res.json({ message: 'Resource deleted successfully' });
    } catch (error) {
      logger.error('Error deleting resource:', error);
      errorHandler(error, req as Request, res);
    }
  }
);

// POST /api/resources/:id/access - Track resource access
resourcesRouter.post(
  '/:id/access',
  isAuthenticated,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const user = getUser(req);
      if (!user) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const resourceId = parseInt(req.params.id);

      // Update access count and last accessed time
      await db
        .update(resources)
        .set({
          accessCount: sql`${resources.accessCount} + 1`,
          lastAccessedAt: new Date(),
        })
        .where(eq(resources.id, resourceId));

      res.json({ message: 'Access tracked' });
    } catch (error) {
      logger.error('Error tracking resource access:', error);
      errorHandler(error, req as Request, res);
    }
  }
);

// POST /api/resources/:id/favorite - Toggle favorite status
resourcesRouter.post(
  '/:id/favorite',
  isAuthenticated,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const user = getUser(req);
      if (!user) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const resourceId = parseInt(req.params.id);

      // Check if already favorited
      const existing = await db
        .select()
        .from(userResourceFavorites)
        .where(
          and(
            eq(userResourceFavorites.userId, user.id),
            eq(userResourceFavorites.resourceId, resourceId)
          )
        )
        .limit(1);

      if (existing.length > 0) {
        // Remove favorite
        await db
          .delete(userResourceFavorites)
          .where(
            and(
              eq(userResourceFavorites.userId, user.id),
              eq(userResourceFavorites.resourceId, resourceId)
            )
          );

        res.json({ isFavorite: false, message: 'Removed from favorites' });
      } else {
        // Add favorite
        await db.insert(userResourceFavorites).values({
          userId: user.id,
          resourceId,
        });

        res.json({ isFavorite: true, message: 'Added to favorites' });
      }
    } catch (error) {
      logger.error('Error toggling favorite:', error);
      errorHandler(error, req as Request, res);
    }
  }
);

// POST /api/resources/:id/tags/:tagId - Assign tag to resource (admin only)
resourcesRouter.post(
  '/:id/tags/:tagId',
  isAuthenticated,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const user = getUser(req);
      if (!user) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      if (!isAdmin(req)) {
        return res.status(403).json({ error: 'Forbidden - Admin access required' });
      }

      const resourceId = parseInt(req.params.id);
      const tagId = parseInt(req.params.tagId);

      // Check if assignment already exists
      const existing = await db
        .select()
        .from(resourceTagAssignments)
        .where(
          and(
            eq(resourceTagAssignments.resourceId, resourceId),
            eq(resourceTagAssignments.tagId, tagId)
          )
        )
        .limit(1);

      if (existing.length > 0) {
        return res.status(400).json({ error: 'Tag already assigned to this resource' });
      }

      await db.insert(resourceTagAssignments).values({
        resourceId,
        tagId,
      });

      logger.info(`Tag ${tagId} assigned to resource ${resourceId} by ${user.email}`);
      res.json({ message: 'Tag assigned successfully' });
    } catch (error) {
      logger.error('Error assigning tag:', error);
      errorHandler(error, req as Request, res);
    }
  }
);

// DELETE /api/resources/:id/tags/:tagId - Remove tag from resource (admin only)
resourcesRouter.delete(
  '/:id/tags/:tagId',
  isAuthenticated,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const user = getUser(req);
      if (!user) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      if (!isAdmin(req)) {
        return res.status(403).json({ error: 'Forbidden - Admin access required' });
      }

      const resourceId = parseInt(req.params.id);
      const tagId = parseInt(req.params.tagId);

      await db
        .delete(resourceTagAssignments)
        .where(
          and(
            eq(resourceTagAssignments.resourceId, resourceId),
            eq(resourceTagAssignments.tagId, tagId)
          )
        );

      logger.info(`Tag ${tagId} removed from resource ${resourceId} by ${user.email}`);
      res.json({ message: 'Tag removed successfully' });
    } catch (error) {
      logger.error('Error removing tag:', error);
      errorHandler(error, req as Request, res);
    }
  }
);

export default resourcesRouter;
