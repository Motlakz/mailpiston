import 'server-only';

import { ConflictError, NotFoundError, ValidationError } from '@/server/core/errors';
import { encryptSecret, randomToken, sha256Hex } from '@/server/core/crypto';
import type { Endpoint, EndpointEmailRecipient } from '@/server/core/types';
import type {
  AddressRepository,
  EndpointRepository,
} from '@/server/repositories/types';

import { assertSafeWebhookUrl } from '../webhooks/url-guard';

import type { OutboundService } from '../emails/outbound-service';

/**
 * Endpoints: typed destinations an address fans out to (plan §13).
 *
 * All three subtypes are live: `email` and `email_group` deliver a constructed
 * notification to a verified mailbox (Phase 6), `webhook` signs and POSTs the
 * public v1 payload (Phase 7).
 *
 * The two halves are checked in opposite directions, and both are load-bearing:
 *
 *  - a **mailbox** proves it wants our mail, by answering a challenge. The
 *    operator can type any address, and without proof of control a typo starts
 *    forwarding a customer's mail to a stranger.
 *  - a **URL** proves nothing and is not asked to. It is constrained instead:
 *    HTTPS only, and never resolving into this deployment's own network. That
 *    check runs here *and* again at delivery time, because DNS can change in
 *    between (see `webhooks/url-guard.ts`).
 */
const CHALLENGE_TTL_MS = 24 * 60 * 60 * 1000;

/** 32 bytes, base64url. Long enough that guessing is not a strategy. */
const SIGNING_SECRET_BYTES = 32;

/**
 * A created endpoint, plus the signing secret if one was minted.
 *
 * The secret comes back exactly once, here, and is never readable again. It is
 * stored encrypted rather than hashed because the server must recover it to
 * *sign* deliveries — but an endpoint whose secret can be re-read on demand
 * turns every read path into a way to leak it.
 */
export interface CreatedEndpoint {
  endpoint: Endpoint;
  secret: string | null;
}

export class EndpointService {
  constructor(
    private readonly endpoints: EndpointRepository,
    private readonly addresses: AddressRepository,
    private readonly outbound: OutboundService,
  ) {}

  async create(input: {
    name: string;
    type: Endpoint['type'];
    enabled?: boolean;
    url?: string;
  }): Promise<CreatedEndpoint> {
    if (input.type !== 'webhook') {
      if (input.url) {
        throw new ValidationError('Only a webhook endpoint takes a URL');
      }

      const endpoint = await this.endpoints.create({
        name: input.name,
        type: input.type,
        enabled: input.enabled ?? true,
      });

      return { endpoint, secret: null };
    }

    if (!input.url) {
      throw new ValidationError('A webhook endpoint needs a URL');
    }

    // Validated before the row exists, so a rejected URL leaves nothing behind.
    await assertSafeWebhookUrl(input.url);

    const endpoint = await this.endpoints.create({
      name: input.name,
      type: 'webhook',
      enabled: input.enabled ?? true,
    });

    const secret = randomToken(SIGNING_SECRET_BYTES);

    try {
      await this.endpoints.setWebhookConfig({
        endpointId: endpoint.id,
        url: input.url,
        secretCiphertext: encryptSecret(secret),
      });
    } catch (error) {
      // Same rule as a failed alias create in Phase 3: an endpoint that exists
      // with no destination is worse than no endpoint at all, because it looks
      // configured and silently delivers nothing.
      await this.endpoints.delete(endpoint.id).catch(() => undefined);
      throw error;
    }

    return { endpoint, secret };
  }

  get(id: string): Promise<Endpoint | null> {
    return this.endpoints.findById(id);
  }

  list(): Promise<Endpoint[]> {
    return this.endpoints.list();
  }

  /** The URL an operator configured. The secret deliberately does not come back. */
  async webhookUrl(id: string): Promise<string | null> {
    const config = await this.endpoints.getWebhookConfig(id);
    return config?.url ?? null;
  }

  async update(
    id: string,
    data: { name?: string; enabled?: boolean; url?: string },
  ): Promise<Endpoint> {
    if (data.url !== undefined) {
      await this.requireWebhookEndpoint(id);
      const config = await this.endpoints.getWebhookConfig(id);

      await assertSafeWebhookUrl(data.url);

      await this.endpoints.setWebhookConfig({
        endpointId: id,
        url: data.url,
        // Repointing an endpoint keeps its secret. The receiving application
        // already has that secret deployed, and rotating it as a side effect of
        // a URL change would break every verification at the new URL for a
        // reason the operator never asked for. `rotateSecret` is the explicit
        // way to change it.
        secretCiphertext:
          config?.secretCiphertext ??
          encryptSecret(randomToken(SIGNING_SECRET_BYTES)),
      });
    }

    const { name, enabled } = data;

    if (name === undefined && enabled === undefined) {
      const endpoint = await this.endpoints.findById(id);
      if (!endpoint) throw new NotFoundError(`Endpoint ${id} not found`);
      return endpoint;
    }

    return this.endpoints.update(id, { name, enabled });
  }

  /**
   * Mints a new signing secret and returns it once.
   *
   * There is an unavoidable window: deliveries between this call and the
   * receiver being redeployed fail verification. That is the right trade — the
   * alternative is honouring two secrets at once, which means a compromised
   * secret keeps working for as long as nobody gets round to removing it.
   */
  async rotateSecret(id: string): Promise<string> {
    await this.requireWebhookEndpoint(id);

    const config = await this.endpoints.getWebhookConfig(id);
    if (!config) throw new NotFoundError('Endpoint has no webhook configuration');

    const secret = randomToken(SIGNING_SECRET_BYTES);

    await this.endpoints.setWebhookConfig({
      endpointId: id,
      url: config.url,
      secretCiphertext: encryptSecret(secret),
    });

    return secret;
  }

  delete(id: string): Promise<void> {
    return this.endpoints.delete(id);
  }

  // --- Bindings -------------------------------------------------------------

  async bind(addressId: string, endpointId: string): Promise<void> {
    const [address, endpoint] = await Promise.all([
      this.addresses.findById(addressId),
      this.endpoints.findById(endpointId),
    ]);

    if (!address) throw new NotFoundError(`Address ${addressId} not found`);
    if (!endpoint) throw new NotFoundError(`Endpoint ${endpointId} not found`);

    await this.endpoints.bindToAddress(addressId, endpointId);
  }

  unbind(addressId: string, endpointId: string): Promise<void> {
    return this.endpoints.unbindFromAddress(addressId, endpointId);
  }

  listForAddress(addressId: string): Promise<Endpoint[]> {
    return this.endpoints.listForAddress(addressId);
  }

  // --- Recipients -----------------------------------------------------------

  listRecipients(endpointId: string): Promise<EndpointEmailRecipient[]> {
    return this.endpoints.listRecipients(endpointId);
  }

  async addRecipient(
    endpointId: string,
    email: string,
  ): Promise<EndpointEmailRecipient> {
    const endpoint = await this.requireEmailEndpoint(endpointId);

    if (endpoint.type === 'email') {
      const existing = await this.endpoints.listRecipients(endpointId);
      if (existing.length > 0) {
        throw new ConflictError(
          'An `email` endpoint holds exactly one mailbox. Use `email_group` for several.',
        );
      }
    }

    return this.endpoints.addRecipient(endpointId, email);
  }

  /**
   * Sends the challenge from one of the managed addresses this endpoint will
   * forward from.
   *
   * From a managed address on purpose: it is the address the recipient will
   * actually see mail arrive from, so the challenge doubles as a check that
   * sending from it works at all.
   */
  async sendRecipientChallenge(
    recipientId: string,
    fromAddressId: string,
  ): Promise<{ expiresAt: Date }> {
    const recipient = await this.requireRecipient(recipientId);

    const token = randomToken(24);
    const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);

    await this.endpoints.setRecipientChallenge(
      recipient.id,
      sha256Hex(token),
      expiresAt,
    );

    await this.outbound.send({
      addressId: fromAddressId,
      to: [recipient.email],
      subject: 'Confirm mail forwarding from MailPiston',
      text: [
        'Someone asked MailPiston to forward mail to this address.',
        '',
        `Confirmation code: ${token}`,
        '',
        `The code expires ${expiresAt.toISOString()}. If you were not expecting`,
        'this, ignore it — nothing is forwarded until the code is entered.',
      ].join('\n'),
    });

    return { expiresAt };
  }

  async confirmRecipient(
    recipientId: string,
    token: string,
  ): Promise<EndpointEmailRecipient> {
    const verified = await this.endpoints.verifyRecipientWithToken(
      recipientId,
      sha256Hex(token),
      new Date(),
    );

    if (!verified) {
      // One message for wrong, expired, and never-issued: distinguishing them
      // tells an attacker which half of the guess was right.
      throw new ValidationError('That confirmation code is not valid');
    }

    return verified;
  }

  removeRecipient(recipientId: string): Promise<void> {
    return this.endpoints.removeRecipient(recipientId);
  }

  private async requireWebhookEndpoint(endpointId: string): Promise<Endpoint> {
    const endpoint = await this.endpoints.findById(endpointId);
    if (!endpoint) throw new NotFoundError(`Endpoint ${endpointId} not found`);

    if (endpoint.type !== 'webhook') {
      throw new ValidationError('That endpoint is not a webhook endpoint');
    }

    return endpoint;
  }

  private async requireEmailEndpoint(endpointId: string): Promise<Endpoint> {
    const endpoint = await this.endpoints.findById(endpointId);
    if (!endpoint) throw new NotFoundError(`Endpoint ${endpointId} not found`);

    if (endpoint.type === 'webhook') {
      throw new ValidationError('Webhook endpoints do not take mail recipients');
    }

    return endpoint;
  }

  private async requireRecipient(id: string): Promise<EndpointEmailRecipient> {
    const recipient = await this.endpoints.findRecipient(id);
    if (!recipient) throw new NotFoundError(`Recipient ${id} not found`);
    return recipient;
  }
}
