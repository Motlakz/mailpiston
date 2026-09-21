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

/**
 * A date, without a time.
 *
 * Read in UTC, deliberately. These formatters run inside server components, so
 * the machine's "local" time is the *renderer's* and never the viewer's — UTC
 * on a deployment, whatever the laptop is set to in development. Mixing that
 * with the UTC timestamps shown elsewhere produced a message dated 20 Sep in
 * the list and 19 Sep 22:42 UTC in the reading pane: both correct, one calendar
 * day apart, from a single timestamp.
 */
export function formatDay(date: Date): string {
  const day = pad(date.getUTCDate());
  const month = MONTHS[date.getUTCMonth()];
  const year = String(date.getUTCFullYear()).slice(-2);

  return `${day} ${month} ${year}`;
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** Byte counts for attachment rows. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
