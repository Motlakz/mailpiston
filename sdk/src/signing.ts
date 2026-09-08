/**
 * Webhook signing, shared by both ends (plan §14).
 *
 * The server signs with `signPayload` and receivers verify with
 * `verifyWebhook`, from this one file — a signer and a verifier that were
 * written separately agree right up until one of them is edited.
 *
 * Web Crypto rather than `node:crypto` so the same module runs in Node, in a
 * Cloudflare Worker, in Deno, and on the edge. A receiver should not have to
 * pick a runtime to check a signature.
 */

export const MAILPISTON_HEADERS = {
  event: 'X-Mailpiston-Event',
  deliveryId: 'X-Mailpiston-Delivery-Id',
  timestamp: 'X-Mailpiston-Timestamp',
  signature: 'X-Mailpiston-Signature',
} as const;

/** Receivers reject anything older than this by default. */
export const DEFAULT_REPLAY_WINDOW_SECONDS = 300;

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

/**
 * Signs `timestamp + "." + body`, never the body alone.
 *
 * Covering the timestamp is what makes the replay window enforceable: a
 * signature over the body alone stays valid forever, so a captured delivery
 * could be replayed at any point in the future and would verify perfectly.
 */
export async function signPayload(
  timestamp: string,
  body: string,
  secret: string,
): Promise<string> {
  const signature = await crypto.subtle.sign(
    'HMAC',
    await hmacKey(secret),
    new TextEncoder().encode(`${timestamp}.${body}`),
  );

  const hex = [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

  return `sha256=${hex}`;
}

/**
 * Constant-time string comparison.
 *
 * A plain `===` leaks how many leading characters matched, which is enough to
 * recover a signature one character at a time. Comparing every position and
 * accumulating with OR keeps the work independent of where the first
 * difference is; unequal lengths short-circuit, which reveals only the length.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }

  return difference === 0;
}

export class WebhookVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookVerificationError';
  }
}

export interface VerifyOptions {
  /** Seconds of clock skew and delay tolerated. Default 300. */
  replayWindowSeconds?: number;
  /** Injectable for tests. Defaults to the wall clock. */
  now?: () => number;
}

/**
 * Verifies a delivery and returns its parsed body.
 *
 * The request is read once, as text, and the signature is checked against
 * those exact bytes — re-serializing JSON before verifying is the single most
 * common way to get this wrong, because key order and number formatting are
 * not preserved.
 *
 * Verification happens before parsing, so a malformed body from an
 * unauthenticated sender is never handed to `JSON.parse`.
 */
export async function verifyWebhook<T = unknown>(
  request: Request,
  secret: string,
  options: VerifyOptions = {},
): Promise<T> {
  const timestamp = request.headers.get(MAILPISTON_HEADERS.timestamp);
  const signature = request.headers.get(MAILPISTON_HEADERS.signature);

  if (!timestamp || !signature) {
    throw new WebhookVerificationError('Missing MailPiston signature headers');
  }

  const window = options.replayWindowSeconds ?? DEFAULT_REPLAY_WINDOW_SECONDS;
  const now = Math.floor((options.now?.() ?? Date.now()) / 1000);
  const sent = Number(timestamp);

  if (!Number.isFinite(sent)) {
    throw new WebhookVerificationError('Malformed timestamp header');
  }

  // Absolute difference, so a delivery stamped in the future is rejected too:
  // a signature with a far-future timestamp would otherwise stay replayable
  // for as long as that timestamp is ahead of the clock.
  if (Math.abs(now - sent) > window) {
    throw new WebhookVerificationError('Timestamp outside the replay window');
  }

  const body = await request.text();
  const expected = await signPayload(timestamp, body, secret);

  if (!timingSafeEqual(expected, signature)) {
    throw new WebhookVerificationError('Signature does not match');
  }

  return JSON.parse(body) as T;
}
