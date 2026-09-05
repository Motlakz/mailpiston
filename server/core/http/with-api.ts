import 'server-only';

import { NextResponse } from 'next/server';
import type { ZodType } from 'zod';

import { resolveApiKey, type ApiKeyIdentity } from '@/server/core/auth/api-key';
import { getOperatorSession } from '@/server/core/auth/session';
import {
  RateLimitError,
  ValidationError,
  formatErrorResponse,
  statusCodeFor,
} from '@/server/core/errors';
import { checkRateLimit, rateLimitHeaders } from '@/server/core/rate-limit';
import type { RateLimitActor } from '@/server/core/rate-limit';

/**
 * Composition point for public API routes (roadmap §2.3).
 *
 * Authenticity, rate limiting, and validation stay separate systems — this only
 * fixes the order in which they run, so no individual route can get it wrong:
 *
 *   1. resolve the caller          → AuthError       (401)
 *   2. rate limit                  → RateLimitError  (429)
 *   3. validate the body           → ValidationError (400)
 *   4. run the handler
 *   5. format anything thrown
 *
 * Idempotency is deliberately absent: its fingerprint is derived from the
 * *normalised* payload, so only a handler can compute it. Retry lives entirely
 * in Inngest and never touches a request path.
 */
export interface ApiContext<TBody = unknown> {
  request: Request;
  body: TBody;
  actor: RateLimitActor;
  apiKey: ApiKeyIdentity | null;
  params: Record<string, string>;
}

export interface WithApiOptions<TBody> {
  /** Rate-limit bucket key. Matches the paths in §9.3, not the concrete URL. */
  endpoint: string;
  /** Body schema. Omit for routes that take no body. */
  schema?: ZodType<TBody>;
  /**
   * Allow a signed-in dashboard session in place of an API key.
   * Default true — the dashboard calls the same routes the SDK does.
   */
  allowSession?: boolean;
}

type RouteContext = { params: Promise<Record<string, string>> };

export function withApi<TBody = undefined>(
  handler: (context: ApiContext<TBody>) => Promise<Response>,
  options: WithApiOptions<TBody>,
) {
  return async (request: Request, routeContext?: RouteContext): Promise<Response> => {
    let rateLimitInfo: Record<string, string> = {};

    try {
      // 1. Who is calling? An API key wins over a session when both are present.
      const authorization = request.headers.get('authorization');
      let apiKey: ApiKeyIdentity | null = null;
      let actor: RateLimitActor;

      if (authorization) {
        apiKey = await resolveApiKey(authorization);
        actor = `apiKey:${apiKey.id}`;
      } else {
        const session =
          options.allowSession === false ? null : await getOperatorSession();

        if (!session) {
          // Throw the same shape whether the key was absent or bad.
          await resolveApiKey(null);
          throw new Error('unreachable');
        }

        actor = `user:${session.userId}`;
      }

      // 2. Rate limit. Throws RateLimitError, which rolls back its own
      //    increment so a rejected request does not consume quota.
      const limit = await checkRateLimit(actor, options.endpoint);
      rateLimitInfo = rateLimitHeaders(limit);

      // 3. Validate.
      let body = undefined as TBody;

      if (options.schema) {
        const raw = await readJson(request);
        const parsed = options.schema.safeParse(raw);

        if (!parsed.success) {
          throw new ValidationError('Request body failed validation', parsed.error.issues);
        }

        body = parsed.data;
      }

      // 4. Run.
      const params = routeContext ? await routeContext.params : {};
      const response = await handler({ request, body, actor, apiKey, params });

      for (const [key, value] of Object.entries(rateLimitInfo)) {
        response.headers.set(key, value);
      }

      return response;
    } catch (error) {
      return errorResponse(error, rateLimitInfo);
    }
  };
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ValidationError('Request body is not valid JSON');
  }
}

export function errorResponse(
  error: unknown,
  extraHeaders: Record<string, string> = {},
): Response {
  const headers = new Headers(extraHeaders);

  if (error instanceof RateLimitError) {
    headers.set(
      'Retry-After',
      String(Math.max(1, Math.ceil((error.resetAt - Date.now()) / 1000))),
    );
  }

  // Unexpected errors are logged inside formatErrorResponse; the body they
  // produce stays generic so internals never reach a client.
  return NextResponse.json(formatErrorResponse(error), {
    status: statusCodeFor(error),
    headers,
  });
}
