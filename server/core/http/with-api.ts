import 'server-only';

import { NextResponse } from 'next/server';
import type { ZodType } from 'zod';

import { resolveApiKey, type ApiKeyIdentity } from '@/server/core/auth/api-key';
import { getOperatorSession } from '@/server/core/auth/session';
import { env } from '@/server/core/config';
import { sha256Hex } from '@/server/core/crypto';
import {
  IdempotencyConflictError,
  RateLimitError,
  ValidationError,
  formatErrorResponse,
  statusCodeFor,
} from '@/server/core/errors';
import { claimIdempotencyRequest } from '@/server/core/idempotency';
import { checkRateLimit, rateLimitHeaders } from '@/server/core/rate-limit';
import type { RateLimitActor } from '@/server/core/rate-limit';

import { readJsonBody } from './body';

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
  /**
   * The workspace this request acts inside.
   *
   * Resolved once here, from whichever credential authenticated — an API key
   * names its tenant, a session names its membership. Handlers take it rather
   * than looking it up, so there is one place that decides whose data a
   * request can reach.
   */
  tenantId: string;
  params: Record<string, string>;
}

/**
 * What to write to the audit log when this route succeeds (§24).
 *
 * Declared here rather than called from inside a handler so that "is this a
 * privileged mutation?" is answered next to the route's other cross-cutting
 * concerns. A handler that has to remember to log is a handler that eventually
 * does not.
 */
export interface AuditOptions {
  /** e.g. `domain.create`. Dot-separated resource and verb. */
  action: string;
  resourceType: string;
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
  /** Set on privileged mutations. Omitted on reads. */
  audit?: AuditOptions;
  /** Prevent an ambiguous client retry from executing this mutation twice. */
  idempotency?: boolean;
}

/**
 * Next hands this to every route handler, dynamic or not — but it sets
 * `params` to `undefined` when the segment has no dynamic parts (see
 * `params: context.params ? … : undefined` in
 * `next/dist/server/route-modules/app-route/module.js`). The context object
 * being present therefore says nothing about whether the promise is, and
 * typing `params` as always-present is what let the bug below compile.
 */
type RouteContext = { params?: Promise<Record<string, string>> };

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
      let tenantId: string;

      if (authorization) {
        apiKey = await resolveApiKey(authorization);
        actor = `apiKey:${apiKey.id}`;
        tenantId = apiKey.tenantId;
      } else {
        const session =
          options.allowSession === false ? null : await getOperatorSession();

        if (!session) {
          // Throw the same shape whether the key was absent or bad.
          await resolveApiKey(null);
          throw new Error('unreachable');
        }

        actor = `user:${session.userId}`;
        tenantId = session.tenantId;
      }

      // 2. Rate limit. Throws RateLimitError, which rolls back its own
      //    increment so a rejected request does not consume quota.
      const limit = await checkRateLimit(actor, options.endpoint);
      rateLimitInfo = rateLimitHeaders(limit);

      // 3. Validate.
      let body = undefined as TBody;

      if (options.schema) {
        const raw = await readJsonBody(request, env.API_MAX_BODY_BYTES);
        const parsed = options.schema.safeParse(raw);

        if (!parsed.success) {
          throw new ValidationError('Request body failed validation', parsed.error.issues);
        }

        body = parsed.data;
      }

      if (options.idempotency) {
        await claimRequestIdempotency(request, tenantId, options.endpoint, body);
      }

      // 4. Run.
      // Awaiting an absent promise yields `undefined`, not the empty object
      // every reader downstream assumes — `recordAudit` reads `params.id`, so
      // an audited route with no `[id]` segment threw a TypeError and lost its
      // audit entry while the mutation itself succeeded.
      const params = (await routeContext?.params) ?? {};
      const response = await handler({ request, body, actor, apiKey, params, tenantId });

      // 5. Record, on success only. A failed mutation changed nothing, and an
      //    audit trail full of attempts is one nobody reads.
      if (options.audit && response.status < 400) {
        await recordAudit(options.audit, tenantId, actor, params, body);
      }

      for (const [key, value] of Object.entries(rateLimitInfo)) {
        response.headers.set(key, value);
      }

      return response;
    } catch (error) {
      return errorResponse(error, rateLimitInfo);
    }
  };
}

async function claimRequestIdempotency(
  request: Request,
  tenantId: string,
  endpoint: string,
  body: unknown,
): Promise<void> {
  const supplied = request.headers.get('idempotency-key');
  if (!supplied) return;

  const key = supplied.trim();
  if (key.length < 8 || key.length > 200 || /[^\x21-\x7e]/.test(key)) {
    throw new ValidationError(
      'Idempotency-Key must be 8 to 200 visible ASCII characters',
    );
  }

  const claim = await claimIdempotencyRequest(
    `api:${sha256Hex(`${tenantId}\0${endpoint}\0${key}`)}`,
    `payload:${sha256Hex(JSON.stringify(body ?? null))}`,
  );

  if (claim === 'replay') {
    throw new IdempotencyConflictError(
      'A request with this Idempotency-Key was already accepted; inspect the mail log before sending again',
    );
  }

  if (claim === 'conflict') {
    throw new IdempotencyConflictError(
      'This Idempotency-Key was already used with a different request body',
      'IDEMPOTENCY_KEY_REUSED',
    );
  }
}

/**
 * Writes the audit entry, and never fails the request if it cannot.
 *
 * The mutation already happened by this point. Throwing here would return an
 * error for work that succeeded, and the caller would retry it — turning a
 * logging outage into duplicate domains and duplicate keys. A missing audit
 * entry is a gap in a record; a retried mutation is a change to the system.
 *
 * The repository is imported lazily so that `withApi` — which every route
 * imports — does not pull the database client into routes that never touch it.
 */
async function recordAudit(
  audit: AuditOptions,
  tenantId: string,
  actor: RateLimitActor,
  params: Record<string, string>,
  body: unknown,
): Promise<void> {
  try {
    const { repositoriesFor } = await import('@/server/repositories');

    await repositoriesFor(tenantId).audit.record({
      actor,
      action: audit.action,
      resourceType: audit.resourceType,
      resourceId: params.id ?? null,
      metadata: auditMetadata(body),
    });
  } catch (error) {
    console.error('Failed to write audit entry', audit.action, error);
  }
}

/**
 * The request body, minus anything that must not be written down.
 *
 * A webhook key arrives in the body of the very route whose mutation is worth
 * auditing, and an audit log is a plaintext table read by more people than the
 * encrypted column it was meant to protect.
 */
const REDACTED_FIELDS = new Set([
  'webhookKey',
  'secret',
  'token',
  // A tenant's provider token: written encrypted, and it must not be written
  // in clear to the audit log on the way past.
  'apiToken',
  'password',
  'text',
  'html',
]);

function auditMetadata(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null) return {};

  return Object.fromEntries(
    Object.entries(body as Record<string, unknown>).map(([key, value]) =>
      REDACTED_FIELDS.has(key) ? [key, '[redacted]'] : [key, value],
    ),
  );
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
