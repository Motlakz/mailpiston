import { describe, expect, it } from 'vitest';

import { formatDay, formatWhen } from './format';

/**
 * These formatters run inside server components, where "local" is the
 * renderer's timezone rather than the viewer's — UTC on a deployment, and
 * whatever the machine is set to in development.
 *
 * The bug these lock down: `formatDay` read the date with `getDate()` while the
 * reading pane printed `toISOString()`. At UTC+2 a message received at
 * 19 Sep 22:42 UTC was listed as 20 Sep and opened as 19 Sep — one calendar day
 * apart, from one timestamp.
 */
describe('formatDay', () => {
  it('reads the date in UTC, not the renderer’s timezone', () => {
    // 22:42 UTC is already the next day anywhere east of UTC+1:18.
    expect(formatDay(new Date('2026-09-19T22:42:00Z'))).toBe('19 Sep 26');
  });

  it('agrees with the ISO date the reading pane prints', () => {
    const date = new Date('2026-09-19T22:42:00Z');
    const isoDay = date.toISOString().slice(8, 10);

    expect(formatDay(date).slice(0, 2)).toBe(isoDay);
  });

  it('pads single-digit days and shortens the year', () => {
    expect(formatDay(new Date('2026-01-05T09:00:00Z'))).toBe('05 Jan 26');
  });

  it('does not roll over just before midnight UTC', () => {
    expect(formatDay(new Date('2026-12-31T23:59:59Z'))).toBe('31 Dec 26');
  });
});

describe('formatWhen', () => {
  it('falls back to an ISO date for anything not from today', () => {
    expect(formatWhen(new Date('2020-03-04T15:00:00Z'))).toBe('2020-03-04');
  });

  it('shows a zero-padded UTC clock for today', () => {
    const now = new Date();
    const todayEarly = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        4,
        7,
      ),
    );

    expect(formatWhen(todayEarly)).toBe('04:07');
  });
});
