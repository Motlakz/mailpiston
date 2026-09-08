import { describe, expect, it } from 'vitest';

import { withoutBlanks } from './config';

/**
 * `.env.example` lists every optional variable with an empty value — that is
 * how you document one without supplying it, and copying that file is the first
 * thing anyone does with this repository.
 *
 * These cases are the difference between that copy booting and failing with a
 * complaint about a variable the operator deliberately left alone.
 */
describe('withoutBlanks', () => {
  it('treats an empty value as unset', () => {
    expect(withoutBlanks({ INNGEST_SIGNING_KEY: '' })).toEqual({
      INNGEST_SIGNING_KEY: undefined,
    });
  });

  it('treats a whitespace-only value as unset', () => {
    // A trailing space after `FOO=` is invisible in an editor and would
    // otherwise satisfy `.min(1)` with a string that means nothing.
    expect(withoutBlanks({ RELAY_DOMAIN: '   ' })).toEqual({
      RELAY_DOMAIN: undefined,
    });
  });

  it('leaves real values alone, including whitespace inside them', () => {
    expect(
      withoutBlanks({
        ALLOWED_OPERATOR_EMAILS: 'one@example.com, two@example.com',
        STORE_RAW_MIME: 'false',
        RETENTION_RAW_MIME_DAYS: '30',
      }),
    ).toEqual({
      ALLOWED_OPERATOR_EMAILS: 'one@example.com, two@example.com',
      STORE_RAW_MIME: 'false',
      RETENTION_RAW_MIME_DAYS: '30',
    });
  });

  it('does not blank a value that is meaningfully "0" or "false"', () => {
    // Falsy strings are values, not absences. Blanking them would silently
    // flip a deliberately-off flag back to its default.
    expect(withoutBlanks({ A: '0', B: 'false' })).toEqual({
      A: '0',
      B: 'false',
    });
  });

  it('passes an already-absent variable through untouched', () => {
    expect(withoutBlanks({ MISSING: undefined })).toEqual({
      MISSING: undefined,
    });
  });
});
