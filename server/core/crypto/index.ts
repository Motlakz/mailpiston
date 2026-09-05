import 'server-only';

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  createHash,
  timingSafeEqual as nodeTimingSafeEqual,
} from 'node:crypto';

import { env } from '@/server/core/config';

/**
 * Constant-time comparison that is also safe on unequal lengths.
 *
 * `crypto.timingSafeEqual` throws when the buffers differ in size, and that
 * throw is itself an oracle. Comparing digests of the inputs keeps the
 * comparison constant-time and fixed-length regardless of what was supplied.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const digestA = createHash('sha256').update(a, 'utf8').digest();
  const digestB = createHash('sha256').update(b, 'utf8').digest();
  return nodeTimingSafeEqual(digestA, digestB);
}

/** Hex HMAC-SHA256 over the exact bytes given. Never re-serialise before this. */
export function hmacSha256Hex(payload: string, key: string): string {
  return createHmac('sha256', key).update(payload, 'utf8').digest('hex');
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** URL-safe random token. Used for API keys and reply-relay tokens. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

// --- Secret encryption -------------------------------------------------------

const ENCRYPTION_VERSION = 'v1';

function encryptionKey(): Buffer {
  const raw = env.SECRET_ENCRYPTION_KEY;
  // Accept hex or base64 so key material can come from either generator.
  const key = /^[0-9a-fA-F]{64}$/.test(raw)
    ? Buffer.from(raw, 'hex')
    : Buffer.from(raw, 'base64');

  if (key.length !== 32) {
    throw new Error(
      'SECRET_ENCRYPTION_KEY must decode to exactly 32 bytes (hex or base64)',
    );
  }

  return key;
}

/**
 * AES-256-GCM, output `v1:<iv>:<tag>:<ciphertext>` in base64url segments.
 *
 * Endpoint webhook secrets must be recoverable so the server can sign
 * deliveries (§4.3), so they are encrypted rather than hashed. The version
 * prefix exists so a key rotation can be rolled out without guessing at the
 * format of stored rows.
 */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  return [
    ENCRYPTION_VERSION,
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join(':');
}

export function decryptSecret(value: string): string {
  const [version, ivPart, tagPart, ciphertextPart] = value.split(':');

  if (version !== ENCRYPTION_VERSION || !ivPart || !tagPart || !ciphertextPart) {
    throw new Error('Unrecognised secret ciphertext format');
  }

  const decipher = createDecipheriv(
    'aes-256-gcm',
    encryptionKey(),
    Buffer.from(ivPart, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextPart, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
