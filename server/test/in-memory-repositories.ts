import { ConflictError, NotFoundError } from '@/server/core/errors';
import type {
  Address,
  AddressWithDomain,
  Domain,
  Email,
  EmailAttachment,
  EmailListItem,
  MailEvent,
  MailEventType,
  Paginated,
  Thread,
} from '@/server/core/types';
import type {
  AddressRepository,
  CreateAttachmentData,
  CreateEmailData,
  EmailRepository,
  EventRepository,
  InboundCaptureResult,
  InboundThreadTarget,
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
   */
  constructor(readonly threads = new InMemoryThreadRepository()) {}

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

    return { duplicate: false, email, event };
  }

  async findById(id: string): Promise<Email | null> {
    return this.rows.get(id) ?? null;
  }

  async findByMessageId(messageId: string): Promise<Email | null> {
    return [...this.rows.values()].find((row) => row.messageId === messageId) ?? null;
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

  async list(filter: {
    emailId?: string;
    type?: MailEventType;
    limit?: number;
  }): Promise<Paginated<MailEvent>> {
    const items = this.rows
      .filter((row) => !filter.emailId || row.emailId === filter.emailId)
      .filter((row) => !filter.type || row.type === filter.type)
      .slice(0, filter.limit ?? 50);

    return { items, nextCursor: null };
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
