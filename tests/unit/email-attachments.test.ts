import * as fs from 'fs';
import * as path from 'path';

// Document rows the mocked db returns, keyed by id and by filePath.
const docRows = [
  {
    id: 7,
    filePath: '/objects/uploads/abc123',
    originalName: 'Food Safety Guide.pdf',
    mimeType: 'application/pdf',
    category: 'toolkit',
    isActive: true,
  },
  {
    id: 8,
    filePath: '/objects/uploads/secret',
    originalName: 'Board Minutes.pdf',
    mimeType: 'application/pdf',
    category: 'confidential',
    isActive: true,
  },
  {
    id: 9,
    filePath: '/objects/uploads/old',
    originalName: 'Old Guide.pdf',
    mimeType: 'application/pdf',
    category: 'toolkit',
    isActive: false,
  },
  {
    // Record exists but the file was deleted from storage.
    id: 10,
    filePath: '/objects/uploads/missing',
    originalName: 'Deleted Guide.pdf',
    mimeType: 'application/pdf',
    category: 'toolkit',
    isActive: true,
  },
];

jest.mock('../../server/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (cond: any) => {
          const rows =
            cond.inArray !== undefined
              ? docRows.filter((r) => cond.inArray.includes(r.id))
              : docRows.filter((r) => r.filePath === cond.eq);
          const p: any = Promise.resolve(rows);
          p.limit = () => Promise.resolve(rows.slice(0, 1));
          return p;
        },
      }),
    }),
  },
}));
jest.mock('drizzle-orm', () => ({
  inArray: (_col: unknown, values: unknown[]) => ({ inArray: values }),
  eq: (_col: unknown, value: unknown) => ({ eq: value }),
}));
jest.mock('@shared/schema', () => ({
  documents: { id: 'id', filePath: 'filePath', originalName: 'originalName', mimeType: 'mimeType', category: 'category', isActive: 'isActive' },
}));
jest.mock('@shared/unified-auth-utils', () => ({
  hasPermission: (user: any, perm: string) => !!user?.permissions?.includes(perm),
}));
jest.mock('@shared/auth-utils', () => ({
  PERMISSIONS: { DOCUMENTS_CONFIDENTIAL: 'DOCUMENTS_CONFIDENTIAL' },
}));
jest.mock('../../server/utils/production-safe-logger', () => ({
  logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const storedObjects: Record<string, Buffer> = {
  '/objects/uploads/abc123': Buffer.from('PDF-FROM-STORAGE'),
  '/objects/uploads/secret': Buffer.from('SECRET'),
  '/objects/uploads/old': Buffer.from('OLD'),
  '/objects/uploads/orphan': Buffer.from('ORPHAN'),
};
jest.mock('../../server/replit_integrations/object_storage', () => {
  class ObjectNotFoundError extends Error {}
  class ObjectStorageService {
    async getObjectEntityFile(p: string) {
      const buf = storedObjects[p];
      if (!buf) throw new ObjectNotFoundError();
      return { download: async () => [buf] };
    }
  }
  return { ObjectStorageService, ObjectNotFoundError };
});

import {
  resolveEmailAttachments,
  describeFailedAttachments,
} from '../../server/utils/email-attachments';

const staff = { user: { permissions: [] as string[] } as any };
const admin = { user: { permissions: ['DOCUMENTS_CONFIDENTIAL'] } as any };

// Scratch files must live under an allowed folder (uploads/).
const uploadsDir = path.join(process.cwd(), 'uploads', '__email_attachment_test__');
beforeAll(() => fs.mkdirSync(uploadsDir, { recursive: true }));
afterAll(() => fs.rmSync(uploadsDir, { recursive: true, force: true }));

const b64 = (s: string) => Buffer.from(s).toString('base64');

describe('resolveEmailAttachments', () => {
  it('downloads /objects/ paths from object storage and uses the document name', async () => {
    const { resolved, failed } = await resolveEmailAttachments(['/objects/uploads/abc123'], staff);
    expect(failed).toEqual([]);
    expect(resolved).toEqual([
      {
        content: b64('PDF-FROM-STORAGE'),
        filename: 'Food Safety Guide.pdf',
        type: 'application/pdf',
        disposition: 'attachment',
      },
    ]);
  });

  it('resolves numeric document IDs whose file lives in object storage', async () => {
    const { resolved, failed } = await resolveEmailAttachments([7, '7'], staff);
    expect(failed).toEqual([]);
    expect(resolved).toHaveLength(2);
    expect(resolved[0].content).toBe(b64('PDF-FROM-STORAGE'));
  });

  it('reads local files inside allowed folders', async () => {
    const file = path.join(uploadsDir, 'labels.pdf');
    fs.writeFileSync(file, 'LOCAL');
    const { resolved, failed } = await resolveEmailAttachments([file], staff);
    expect(failed).toEqual([]);
    expect(resolved[0]).toMatchObject({ filename: 'labels.pdf', type: 'application/pdf', content: b64('LOCAL') });
  });

  it('reports (does not silently drop) anything it cannot load', async () => {
    const { resolved, failed } = await resolveEmailAttachments([
      '/objects/uploads/missing',
      '/definitely/not/here.pdf',
      999,
      'uploads/documents/unknownhash',
    ], staff);
    expect(resolved).toEqual([]);
    expect(failed.map((f) => f.ref)).toEqual([
      '/objects/uploads/missing',
      '/definitely/not/here.pdf',
      '999',
      'uploads/documents/unknownhash',
    ]);
    expect(failed[0].reason).toBe('file not found in object storage');
  });

  it('returns empty results for no attachments', async () => {
    expect(await resolveEmailAttachments([], staff)).toEqual({ resolved: [], failed: [] });
    expect(await resolveEmailAttachments(undefined, staff)).toEqual({ resolved: [], failed: [] });
  });

  describe('access control', () => {
    it('blocks confidential documents without DOCUMENTS_CONFIDENTIAL (by ID and by path)', async () => {
      const { resolved, failed } = await resolveEmailAttachments([8, '/objects/uploads/secret'], staff);
      expect(resolved).toEqual([]);
      expect(failed.map((f) => f.reason)).toEqual([
        'no permission for confidential documents',
        'no permission for confidential documents',
      ]);
      expect(failed[0].name).toBe('Board Minutes.pdf');
    });

    it('allows confidential documents with DOCUMENTS_CONFIDENTIAL', async () => {
      const { resolved, failed } = await resolveEmailAttachments([8], admin);
      expect(failed).toEqual([]);
      expect(resolved[0].content).toBe(b64('SECRET'));
    });

    it('blocks inactive documents', async () => {
      const { failed } = await resolveEmailAttachments([9], admin);
      expect(failed[0].reason).toBe('document is not active');
    });

    it('blocks /objects/ paths that are not a document record', async () => {
      const { failed } = await resolveEmailAttachments(['/objects/uploads/orphan'], admin);
      expect(failed[0].reason).toBe('not a known document');
    });

    it('blocks local files outside allowed folders, including via ..', async () => {
      const { failed } = await resolveEmailAttachments(
        ['package.json', path.join(process.cwd(), 'package.json'), 'uploads/../package.json'],
        admin
      );
      expect(failed.map((f) => f.reason)).toEqual([
        'path is outside allowed folders',
        'path is outside allowed folders',
        'path is outside allowed folders',
      ]);
    });

    it('blocks symlinks that point outside allowed folders', async () => {
      const link = path.join(uploadsDir, 'sneaky.pdf');
      fs.symlinkSync(path.join(process.cwd(), 'package.json'), link);
      const { failed } = await resolveEmailAttachments([link], admin);
      expect(failed[0].reason).toBe('path is outside allowed folders');
    });
  });

  it('falls back to a local file for unknown uploads/documents/<hash> refs', async () => {
    const dir = path.join(process.cwd(), 'uploads', 'documents');
    const existed = fs.existsSync(dir);
    fs.mkdirSync(dir, { recursive: true });
    const hash = '__test_hash_' + Date.now();
    const file = path.join(dir, hash);
    fs.writeFileSync(file, 'HASHED');
    try {
      const { resolved, failed } = await resolveEmailAttachments([`uploads/documents/${hash}`], staff);
      expect(failed).toEqual([]);
      expect(resolved[0].content).toBe(b64('HASHED'));
    } finally {
      fs.rmSync(file);
      if (!existed) fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('names the failed files in the sender-facing message', () => {
    const msg = describeFailedAttachments([
      { ref: '8', name: 'Board Minutes.pdf', reason: 'no permission for confidential documents' },
    ]);
    expect(msg).toContain('Board Minutes.pdf');
    expect(msg).toContain('no permission for confidential documents');
  });
});
