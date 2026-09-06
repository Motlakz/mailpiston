import 'server-only';

import { ConflictError, NotFoundError, ValidationError } from '@/server/core/errors';
import { randomToken, sha256Hex } from '@/server/core/crypto';
import type { Endpoint, EndpointEmailRecipient } from '@/server/core/types';
import type {
  AddressRepository,
  EndpointRepository,
} from '@/server/repositories/types';

import type { OutboundService } from '../emails/outbound-service';

/**
 * Endpoints: typed destinations an address fans out to (plan §13).
 *
 * Phase 6 enables the `email` and `email_group` subtypes. `webhook` is refused
 * here rather than half-built: an endpoint that accepts a URL and never
 * delivers to it is worse than one that says "not yet", because the operator
 * configures it, sees no error, and assumes their app is wired up. It lands in
 * Phase 7 with signing, SSRF checks, and a delivery log behind it.
 *
 * Recipients are verified by challenge, not by assertion. The operator can type
 * any address; without proof of control, a typo starts forwarding a customer's
 * mail to a stranger, and neither of them would ever know.
 */
const CHALLENGE_TTL_MS = 24 * 60 * 60 * 1000;

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
  }): Promise<Endpoint> {
    if (input.type === 'webhook') {
      throw new ValidationError(
        'Webhook endpoints land in Phase 7, with signing and a delivery log. Use an email endpoint for now.',
      );
    }

    return this.endpoints.create({
      name: input.name,
      type: input.type,
      enabled: input.enabled ?? true,
    });
  }

  get(id: string): Promise<Endpoint | null> {
    return this.endpoints.findById(id);
  }

  list(): Promise<Endpoint[]> {
    return this.endpoints.list();
  }

  update(id: string, data: { name?: string; enabled?: boolean }): Promise<Endpoint> {
    return this.endpoints.update(id, data);
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
