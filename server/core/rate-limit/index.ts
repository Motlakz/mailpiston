import 'server-only';

import { RateLimitError } from '@/server/core/errors';
import { pool } from '@/server/db/client';

import {
  rateLimitConfigFor,
  type RateLimitActor,
  type RateLimitResult,
} from './config';

export * from './config';

interface RateLimitRow {
  window_started_at: string | Date;
  request_count: number;
}

/**
 * Transactional fixed-window limiter (execution plan §9.4).
 *
 * Two properties this depends on and must not lose:
 *
 * 1. `SELECT … FOR UPDATE` inside a real interactive transaction. A read
 *    followed by a separate write races: two requests both read 29 and both
 *    allow request 30. This runs on the WebSocket pool driver because the Neon
 *    HTTP driver cannot hold an interactive transaction at all (roadmap §1.6).
 *
 * 2. `RateLimitError` is thrown *inside* the transaction, which rolls the
 *    increment back. This is deliberate: a request that was rejected must not
 *    consume quota, or a client stuck in a retry loop can never recover.
 */
export async function checkRateLimit(
  actor: RateLimitActor,
  endpoint: string,
): Promise<RateLimitResult> {
  const config = rateLimitConfigFor(endpoint);

  const now = new Date();
  const nowMs = now.getTime();

  try {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const selected = await client.query<RateLimitRow>(
        `
        SELECT window_started_at, request_count
        FROM rate_limits
        WHERE actor_key = $1
          AND endpoint = $2
        FOR UPDATE
        `,
        [actor, endpoint],
      );

      let result: RateLimitResult;

      if (selected.rowCount === 0) {
        // No row yet. INSERT … ON CONFLICT rather than a bare INSERT: two
        // first-ever requests can both miss the SELECT, and only one may win.
        await client.query(
          `
          INSERT INTO rate_limits (actor_key, endpoint, window_started_at, request_count)
          VALUES ($1, $2, $3, 1)
          ON CONFLICT (actor_key, endpoint) DO UPDATE
            SET request_count = rate_limits.request_count + 1,
                updated_at = NOW()
          `,
          [actor, endpoint, now],
        );

        result = {
          allowed: true,
          remaining: config.requests - 1,
          resetAt: nowMs + config.windowMs,
          limit: config.requests,
        };
      } else {
        const row = selected.rows[0];
        const windowStartedAt = new Date(row.window_started_at).getTime();
        const expired = nowMs - windowStartedAt >= config.windowMs;

        if (expired) {
          await client.query(
            `
            UPDATE rate_limits
            SET window_started_at = $3,
                request_count = 1,
                updated_at = NOW()
            WHERE actor_key = $1
              AND endpoint = $2
            `,
            [actor, endpoint, now],
          );

          result = {
            allowed: true,
            remaining: config.requests - 1,
            resetAt: nowMs + config.windowMs,
            limit: config.requests,
          };
        } else if (row.request_count >= config.requests) {
          // Thrown inside the transaction on purpose — see the doc comment.
          throw new RateLimitError(windowStartedAt + config.windowMs);
        } else {
          const nextCount = row.request_count + 1;

          await client.query(
            `
            UPDATE rate_limits
            SET request_count = $3,
                updated_at = NOW()
            WHERE actor_key = $1
              AND endpoint = $2
            `,
            [actor, endpoint, nextCount],
          );

          result = {
            allowed: true,
            remaining: config.requests - nextCount,
            resetAt: windowStartedAt + config.windowMs,
            limit: config.requests,
          };
        }
      }

      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    if (error instanceof RateLimitError) {
      throw error;
    }

    console.error('Rate limit check failed', error);

    // The limiter is unavailable, not the caller's fault. §9.5 decides.
    if (!config.failOpen) {
      throw new RateLimitError(nowMs + 60_000);
    }

    return {
      allowed: true,
      remaining: config.requests,
      resetAt: nowMs + config.windowMs,
      limit: config.requests,
    };
  }
}

/** Headers every rate-limited response carries, allowed or not. */
export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    'X-RateLimit-Limit': String(result.limit),
    'X-RateLimit-Remaining': String(Math.max(0, result.remaining)),
    'X-RateLimit-Reset': String(Math.ceil(result.resetAt / 1000)),
  };
}
