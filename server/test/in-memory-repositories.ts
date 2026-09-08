import { ConflictError, NotFoundError } from '@/server/core/errors';
import type {
  Address,
  AddressWithDomain,
  Domain,
  Email,
  EmailAttachment,
  EmailListItem,
  MailEvent,
  Endpoint,
  EndpointDelivery,
  EndpointEmailRecipient,
  EndpointWebhookConfig,
  MailEventType,
  Paginated,
  ReconciliationItem,
  ReconciliationItemStatus,
  ReconciliationRun,
  ReplyRelay,
  Thread,
} from '@/server/core/types';
import type {
  AddressRepository,
  CreateAttachmentData,
  CreateEmailData,
  DeliveryRepository,
  EmailRepository,
  EnqueueResult,
  EventFilter,
  EventRepository,
  InboundCaptureResult,
  InboundThreadTarget,
  EndpointRepository,
  ReconciliationRepository,
  ReplyRelayRepository,
  ThreadRepository,
  CreateAddressData,
  CreateDomainData,
  DomainRepository,
  UpdateAddressData,
  UpdateDomainData,
} from '@/server/repositories/types';
import type { Storage } from '@/server/storage/types';

/**
 * In-memory repositories for service tests.
 *
 * They reproduce the two constraints the Neon implementations rely on the
 * database for — case-insensitive uniqueness on the domain name and on
 * (domain, local part) — because those are exactly what the services are
 * expected to turn into a `ConflictError` rather than a 500.
 */
let counter = 0;
const nextId = (prefix: string) => `${prefix}_${(counter += 1)}`;

export class InMemoryDomainRepository implements DomainRepository {
  readonly rows = new Map<string, Domain>();

  async create(data: CreateDomainData): Promise<Domain> {
    if (await this.findByName(data.name)) {
      throw new ConflictError(`Domain ${data.name} already exists`);
    }

    const now = new Date();
    const domain: Domain = {
      id: nextId('dom'),
      name: data.name.toLowerCase(),
      providerDomainId: data.providerDomainId,
      status: data.status,
      catchAllAliasId: null,
      dnsRecords: data.dnsRecords,
      verificationErrors: [],
      lastVerifiedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    this.rows.set(domain.id, domain);
    return domain;
  }

  async findById(id: string): Promise<Domain | null> {
    return this.rows.get(id) ?? null;
  }

  async findByName(name: string): Promise<Domain | null> {
    return (
      [...this.rows.values()].find(
        (domain) => domain.name === name.toLowerCase(),
      ) ?? null
    );
  }

  async list(): Promise<Domain[]> {
    return [...this.rows.values()];
  }

  async update(id: string, data: UpdateDomainData): Promise<Domain> {
    const existing = this.rows.get(id);
    if (!existing) throw new NotFoundError(`Domain ${id} not found`);

    const updated: Domain = { ...existing, ...data, updatedAt: new Date() };
    this.rows.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    if (!this.rows.delete(id)) throw new NotFoundError(`Domain ${id} not found`);
  }
}

export class InMemoryAddressRepository implements AddressRepository {
  readonly rows = new Map<string, Address>();

  constructor(private readonly domains: InMemoryDomainRepository) {}

  async create(data: CreateAddressData): Promise<Address> {
    const duplicate = await this.findByDomainAndLocalPart(
      data.domainId,
      data.localPart,
    );

    if (duplicate) {
      throw new ConflictError(
        `Address ${data.localPart} already exists on that domain`,
      );
    }

    const now = new Date();
    const address: Address = {
      id: nextId('addr'),
      domainId: data.domainId,
      localPart: data.localPart.toLowerCase(),
      providerAliasId: data.providerAliasId,
      canSend: data.canSend,
      enabled: data.enabled,
      createdAt: now,
      updatedAt: now,
    };

    this.rows.set(address.id, address);
    return address;
  }

  async findById(id: string): Promise<Address | null> {
    return this.rows.get(id) ?? null;
  }

  async findByIdWithDomain(id: string): Promise<AddressWithDomain | null> {
    const address = this.rows.get(id);
    if (!address) return null;

    const domain = await this.domains.findById(address.domainId);
    return domain ? this.withDomain(address, domain.name) : null;
  }

  async findByEmail(email: string): Promise<AddressWithDomain | null> {
    const at = email.lastIndexOf('@');
    if (at <= 0) return null;

    const localPart = email.slice(0, at).toLowerCase();
    const domainName = email.slice(at + 1).toLowerCase();

    const domain = await this.domains.findByName(domainName);
    if (!domain) return null;

    const address = [...this.rows.values()].find(
      (row) => row.domainId === domain.id && row.localPart === localPart,
    );

    return address ? this.withDomain(address, domain.name) : null;
  }

  async findByDomainAndLocalPart(
    domainId: string,
    localPart: string,
  ): Promise<Address | null> {
    return (
      [...this.rows.values()].find(
        (row) =>
          row.domainId === domainId &&
          row.localPart === localPart.toLowerCase(),
      ) ?? null
    );
  }

  async list(filter: { domainId?: string } = {}): Promise<AddressWithDomain[]> {
    const result: AddressWithDomain[] = [];

    for (const address of this.rows.values()) {
      if (filter.domainId && address.domainId !== filter.domainId) continue;

      const domain = await this.domains.findById(address.domainId);
      if (domain) result.push(this.withDomain(address, domain.name));
    }

    return result;
  }

  async update(id: string, data: UpdateAddressData): Promise<Address> {
    const existing = this.rows.get(id);
    if (!existing) throw new NotFoundError(`Address ${id} not found`);

    const updated: Address = { ...existing, ...data, updatedAt: new Date() };
    this.rows.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    if (!this.rows.delete(id)) throw new NotFoundError(`Address ${id} not found`);
  }

  private withDomain(address: Address, domainName: string): AddressWithDomain {
    return {
      ...address,
      domainName,
      email: `${address.localPart}@${domainName}`,
    };
  }
}

/**
 * Email and event repositories for the Phase 4 pipeline tests.
 *
 * `createInbound` reproduces the one constraint the real implementation leans
 * on the database for — the unique index on `fingerprint` — because that index
 * *is* the idempotency mechanism, and a fake that quietly allowed duplicates
 * would make the tests pass for the wrong reason.
 */
export class InMemoryEmailRepository implements EmailRepository {
  readonly rows = new Map<string, Email>();
  readonly attachments = new Map<string, EmailAttachment>();
  readonly events: MailEvent[] = [];

  /**
   * Threads are written through the email repository, exactly as the Neon one
   * does inside the capture transaction, so a test sees the same rollback
   * behaviour: a duplicate leaves no thread behind.
   *
   * `eventStore` mirrors the other half of that transaction. In Neon the
   * capture event is a `mail_events` row like any other, so anything reading
   * events finds it; passing the event repository here reproduces that, and a
   * test that looks an event up by id sees the one capture wrote.
   */
  constructor(
    readonly threads = new InMemoryThreadRepository(),
    private readonly eventStore?: InMemoryEventRepository,
  ) {}

  async create(data: CreateEmailData): Promise<Email> {
    const now = new Date();
    const email: Email = { ...data, id: nextId('em'), createdAt: now, updatedAt: now };
    this.rows.set(email.id, email);
    return email;
  }

  async createInbound(input: {
    email: CreateEmailData & { id: string; fingerprint: string };
    attachments: CreateAttachmentData[];
    eventMetadata: Record<string, unknown>;
    thread: InboundThreadTarget;
  }): Promise<InboundCaptureResult> {
    const taken = [...this.rows.values()].some(
      (row) => row.fingerprint === input.email.fingerprint,
    );

    if (taken) return { duplicate: true, email: null, event: null };

    const now = new Date();
    const lastMessageAt = input.email.receivedAt ?? now;

    const threadId =
      input.thread.existingId !== undefined
        ? input.thread.existingId
        : (await this.threads.create({ subject: input.thread.subject, lastMessageAt })).id;

    await this.threads.touch(threadId, lastMessageAt);

    const email: Email = { ...input.email, threadId, createdAt: now, updatedAt: now };
    this.rows.set(email.id, email);
    // Stands in for the Neon join the resolver runs against `emails`.
    this.threads.index([email.messageId, email.providerMessageId], threadId);

    for (const attachment of input.attachments) {
      const id = nextId('att');
      this.attachments.set(id, { ...attachment, id, emailId: email.id, createdAt: now });
    }

    const event: MailEvent = {
      id: nextId('evt'),
      emailId: email.id,
      type: 'email.received',
      metadata: input.eventMetadata,
      occurredAt: now,
    };
    this.events.push(event);
    this.eventStore?.rows.push(event);

    return { duplicate: false, email, event };
  }

  async findById(id: string): Promise<Email | null> {
    return this.rows.get(id) ?? null;
  }

  async findByMessageId(messageId: string): Promise<Email | null> {
    return [...this.rows.values()].find((row) => row.messageId === messageId) ?? null;
  }

  async findByProviderMessageId(providerMessageId: string): Promise<Email | null> {
    return (
      [...this.rows.values()].find(
        (row) => row.providerMessageId === providerMessageId,
      ) ?? null
    );
  }

  async list(filter: {
    direction?: Email['direction'];
    addressId?: string;
    threadId?: string;
    limit?: number;
  }): Promise<Paginated<EmailListItem>> {
    const items = [...this.rows.values()]
      .filter((row) => !filter.direction || row.direction === filter.direction)
      .filter((row) => !filter.addressId || row.addressId === filter.addressId)
      .filter((row) => !filter.threadId || row.threadId === filter.threadId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, filter.limit ?? 50)
      .map((row) => ({
        ...row,
        addressEmail: null,
        attachmentCount: [...this.attachments.values()].filter(
          (attachment) => attachment.emailId === row.id,
        ).length,
      }));

    return { items, nextCursor: null };
  }

  async updateStatus(id: string, status: Email['status']): Promise<Email> {
    const existing = this.rows.get(id);
    if (!existing) throw new NotFoundError(`Email ${id} not found`);

    const updated = { ...existing, status, updatedAt: new Date() };
    this.rows.set(id, updated);
    return updated;
  }

  async recordSent(
    id: string,
    data: {
      status: Email['status'];
      providerMessageId: string | null;
      messageId: string | null;
      sentAt: Date | null;
    },
  ): Promise<Email> {
    const existing = this.rows.get(id);
    if (!existing) throw new NotFoundError(`Email ${id} not found`);

    const updated = { ...existing, ...data, updatedAt: new Date() };
    this.rows.set(id, updated);
    if (existing.threadId) {
      this.threads.index([updated.messageId, updated.providerMessageId], existing.threadId);
    }
    return updated;
  }

  async addAttachment(
    data: Omit<EmailAttachment, 'id' | 'createdAt'>,
  ): Promise<EmailAttachment> {
    const attachment: EmailAttachment = {
      ...data,
      id: nextId('att'),
      createdAt: new Date(),
    };
    this.attachments.set(attachment.id, attachment);
    return attachment;
  }

  async listAttachments(emailId: string): Promise<EmailAttachment[]> {
    return [...this.attachments.values()].filter((row) => row.emailId === emailId);
  }

  async findAttachment(id: string): Promise<EmailAttachment | null> {
    return this.attachments.get(id) ?? null;
  }
}

export class InMemoryThreadRepository implements ThreadRepository {
  readonly rows = new Map<string, Thread>();
  /** message id (ours or the provider's) → thread id */
  private readonly byMessageId = new Map<string, string>();

  async create(data: { subject: string | null; lastMessageAt: Date }): Promise<Thread> {
    const now = new Date();
    const thread: Thread = {
      ...data,
      id: nextId('thr'),
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(thread.id, thread);
    return thread;
  }

  async findById(id: string): Promise<Thread | null> {
    return this.rows.get(id) ?? null;
  }

  async findByMessageIds(messageIds: string[]): Promise<Thread | null> {
    for (const messageId of messageIds) {
      const threadId = this.byMessageId.get(messageId);
      if (threadId) return this.rows.get(threadId) ?? null;
    }
    return null;
  }

  async list(filter: { limit?: number }): Promise<Paginated<Thread>> {
    const items = [...this.rows.values()]
      .sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime())
      .slice(0, filter.limit ?? 50);

    return { items, nextCursor: null };
  }

  async touch(id: string, lastMessageAt: Date): Promise<void> {
    const existing = this.rows.get(id);
    if (!existing) return;

    this.rows.set(id, {
      ...existing,
      lastMessageAt: new Date(
        Math.max(existing.lastMessageAt.getTime(), lastMessageAt.getTime()),
      ),
      updatedAt: new Date(),
    });
  }

  /** Test-side stand-in for the Neon join from emails to threads. */
  index(messageIds: (string | null)[], threadId: string): void {
    for (const messageId of messageIds) {
      if (messageId) this.byMessageId.set(messageId, threadId);
    }
  }
}

export class InMemoryEventRepository implements EventRepository {
  readonly rows: MailEvent[] = [];

  async create(data: {
    emailId: string | null;
    type: MailEventType;
    metadata: Record<string, unknown>;
  }): Promise<MailEvent> {
    const event: MailEvent = { ...data, id: nextId('evt'), occurredAt: new Date() };
    this.rows.push(event);
    return event;
  }

  async findById(id: string): Promise<MailEvent | null> {
    return this.rows.find((row) => row.id === id) ?? null;
  }

  async list(filter: EventFilter): Promise<Paginated<MailEvent>> {
    const items = this.rows
      .filter((row) => !filter.emailId || row.emailId === filter.emailId)
      .filter((row) => !filter.types?.length || filter.types.includes(row.type))
      .filter(
        (row) =>
          !filter.endpointId || row.metadata.endpointId === filter.endpointId,
      )
      .filter((row) => !filter.since || row.occurredAt >= filter.since)
      .filter((row) => !filter.until || row.occurredAt <= filter.until)
      .slice(0, filter.limit ?? 50);

    return { items, nextCursor: null };
  }
}

/**
 * Endpoints, their recipients, and the address bindings between them.
 *
 * The verification challenge is reproduced faithfully — hash and expiry are
 * both part of the match — because "verified" is what stands between a typo and
 * a stranger receiving a customer's mail.
 */
export class InMemoryEndpointRepository implements EndpointRepository {
  readonly rows = new Map<string, Endpoint>();
  readonly recipients = new Map<string, EndpointEmailRecipient>();
  readonly bindings = new Set<string>();

  private readonly challenges = new Map<string, { hash: string; expiresAt: Date }>();
  private readonly webhookConfigs = new Map<string, EndpointWebhookConfig>();

  async create(data: {
    name: string;
    type: Endpoint['type'];
    enabled: boolean;
  }): Promise<Endpoint> {
    const now = new Date();
    const endpoint: Endpoint = {
      ...data,
      id: nextId('ep'),
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(endpoint.id, endpoint);
    return endpoint;
  }

  async findById(id: string): Promise<Endpoint | null> {
    return this.rows.get(id) ?? null;
  }

  async list(): Promise<Endpoint[]> {
    return [...this.rows.values()];
  }

  async update(
    id: string,
    data: { name?: string; enabled?: boolean },
  ): Promise<Endpoint> {
    const existing = this.rows.get(id);
    if (!existing) throw new NotFoundError(`Endpoint ${id} not found`);

    const updated = { ...existing, ...data, updatedAt: new Date() };
    this.rows.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    if (!this.rows.delete(id)) throw new NotFoundError(`Endpoint ${id} not found`);
  }

  async listForAddress(addressId: string): Promise<Endpoint[]> {
    return [...this.bindings]
      .filter((key) => key.startsWith(`${addressId}:`))
      .map((key) => this.rows.get(key.split(':')[1]))
      .filter((endpoint): endpoint is Endpoint => Boolean(endpoint?.enabled));
  }

  async bindToAddress(addressId: string, endpointId: string): Promise<void> {
    this.bindings.add(`${addressId}:${endpointId}`);
  }

  async unbindFromAddress(addressId: string, endpointId: string): Promise<void> {
    this.bindings.delete(`${addressId}:${endpointId}`);
  }

  async getWebhookConfig(
    endpointId: string,
  ): Promise<EndpointWebhookConfig | null> {
    return this.webhookConfigs.get(endpointId) ?? null;
  }

  async setWebhookConfig(config: EndpointWebhookConfig): Promise<void> {
    this.webhookConfigs.set(config.endpointId, config);
  }

  async listRecipients(endpointId: string): Promise<EndpointEmailRecipient[]> {
    return [...this.recipients.values()].filter(
      (recipient) => recipient.endpointId === endpointId,
    );
  }

  async findRecipient(id: string): Promise<EndpointEmailRecipient | null> {
    return this.recipients.get(id) ?? null;
  }

  async addRecipient(
    endpointId: string,
    email: string,
  ): Promise<EndpointEmailRecipient> {
    const duplicate = (await this.listRecipients(endpointId)).some(
      (recipient) => recipient.email === email.toLowerCase(),
    );

    if (duplicate) {
      throw new ConflictError(`${email} is already a recipient of this endpoint`);
    }

    const recipient: EndpointEmailRecipient = {
      id: nextId('rcpt'),
      endpointId,
      email: email.toLowerCase(),
      verifiedAt: null,
      verificationExpiresAt: null,
      enabled: true,
    };

    this.recipients.set(recipient.id, recipient);
    return recipient;
  }

  async setRecipientChallenge(
    recipientId: string,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<void> {
    this.challenges.set(recipientId, { hash: tokenHash, expiresAt });

    const existing = this.recipients.get(recipientId);
    if (existing) {
      this.recipients.set(recipientId, {
        ...existing,
        verificationExpiresAt: expiresAt,
      });
    }
  }

  async verifyRecipientWithToken(
    recipientId: string,
    tokenHash: string,
    now: Date,
  ): Promise<EndpointEmailRecipient | null> {
    const challenge = this.challenges.get(recipientId);
    const recipient = this.recipients.get(recipientId);

    if (!challenge || !recipient) return null;
    if (challenge.hash !== tokenHash) return null;
    if (challenge.expiresAt.getTime() <= now.getTime()) return null;

    const verified = {
      ...recipient,
      verifiedAt: now,
      verificationExpiresAt: null,
    };

    this.recipients.set(recipientId, verified);
    this.challenges.delete(recipientId);
    return verified;
  }

  async markRecipientVerified(
    recipientId: string,
  ): Promise<EndpointEmailRecipient> {
    const recipient = this.recipients.get(recipientId);
    if (!recipient) throw new NotFoundError(`Recipient ${recipientId} not found`);

    const verified = {
      ...recipient,
      verifiedAt: new Date(),
      verificationExpiresAt: null,
    };
    this.recipients.set(recipientId, verified);
    return verified;
  }

  async removeRecipient(recipientId: string): Promise<void> {
    if (!this.recipients.delete(recipientId)) {
      throw new NotFoundError(`Recipient ${recipientId} not found`);
    }
  }
}

/**
 * Endpoint deliveries.
 *
 * Reproduces the one constraint the Neon implementation leans on the database
 * for — the unique index on (event, endpoint, recipient) — because that index
 * *is* how a single deliverer gets elected. A fake that let both callers insert
 * would make a concurrency test pass while the real thing double-delivers.
 */
export class InMemoryDeliveryRepository implements DeliveryRepository {
  readonly rows = new Map<string, EndpointDelivery>();

  async enqueue(data: {
    endpointId: string;
    eventId: string;
    recipientId: string | null;
  }): Promise<EnqueueResult> {
    const existing = [...this.rows.values()].find(
      (row) =>
        row.eventId === data.eventId &&
        row.endpointId === data.endpointId &&
        (row.recipientId ?? '') === (data.recipientId ?? ''),
    );

    if (existing) return { delivery: existing, created: false };

    const now = new Date();
    const delivery: EndpointDelivery = {
      ...data,
      id: nextId('dlv'),
      status: 'pending',
      attempt: 0,
      responseCode: null,
      lastError: null,
      nextAttemptAt: now,
      leaseOwner: null,
      leaseExpiresAt: null,
      deliveredAt: null,
      createdAt: now,
      updatedAt: now,
    };

    this.rows.set(delivery.id, delivery);
    return { delivery, created: true };
  }

  async findById(id: string): Promise<EndpointDelivery | null> {
    return this.rows.get(id) ?? null;
  }

  /**
   * The same transition the Neon `UPDATE … WHERE status IN (…) RETURNING *`
   * makes, reproduced exactly: `pending`, or `delivering` with an expired
   * lease, and never `failed`. A fake that let anything be claimed would make
   * the double-delivery tests pass for the wrong reason.
   */
  async claim(
    id: string,
    leaseOwner: string,
    leaseMs: number,
  ): Promise<EndpointDelivery | null> {
    const existing = this.rows.get(id);
    if (!existing) return null;

    const now = new Date();
    const leaseExpired =
      existing.status === 'delivering' &&
      existing.leaseExpiresAt !== null &&
      existing.leaseExpiresAt.getTime() < now.getTime();

    if (existing.status !== 'pending' && !leaseExpired) return null;

    const claimed: EndpointDelivery = {
      ...existing,
      status: 'delivering',
      leaseOwner,
      leaseExpiresAt: new Date(now.getTime() + leaseMs),
      updatedAt: now,
    };

    this.rows.set(id, claimed);
    return claimed;
  }

  async requeue(id: string): Promise<EndpointDelivery | null> {
    const existing = this.rows.get(id);
    if (!existing) return null;
    if (existing.status !== 'failed' && existing.status !== 'pending') return null;

    const now = new Date();
    const requeued: EndpointDelivery = {
      ...existing,
      status: 'pending',
      nextAttemptAt: now,
      leaseOwner: null,
      leaseExpiresAt: null,
      updatedAt: now,
    };

    this.rows.set(id, requeued);
    return requeued;
  }

  async markDelivered(id: string, responseCode: number): Promise<void> {
    const existing = this.rows.get(id);
    if (!existing) return;

    this.rows.set(id, {
      ...existing,
      status: 'delivered',
      attempt: existing.attempt + 1,
      responseCode,
      lastError: null,
      deliveredAt: new Date(),
      leaseOwner: null,
      leaseExpiresAt: null,
      updatedAt: new Date(),
    });
  }

  async markFailed(
    id: string,
    responseCode: number | null,
    error: string,
    nextAttemptAt: Date | null,
  ): Promise<void> {
    const existing = this.rows.get(id);
    if (!existing) return;

    this.rows.set(id, {
      ...existing,
      status: nextAttemptAt ? 'pending' : 'failed',
      attempt: existing.attempt + 1,
      responseCode,
      lastError: error.slice(0, 2000),
      // Left untouched on a final failure; `status` is what says there is no
      // next attempt.
      nextAttemptAt: nextAttemptAt ?? existing.nextAttemptAt,
      leaseOwner: null,
      leaseExpiresAt: null,
      updatedAt: new Date(),
    });
  }

  async listForEvent(eventId: string): Promise<EndpointDelivery[]> {
    return [...this.rows.values()].filter((row) => row.eventId === eventId);
  }

  async listForEndpoint(
    endpointId: string,
    limit = 50,
  ): Promise<EndpointDelivery[]> {
    return [...this.rows.values()]
      .filter((row) => row.endpointId === endpointId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }
}

export class InMemoryReplyRelayRepository implements ReplyRelayRepository {
  readonly rows = new Map<string, ReplyRelay>();

  async create(
    data: Omit<ReplyRelay, 'id' | 'createdAt' | 'revokedAt'>,
  ): Promise<ReplyRelay> {
    const relay: ReplyRelay = {
      ...data,
      id: nextId('rr'),
      revokedAt: null,
      createdAt: new Date(),
    };
    this.rows.set(relay.id, relay);
    return relay;
  }

  async findByTokenHash(tokenHash: string): Promise<ReplyRelay | null> {
    return (
      [...this.rows.values()].find((relay) => relay.tokenHash === tokenHash) ?? null
    );
  }

  async revoke(id: string): Promise<void> {
    const relay = this.rows.get(id);
    if (relay) this.rows.set(id, { ...relay, revokedAt: new Date() });
  }
}

export class InMemoryReconciliationRepository
  implements ReconciliationRepository
{
  readonly runs: ReconciliationRun[] = [];
  readonly items: ReconciliationItem[] = [];

  async startRun(provider: string): Promise<ReconciliationRun> {
    const run: ReconciliationRun = {
      id: nextId('run'),
      provider,
      status: 'running',
      startedAt: new Date(),
      finishedAt: null,
      error: null,
    };

    this.runs.push(run);
    return run;
  }

  async finishRun(
    id: string,
    status: 'completed' | 'failed',
    error: string | null = null,
  ): Promise<ReconciliationRun> {
    const index = this.runs.findIndex((run) => run.id === id);
    if (index < 0) throw new NotFoundError(`Reconciliation run ${id} not found`);

    const finished: ReconciliationRun = {
      ...this.runs[index],
      status,
      error,
      finishedAt: new Date(),
    };

    this.runs[index] = finished;
    return finished;
  }

  async addItem(data: {
    runId: string;
    resourceType: string;
    resourceId: string;
    status: ReconciliationItemStatus;
    detail: Record<string, unknown>;
  }): Promise<ReconciliationItem> {
    const item: ReconciliationItem = {
      ...data,
      id: nextId('item'),
      createdAt: new Date(),
    };

    this.items.push(item);
    return item;
  }

  async latestRun(): Promise<ReconciliationRun | null> {
    return this.runs.at(-1) ?? null;
  }

  async listRuns(limit = 20): Promise<ReconciliationRun[]> {
    return [...this.runs].reverse().slice(0, limit);
  }

  async listItems(runId: string): Promise<ReconciliationItem[]> {
    return this.items.filter((item) => item.runId === runId);
  }
}

/** Storage that keeps bytes in a Map, so a test can assert on what was stored. */
export class InMemoryStorage implements Storage {
  readonly id = 'local' as const;
  readonly objects = new Map<string, Buffer>();

  async put(key: string, body: Buffer): Promise<{ key: string; sizeBytes: number }> {
    this.objects.set(key, body);
    return { key, sizeBytes: body.byteLength };
  }

  async get(key: string): Promise<Buffer> {
    const value = this.objects.get(key);
    if (!value) throw new NotFoundError(`No stored object at ${key}`);
    return value;
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async presignedUrl(): Promise<null> {
    return null;
  }
}
