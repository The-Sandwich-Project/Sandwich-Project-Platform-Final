jest.mock('@/lib/logger', () => ({ logger: { log() {}, warn() {}, error() {}, info() {} } }));
jest.mock('@/lib/queryClient', () => ({ apiRequest: jest.fn() }));

import { intelligentMergeFormData } from '../form-utils';

const base = { status: 'standby', standbyNotes: '' };

describe('draft recovery keeps the Standby reminder choice and date together', () => {
  const original = { ...base, standbyCheckBackMode: 'specific', standbyCheckBackDate: '2026-12-10', standbyExpectedDate: '2026-12-10' };

  it('server wins when both changed (drafted "No reminder" vs someone else saving Dec 20)', () => {
    const draft = { ...original, standbyCheckBackMode: 'none', standbyCheckBackDate: '' };
    const server = { ...original, standbyCheckBackDate: '2026-12-20', standbyExpectedDate: '2026-12-20' };
    const { mergedData, conflicts } = intelligentMergeFormData(draft, original, server);
    expect(mergedData).toMatchObject({ standbyCheckBackMode: 'specific', standbyCheckBackDate: '2026-12-20', standbyExpectedDate: '2026-12-20' });
    expect(conflicts).toEqual(expect.arrayContaining(['standbyCheckBackMode']));
  });

  it("keeps the draft's choice when only the draft changed it", () => {
    const draft = { ...original, standbyCheckBackMode: 'none', standbyCheckBackDate: '' };
    const { mergedData } = intelligentMergeFormData(draft, original, original);
    expect(mergedData).toMatchObject({ standbyCheckBackMode: 'none', standbyCheckBackDate: '' });
  });

  it("takes the server's newer reminder when the draft didn't touch it, and still keeps other draft edits", () => {
    const draft = { ...original, standbyNotes: 'PTA vote moved' };
    const server = { ...original, standbyCheckBackDate: '2026-12-20', standbyExpectedDate: '2026-12-20' };
    const { mergedData } = intelligentMergeFormData(draft, original, server);
    expect(mergedData).toMatchObject({ standbyCheckBackDate: '2026-12-20', standbyExpectedDate: '2026-12-20', standbyNotes: 'PTA vote moved' });
  });
});
