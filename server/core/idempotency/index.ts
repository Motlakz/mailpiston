import 'server-only';

import { pool } from '@/server/db/client';

export { createInboundFingerprint } from './fingerprint';


/**
 * Atomic claim (§10.2). Returns true exactly once per key, for the caller that
 * won the insert; every retry of the same provider delivery gets false.
 *
 * This is one statement on purpose — the uniqueness of the primary key is the
 * lock, so no transaction or read-then-write is involved.
 */
export async function claimIdempotencyKey(
  key: string,
  source: string,
): Promise<boolean> {
  const result = await pool.query(
    `
    INSERT INTO idempotency_keys (key, source)
    VALUES ($1, $2)
    ON CONFLICT (key) DO NOTHING
    RETURNING key
    `,
    [key, source],
  );

  return result.rowCount === 1;
}

/**
 * Releases a claim so the provider's next retry can be processed.
 *
 * Call this only when processing failed *after* the claim but before anything
 * durable was written — otherwise a transient failure permanently swallows the
 * message.
 */
export async function releaseIdempotencyKey(key: string): Promise<void> {
  await pool.query(`DELETE FROM idempotency_keys WHERE key = $1`, [key]);
}
