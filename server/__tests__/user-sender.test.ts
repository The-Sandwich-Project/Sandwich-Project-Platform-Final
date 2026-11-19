import { buildUserSender } from '../utils/user-sender';

const ORG = 'office@thesandwichproject.org';

describe('buildUserSender', () => {
  it('sends from the user when their address is on the authenticated domain', () => {
    const sender = buildUserSender(
      { firstName: 'Pat', lastName: 'Lee', email: 'pat@thesandwichproject.org' },
      ORG
    );
    expect(sender.from).toEqual({ email: 'pat@thesandwichproject.org', name: 'Pat Lee' });
    expect(sender.replyTo).toBe('pat@thesandwichproject.org');
    expect(sender.senderCopyBcc).toBe('pat@thesandwichproject.org');
  });

  it('matches the domain case-insensitively', () => {
    const sender = buildUserSender(
      { firstName: 'Pat', email: 'Pat@TheSandwichProject.org' },
      ORG
    );
    expect(sender.from.email).toBe('Pat@TheSandwichProject.org');
  });

  it('uses the org address with a "via" name for personal addresses', () => {
    const sender = buildUserSender(
      { firstName: 'Pat', lastName: 'Lee', email: 'pat.lee@gmail.com' },
      ORG
    );
    expect(sender.from).toEqual({ email: ORG, name: 'Pat Lee via The Sandwich Project' });
    expect(sender.replyTo).toBe('pat.lee@gmail.com');
    expect(sender.senderCopyBcc).toBe('pat.lee@gmail.com');
  });

  it('prefers the preferred email for replies and the copy', () => {
    const sender = buildUserSender(
      { firstName: 'Pat', email: 'pat.lee@gmail.com', preferredEmail: 'pat@thesandwichproject.org' },
      ORG
    );
    expect(sender.from.email).toBe('pat@thesandwichproject.org');
    expect(sender.replyTo).toBe('pat@thesandwichproject.org');
  });

  it('sends from the domain login email when the preferred email is personal', () => {
    const sender = buildUserSender(
      { firstName: 'Pat', email: 'pat@thesandwichproject.org', preferredEmail: 'pat.lee@gmail.com' },
      ORG
    );
    expect(sender.from.email).toBe('pat@thesandwichproject.org');
    expect(sender.replyTo).toBe('pat.lee@gmail.com');
  });

  it('does not treat look-alike domains as ours', () => {
    const sender = buildUserSender({ firstName: 'Pat', email: 'pat@thesandwichproject.org.evil.com' }, ORG);
    expect(sender.from.email).toBe(ORG);
    const sender2 = buildUserSender({ firstName: 'Pat', email: 'pat@notthesandwichproject.org' }, ORG);
    expect(sender2.from.email).toBe(ORG);
  });

  it('falls back to the org name when the user has no name', () => {
    const sender = buildUserSender({ email: 'someone@gmail.com' }, ORG);
    expect(sender.from).toEqual({ email: ORG, name: 'The Sandwich Project' });
  });
});
