import { ConflictError, NotFoundError, ValidationError } from '@/server/core/errors';
import type {
  CreateAliasInput,
  CreateDomainInput,
  DomainVerification,
  MailProvider,
  NormalizedInboundEmail,
  NormalizedMailEvent,
  OutboundQuota,
  ProviderAlias,
  ProviderDomain,
  ProviderSendResult,
  ReplyEmailInput,
  SendEmailInput,
  UpdateAliasInput,
} from '@/server/providers/types';

/**
 * In-memory `MailProvider` for tests and local development.
 *
 * Every message it "sends" is recorded on `sentMessages` instead, so a test can
 * assert on outbound mail without a network, an account, or a real domain.
 * Inbound normalisation accepts an already-normalised payload, which keeps
 * fixture-driven pipeline tests independent of any provider's wire format.
 */
export class MockMailProvider implements MailProvider {
  readonly id = 'mock';

  readonly sentMessages: Array<SendEmailInput & { messageId: string }> = [];

  private readonly domains = new Map<string, ProviderDomain>();
  private readonly aliases = new Map<string, ProviderAlias>();
  private counter = 0;

  /** Signature checking is a no-op here; flip it to exercise the 401 path. */
  constructor(
    private readonly acceptWebhooks = true,
    private readonly dailyLimit: number | null = 100,
  ) {}

  async findDomain(name: string): Promise<ProviderDomain | null> {
    return this.domains.get(name.toLowerCase()) ?? null;
  }

  async createDomain(input: CreateDomainInput): Promise<ProviderDomain> {
    const name = input.name.toLowerCase();

    if (this.domains.has(name)) {
      throw new ConflictError(`Domain ${name} already exists at the provider`);
    }

    const domain: ProviderDomain = {
      id: name,
      name,
      verified: false,
      records: [
        {
          type: 'MX',
          name: '@',
          value: 'mx1.mock.invalid',
          priority: 10,
          purpose: 'inbound',
          present: false,
        },
        {
          type: 'TXT',
          name: '@',
          value: `mock-verification=${this.nextId('ver')}`,
          purpose: 'verification',
          present: false,
        },
      ],
    };

    this.domains.set(name, domain);
    return domain;
  }

  async verifyDomain(domainId: string): Promise<DomainVerification> {
    const domain = this.requireDomain(domainId);

    // The mock verifies on the first poll; tests that need a failing domain
    // assert on the pre-verification state instead.
    domain.verified = true;
    domain.records = domain.records.map((record) => ({ ...record, present: true }));

    return { verified: true, records: domain.records, errors: [] };
  }

  async deleteDomain(domainId: string): Promise<void> {
    this.requireDomain(domainId);
    this.domains.delete(domainId.toLowerCase());

    for (const [id, alias] of this.aliases) {
      if (alias.domain === domainId.toLowerCase()) this.aliases.delete(id);
    }
  }

  async createAlias(input: CreateAliasInput): Promise<ProviderAlias> {
    const domain = this.requireDomain(input.domainId);

    const duplicate = [...this.aliases.values()].find(
      (alias) =>
        alias.domain === domain.name &&
        alias.localPart.toLowerCase() === input.localPart.toLowerCase(),
    );

    if (duplicate) {
      throw new ConflictError(
        `Alias ${input.localPart}@${domain.name} already exists at the provider`,
      );
    }

    const alias: ProviderAlias = {
      id: this.nextId('alias'),
      localPart: input.localPart,
      domain: domain.name,
      recipients: input.recipients,
      enabled: input.enabled ?? true,
    };

    this.aliases.set(alias.id, alias);
    return alias;
  }

  async findAlias(
    domainId: string,
    localPart: string,
  ): Promise<ProviderAlias | null> {
    const domain = this.requireDomain(domainId);
    return (
      [...this.aliases.values()].find(
        (alias) =>
          alias.domain === domain.name &&
          alias.localPart.toLowerCase() === localPart.toLowerCase(),
      ) ?? null
    );
  }

  async updateAlias(
    aliasId: string,
    input: UpdateAliasInput,
  ): Promise<ProviderAlias> {
    const alias = this.aliases.get(aliasId);
    if (!alias) throw new NotFoundError(`Alias ${aliasId} not found`);

    const updated: ProviderAlias = {
      ...alias,
      ...(input.localPart !== undefined && { localPart: input.localPart }),
      ...(input.recipients !== undefined && { recipients: input.recipients }),
      ...(input.enabled !== undefined && { enabled: input.enabled }),
    };

    this.aliases.set(aliasId, updated);
    return updated;
  }

  async deleteAlias(aliasId: string): Promise<void> {
    if (!this.aliases.delete(aliasId)) {
      throw new NotFoundError(`Alias ${aliasId} not found`);
    }
  }

  async listAliases(domainId: string): Promise<ProviderAlias[]> {
    const domain = this.requireDomain(domainId);
    return [...this.aliases.values()].filter((alias) => alias.domain === domain.name);
  }

  /** Enough of a quota to render; tests that care set `dailyLimit`. */
  async outboundQuota(): Promise<OutboundQuota> {
    return {
      daily: { used: this.sentMessages.length, limit: this.dailyLimit },
      monthlyAllowance: null,
      checkedAt: new Date(),
    };
  }

  async send(input: SendEmailInput): Promise<ProviderSendResult> {
    return this.record(input);
  }

  async reply(input: ReplyEmailInput): Promise<ProviderSendResult> {
    return this.record(input);
  }

  async verifyInboundWebhook(): Promise<boolean> {
    return this.acceptWebhooks;
  }

  async normalizeInbound(payload: unknown): Promise<NormalizedInboundEmail> {
    const normalized = payload as NormalizedInboundEmail;

    if (!normalized?.recipient) {
      throw new ValidationError('Mock inbound payload has no recipient');
    }

    return { ...normalized, provider: this.id };
  }

  async normalizeDeliveryEvent(payload: unknown): Promise<NormalizedMailEvent> {
    return payload as NormalizedMailEvent;
  }

  private record(input: SendEmailInput): ProviderSendResult {
    const messageId = `${this.nextId('msg')}@mock.invalid`;
    this.sentMessages.push({ ...input, messageId });

    return {
      providerMessageId: messageId,
      messageId,
      acceptedAt: new Date(),
    };
  }

  private requireDomain(domainId: string): ProviderDomain {
    const domain = this.domains.get(domainId.toLowerCase());
    if (!domain) throw new NotFoundError(`Domain ${domainId} not found`);
    return domain;
  }

  private nextId(prefix: string): string {
    this.counter += 1;
    return `${prefix}_${this.counter.toString().padStart(6, '0')}`;
  }

  /** Test helper: drop all state between cases. */
  reset(): void {
    this.domains.clear();
    this.aliases.clear();
    this.sentMessages.length = 0;
    this.counter = 0;
  }
}
