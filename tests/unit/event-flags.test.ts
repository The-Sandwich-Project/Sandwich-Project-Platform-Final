import { canWriteFlags, flagsEmailHtml, flagsEmailText, flagsSmsSuffix } from '../../server/services/event-flags';

const flag = (content: string, userName = 'Christine') => ({ content, userName, createdAt: new Date('2026-11-20T15:00:00Z') });

describe('New Event Flags in the assignment alert', () => {
  it('adds nothing when there are no flags', () => {
    expect(flagsEmailHtml([])).toBe('');
    expect(flagsEmailText([])).toBe('');
    expect(flagsSmsSuffix([])).toBe('');
  });

  it('lists every flag under "Notes before you reach out", escaped', () => {
    const html = flagsEmailHtml([flag('Budget is tight'), flag('Wants <b>weekday</b> & mornings', 'Katie')]);
    expect(html).toContain('Notes before you reach out');
    expect(html).toContain('Budget is tight');
    expect(html).toContain('Wants &lt;b&gt;weekday&lt;/b&gt; &amp; mornings');
    expect(html).not.toContain('<b>weekday</b>');
    expect(html).toContain('Katie');
  });

  it('has a plain-text version, and the text message only says there are notes', () => {
    expect(flagsEmailText([flag('Budget is tight')])).toBe('\n\nNotes before you reach out:\n- Budget is tight (Christine)');
    expect(flagsSmsSuffix([flag('a'), flag('b')])).toBe(' Has notes, see event.');
  });

  it('trims a very long flag', () => {
    expect(flagsEmailText([flag('x'.repeat(1500))])).toContain(`${'x'.repeat(1000)}…`);
  });

  it('flags can only be added while the event is New', () => {
    expect(canWriteFlags('new')).toBe(true);
    for (const s of ['in_process', 'standby', 'scheduled', 'completed', 'declined', 'stalled']) expect(canWriteFlags(s)).toBe(false);
  });
});
