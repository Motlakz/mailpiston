import 'server-only';

import { NextResponse } from 'next/server';

import { env } from '@/server/core/config';
import { WebhookVerificationError } from '@/server/core/errors';
import { checkRateLimit } from '@/server/core/rate-limit';
import { mailProviderRegistry } from '@/server/providers/registry';
import type { ProviderId } from '@/server/providers/registry';

import { errorResponse } from './with-api';
import { readBodyText } from './body';

/**
 * Composition point for provider ingress (roadmap §2.3).
 *
 * The ordering here is load-bearing:
 *
 *   1. read the RAW body as text  — must be first. `request.json()` consumes
 *      the stream, and re-serialising will not reproduce byte-identical input,
 *      so the HMAC would never match again.
 *   2. verify the signature       → 401, before any spend. Signature
 *      verification is the trust mechanism; source IP, endpoint obscurity, and
 *      rate limiting are not (§8).
 *   3. rate limit, fail-open      — the caller is already authenticated, and
 *      losing a real email to a transient limiter error is worse than a burst.
 *   4. parse
 *   5. run the handler, which claims its own idempotency key from the
 *      normalised payload.
 *
 * A handler that throws returns 503. At this boundary the handler includes
 * durable capture itself, so acknowledging an error with 200 would permanently
 * discard the provider's retry opportunity. Work triggered after capture must
 * handle its own errors without throwing back through this wrapper.
 */
export interface ProviderContext {
  request: Request;
  /** The exact bytes that were signed. */
  rawBody: string;
  payload: unknown;
}

export interface WithProviderOptions {
  provider: ProviderId;
  /** Rate-limit bucket key, matching the paths in §9.3. */
  endpoint: string;
}

export function withProvider(
  handler: (context: ProviderContext) => Promise<Response>,
  options: WithProviderOptions,
) {
  return async (request: Request): Promise<Response> => {
    let rawBody: string;

    try {
      // 1. Raw body first, always.
      rawBody = await readBodyText(request, env.PROVIDER_MAX_BODY_BYTES);
    } catch (error) {
      return errorResponse(error);
    }

    try {
      // 2. Authenticity. Re-create a Request so the provider verifier sees an
      //    unconsumed body while we keep the exact bytes.
      //
      //    The *active* provider verifies, not the one this path is named for.
      //    In production they are the same object. With MAIL_PROVIDER=mock they
      //    are not, and that is the entire point of the mock: it exists so the
      //    pipeline can run with no provider account, which necessarily means
      //    there is no real signature to check. Asking the Forward Email
      //    verifier to do it anyway would only throw on the absent webhook key.
      //    `config.ts` refuses `mock` in production, so this cannot become an
      //    unauthenticated ingress on a deployed instance.
      const provider = mailProviderRegistry.active();
      const verified = await provider.verifyInboundWebhook(
        new Request(request.url, {
          method: request.method,
          headers: request.headers,
          body: rawBody,
        }),
      );

      if (!verified) {
        throw new WebhookVerificationError();
      }
    } catch (error) {
      /**
       * Say that a delivery was refused, and say enough to tell why.
       *
       * This used to be silent. `formatErrorResponse` logs only unexpected
       * errors, and a rejected signature is an entirely expected one — so a
       * misconfigured webhook key produced a 401, no log line, no stored mail,
       * and no event, because an unauthenticated request has no tenant to
       * record an event against. The operator's evidence was an empty inbox.
       *
       * A missing signature header and a wrong key are the two causes and they
       * need different fixes: the first means the provider was never told to
       * sign, the second that it signs with a key we do not hold. Neither the
       * signature nor the body is logged — this narrows the cause without
       * writing down the thing an attacker is trying to guess.
       */
      console.warn(`[${options.provider}] ingress refused a delivery`, {
        endpoint: options.endpoint,
        reason: error instanceof WebhookVerificationError ? 'signature' : 'error',
        signatureHeaderPresent: Boolean(
          request.headers.get('x-webhook-signature'),
        ),
        bodyBytes: rawBody.length,
        message: error instanceof Error ? error.message : String(error),
      });

      // Verification failures are the one case that must NOT return 200: an
      // unauthenticated caller gets nothing, and nothing is written.
      return errorResponse(error);
    }

    // 3. Rate limit. Fail-open by configuration (§9.5).
    try {
      await checkRateLimit(`provider:${options.provider}`, options.endpoint);
    } catch (error) {
      return errorResponse(error);
    }

    try {
      // 4. Parse, then 5. run.
      const payload: unknown = rawBody.length > 0 ? JSON.parse(rawBody) : {};
      return await handler({ request, rawBody, payload });
    } catch (error) {
      // Authenticated, but durable processing failed. Ask the provider to
      // retry; a 200 here would turn a temporary storage/database failure into
      // permanent mail loss.
      console.error(`[${options.provider}] ingress handler failed`, error);

      return NextResponse.json(
        { received: true, processed: false },
        { status: 503, headers: { 'Retry-After': '60' } },
      );
    }
  };
}
