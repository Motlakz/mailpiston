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

export class ForwardEmailVerifier {
  constructor(private readonly webhookKey: string) {}

  async verify(request: Request): Promise<boolean> {
    const signature = request.headers.get(SIGNATURE_HEADER);
    if (!signature) return false;

    const rawBody = await request.text();
    return verifySignature(rawBody, signature, this.webhookKey);
  }
}
