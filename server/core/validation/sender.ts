/**
 * The `From:` an API caller asks to send as.
 *
 * Sending is authorised by a concrete provider alias, and for a while the only
 * way to name one here was its `addr_…` id. That is the right *internal* key
 * and the wrong thing to ask an integrator for: it forces a value that has to
 * be looked up in our dashboard, pasted into their deployment, and re-pasted
 * whenever an address is rebuilt — to say a thing they already know how to say,
 * which is the email address. Every other mail API takes `from`, so an app
 * being ported has that string already and nothing else.
 *
 * So `from` is accepted in the shape it arrives in, display name and all, and
 * resolved against the managed addresses. The id still works, because it is
 * unambiguous and some callers hold one.
 */

/** A `From:` broken into the two parts the header is built from. */
export interface ParsedSender {
  /** The address itself, lowercased — the key an address is found by. */
  email: string;
  /** The display name, if one was given. */
  name: string | null;
}

// Deliberately not RFC 5322 in full: this validates a value we are about to
// put in a header, so it errs narrow. A quoted display name with a comma or an
// escaped quote inside it is rejected rather than half-parsed.
const ANGLE_FORM = /^\s*(?:"([^"]*)"|([^<>"]*?))\s*<\s*([^<>\s]+)\s*>\s*$/;
const BARE_ADDRESS = /^[^\s<>@,"]+@[^\s<>@,".]+(\.[^\s<>@,".]+)+$/;

/**
 * Parses `user@example.com` or `Display Name <user@example.com>`.
 *
 * Returns `null` for anything else, so the caller decides whether that is a
 * validation error or a reason to try the value as an id.
 */
export function parseSender(value: string): ParsedSender | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const angled = ANGLE_FORM.exec(trimmed);

  if (angled) {
    const [, quotedName, bareName, email] = angled;
    if (!BARE_ADDRESS.test(email)) return null;

    const name = (quotedName ?? bareName ?? '').trim();
    return { email: email.toLowerCase(), name: name || null };
  }

  if (!BARE_ADDRESS.test(trimmed)) return null;
  return { email: trimmed.toLowerCase(), name: null };
}

/**
 * Renders a sender back into a header value.
 *
 * The display name is quoted whenever it holds anything that would change how
 * the header parses — a bare `Support, Speak Diary <…>` reads as two
 * recipients, not one name.
 */
export function formatSender(sender: ParsedSender): string {
  if (!sender.name) return sender.email;

  const escaped = sender.name.replace(/(["\\])/g, '\\$1');
  return `"${escaped}" <${sender.email}>`;
}
