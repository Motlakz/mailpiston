/**
 * What we know about a sender's domain before reading a word of their mail.
 *
 * Two lists, and they answer different questions.
 *
 * **Trusted platforms** are the large services an operator has an account
 * with — Google, Apple, GitHub, their payment provider. Their mail is
 * overwhelmingly transactional, it routinely carries `List-Unsubscribe`, and
 * the rule engine used to put every one of them in Suspicious for it. They are
 * discounted by the classifier (only when the envelope agrees, see
 * `classifier.ts`) and the automatic blocker never touches them: blocking
 * `noreply-accounts@google.com` because somebody forged it once would cost the
 * operator their security alerts.
 *
 * **Shared mailbox providers** are domains where the address is the identity
 * and the domain is everyone — Gmail, and also newsletter platforms like
 * Substack, where each address is a different publication. Blocking `gmail.com` because one Gmail user is a
 * spammer blocks the operator's customers, so nothing — automatic or by hand
 * from a message — ever blocks or trusts one of these at domain scope.
 *
 * Both are deliberately short, hand-kept and boring. A platform missing from
 * the list is one "Trust sender" click away; a platform wrongly on it is a
 * hole in the filter, so the bar for adding one is "a company with a DMARC
 * reject policy that only sends its own mail from this domain".
 */

export const TRUSTED_PLATFORM_DOMAINS: readonly string[] = [
  // Identity, OS and cloud accounts
  'google.com',
  'youtube.com',
  'apple.com',
  'microsoft.com',
  'amazon.com',
  'linkedin.com',
  'facebookmail.com',
  'x.com',
  // Developer infrastructure
  'github.com',
  'gitlab.com',
  'vercel.com',
  'netlify.com',
  'cloudflare.com',
  'digitalocean.com',
  'heroku.com',
  'neon.tech',
  'supabase.com',
  'supabase.io',
  'inngest.com',
  'expo.dev',
  'npmjs.com',
  'docker.com',
  'sentry.io',
  'twilio.com',
  'openai.com',
  'anthropic.com',
  // Payments and workspace tools
  'stripe.com',
  'paypal.com',
  'dodopayments.com',
  'shopify.com',
  'slack.com',
  'atlassian.com',
  'notion.so',
  'figma.com',
  'zoom.us',
  'dropbox.com',
  'discord.com',
];

export const SHARED_MAILBOX_DOMAINS: readonly string[] = [
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'yahoo.com',
  'ymail.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'pm.me',
  'gmx.com',
  'gmx.net',
  'gmx.de',
  'web.de',
  'mail.com',
  'zoho.com',
  'yandex.com',
  'yandex.ru',
  'mail.ru',
  'qq.com',
  '163.com',
  '126.com',
  'fastmail.com',
  'hey.com',
  'tutanota.com',
  'tuta.io',
  // Publishing and sending platforms: every address is a different
  // publication or customer, exactly like a mailbox provider.
  'substack.com',
  'beehiiv.com',
  'ghost.io',
  'medium.com',
  'loops.so',
  'buttondown.email',
  'convertkit-mail.com',
  'mailerlite.com',
];

/** Equal, or one is a subdomain of the other. */
export function sameDomain(a: string, b: string): boolean {
  const left = a.toLowerCase().replace(/\.$/, '');
  const right = b.toLowerCase().replace(/\.$/, '');

  return (
    left === right ||
    left.endsWith(`.${right}`) ||
    right.endsWith(`.${left}`)
  );
}

/** `accounts.google.com` is Google; `google.com.evil.test` is not. */
export function isTrustedPlatform(domain: string | null | undefined): boolean {
  if (!domain) return false;
  const value = domain.toLowerCase();
  return TRUSTED_PLATFORM_DOMAINS.some(
    (trusted) => value === trusted || value.endsWith(`.${trusted}`),
  );
}

export function isSharedMailboxDomain(domain: string | null | undefined): boolean {
  if (!domain) return false;
  const value = domain.toLowerCase();
  return SHARED_MAILBOX_DOMAINS.some(
    (shared) => value === shared || value.endsWith(`.${shared}`),
  );
}

/**
 * The part of a host a company actually owns: `mail.indieneed.com` →
 * `indieneed.com`, `news.example.co.uk` → `example.co.uk`.
 *
 * A heuristic rather than the Public Suffix List, which is a large file to
 * ship for one decision. It handles the shape that matters — a two-letter
 * country code under a short generic label (`co.uk`, `com.au`, `ac.th`) — and
 * errs towards the *longer* name otherwise, which can only make a domain block
 * narrower than intended, never wider.
 */
export function registrableDomain(host: string): string {
  const labels = host.toLowerCase().replace(/\.$/, '').split('.').filter(Boolean);
  if (labels.length <= 2) return labels.join('.');

  const tld = labels[labels.length - 1];
  const second = labels[labels.length - 2];
  const countrySecondLevel =
    tld.length === 2 && /^(co|com|net|org|ac|gov|edu|ltd|plc|or|ne|go)$/.test(second);

  return labels.slice(countrySecondLevel ? -3 : -2).join('.');
}
