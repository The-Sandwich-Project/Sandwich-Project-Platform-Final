import * as fs from 'fs';
import * as path from 'path';
import { inArray, eq } from 'drizzle-orm';
import { db } from '../db';
import { documents } from '@shared/schema';
import {
  ObjectStorageService,
  ObjectNotFoundError,
} from '../replit_integrations/object_storage';
import { logger } from './production-safe-logger';
import { hasPermission } from '@shared/unified-auth-utils';
import { PERMISSIONS } from '@shared/auth-utils';

/**
 * Resolves email attachment references (document IDs, `/objects/...` storage
 * paths, legacy `uploads/documents/<hash>` refs, local file paths) into
 * base64 attachments SendGrid can send directly.
 *
 * Why this exists: the SendGrid helper only reads local disk and silently
 * skips anything missing. Document records that live in object storage
 * (`/objects/uploads/...`) were being dropped, so toolkit emails could go out
 * without the PDFs the sender selected. Callers should refuse to send when
 * `failed` is non-empty.
 */

export interface ResolvedAttachment {
  content: string;
  filename: string;
  type: string;
  disposition: 'attachment';
}

export interface FailedAttachment {
  ref: string;
  /** Human-readable name to show the sender. */
  name: string;
  reason: string;
}

export interface AttachmentResolution {
  resolved: ResolvedAttachment[];
  failed: FailedAttachment[];
}

export interface ResolveAttachmentOptions {
  /** The authenticated sender; used for confidential-document checks. */
  user: Parameters<typeof hasPermission>[0];
}

/** Builds the sender-facing error message for failed attachments. */
export function describeFailedAttachments(failed: FailedAttachment[]): string {
  const names = failed.map((f) => `${f.name} (${f.reason})`).join('; ');
  return `Email not sent. Couldn't attach: ${names}. Remove ${
    failed.length === 1 ? 'it' : 'them'
  } or re-upload the document and try again.`;
}

class AttachmentDeniedError extends Error {}

type AttachmentRef =
  | string
  | number
  | { filePath: string; originalName?: string };

// Legacy document hashes that map to PDFs bundled in attached_assets/.
const LEGACY_HASH_MAP: Record<string, { file: string; name: string }> = {
  '015b0f68ddb511633e7696caab59bfa7': {
    file: 'attached_assets/20260506-TSP-Food+Safety+Volunteers.pdf',
    name: 'Food Safety Guide for Volunteers.pdf',
  },
  '3e375509b08b20265abdfa6afe632982': {
    file: 'attached_assets/PBJ Sandwich Making 2 101 03172026.pdf',
    name: 'PBJ Sandwich Making 101.pdf',
  },
  '56687eca96492549ba09d1bda0e5e6e0': {
    file: 'attached_assets/Deli Sandwich Making 101 03172026.pdf',
    name: 'Deli Sandwich Making 101.pdf',
  },
  '075839360400adce8b79a6a58a96dcfc': {
    file: 'attached_assets/Deli Labels_1756865384146.pdf',
    name: 'Deli Sandwich Labels.pdf',
  },
  a9458021b23fca8d76e674597c691876: {
    file: 'attached_assets/PBJ Labels_1756865384146.pdf',
    name: 'PBJ Sandwich Labels.pdf',
  },
};

const CONTENT_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx':
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.txt': 'text/plain',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

function contentTypeFor(filename: string, fallback?: string | null): string {
  return (
    fallback ||
    CONTENT_TYPES[path.extname(filename).toLowerCase()] ||
    'application/octet-stream'
  );
}

function resolveLocalPath(p: string): string {
  if (p.startsWith('/uploads/')) return path.join(process.cwd(), p.substring(1));
  if (path.isAbsolute(p)) return p;
  return path.join(process.cwd(), p);
}

// Only files under these folders (relative to the app root) may be attached.
// Without this, any path string — e.g. `.env` — could be read and emailed.
const ALLOWED_LOCAL_ROOTS = ['uploads', 'server/uploads', 'public', 'attached_assets'];
const CONFIDENTIAL_LOCAL_ROOT = 'server/uploads/confidential';

function isInside(child: string, parentRel: string): boolean {
  let parent = path.resolve(process.cwd(), parentRel);
  try {
    parent = fs.realpathSync(parent);
  } catch {
    // Folder doesn't exist; compare against the unresolved path.
  }
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

let objectStorage: ObjectStorageService | null = null;
function getObjectStorage(): ObjectStorageService {
  if (!objectStorage) objectStorage = new ObjectStorageService();
  return objectStorage;
}

async function readObjectStorageFile(objectPath: string): Promise<Buffer> {
  const file = await getObjectStorage().getObjectEntityFile(objectPath);
  const [buffer] = await file.download();
  return buffer;
}

interface DocMeta {
  filePath: string;
  originalName?: string | null;
  mimeType?: string | null;
  category?: string | null;
  isActive?: boolean | null;
}

export async function resolveEmailAttachments(
  refs: AttachmentRef[] | undefined | null,
  options: ResolveAttachmentOptions
): Promise<AttachmentResolution> {
  const canSeeConfidential = hasPermission(
    options.user,
    PERMISSIONS.DOCUMENTS_CONFIDENTIAL
  );

  // Same rules as the document download route (server/routes/documents.ts).
  function assertDocAccess(doc: DocMeta) {
    if (doc.isActive === false) {
      throw new AttachmentDeniedError('document is not active');
    }
    if (doc.category === 'confidential' && !canSeeConfidential) {
      throw new AttachmentDeniedError('no permission for confidential documents');
    }
  }

  const result: AttachmentResolution = { resolved: [], failed: [] };
  if (!refs || refs.length === 0) return result;

  // Batch-load document records referenced by numeric ID.
  const numericIds = refs
    .map((r) =>
      typeof r === 'number'
        ? r
        : typeof r === 'string' && /^\d+$/.test(r.trim())
          ? parseInt(r.trim(), 10)
          : NaN
    )
    .filter((id) => !isNaN(id));

  const docsById = new Map<number, DocMeta>();
  if (numericIds.length > 0) {
    const rows = await db
      .select({
        id: documents.id,
        filePath: documents.filePath,
        originalName: documents.originalName,
        mimeType: documents.mimeType,
        category: documents.category,
        isActive: documents.isActive,
      })
      .from(documents)
      .where(inArray(documents.id, numericIds));
    rows.forEach((r) => docsById.set(r.id, r));
  }

  // Look up nicer filenames/mime types for raw `/objects/...` paths.
  async function docMetaForPath(filePath: string): Promise<DocMeta | null> {
    const [row] = await db
      .select({
        filePath: documents.filePath,
        originalName: documents.originalName,
        mimeType: documents.mimeType,
        category: documents.category,
        isActive: documents.isActive,
      })
      .from(documents)
      .where(eq(documents.filePath, filePath))
      .limit(1);
    return row || null;
  }

  async function load(
    filePath: string,
    displayName?: string | null,
    mimeType?: string | null
  ): Promise<ResolvedAttachment> {
    let buffer: Buffer;
    if (filePath.startsWith('/objects/')) {
      buffer = await readObjectStorageFile(filePath);
    } else {
      const local = resolveLocalPath(filePath);
      if (!fs.existsSync(local)) {
        throw new Error('file not found on server');
      }
      // realpath defeats `..` segments and symlinks pointing elsewhere.
      const real = fs.realpathSync(local);
      if (!ALLOWED_LOCAL_ROOTS.some((root) => isInside(real, root))) {
        throw new AttachmentDeniedError('path is outside allowed folders');
      }
      if (isInside(real, CONFIDENTIAL_LOCAL_ROOT) && !canSeeConfidential) {
        throw new AttachmentDeniedError('no permission for confidential documents');
      }
      buffer = fs.readFileSync(real);
    }
    const filename = displayName || path.basename(filePath);
    return {
      content: buffer.toString('base64'),
      filename,
      type: contentTypeFor(filename, mimeType),
      disposition: 'attachment',
    };
  }

  // A local path or `{ filePath }` ref: apply the document record's access
  // rules if one exists, then load (load() enforces the allowed folders).
  async function loadPath(p: string, displayName?: string | null) {
    const meta = await docMetaForPath(p);
    if (meta) assertDocAccess(meta);
    return load(p, displayName || meta?.originalName, meta?.mimeType);
  }

  for (const ref of refs) {
    const label =
      typeof ref === 'object' && ref !== null ? ref.filePath : String(ref);
    let name = path.basename(label);
    try {
      if (typeof ref === 'number' || (typeof ref === 'string' && /^\d+$/.test(ref.trim()))) {
        const id = typeof ref === 'number' ? ref : parseInt(ref.trim(), 10);
        name = `document #${id}`;
        const doc = docsById.get(id);
        if (!doc) throw new Error('document not found');
        if (doc.originalName) name = doc.originalName;
        assertDocAccess(doc);
        result.resolved.push(await load(doc.filePath, doc.originalName, doc.mimeType));
        continue;
      }

      if (typeof ref === 'string') {
        const trimmed = ref.trim();

        if (trimmed.startsWith('uploads/documents/')) {
          const hash = trimmed.split('/').pop() || '';
          const legacy = LEGACY_HASH_MAP[hash];
          if (legacy) {
            name = legacy.name;
            result.resolved.push(await load(legacy.file, legacy.name));
            continue;
          }
          // Not a bundled alias: fall through and try it as a local file.
        }

        if (trimmed.startsWith('/objects/')) {
          // Only storage objects that belong to a document record, so access
          // rules can be applied.
          const meta = await docMetaForPath(trimmed);
          if (!meta) throw new AttachmentDeniedError('not a known document');
          if (meta.originalName) name = meta.originalName;
          assertDocAccess(meta);
          result.resolved.push(await load(trimmed, meta.originalName, meta.mimeType));
          continue;
        }

        result.resolved.push(await loadPath(trimmed));
        continue;
      }

      if (ref && typeof ref === 'object' && typeof ref.filePath === 'string') {
        if (ref.originalName) name = ref.originalName;
        if (ref.filePath.startsWith('/objects/')) {
          // Route through the string branch's document check.
          const sub = await resolveEmailAttachments([ref.filePath], options);
          if (sub.failed.length) throw new AttachmentDeniedError(sub.failed[0].reason);
          result.resolved.push({ ...sub.resolved[0], filename: ref.originalName || sub.resolved[0].filename });
          continue;
        }
        result.resolved.push(await loadPath(ref.filePath, ref.originalName));
        continue;
      }

      throw new Error('unrecognized attachment format');
    } catch (err) {
      const reason =
        err instanceof ObjectNotFoundError
          ? 'file not found in object storage'
          : err instanceof Error
            ? err.message
            : String(err);
      logger.error(`[Email Attachments] Could not attach ${label}: ${reason}`);
      result.failed.push({ ref: label, name, reason });
    }
  }

  return result;
}
