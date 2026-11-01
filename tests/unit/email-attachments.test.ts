import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Document rows the mocked db returns, keyed by id and by filePath.
const docRows = [
  {
    id: 7,
    filePath: '/objects/uploads/abc123',
    originalName: 'Food Safety Guide.pdf',
    mimeType: 'application/pdf',
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
  documents: { id: 'id', filePath: 'filePath', originalName: 'originalName', mimeType: 'mimeType' },
}));
jest.mock('../../server/utils/production-safe-logger', () => ({
  logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const storedObjects: Record<string, Buffer> = {
  '/objects/uploads/abc123': Buffer.from('PDF-FROM-STORAGE'),
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

import { resolveEmailAttachments } from '../../server/utils/email-attachments';

const b64 = (s: string) => Buffer.from(s).toString('base64');

describe('resolveEmailAttachments', () => {
  it('downloads /objects/ paths from object storage and uses the document name', async () => {
    const { resolved, failed } = await resolveEmailAttachments(['/objects/uploads/abc123']);
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
    const { resolved, failed } = await resolveEmailAttachments([7, '7']);
    expect(failed).toEqual([]);
    expect(resolved).toHaveLength(2);
    expect(resolved[0].content).toBe(b64('PDF-FROM-STORAGE'));
  });

  it('reads local files', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'att-'));
    const file = path.join(dir, 'labels.pdf');
    fs.writeFileSync(file, 'LOCAL');
    const { resolved, failed } = await resolveEmailAttachments([file]);
    expect(failed).toEqual([]);
    expect(resolved[0]).toMatchObject({ filename: 'labels.pdf', type: 'application/pdf', content: b64('LOCAL') });
  });

  it('reports (does not silently drop) anything it cannot load', async () => {
    const { resolved, failed } = await resolveEmailAttachments([
      '/objects/uploads/missing',
      '/definitely/not/here.pdf',
      999,
      'uploads/documents/unknownhash',
    ]);
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
    expect(await resolveEmailAttachments([])).toEqual({ resolved: [], failed: [] });
    expect(await resolveEmailAttachments(undefined)).toEqual({ resolved: [], failed: [] });
  });
});
