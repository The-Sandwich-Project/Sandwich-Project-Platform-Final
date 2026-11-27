import { emailOrganizer, organizerMailtoHref } from '../lib/emailOrganizer';

describe('Email button (mailto link)', () => {
  it('addresses the group contact with a short subject and no body', () => {
    const href = organizerMailtoHref({ email: 'pat@school.org', organizationName: 'Lincoln Elementary' });
    expect(href).toBe(
      'mailto:pat@school.org?subject=' + encodeURIComponent('Your Sandwich Project event – Lincoln Elementary')
    );
    expect(href).not.toContain('body=');
  });

  it('still has a subject when the organization name is missing', () => {
    expect(organizerMailtoHref({ email: 'pat@school.org', organizationName: '' })).toBe(
      'mailto:pat@school.org?subject=' + encodeURIComponent('Your Sandwich Project event')
    );
  });

  it('encodes characters that would break the link', () => {
    const href = organizerMailtoHref({ email: 'pat@school.org', organizationName: 'Boys & Girls Club #4' })!;
    expect(href).toContain(encodeURIComponent('Boys & Girls Club #4'));
    expect(href.split('?')).toHaveLength(2);
  });

  it('runs the fallback when there is no email to address', () => {
    expect(organizerMailtoHref({ email: '  ', organizationName: 'X' })).toBeNull();
    const fallback = jest.fn();
    emailOrganizer({ email: null as any, organizationName: 'X' }, fallback);
    expect(fallback).toHaveBeenCalledTimes(1);
  });
});
