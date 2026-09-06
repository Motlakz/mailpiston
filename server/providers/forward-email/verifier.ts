import { createHmac, createHash, timingSafeEqual } from 'node:crypto';

/**
 * Inbound webhook authenticity for Forward Email (roadmap §1.3).
 *
 * Forward Email sends `X-Webhook-Signature: <hex HMAC-SHA256 of the raw
 * request body, keyed with the domain's webhook key>`.
 *
 * Two rules this file exists to keep:
 *
 *  - The signature covers the *raw bytes*. Anything that parses and
 *    re-serialises first will produce a different body and never match.
 *  - Comparison is constant-time. `===` on a hex digest leaks the position of
 *    the first differing character, which is enough to forge one byte at a time.
 *
 * Kept free of `server-only` and of any config import so the fixture tests can
 * exercise it directly.
 */
export const SIGNATURE_HEADER = 'x-webhook-signature';

export function computeSignature(rawBody: string, webhookKey: string): string {
  return createHmac('sha256', webhookKey).update(rawBody, 'utf8').digest('hex');
}

export function verifySignature(
  rawBody: string,
  providedSignature: string | null | undefined,
  webhookKey: string,
): boolean {
  if (!providedSignature) return false;

  const expected = computeSignature(rawBody, webhookKey);

  // Digest both sides so the comparison is fixed-length: timingSafeEqual throws
  // on a length mismatch, and that throw is itself a signal an attacker can use.
  const a = createHash('sha256').update(expected, 'utf8').digest();
  const b = createHash('sha256')
    .update(providedSignature.trim().toLowerCase(), 'utf8')
    .digest();

  return timingSafeEqual(a, b);
}

/**
 * Verifies against *every* candidate key rather than one.
 *
 * Forward Email's webhook key is per domain, so a deployment serving several
 * domains has several keys and cannot know which one signed a request until it
 * has read the body — which is exactly the thing it may not trust yet.
 *
 * Two ways out. Parse the unverified body to learn the recipient domain and
 * pick its key: fast, and safe in principle, since claiming a domain does not
 * let you forge that domain's HMAC. Or try them all. This takes the second,
 * because the first inverts the "verify before you parse" ordering the ingress
 * wrapper exists to guarantee, and an invariant that simple is worth more than
 * the microseconds. A single-tenant control plane has tens of domains, not
 * thousands, and an HMAC over a few hundred kilobytes is measured in
 * microseconds.
 *
 * Every candidate is tried even after one matches. Returning early would make
 * the response time depend on which key matched, and on how many keys exist —
 * a side channel over the very secrets this function protects.
 */
export function verifyAgainstAny(
  rawBody: string,
  providedSignature: string | null | undefined,
  webhookKeys: readonly string[],
): boolean {
  if (!providedSignature) return false;

  let matched = false;

  for (const key of webhookKeys) {
    if (verifySignature(rawBody, providedSignature, key)) matched = true;
  }

  return matched;
}

/** Supplies the keys a request may have been signed with. */
export type WebhookKeyResolver = () => Promise<readonly string[]>;

export class ForwardEmailVerifier {
  private readonly resolveKeys: WebhookKeyResolver;

  /**
   * Takes a resolver rather than a key so the provider stays ignorant of where
   * keys are stored. The registry supplies one that reads the per-domain keys
   * out of the database and falls back to the environment.
   */
  constructor(keys: string | WebhookKeyResolver) {
    this.resolveKeys =
      typeof keys === 'function' ? keys : async () => (keys ? [keys] : []);
  }

  async verify(request: Request): Promise<boolean> {
    const signature = request.headers.get(SIGNATURE_HEADER);
    if (!signature) return false;

    const rawBody = await request.text();
    const keys = await this.resolveKeys();

    return verifyAgainstAny(rawBody, signature, keys);
  }
}
