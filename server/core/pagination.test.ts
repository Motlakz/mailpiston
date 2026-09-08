import { describe, expect, it } from 'vitest';

import { decodeTimeCursor, encodeTimeCursor } from './pagination';

describe('time cursors', () => {
  it('round-trips', () => {
    const cursor = {
      occurredAt: new Date('2026-09-05T12:00:00.123Z'),
      id: 'evt_abc123',
    };

    expect(decodeTimeCursor(encodeTimeCursor(cursor))).toEqual(cursor);
  });

  it('keeps sub-second precision', () => {
    // Losing the milliseconds is what makes a same-transaction event slip
    // through a page boundary in the first place.
    const cursor = {
      occurredAt: new Date('2026-09-05T12:00:00.987Z'),
      id: 'evt_abc123',
    };

    expect(decodeTimeCursor(encodeTimeCursor(cursor))?.occurredAt.getTime()).toBe(
      cursor.occurredAt.getTime(),
    );
  });

  it('splits on the first separator, so a separator in the id is harmless', () => {
    // An ISO timestamp cannot contain one, so everything after the first is the
    // id — true today, and still true if ids ever gain characters.
    const decoded = decodeTimeCursor('2026-09-05T12:00:00.000Z|evt_a|b');
    expect(decoded?.id).toBe('evt_a|b');
    expect(decoded?.occurredAt.toISOString()).toBe('2026-09-05T12:00:00.000Z');
  });

  it.each<[string, string | null | undefined]>([
    ['empty', ''],
    ['null', null],
    ['undefined', undefined],
    ['no separator', 'not-a-cursor'],
    ['no timestamp', '|evt_1'],
    ['no id', '2026-09-05T12:00:00.000Z|'],
    ['an unparseable timestamp', 'yesterday|evt_1'],
  ])('returns null for %s', (_label, value) => {
    // A stale bookmark should page from the start, not 400. The cursor is an
    // opaque client-held string, and rejecting it breaks a saved URL.
    expect(decodeTimeCursor(value)).toBeNull();
  });
});
