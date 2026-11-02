import { Router, type Response } from 'express';
import path from 'path';
import { existsSync, createReadStream } from 'fs';
import type { IStorage } from '../storage';
import { isAuthenticated } from '../auth';
import { logger } from '../middleware/logger';
import { createStandardMiddleware, createErrorHandler } from '../middleware';
import { storage } from '../storage-wrapper';
import type { AuthenticatedRequest } from '../types/express';
import { hasPermission } from '@shared/unified-auth-utils';
import { PERMISSIONS } from '@shared/auth-utils';
import { ObjectStorageService, ObjectNotFoundError } from '../replit_integrations/object_storage';

const objectStorageService = new ObjectStorageService();

const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'text/plain',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'text/csv',
];

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

const documentsRouter = Router();

documentsRouter.use(createStandardMiddleware());

const errorHandler = createErrorHandler('documents');

const getUser = (req: AuthenticatedRequest) => {
  return req.user || req.session?.user;
};

// GET /api/documents - List all documents
documentsRouter.get(
  '/',
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const user = getUser(req);

      if (!user || !user.email) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const documents = await storage.getAllDocuments();

      const canViewConfidential = hasPermission(user, PERMISSIONS.DOCUMENTS_CONFIDENTIAL);

      const activeDocuments = documents.filter((doc) => {
        if (doc.isActive === false) return false;
        if (doc.category === 'confidential' && !canViewConfidential) return false;
        return true;
      });

      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');

      res.json(activeDocuments);
    } catch (error: any) {
      logger.error('Error fetching documents:', error);
      res.status(500).json({ error: 'Failed to fetch documents' });
    }
  }
);

// POST /api/documents/request-upload-url - Get presigned URL for upload
documentsRouter.post('/request-upload-url', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = getUser(req);
    if (!user || !user.email) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (user.role !== 'super_admin' && user.email !== 'admin@sandwich.project' && user.email !== 'katielong2316@gmail.com') {
      return res.status(403).json({ error: 'Only super admins can upload documents' });
    }

    const { name, size, contentType } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'File name is required' });
    }

    if (contentType && !ALLOWED_MIME_TYPES.includes(contentType)) {
      return res.status(400).json({ error: 'File type not supported' });
    }

    if (size && size > MAX_FILE_SIZE) {
      return res.status(400).json({ error: 'File exceeds maximum size of 100MB' });
    }

    const uploadURL = await objectStorageService.getObjectEntityUploadURL();
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);

    logger.info(`Document upload URL requested by ${user.email} for "${name}"`);

    res.json({
      uploadURL,
      objectPath,
      metadata: { name, size, contentType },
    });
  } catch (error: any) {
    logger.error('Error generating document upload URL:', error);
    res.status(500).json({ error: 'Failed to generate upload URL' });
  }
});

// POST /api/documents - Create document record (after file is uploaded to cloud)
documentsRouter.post('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = getUser(req);
    if (!user || !user.email) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (user.role !== 'super_admin' && user.email !== 'admin@sandwich.project' && user.email !== 'katielong2316@gmail.com') {
      return res.status(403).json({ error: 'Only super admins can create documents' });
    }

    const { title, description, category, fileName, originalName, fileSize, mimeType, objectPath } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'Title is required' });
    }

    if (!objectPath) {
      return res.status(400).json({ error: 'objectPath is required (upload file first)' });
    }

    logger.info(`Document record creation by ${user.email}: "${title}" (${originalName})`);

    const documentData = {
      title,
      description: description || null,
      fileName: fileName || originalName,
      originalName: originalName || fileName,
      filePath: objectPath,
      fileSize: fileSize || 0,
      mimeType: mimeType || 'application/octet-stream',
      category: category || 'general',
      isActive: true,
      uploadedBy: user.id,
      uploadedByName:
        user.firstName && user.lastName
          ? `${user.firstName} ${user.lastName}`
          : user.email,
    };

    const document = await storage.createDocument(documentData);

    logger.info(`Document created successfully: ID ${document.id} - "${document.title}"`);

    res.status(201).json({ document });
  } catch (error: any) {
    logger.error('Error creating document:', error);
    res.status(500).json({ error: 'Failed to create document' });
  }
});

// GET /api/documents/:id/preview - Preview document (inline display)
documentsRouter.get(
  '/:id/preview',
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const user = getUser(req);

      if (!user || !user.email) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const documentId = parseInt(req.params.id);

      if (isNaN(documentId)) {
        return res.status(400).json({ error: 'Invalid document ID' });
      }

      const documents = await storage.getAllDocuments();
      const document = documents.find((doc) => doc.id === documentId);

      if (!document) {
        return res.status(404).json({ error: 'Document not found' });
      }

      if (!document.isActive) {
        return res.status(403).json({ error: 'Document is not active' });
      }

      if (document.category === 'confidential' && !hasPermission(user, PERMISSIONS.DOCUMENTS_CONFIDENTIAL)) {
        return res.status(403).json({ error: 'You do not have permission to view confidential documents' });
      }

      if (document.filePath.startsWith('/objects/')) {
        try {
          const objectFile = await objectStorageService.getObjectEntityFile(document.filePath);

          res.setHeader('Content-Disposition', `inline; filename="${document.originalName}"`);
          res.setHeader('Content-Type', document.mimeType || 'application/octet-stream');
          res.setHeader('X-Content-Type-Options', 'nosniff');
          res.setHeader('Cache-Control', 'private, max-age=3600');

          const stream = objectFile.createReadStream();
          stream.on('error', (err) => {
            logger.error('Stream error during preview:', err);
            if (!res.headersSent) {
              res.status(500).json({ error: 'Error streaming file' });
            }
          });
          stream.pipe(res);
          return;
        } catch (error) {
          if (error instanceof ObjectNotFoundError) {
            logger.error(`Object not found in cloud storage: ${document.filePath}`);
            return res.status(404).json({ error: 'File not found in storage' });
          }
          throw error;
        }
      }

      if (!existsSync(document.filePath)) {
        logger.error(`File not found (neither cloud nor disk): ${document.filePath}`);
        return res.status(404).json({ error: 'File not found on server. This document may need to be re-uploaded.' });
      }

      res.setHeader('Content-Disposition', `inline; filename="${document.originalName}"`);
      res.setHeader('Content-Type', document.mimeType || 'application/octet-stream');
      res.setHeader('Content-Length', document.fileSize);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, max-age=3600');

      const fileStream = createReadStream(document.filePath);
      fileStream.on('error', (err) => {
        logger.error('Stream error during preview:', err);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Error streaming file' });
        }
      });
      fileStream.pipe(res);
    } catch (error: any) {
      logger.error('Error previewing document:', error);
      res.status(500).json({ error: 'Failed to preview document' });
    }
  }
);

// GET /api/documents/:id/download - Download specific document
documentsRouter.get(
  '/:id/download',
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const user = getUser(req);

      if (!user || !user.email) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const documentId = parseInt(req.params.id);

      if (isNaN(documentId)) {
        return res.status(400).json({ error: 'Invalid document ID' });
      }

      logger.info(
        `Document download attempt by ${user.email}: document ID ${documentId}`
      );

      const documents = await storage.getAllDocuments();
      const document = documents.find((doc) => doc.id === documentId);

      if (!document) {
        logger.warn(
          `Document not found: ID ${documentId} requested by ${user.email}`
        );
        return res.status(404).json({ error: 'Document not found' });
      }

      if (!document.isActive) {
        logger.warn(
          `Inactive document access attempt: ID ${documentId} by ${user.email}`
        );
        return res.status(403).json({ error: 'Document is not active' });
      }

      if (document.category === 'confidential' && !hasPermission(user, PERMISSIONS.DOCUMENTS_CONFIDENTIAL)) {
        logger.warn(`Unauthorized confidential document download attempt: ${user.email} for document ID ${documentId}`);
        return res.status(403).json({ error: 'You do not have permission to download confidential documents' });
      }

      logger.info(
        `Document download success: ${user.email} downloaded document ID ${documentId} - "${document.originalName}"`
      );

      if (document.filePath.startsWith('/objects/')) {
        try {
          const objectFile = await objectStorageService.getObjectEntityFile(document.filePath);

          res.setHeader('Content-Disposition', `attachment; filename="${document.originalName}"`);
          res.setHeader('Content-Type', document.mimeType || 'application/octet-stream');
          res.setHeader('X-Content-Type-Options', 'nosniff');

          const stream = objectFile.createReadStream();
          stream.on('error', (err) => {
            logger.error('Stream error during download:', err);
            if (!res.headersSent) {
              res.status(500).json({ error: 'Error streaming file' });
            }
          });
          stream.pipe(res);
          return;
        } catch (error) {
          if (error instanceof ObjectNotFoundError) {
            logger.error(`Object not found in cloud storage: ${document.filePath}`);
            return res.status(404).json({ error: 'File not found in storage' });
          }
          throw error;
        }
      }

      if (!existsSync(document.filePath)) {
        logger.error(`File not found (neither cloud nor disk): ${document.filePath}`);
        return res.status(404).json({ error: 'File not found on server. This document may need to be re-uploaded.' });
      }

      res.setHeader('Content-Disposition', `attachment; filename="${document.originalName}"`);
      res.setHeader('Content-Type', document.mimeType || 'application/octet-stream');
      res.setHeader('Content-Length', document.fileSize);

      const fileStream = createReadStream(document.filePath);
      fileStream.on('error', (err) => {
        logger.error('Stream error during download:', err);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Error streaming file' });
        }
      });
      fileStream.pipe(res);
    } catch (error: any) {
      logger.error('Error downloading document:', error);
      res.status(500).json({ error: 'Failed to download document' });
    }
  }
);

// DELETE /api/documents/:id - Delete document
documentsRouter.delete(
  '/:id',
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const user = getUser(req);

      if (!user || !user.email) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const documentId = parseInt(req.params.id);

      if (isNaN(documentId)) {
        return res.status(400).json({ error: 'Invalid document ID' });
      }

      logger.info(
        `Document delete attempt by ${user.email}: document ID ${documentId}`
      );

      const documents = await storage.getAllDocuments();
      const document = documents.find((doc) => doc.id === documentId);

      if (!document) {
        logger.warn(
          `Document not found for deletion: ID ${documentId} by ${user.email}`
        );
        return res.status(404).json({ error: 'Document not found' });
      }

      if (user.role !== 'super_admin' && user.email !== 'admin@sandwich.project' && user.email !== 'katielong2316@gmail.com') {
        logger.warn(
          `Unauthorized delete attempt: ${user.email} tried to delete document ID ${documentId}`
        );
        return res
          .status(403)
          .json({
            error: 'Only super admins can delete documents',
          });
      }

      const deleted = await storage.deleteDocument(documentId);

      if (!deleted) {
        logger.error(`Failed to soft delete document ID ${documentId}`);
        return res
          .status(500)
          .json({ error: 'Failed to delete document' });
      }

      logger.info(
        `Document soft deleted: ${user.email} deleted document ID ${documentId} - "${document.title}" (file preserved for recovery)`
      );

      res.json({
        success: true,
        message: 'Document deleted successfully'
      });
    } catch (error: any) {
      logger.error('Error deleting document:', error);
      res.status(500).json({ error: 'Failed to delete document' });
    }
  }
);

// PATCH /api/documents/:id - Update document metadata (title/description/category)
documentsRouter.patch(
  '/:id',
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const user = getUser(req);

      if (!user || !user.email) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const documentId = parseInt(req.params.id);
      if (isNaN(documentId)) {
        return res.status(400).json({ error: 'Invalid document ID' });
      }

      const document = await storage.getDocument(documentId);
      if (!document) {
        return res.status(404).json({ error: 'Document not found' });
      }

      // Auth: same rules as delete — super admins, the privileged accounts,
      // or the original uploader can edit metadata.
      const isPrivileged =
        user.role === 'super_admin' ||
        user.email === 'admin@sandwich.project' ||
        user.email === 'katielong2316@gmail.com';
      const isUploader = document.uploadedBy === user.id;
      if (!isPrivileged && !isUploader) {
        logger.warn(
          `Unauthorized document edit attempt: ${user.email} tried to edit document ID ${documentId}`
        );
        return res.status(403).json({
          error: 'You do not have permission to edit this document',
        });
      }

      // Only accept the metadata fields the UI can edit. Ignore anything else
      // the client sends to avoid letting people overwrite filePath / uploadedBy / etc.
      const { title, description, category } = req.body ?? {};
      const updates: { title?: string; description?: string | null; category?: string } = {};

      if (title !== undefined) {
        if (typeof title !== 'string' || title.trim() === '') {
          return res.status(400).json({ error: 'Title must be a non-empty string' });
        }
        updates.title = title.trim();
      }
      if (description !== undefined) {
        if (description !== null && typeof description !== 'string') {
          return res.status(400).json({ error: 'Description must be a string or null' });
        }
        updates.description = description === null ? null : description.trim();
      }
      if (category !== undefined) {
        if (typeof category !== 'string' || category.trim() === '') {
          return res.status(400).json({ error: 'Category must be a non-empty string' });
        }
        updates.category = category.trim();
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'No editable fields supplied' });
      }

      const updated = await storage.updateDocument(documentId, updates);
      if (!updated) {
        return res.status(500).json({ error: 'Failed to update document' });
      }

      logger.info(
        `Document updated by ${user.email}: ID ${documentId} fields=${Object.keys(updates).join(',')}`
      );

      res.json({ success: true, document: updated });
    } catch (error: any) {
      logger.error('Error updating document:', error);
      res.status(500).json({ error: 'Failed to update document' });
    }
  }
);

// GET /api/documents/:id/permissions - Get document permissions (stub for future implementation)
documentsRouter.get(
  '/:id/permissions',
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const user = getUser(req);

      if (!user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      res.json([]);
    } catch (error: any) {
      logger.error('Error fetching permissions:', error);
      res.status(500).json({ error: 'Failed to fetch permissions' });
    }
  }
);

// POST /api/documents/:id/permissions - Grant document permission (stub for future implementation)
documentsRouter.post(
  '/:id/permissions',
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const user = getUser(req);

      if (!user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      res.json({ success: true, message: 'Permissions feature coming soon' });
    } catch (error: any) {
      logger.error('Error granting permission:', error);
      res.status(500).json({ error: 'Failed to grant permission' });
    }
  }
);

// DELETE /api/documents/:id/permissions/:userId/:permissionType - Revoke permission (stub)
documentsRouter.delete(
  '/:id/permissions/:userId/:permissionType',
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const user = getUser(req);

      if (!user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      res.json({ success: true, message: 'Permissions feature coming soon' });
    } catch (error: any) {
      logger.error('Error revoking permission:', error);
      res.status(500).json({ error: 'Failed to revoke permission' });
    }
  }
);

// GET /api/documents/:id/access-logs - Get document access logs (stub for future implementation)
documentsRouter.get(
  '/:id/access-logs',
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const user = getUser(req);

      if (!user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      res.json([]);
    } catch (error: any) {
      logger.error('Error fetching access logs:', error);
      res.status(500).json({ error: 'Failed to fetch access logs' });
    }
  }
);

documentsRouter.use(errorHandler);

export default documentsRouter;
