import 'server-only';

import { decryptSecret } from '@/server/core/crypto';
import { NotFoundError, ValidationError } from '@/server/core/errors';
import { newId } from '@/server/core/ids';
import type {
  AddressWithDomain,
  Email,
  EmailAttachment,
  Endpoint,
  EndpointDelivery,
  EndpointWebhookConfig,
  MailEvent,
} from '@/server/core/types';
import type {
  DeliveryRepository,
  EmailRepository,
  EndpointRepository,
  EventRepository,
} from '@/server/repositories/types';
import type { MailpistonWebhookEvent } from '@/sdk/src/payload';
import { MAILPISTON_HEADERS, signPayload } from '@/sdk/src/signing';

import { buildWebhookPayload, webhookEventTypeFor } from './payload';
import { retryDelayMs } from './retry-schedule';
import type { RetryScheduler } from './retry-scheduler';
import { assertSafeWebhookUrl } from './url-guard';

/**
 * Webhook delivery (roadmap Phases 7–8, plan §13–§15).
 *
 * Every attempt — the synchronous first one on the ingest path, a scheduled
 * retry, and an operator's manual retry — goes through the same claimed path.
 * That is the single most important property here: three entry points that each
 * did their own state handling would eventually disagree, and the way they
 * would disagree is by delivering twice.
 *
 * Three other properties this file exists to guarantee:
 *
 * **Ingress never fails because a receiver did.** The message is already
 * durable when this runs. Turning a customer's 500 into a non-200 for the mail
 * provider would make the provider retry a delivery we already hold, and the
 * retry would deduplicate — costing the operator the mail itself.
 *
 * **Exactly one deliverer per (event, endpoint).** `enqueue` elects it by
 * constraint, and `claim` re-elects it on every subsequent attempt.
 *
 * **The URL is re-checked immediately before the request.** A host that
 * resolved publicly at configuration time can be repointed at loopback
 * afterwards; see `url-guard.ts`.
 */
export interface WebhookDeliveryOutcome {
  deliveryId: string;
  ok: boolean;
  responseCode: number | null;
  error: string | null;
}

export type AttemptResult =
  | ({ skipped: false } & WebhookDeliveryOutcome)
  | { skipped: true; reason: AttemptSkipReason };

export type AttemptSkipReason =
  | 'already-claimed-or-complete'
  | 'not-retryable';

export interface DispatchResult {
  delivered: number;
  failed: number;
  /** Already enqueued by someone else, or an event type webhooks do not carry. */
  skipped: number;
}

export interface WebhookServiceOptions {
  timeoutMs: number;
  /**
   * Required, not defaulted. A deployment that ends up never retrying should
   * have had to write that down.
   */
  scheduler: RetryScheduler;
}

/** How much of a failing response is worth keeping in the delivery log. */
const ERROR_EXCERPT = 500;

/**
 * How long past the request timeout a claim stays held.
 *
 * Long enough that a slow-but-alive attempt is never stolen mid-flight, short
 * enough that a process which died holding one is not stranded for long.
 */
const LEASE_GRACE_MS = 30_000;

/** Everything a delivery needs, when the caller already has it loaded. */
interface DeliveryContext {
  event: MailEvent;
  email: Email;
  attachments: EmailAttachment[];
}

export class WebhookService {
  constructor(
    private readonly endpoints: EndpointRepository,
    private readonly deliveries: DeliveryRepository,
    private readonly emails: EmailRepository,
    private readonly events: EventRepository,
    private readonly options: WebhookServiceOptions,
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
  ) {}

  /**
   * Fans one mail event out to every webhook endpoint bound to its address.
   *
   * Never throws: an endpoint that cannot be reached is a recorded failure, not
   * an exception travelling back up into the provider's request.
   */
  async dispatch(input: {
    email: Email;
    address: AddressWithDomain;
    event: MailEvent;
  }): Promise<DispatchResult> {
    const type = webhookEventTypeFor(input.event.type);
    const result: DispatchResult = { delivered: 0, failed: 0, skipped: 0 };

    if (!type) return result;

    const bound = (await this.endpoints.listForAddress(input.address.id)).filter(
      (endpoint) => endpoint.type === 'webhook',
    );

    if (bound.length === 0) return result;

    // Loaded once and shared across endpoints. The delivery path can load this
    // for itself, so a retry needs nothing from here — this only avoids reading
    // the same message once per endpoint.
    const context: DeliveryContext = {
      event: input.event,
      email: input.email,
      attachments: await this.emails.listAttachments(input.email.id),
    };

    for (const endpoint of bound) {
      const { delivery, created } = await this.deliveries.enqueue({
        endpointId: endpoint.id,
        eventId: input.event.id,
        recipientId: null,
      });

      if (!created) {
        result.skipped += 1;
        continue;
      }

      await this.events.create({
        emailId: input.event.emailId,
        type: 'webhook.queued',
        metadata: { endpointId: endpoint.id, deliveryId: delivery.id },
      });

      const outcome = await this.attemptDelivery(delivery.id, context);

      if (outcome.skipped) result.skipped += 1;
      else if (outcome.ok) result.delivered += 1;
      else result.failed += 1;
    }

    return result;
  }

  /**
   * One scheduled attempt. This is what the Inngest retry function calls.
   *
   * It claims before it does anything else, so a duplicate event, a re-run
   * function, and a concurrent manual retry all collapse into one delivery.
   */
  async attempt(deliveryId: string): Promise<AttemptResult> {
    const existing = await this.deliveries.findById(deliveryId);
    if (!existing) throw new NotFoundError(`Delivery ${deliveryId} not found`);

    return this.attemptDelivery(deliveryId);
  }

  /**
   * Manual retry from the delivery log.
   *
   * Requeues first, then goes through the identical claim path — it does not
   * get a shortcut past it. A "retry now" button that bypassed the claim would
   * be the easiest way in the entire system to deliver the same event twice,
   * because the operator presses it exactly when a scheduled retry is due.
   */
  async retry(deliveryId: string): Promise<AttemptResult> {
    const existing = await this.deliveries.findById(deliveryId);
    if (!existing) throw new NotFoundError(`Delivery ${deliveryId} not found`);

    const requeued = await this.deliveries.requeue(deliveryId);

    // Already delivered, or in flight right now. Neither is worth re-sending.
    if (!requeued) return { skipped: true, reason: 'not-retryable' };

    return this.attemptDelivery(deliveryId);
  }

  /**
   * Sends a sample delivery so an operator can prove the receiver works before
   * a customer's mail depends on it.
   *
   * Deliberately not recorded as a delivery row: the log is the audit trail of
   * real mail, and a test entry in it would be indistinguishable from one.
   */
  async test(endpointId: string): Promise<{
    ok: boolean;
    responseCode: number | null;
    error: string | null;
  }> {
    await this.requireWebhookEndpoint(endpointId);
    const config = await this.requireConfig(endpointId);

    const outcome = await this.post(config, 'dlv_test', samplePayload());

    return {
      ok: outcome.ok,
      responseCode: outcome.responseCode,
      error: outcome.error,
    };
  }

  // --- The one delivery path ------------------------------------------------

  private async attemptDelivery(
    deliveryId: string,
    preloaded?: DeliveryContext,
  ): Promise<AttemptResult> {
    const claimed = await this.deliveries.claim(
      deliveryId,
      newId('run'),
      this.options.timeoutMs + LEASE_GRACE_MS,
    );

    if (!claimed) return { skipped: true, reason: 'already-claimed-or-complete' };

    const context = preloaded ?? (await this.loadContext(claimed));

    // Nothing left to deliver — the message, event, or endpoint is gone. This
    // is terminal rather than an exception: throwing would leave the row
    // `delivering` until its lease expired, and every later attempt would
    // rediscover the same missing row and strand it again.
    if (!context) {
      return {
        skipped: false,
        ...(await this.recordFailure(
          claimed,
          null,
          null,
          'The message this delivery refers to no longer exists',
          null,
        )),
      };
    }

    const endpoint = await this.endpoints.findById(claimed.endpointId);
    const type = webhookEventTypeFor(context.event.type);

    if (!endpoint || !type) {
      return {
        skipped: false,
        ...(await this.recordFailure(
          claimed,
          context.event,
          null,
          endpoint
            ? `Event ${context.event.type} is not deliverable to a webhook`
            : 'The endpoint this delivery was queued for no longer exists',
          null,
        )),
      };
    }

    const config = await this.endpoints.getWebhookConfig(endpoint.id);

    if (!config) {
      // A webhook endpoint with no URL cannot be created through the service,
      // so this means the config row went away underneath us. Permanent: no
      // schedule of retries will invent a destination.
      return {
        skipped: false,
        ...(await this.recordFailure(
          claimed,
          context.event,
          endpoint.id,
          'Endpoint has no webhook configuration',
          null,
        )),
      };
    }

    const payload = buildWebhookPayload({
      // Rebuilt on every attempt rather than stored. Attachment download URLs
      // and the app origin can both move, and a payload frozen at first attempt
      // would hand a receiver URLs that no longer resolve. The event id — what
      // a receiver deduplicates on — is what stays fixed.
      event: context.event,
      email: context.email,
      attachments: context.attachments,
      type,
    });

    const outcome = await this.post(config, claimed.id, payload);

    if (outcome.ok) {
      await this.deliveries.markDelivered(claimed.id, outcome.responseCode ?? 200);
      await this.events.create({
        emailId: context.event.emailId,
        type: 'webhook.delivered',
        metadata: {
          endpointId: endpoint.id,
          deliveryId: claimed.id,
          responseCode: outcome.responseCode,
          attempt: claimed.attempt + 1,
        },
      });

      return { skipped: false, ...outcome };
    }

    // `claimed.attempt` counts completed attempts, so the one that just failed
    // is `+ 1` and the next one would be `+ 2`.
    const nextAttempt = claimed.attempt + 2;
    const delayMs = retryDelayMs(nextAttempt);

    const recorded = await this.recordFailure(
      claimed,
      context.event,
      endpoint.id,
      outcome.error ?? 'Delivery failed',
      delayMs === null ? null : new Date(Date.now() + delayMs),
      outcome.responseCode,
    );

    if (delayMs !== null) {
      // State first, schedule second (plan §15.2). If this process dies in
      // between, the delivery is a `pending` row a manual retry can pick up.
      // The other order loses the row and schedules an event pointing at
      // nothing.
      await this.options.scheduler.scheduleRetry({
        deliveryId: claimed.id,
        attempt: nextAttempt,
        delayMs,
      });
    }

    return { skipped: false, ...recorded };
  }

  private async loadContext(
    delivery: EndpointDelivery,
  ): Promise<DeliveryContext | null> {
    const event = await this.events.findById(delivery.eventId);
    if (!event?.emailId) return null;

    const email = await this.emails.findById(event.emailId);
    if (!email) return null;

    return {
      event,
      email,
      attachments: await this.emails.listAttachments(email.id),
    };
  }

  private async recordFailure(
    delivery: EndpointDelivery,
    event: MailEvent | null,
    endpointId: string | null,
    error: string,
    nextAttemptAt: Date | null,
    responseCode: number | null = null,
  ): Promise<WebhookDeliveryOutcome> {
    await this.deliveries.markFailed(
      delivery.id,
      responseCode,
      error,
      nextAttemptAt,
    );

    if (event) {
      await this.events.create({
        emailId: event.emailId,
        type: 'webhook.failed',
        metadata: {
          endpointId: endpointId ?? delivery.endpointId,
          deliveryId: delivery.id,
          responseCode,
          error,
          attempt: delivery.attempt + 1,
          // The operator's first question about a failure is whether anything
          // else will happen on its own.
          final: nextAttemptAt === null,
        },
      });
    }

    return { deliveryId: delivery.id, ok: false, responseCode, error };
  }

  /** The signed request itself. Every failure mode comes back as an outcome. */
  private async post(
    config: EndpointWebhookConfig,
    deliveryId: string,
    payload: MailpistonWebhookEvent,
  ): Promise<WebhookDeliveryOutcome> {
    const fail = (
      error: string,
      responseCode: number | null = null,
    ): WebhookDeliveryOutcome => ({
      deliveryId,
      ok: false,
      responseCode,
      error,
    });

    let url: URL;

    try {
      url = await assertSafeWebhookUrl(config.url);
    } catch (error) {
      return fail((error as Error).message);
    }

    // Serialised once. The signature covers these exact bytes, so the body sent
    // and the body signed can never be two different serialisations.
    const body = JSON.stringify(payload);
    const timestamp = String(Math.floor(Date.now() / 1000));

    let signature: string;

    try {
      signature = await signPayload(
        timestamp,
        body,
        decryptSecret(config.secretCiphertext),
      );
    } catch {
      // A secret that will not decrypt means the encryption key changed. Say
      // so without echoing anything about the ciphertext.
      return fail('Endpoint signing secret could not be decrypted');
    }

    try {
      const response = await this.fetchImpl(url.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'MailPiston/1.0',
          [MAILPISTON_HEADERS.event]: payload.type,
          [MAILPISTON_HEADERS.deliveryId]: deliveryId,
          [MAILPISTON_HEADERS.timestamp]: timestamp,
          [MAILPISTON_HEADERS.signature]: signature,
        },
        body,
        // Never follow a redirect: a 302 to an internal address would walk
        // straight past the guard that just validated the original host.
        redirect: 'manual',
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });

      if (response.ok) {
        return {
          deliveryId,
          ok: true,
          responseCode: response.status,
          error: null,
        };
      }

      return fail(await excerpt(response), response.status);
    } catch (error) {
      const name = (error as Error).name;

      return fail(
        name === 'TimeoutError' || name === 'AbortError'
          ? `No response within ${this.options.timeoutMs}ms`
          : (error as Error).message,
      );
    }
  }

  private async requireWebhookEndpoint(id: string): Promise<Endpoint> {
    const endpoint = await this.endpoints.findById(id);
    if (!endpoint) throw new NotFoundError(`Endpoint ${id} not found`);

    if (endpoint.type !== 'webhook') {
      throw new ValidationError('That endpoint is not a webhook endpoint');
    }

    return endpoint;
  }

  private async requireConfig(
    endpointId: string,
  ): Promise<EndpointWebhookConfig> {
    const config = await this.endpoints.getWebhookConfig(endpointId);
    if (!config) throw new NotFoundError('Endpoint has no webhook configuration');
    return config;
  }
}

/** A failing receiver's body, truncated. The useful part is always at the front. */
async function excerpt(response: Response): Promise<string> {
  let detail = '';

  try {
    detail = (await response.text()).slice(0, ERROR_EXCERPT).trim();
  } catch {
    // A body that will not read is not worth failing the failure over.
  }

  return detail ? `HTTP ${response.status}: ${detail}` : `HTTP ${response.status}`;
}

/**
 * The test payload.
 *
 * Every id is visibly fake so nobody chases `evt_test` through the logs, and
 * the shape is the real one, so a receiver that handles this handles real mail.
 */
function samplePayload(): MailpistonWebhookEvent {
  const now = new Date().toISOString();

  return {
    version: '1',
    id: 'evt_test',
    type: 'email.received',
    createdAt: now,
    data: {
      id: 'em_test',
      threadId: 'thr_test',
      direction: 'inbound',
      state: 'received',
      envelope: {
        from: 'test@mailpiston.example',
        recipients: ['support@your-domain.example'],
      },
      from: { name: 'MailPiston', email: 'test@mailpiston.example' },
      to: ['support@your-domain.example'],
      cc: [],
      subject: 'MailPiston test delivery',
      text: 'This is a test delivery from MailPiston. No mail was received.',
      html: '<p>This is a test delivery from MailPiston. No mail was received.</p>',
      inReplyTo: null,
      references: [],
      receivedAt: now,
      attachments: [],
    },
  };
}
