/**
 * Keyset cursors for the event stream (roadmap Phase 9).
 *
 * A cursor on the timestamp alone is not enough here. Several events for one
 * message are written inside a single transaction and routinely share a
 * millisecond — `email.received`, `webhook.queued`, `webhook.delivered` — so a
 * strict `occurred_at < cursor` silently drops whichever of them straddled a
 * page boundary. Pairing the timestamp with the row id makes the comparison
 * total, and Postgres compares the tuple in one indexable expression.
 *
 * The id is an arbitrary tiebreak — our ids are random, not sequential — but it
 * only has to be *stable*, and it is.
 */
export interface TimeCursor {
  occurredAt: Date;
  id: string;
}

export function encodeTimeCursor(cursor: TimeCursor): string {
  return `${cursor.occurredAt.toISOString()}|${cursor.id}`;
}

/**
 * Returns null for anything unparseable.
 *
 * A cursor is a client-supplied opaque string, and the most common bad one is a
 * stale bookmark. Paging from the start is a mildly wrong answer; a 400 on a
 * saved URL is a broken page.
 */
export function decodeTimeCursor(
  value: string | null | undefined,
): TimeCursor | null {
  if (!value) return null;

  // The first separator. An ISO timestamp cannot contain one, so everything
  // after it is the id — which stays true even if ids ever gain characters.
  const separator = value.indexOf('|');
  if (separator <= 0) return null;

  const occurredAt = new Date(value.slice(0, separator));
  const id = value.slice(separator + 1);

  if (Number.isNaN(occurredAt.getTime()) || !id) return null;

  return { occurredAt, id };
}
