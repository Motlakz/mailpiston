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

function decodeKey(raw: string, name: string): Buffer {
  // Accept hex or base64 so key material can come from either generator.
  const key = /^[0-9a-fA-F]{64}$/.test(raw)
    ? Buffer.from(raw, 'hex')
    : Buffer.from(raw, 'base64');

  if (key.length !== 32) {
    throw new Error(`${name} must decode to exactly 32 bytes (hex or base64)`);
  }

  return key;
}

function encryptionKey(): Buffer {
  return decodeKey(env.SECRET_ENCRYPTION_KEY, 'SECRET_ENCRYPTION_KEY');
}

/**
 * Every key a ciphertext might have been written under: the current one, then
 * the previous one if a rotation is in progress.
 *
 * Without this, rotating the encryption key is not a migration but an outage —
 * every stored webhook key and endpoint secret becomes undecryptable the moment
 * the variable changes, and inbound verification and webhook signing both stop
 * at once. With it, rotation is: add the old key as `_PREVIOUS`, set the new
 * one as current, re-encrypt everything, then drop `_PREVIOUS`.
 */
function decryptionKeys(): Array<{ key: Buffer; name: string }> {
  const keys = [{ key: encryptionKey(), name: 'SECRET_ENCRYPTION_KEY' }];

  if (env.SECRET_ENCRYPTION_KEY_PREVIOUS) {
    keys.push({
      key: decodeKey(
        env.SECRET_ENCRYPTION_KEY_PREVIOUS,
        'SECRET_ENCRYPTION_KEY_PREVIOUS',
      ),
      name: 'SECRET_ENCRYPTION_KEY_PREVIOUS',
    });
  }

  return keys;
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

/**
 * Decrypts under the current key, falling back to the previous one during a
 * rotation.
 *
 * GCM authenticates, so a wrong key fails loudly rather than returning
 * plausible garbage — trying keys in order is safe, and the failure of the last
 * one is the failure reported.
 */
export function decryptSecret(value: string): string {
  const [version, ivPart, tagPart, ciphertextPart] = value.split(':');

  if (version !== ENCRYPTION_VERSION || !ivPart || !tagPart || !ciphertextPart) {
    throw new Error('Unrecognised secret ciphertext format');
  }

  const iv = Buffer.from(ivPart, 'base64url');
  const tag = Buffer.from(tagPart, 'base64url');
  const ciphertext = Buffer.from(ciphertextPart, 'base64url');

  let lastError: unknown;

  for (const { key } of decryptionKeys()) {
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);

      return Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]).toString('utf8');
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(
    `Could not decrypt with any configured key: ${(lastError as Error)?.message ?? 'unknown error'}`,
  );
}

/**
 * Whether a ciphertext is already under the current key.
 *
 * Used by the re-encryption pass so it can be re-run safely: a row already
 * migrated is skipped rather than decrypted and rewritten, which keeps the pass
 * idempotent and its progress meaningful.
 */
export function isUnderCurrentKey(value: string): boolean {
  const [version, ivPart, tagPart, ciphertextPart] = value.split(':');
  if (version !== ENCRYPTION_VERSION || !ivPart || !tagPart || !ciphertextPart) {
    return false;
  }

  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      encryptionKey(),
      Buffer.from(ivPart, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
    decipher.update(Buffer.from(ciphertextPart, 'base64url'));
    decipher.final();
    return true;
  } catch {
    return false;
  }
}
