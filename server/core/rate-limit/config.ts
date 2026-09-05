/**
 * Rate-limit configuration (execution plan §9.3) and the actor model (§9.2).
 *
 * Kept free of `server-only` and of any database import so it can be unit
 * tested and reasoned about on its own.
 */
export type RateLimitActor =
  | `user:${string}`
  | `apiKey:${string}`
  | `endpoint:${string}`
  | `provider:${string}`
  | `ip:${string}`;

export interface RateLimitConfig {
  requests: number;
  windowMs: number;
  /**
   * What to do when the limiter *itself* fails (§9.5).
   *
   * false — fail closed. Anything that spends money, sends mail, or mutates
   * provider infrastructure.
   * true  — fail open. Already-authenticated provider callbacks: dropping a
   * real inbound email over a transient database error is worse than
   * briefly allowing a burst.
   */
  failOpen: boolean;
}

export const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  requests: 100,
  windowMs: 60 * 60 * 1000,
  failOpen: true,
};

export const RATE_LIMITS: Record<string, RateLimitConfig> = {
  '/v1/emails/send': {
    requests: 100,
    windowMs: 60 * 60 * 1000,
    failOpen: false,
  },

  '/v1/emails/reply': {
    requests: 200,
    windowMs: 60 * 60 * 1000,
    failOpen: false,
  },

  '/v1/domains': {
    requests: 30,
    windowMs: 60 * 60 * 1000,
    failOpen: false,
  },

  '/v1/addresses': {
    requests: 100,
    windowMs: 60 * 60 * 1000,
    failOpen: false,
  },

  '/v1/endpoints': {
    requests: 100,
    windowMs: 60 * 60 * 1000,
    failOpen: false,
  },

  '/v1/api-keys': {
    requests: 20,
    windowMs: 60 * 60 * 1000,
    failOpen: false,
  },

  '/api/providers/forward-email/inbound': {
    requests: 5000,
    windowMs: 5 * 60 * 1000,
    failOpen: true,
  },

  '/api/providers/forward-email/events': {
    requests: 5000,
    windowMs: 5 * 60 * 1000,
    failOpen: true,
  },
};

export function rateLimitConfigFor(endpoint: string): RateLimitConfig {
  return RATE_LIMITS[endpoint] ?? DEFAULT_RATE_LIMIT;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  limit: number;
}
