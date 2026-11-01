import * as fs from 'fs';
import * as path from 'path';

const TEST_DIR_REL = 'uploads/__email_attachment_test__';
const TEST_HASH = 'ab'.repeat(16); // 32 hex chars, not a bundled alias

// Document rows the mocked db returns.
const docRows = [
  { id: 7, filePath: '/objects/uploads/abc123', originalName: 'Food Safety Guide.pdf', mimeType: 'application/pdf', category: 'toolkit', isActive: true },
  { id: 8, filePath: '/objects/uploads/secret', originalName: 'Board Minutes.pdf', mimeType: 'application/pdf', category: 'confidential', isActive: true },
  { id: 9, filePath: '/objects/uploads/old', originalName: 'Old Guide.pdf', mimeType: 'application/pdf', category: 'toolkit', isActive: false },
  // Record exists but the file was deleted from storage.
  { id: 10, filePath: '/objects/uploads/missing', originalName: 'Deleted Guide.pdf', mimeType: 'application/pdf', category: 'toolkit', isActive: true },
  // Local files.
  { id: 11, filePath: `${TEST_DIR_REL}/labels.pdf`, originalName: 'Labels.pdf', mimeType: 'application/pdf', category: 'toolkit', isActive: true },
  { id: 12, filePath: `${TEST_DIR_REL}/secret-local.pdf`, originalName: 'Local Secret.pdf', mimeType: 'application/pdf', category: 'confidential', isActive: true },
  // Legacy aliases (bundled files exist in attached_assets/).
  { id: 13, filePath: 'uploads/documents/015b0f68ddb511633e7696caab59bfa7', originalName: 'Food Safety (old)', mimeType: 'application/pdf', category: 'toolkit', isActive: false },
  { id: 14, filePath: 'uploads/documents/3e375509b08b20265abdfa6afe632982', originalName: 'PBJ Sandwich Making 101.pdf', mimeType: 'application/pdf', category: 'toolkit', isActive: true },
  // Hash path that isn't a bundled alias: read from disk.
  { id: 15, filePath: `uploads/documents/${TEST_HASH}`, originalName: 'Hashed.pdf', mimeType: 'application/pdf', category: 'toolkit', isActive: true },
  // Records whose stored path is unsafe (defense in depth).
  { id: 16, filePath: 'package.json', originalName: 'pkg.json', mimeType: 'application/json', category: 'toolkit', isActive: true },
  { id: 17, filePath: `${TEST_DIR_REL}/sneaky.pdf`, originalName: 'Sneaky.pdf', mimeType: 'application/pdf', category: 'toolkit', isActive: true },
  { id: 18, filePath: 'server/uploads/confidential/__email_test__.pdf', originalName: 'Conf Store.pdf', mimeType: 'application/pdf', category: 'toolkit', isActive: true },
];

jest.mock('../../server/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (cond: { col: string; values: unknown[] }) =>
          Promise.resolve(docRows.filter((r: any) => cond.values.includes(r[cond.col]))),
      }),
    }),
  },
}));
jest.mock('drizzle-orm', () => ({
  inArray: (col: string, values: unknown[]) => ({ col, values }),
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
const b64 = (s: string) => Buffer.from(s).toString('base64');
const abs = (rel: string) => path.join(process.cwd(), rel);

const testDir = abs(TEST_DIR_REL);
const hashDir = abs('uploads/documents');
const confDir = abs('server/uploads/confidential');
const created: string[] = [];
let hashDirExisted = false;
let confDirExisted = false;

beforeAll(() => {
  fs.mkdirSync(testDir, { recursive: true });
  fs.writeFileSync(abs(`${TEST_DIR_REL}/labels.pdf`), 'LOCAL');
  fs.writeFileSync(abs(`${TEST_DIR_REL}/secret-local.pdf`), 'LOCAL-SECRET');
  fs.symlinkSync(abs('package.json'), abs(`${TEST_DIR_REL}/sneaky.pdf`));

  hashDirExisted = fs.existsSync(hashDir);
  fs.mkdirSync(hashDir, { recursive: true });
  fs.writeFileSync(path.join(hashDir, TEST_HASH), 'HASHED');
  created.push(path.join(hashDir, TEST_HASH));

  confDirExisted = fs.existsSync(confDir);
  fs.mkdirSync(confDir, { recursive: true });
  fs.writeFileSync(path.join(confDir, '__email_test__.pdf'), 'CONF');
  created.push(path.join(confDir, '__email_test__.pdf'));
});
afterAll(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
  created.forEach((f) => fs.rmSync(f, { force: true }));
  if (!hashDirExisted) fs.rmSync(hashDir, { recursive: true, force: true });
  if (!confDirExisted) fs.rmSync(confDir, { recursive: true, force: true });
});

const reasons = async (refs: any[], opts = admin) =>
  (await resolveEmailAttachments(refs, opts)).failed.map((f) => f.reason);

describe('resolveEmailAttachments', () => {
  describe('loading', () => {
    it('downloads /objects/ documents from object storage with the document name', async () => {
      const { resolved, failed } = await resolveEmailAttachments(['/objects/uploads/abc123'], staff);
      expect(failed).toEqual([]);
      expect(resolved).toEqual([
        { content: b64('PDF-FROM-STORAGE'), filename: 'Food Safety Guide.pdf', type: 'application/pdf', disposition: 'attachment' },
      ]);
    });

    it('resolves numeric document IDs (number and string)', async () => {
      const { resolved, failed } = await resolveEmailAttachments([7, '7'], staff);
      expect(failed).toEqual([]);
      expect(resolved.map((r) => r.content)).toEqual([b64('PDF-FROM-STORAGE'), b64('PDF-FROM-STORAGE')]);
    });

    it('reads a local document by its stored path or { filePath } object', async () => {
      const { resolved, failed } = await resolveEmailAttachments(
        [`${TEST_DIR_REL}/labels.pdf`, { filePath: `${TEST_DIR_REL}/labels.pdf`, originalName: 'Custom.pdf' }],
        staff
      );
      expect(failed).toEqual([]);
      expect(resolved[0]).toMatchObject({ filename: 'Labels.pdf', content: b64('LOCAL') });
      expect(resolved[1]).toMatchObject({ filename: 'Custom.pdf', content: b64('LOCAL') });
    });

    it('maps an active legacy alias record to its bundled PDF', async () => {
      const { resolved, failed } = await resolveEmailAttachments([14], staff);
      expect(failed).toEqual([]);
      const bundled = fs.readFileSync(abs('attached_assets/PBJ Sandwich Making 2 101 03172026.pdf'));
      expect(resolved[0]).toMatchObject({ filename: 'PBJ Sandwich Making 101.pdf', content: bundled.toString('base64') });
    });

    it('reads non-alias uploads/documents/<hash> records from disk', async () => {
      const { resolved, failed } = await resolveEmailAttachments([`uploads/documents/${TEST_HASH}`], staff);
      expect(failed).toEqual([]);
      expect(resolved[0].content).toBe(b64('HASHED'));
    });

    it('returns empty results for no attachments', async () => {
      expect(await resolveEmailAttachments([], staff)).toEqual({ resolved: [], failed: [] });
      expect(await resolveEmailAttachments(undefined, staff)).toEqual({ resolved: [], failed: [] });
    });
  });

  describe('failures are reported, not dropped', () => {
    it('reports missing storage files, unknown IDs and bad formats', async () => {
      const { resolved, failed } = await resolveEmailAttachments(['/objects/uploads/missing', 999, null as any], staff);
      expect(resolved).toEqual([]);
      expect(failed.map((f) => [f.ref, f.reason])).toEqual([
        ['/objects/uploads/missing', 'file not found in object storage'],
        ['999', 'not a known document'],
        ['null', 'unrecognized attachment format'],
      ]);
      expect(failed[0].name).toBe('Deleted Guide.pdf');
    });

    it('names the failed files in the sender-facing message', () => {
      const msg = describeFailedAttachments([
        { ref: '8', name: 'Board Minutes.pdf', reason: 'no permission for confidential documents' },
      ]);
      expect(msg).toContain('Board Minutes.pdf');
      expect(msg).toContain('no permission for confidential documents');
    });
  });

  describe('access control', () => {
    it('blocks confidential documents without DOCUMENTS_CONFIDENTIAL (ID, storage path, local path)', async () => {
      expect(await reasons([8, '/objects/uploads/secret', `${TEST_DIR_REL}/secret-local.pdf`], staff)).toEqual([
        'no permission for confidential documents',
        'no permission for confidential documents',
        'no permission for confidential documents',
      ]);
    });

    it('allows confidential documents with DOCUMENTS_CONFIDENTIAL', async () => {
      const { resolved, failed } = await resolveEmailAttachments([8, 12], admin);
      expect(failed).toEqual([]);
      expect(resolved.map((r) => r.content)).toEqual([b64('SECRET'), b64('LOCAL-SECRET')]);
    });

    it('blocks inactive documents', async () => {
      expect(await reasons([9])).toEqual(['document is not active']);
    });

    it('never reads a caller-supplied path that is not a stored document path', async () => {
      expect(
        await reasons([
          '/objects/uploads/orphan',
          '.env',
          'server/db.ts',
          abs('package.json'),
          `./${TEST_DIR_REL}/secret-local.pdf`,
          abs(`${TEST_DIR_REL}/secret-local.pdf`),
          `uploads/documents/../__email_attachment_test__/secret-local.pdf`,
        ])
      ).toEqual(Array(7).fill('not a known document'));
    });

    it('legacy aliases: inactive record blocks it, and other spellings or the bundled path are unknown', async () => {
      expect(
        await reasons([
          'uploads/documents/015b0f68ddb511633e7696caab59bfa7',
          'uploads/documents/./015b0f68ddb511633e7696caab59bfa7',
          'attached_assets/20260506-TSP-Food+Safety+Volunteers.pdf',
        ])
      ).toEqual(['document is not active', 'not a known document', 'not a known document']);
    });

    it('refuses records whose stored path escapes the allowed folders (incl. symlinks)', async () => {
      expect(await reasons([16, 17])).toEqual(['path is outside allowed folders', 'path is outside allowed folders']);
    });

    it('refuses the confidential upload store even with DOCUMENTS_CONFIDENTIAL', async () => {
      expect(await reasons([18])).toEqual(['confidential uploads cannot be emailed']);
    });
  });
});
