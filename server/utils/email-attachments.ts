import * as fs from 'fs';
import * as path from 'path';
import { inArray } from 'drizzle-orm';
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
 * Resolves email attachment references into base64 attachments SendGrid can
 * send directly.
 *
 * Why this exists: the SendGrid helper only reads local disk and silently
 * skips anything missing. Document records that live in object storage
 * (`/objects/uploads/...`) were being dropped, so toolkit emails could go out
 * without the PDFs the sender selected. Callers should refuse to send when
 * `failed` is non-empty.
 *
 * Security model: a reference is only ever a pointer to a `documents` record
 * (its numeric ID, or its exact stored `filePath`, which is what the email
 * composers send). The record's access rules are checked, and the file is
 * read from the record's own stored path. A path supplied by the caller is
 * never read directly, so path spellings, `..`, symlinks and aliases can't
 * be used to reach files the record system doesn't vouch for.
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

// Legacy document hashes that map to PDFs bundled in client/public/documents/.
const LEGACY_HASH_MAP: Record<string, { file: string; name: string }> = {
  '015b0f68ddb511633e7696caab59bfa7': {
    file: 'client/public/documents/food-safety-volunteers.pdf',
    name: 'Food Safety Guide for Volunteers.pdf',
  },
  '3e375509b08b20265abdfa6afe632982': {
    file: 'client/public/documents/pbj-sandwich-making-101.pdf',
    name: 'PBJ Sandwich Making 101.pdf',
  },
  '56687eca96492549ba09d1bda0e5e6e0': {
    file: 'client/public/documents/deli-sandwich-making-101.pdf',
    name: 'Deli Sandwich Making 101.pdf',
  },
  '075839360400adce8b79a6a58a96dcfc': {
    file: 'client/public/documents/deli-labels.pdf',
    name: 'Deli Sandwich Labels.pdf',
  },
  a9458021b23fca8d76e674597c691876: {
    file: 'client/public/documents/pbj-labels.pdf',
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
// Defense in depth: even a record's stored path may only point here.
// client/public/documents holds the app's static documents, already served
// publicly at /documents/.
const ALLOWED_LOCAL_ROOTS = ['uploads', 'server/uploads', 'public', 'attached_assets', 'client/public/documents'];
// Confidential uploads have their own per-document email allowlists
// (confidential_documents table), which this resolver doesn't model, so
// files there are never attachable.
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
  id: number;
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
  const result: AttachmentResolution = { resolved: [], failed: [] };
  if (!refs || refs.length === 0) return result;

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

  // Normalize each ref to either a document ID or an exact stored filePath.
  type Key = { id: number } | { filePath: string };
  const keys: (Key | null)[] = refs.map((ref) => {
    if (typeof ref === 'number') return { id: ref };
    if (typeof ref === 'string') {
      const t = ref.trim();
      return /^\d+$/.test(t) ? { id: parseInt(t, 10) } : { filePath: t };
    }
    if (ref && typeof ref === 'object' && typeof ref.filePath === 'string') {
      return { filePath: ref.filePath.trim() };
    }
    return null;
  });

  // Load every referenced record in at most two queries.
  const ids = keys.flatMap((k) => (k && 'id' in k ? [k.id] : []));
  const paths = keys.flatMap((k) => (k && 'filePath' in k ? [k.filePath] : []));
  const columns = {
    id: documents.id,
    filePath: documents.filePath,
    originalName: documents.originalName,
    mimeType: documents.mimeType,
    category: documents.category,
    isActive: documents.isActive,
  };
  const byId = new Map<number, DocMeta>();
  const byPath = new Map<string, DocMeta[]>();
  if (ids.length > 0) {
    const rows: DocMeta[] = await db.select(columns).from(documents).where(inArray(documents.id, ids));
    rows.forEach((r) => byId.set(r.id, r));
  }
  if (paths.length > 0) {
    const rows: DocMeta[] = await db.select(columns).from(documents).where(inArray(documents.filePath, paths));
    rows.forEach((r) => byPath.set(r.filePath, [...(byPath.get(r.filePath) || []), r]));
  }

  // Reads the file a record points at. Only ever called with a record's
  // stored path, never with caller input.
  async function readRecordFile(doc: DocMeta): Promise<Buffer> {
    if (doc.filePath.startsWith('/objects/')) {
      return readObjectStorageFile(doc.filePath);
    }

    let localPath = doc.filePath;
    const legacyMatch = /^uploads\/documents\/([0-9a-f]{32})$/.exec(doc.filePath);
    if (legacyMatch && LEGACY_HASH_MAP[legacyMatch[1]]) {
      localPath = LEGACY_HASH_MAP[legacyMatch[1]].file;
    }

    const resolved = resolveLocalPath(localPath);
    if (!fs.existsSync(resolved)) {
      throw new Error('file not found on server');
    }
    const real = fs.realpathSync(resolved);
    if (!ALLOWED_LOCAL_ROOTS.some((root) => isInside(real, root))) {
      throw new AttachmentDeniedError('path is outside allowed folders');
    }
    if (isInside(real, CONFIDENTIAL_LOCAL_ROOT)) {
      throw new AttachmentDeniedError('confidential uploads cannot be emailed');
    }
    return fs.readFileSync(real);
  }

  for (let i = 0; i < refs.length; i++) {
    const ref = refs[i];
    const key = keys[i];
    // Always a string, even for malformed input like {} or { filePath: 42 },
    // so bad refs reach the format error below instead of throwing here.
    const label =
      typeof ref === 'object' && ref !== null && typeof ref.filePath === 'string'
        ? ref.filePath
        : typeof ref === 'object' && ref !== null
          ? JSON.stringify(ref)
          : String(ref);
    let name = key && 'id' in key ? `document #${key.id}` : path.basename(label);
    try {
      if (!key) throw new Error('unrecognized attachment format');

      let doc: DocMeta | undefined;
      if ('id' in key) {
        doc = byId.get(key.id);
      } else {
        const matches = byPath.get(key.filePath) || [];
        // Name the document before any denial, so errors show its title.
        if (matches[0]?.originalName) name = matches[0].originalName;
        // If several records share a path, every one must allow access.
        matches.forEach(assertDocAccess);
        doc = matches[0];
      }
      if (!doc) throw new AttachmentDeniedError('not a known document');
      if (doc.originalName) name = doc.originalName;
      assertDocAccess(doc);

      const legacyName = (() => {
        const m = /^uploads\/documents\/([0-9a-f]{32})$/.exec(doc.filePath);
        return m ? LEGACY_HASH_MAP[m[1]]?.name : undefined;
      })();
      const displayName =
        (typeof ref === 'object' && ref?.originalName) ||
        doc.originalName ||
        legacyName ||
        path.basename(doc.filePath);

      const buffer = await readRecordFile(doc);
      result.resolved.push({
        content: buffer.toString('base64'),
        filename: displayName,
        type: contentTypeFor(displayName, doc.mimeType),
        disposition: 'attachment',
      });
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
