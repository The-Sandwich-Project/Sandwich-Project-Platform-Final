const mockFrom = jest.fn();
const mockSelect = jest.fn().mockImplementation(() => ({ from: mockFrom }));
jest.mock('../../server/db', () => ({ db: { select: mockSelect } }));
jest.mock('@shared/schema', () => ({ users: { id: 'id', email: 'email', firstName: 'first', lastName: 'last', isActive: 'active' } }));
import { normalizeEventContacts } from '../../server/services/event-contact-directory';

beforeEach(() => { jest.clearAllMocks(); mockFrom.mockResolvedValue([{ id: 'u1', firstName: 'Example', lastName: 'Person', isActive: true }]); });
it('does not query the directory for an unrelated update', async () => {
  expect(await normalizeEventContacts({ planningNotes: 'note' })).toEqual({ planningNotes: 'note' });
  expect(mockSelect).not.toHaveBeenCalled();
});
it('does not query or reconcile unchanged full-form contact values', async () => {
  expect(await normalizeEventContacts({ tspContact: 'old label' }, { tspContact: 'old label', tspContactAssigned: 'other' })).toEqual({ tspContact: 'old label' });
  expect(mockSelect).not.toHaveBeenCalled();
});
it('selects only identity fields and normalizes a new import', async () => {
  const result = await normalizeEventContacts({ tspContactAssigned: 'Example Person' });
  expect(mockSelect.mock.calls[0][0]).toEqual({ id: 'id', email: 'email', firstName: 'first', lastName: 'last', isActive: 'active' });
  expect(result).toMatchObject({ tspContact: 'u1', tspContactAssigned: 'u1', planningNotes: '[Imported TSP contact] Example Person' });
});
