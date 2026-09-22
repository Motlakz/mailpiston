import { describe, expect, it } from 'vitest';

import { formatSender, parseSender } from './sender';

describe('parseSender', () => {
  it('takes a bare address, lowercased', () => {
    expect(parseSender('Support@Example.COM')).toEqual({
      email: 'support@example.com',
      name: null,
    });
  });

  it('takes the display-name form every mail API accepts', () => {
    expect(parseSender('Speak Diary Support <support@example.com>')).toEqual({
      email: 'support@example.com',
      name: 'Speak Diary Support',
    });
  });

  it('takes a quoted display name, quotes removed', () => {
    expect(parseSender('"Support, Speak Diary" <support@example.com>')).toEqual({
      email: 'support@example.com',
      name: 'Support, Speak Diary',
    });
  });

  it('reads an address with no display name in angle brackets', () => {
    expect(parseSender('<support@example.com>')).toEqual({
      email: 'support@example.com',
      name: null,
    });
  });

  it.each([
    ['a name with no address', 'Speak Diary Support'],
    ['an unqualified local part', 'support'],
    ['a domain with no TLD', 'support@localhost'],
    ['two addresses', 'a@example.com, b@example.com'],
    ['an unterminated bracket', 'Support <support@example.com'],
    ['nothing', '   '],
  ])('refuses %s', (_label, value) => {
    expect(parseSender(value)).toBeNull();
  });
});

describe('formatSender', () => {
  it('renders a bare address when there is no name', () => {
    expect(formatSender({ email: 'support@example.com', name: null })).toBe(
      'support@example.com',
    );
  });

  it('quotes the display name, so a comma in it cannot read as a second recipient', () => {
    expect(
      formatSender({ email: 'support@example.com', name: 'Support, Speak Diary' }),
    ).toBe('"Support, Speak Diary" <support@example.com>');
  });

  it('escapes a quote rather than closing the string early', () => {
    expect(
      formatSender({ email: 'support@example.com', name: 'The "Help" Desk' }),
    ).toBe('"The \\"Help\\" Desk" <support@example.com>');
  });

  it('round-trips what it renders', () => {
    const sender = { email: 'support@example.com', name: 'Support, Speak Diary' };
    expect(parseSender(formatSender(sender))).toEqual(sender);
  });
});
