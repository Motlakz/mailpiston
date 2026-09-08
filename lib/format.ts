/**
 * Shared formatting for the message lists.
 *
 * Inbox and Sent are the same object seen from two directions, so they format
 * time and preview text from one place — two lists that agree on everything but
 * their date format look like two different products.
 */

/** Time for today, date for anything older — the usual mail-client shorthand. */
export function formatWhen(date: Date): string {
  const isToday = new Date().toDateString() === date.toDateString();

  return isToday
    ? date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : date.toISOString().slice(0, 10);
}

/**
 * A one-line preview of a message body.
 *
 * Whitespace is collapsed first: mail arrives full of hard wraps and quoted
 * blocks, and a raw slice of it renders as ragged fragments rather than a
 * sentence.
 */
export function previewOf(text: string | null, length = 140): string | null {
  if (!text) return null;

  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (!collapsed) return null;

  return collapsed.length > length
    ? `${collapsed.slice(0, length).trimEnd()}…`
    : collapsed;
}
