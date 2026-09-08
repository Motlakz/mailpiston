import 'server-only';

import { decryptSecret } from '@/server/core/crypto';
import { NotFoundError, ValidationError } from '@/server/core/errors';
import type {
  AddressWithDomain,
  Email,
  Endpoint,
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
import { assertSafeWebhookUrl } from './url-guard';

/**
 * Webhook delivery (roadmap Phase 7, plan §13–§14).
 *
 * One attempt, synchronously, on the ingest path — and then it stops. A failure
 * records a `pending` delivery and nothing else; the retry schedule is Phase
 * 8's, and a loop built here would be a second scheduler to reconcile with it
 * later.
 *
 * Three properties this file exists to guarantee:
 *
 * **Ingress never fails because a receiver did.** The message is already
 * durable when this runs. Turning a customer's 500 into a non-200 for the mail
 * provider would make the provider retry a delivery we already hold, and the
 * retry would deduplicate — costing the operator the mail itself.
 *
 * **Exactly one deliverer per (event, endpoint).** `enqueue` is the election:
 * whoever inserts the row delivers, and a concurrent second ingest of the same
 * event gets `created: false` and does nothing.
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

export interface DispatchResult {
  delivered: number;
  failed: number;
  /** Already enqueued by someone else, or an event type webhooks do not carry. */
  skipped: number;
}

/** How much of a failing response is worth keeping in the delivery log. */
const ERROR_EXCERPT = 500;

export class WebhookService {
  constructor(
    private readonly endpoints: EndpointRepository,
    private readonly deliveries: DeliveryRepository,
    private readonly emails: EmailRepository,
    private readonly events: EventRepository,
    private readonly options: { timeoutMs: number },
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

    const attachments = await this.emails.listAttachments(input.email.id);
    const payload = buildWebhookPayload({
      event: input.event,
      email: input.email,
      attachments,
      type,
    });

    for (const endpoint of bound) {
      const outcome = await this.deliverTo(endpoint, input.event, payload);

      if (!outcome) result.skipped += 1;
      else if (outcome.ok) result.delivered += 1;
      else result.failed += 1;
    }

    return result;
  }

  /**
   * Re-attempts an existing delivery, rebuilding its payload from the event.
   *
   * Rebuilt rather than stored: attachment download URLs and the app origin can
   * both move, and a payload frozen at first attempt would hand a receiver URLs
   * that no longer resolve. The event id — the thing a receiver deduplicates on
   * — is what stays fixed.
   *
   * Phase 8 calls this behind its atomic claim; it does no locking of its own.
   */
  async attempt(deliveryId: string): Promise<WebhookDeliveryOutcome> {
    const delivery = await this.deliveries.findById(deliveryId);
    if (!delivery) throw new NotFoundError(`Delivery ${deliveryId} not found`);

    const [endpoint, event] = await Promise.all([
      this.endpoints.findById(delivery.endpointId),
      this.events.findById(delivery.eventId),
    ]);

    if (!endpoint) {
      throw new NotFoundError(`Endpoint ${delivery.endpointId} not found`);
    }
    if (!event) throw new NotFoundError(`Event ${delivery.eventId} not found`);

    const type = webhookEventTypeFor(event.type);
    if (!type) {
      throw new ValidationError(
        `Event ${event.type} is not deliverable to a webhook`,
      );
    }

    const email = event.emailId
      ? await this.emails.findById(event.emailId)
      : null;

    if (!email) {
      throw new NotFoundError(`Event ${event.id} has no email to deliver`);
    }

    const payload = buildWebhookPayload({
      event,
      email,
      attachments: await this.emails.listAttachments(email.id),
      type,
    });

    return this.send(delivery.id, endpoint, event, payload);
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

  // --- Internals ------------------------------------------------------------

  /** Returns null when another ingest already owns this delivery. */
  private async deliverTo(
    endpoint: Endpoint,
    event: MailEvent,
    payload: MailpistonWebhookEvent,
  ): Promise<WebhookDeliveryOutcome | null> {
    const { delivery, created } = await this.deliveries.enqueue({
      endpointId: endpoint.id,
      eventId: event.id,
      recipientId: null,
    });

    if (!created) return null;

    await this.events.create({
      emailId: event.emailId,
      type: 'webhook.queued',
      metadata: { endpointId: endpoint.id, deliveryId: delivery.id },
    });

    return this.send(delivery.id, endpoint, event, payload);
  }

  private async send(
    deliveryId: string,
    endpoint: Endpoint,
    event: MailEvent,
    payload: MailpistonWebhookEvent,
  ): Promise<WebhookDeliveryOutcome> {
    const config = await this.endpoints.getWebhookConfig(endpoint.id);

    if (!config) {
      // A webhook endpoint with no URL cannot be created through the service,
      // so this means the config row went away underneath us. It is a permanent
      // failure: no schedule of retries will invent a destination.
      return this.recordFailure(
        deliveryId,
        event,
        endpoint.id,
        null,
        'Endpoint has no webhook configuration',
        null,
      );
    }

    const outcome = await this.post(config, deliveryId, payload);

    if (outcome.ok) {
      await this.deliveries.markDelivered(
        deliveryId,
        outcome.responseCode ?? 200,
      );

      await this.events.create({
        emailId: event.emailId,
        type: 'webhook.delivered',
        metadata: {
          endpointId: endpoint.id,
          deliveryId,
          responseCode: outcome.responseCode,
        },
      });

      return outcome;
    }

    return this.recordFailure(
      deliveryId,
      event,
      endpoint.id,
      outcome.responseCode,
      outcome.error ?? 'Delivery failed',
      // Due immediately. Phase 8 owns the backoff curve; leaving the row
      // `pending` and due now is what hands it over, rather than inventing a
      // schedule this phase has nothing to honour it with.
      new Date(),
    );
  }

  private async recordFailure(
    deliveryId: string,
    event: MailEvent,
    endpointId: string,
    responseCode: number | null,
    error: string,
    nextAttemptAt: Date | null,
  ): Promise<WebhookDeliveryOutcome> {
    await this.deliveries.markFailed(
      deliveryId,
      responseCode,
      error,
      nextAttemptAt,
    );

    await this.events.create({
      emailId: event.emailId,
      type: 'webhook.failed',
      metadata: { endpointId, deliveryId, responseCode, error },
    });

    return { deliveryId, ok: false, responseCode, error };
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
