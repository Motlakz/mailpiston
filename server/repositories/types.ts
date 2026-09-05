import type {
  Address,
  AddressWithDomain,
  ApiKey,
  Domain,
  DomainDnsRecord,
  Email,
  EmailAttachment,
  Endpoint,
  EndpointDelivery,
  EndpointEmailRecipient,
  EndpointWebhookConfig,
  MailEvent,
  MailEventType,
  Paginated,
  ReplyRelay,
  Thread,
} from '@/server/core/types';

/**
 * Repository interfaces — persistence only, one per aggregate (roadmap §2.1).
 *
 * Rules that hold for every method here:
 *  - no business logic, no provider calls, no HTTP;
 *  - inputs and outputs are the §4 domain types, never Drizzle rows;
 *  - a method that can fail on a constraint throws the matching `APIError`
 *    (`ConflictError`, `NotFoundError`) rather than leaking a driver error.
 */

export interface CreateDomainData {
  name: string;
  providerDomainId: string | null;
  status: Domain['status'];
  dnsRecords: DomainDnsRecord[];
}

export interface UpdateDomainData {
  status?: Domain['status'];
  providerDomainId?: string | null;
  catchAllAliasId?: string | null;
  dnsRecords?: DomainDnsRecord[];
  lastVerifiedAt?: Date | null;
}

export interface DomainRepository {
  create(data: CreateDomainData): Promise<Domain>;
  findById(id: string): Promise<Domain | null>;
  findByName(name: string): Promise<Domain | null>;
  list(): Promise<Domain[]>;
  update(id: string, data: UpdateDomainData): Promise<Domain>;
  delete(id: string): Promise<void>;
}

export interface CreateAddressData {
  domainId: string;
  localPart: string;
  providerAliasId: string | null;
  canSend: boolean;
  enabled: boolean;
}

export interface UpdateAddressData {
  enabled?: boolean;
  canSend?: boolean;
  providerAliasId?: string | null;
}

export interface AddressRepository {
  create(data: CreateAddressData): Promise<Address>;
  findById(id: string): Promise<Address | null>;
  /** Routing lookup for inbound mail. Case-insensitive on both sides. */
  findByEmail(email: string): Promise<AddressWithDomain | null>;
  findByDomainAndLocalPart(
    domainId: string,
    localPart: string,
  ): Promise<Address | null>;
  list(filter?: { domainId?: string }): Promise<AddressWithDomain[]>;
  update(id: string, data: UpdateAddressData): Promise<Address>;
  delete(id: string): Promise<void>;
}

export interface EndpointRepository {
  create(data: {
    name: string;
    type: Endpoint['type'];
    enabled: boolean;
  }): Promise<Endpoint>;
  findById(id: string): Promise<Endpoint | null>;
  list(): Promise<Endpoint[]>;
  update(
    id: string,
    data: { name?: string; enabled?: boolean },
  ): Promise<Endpoint>;
  delete(id: string): Promise<void>;

  /** Every enabled endpoint bound to an address, for inbound fan-out. */
  listForAddress(addressId: string): Promise<Endpoint[]>;
  bindToAddress(addressId: string, endpointId: string): Promise<void>;
  unbindFromAddress(addressId: string, endpointId: string): Promise<void>;

  getWebhookConfig(endpointId: string): Promise<EndpointWebhookConfig | null>;
  setWebhookConfig(config: EndpointWebhookConfig): Promise<void>;

  listRecipients(endpointId: string): Promise<EndpointEmailRecipient[]>;
  addRecipient(
    endpointId: string,
    email: string,
  ): Promise<EndpointEmailRecipient>;
  markRecipientVerified(recipientId: string): Promise<EndpointEmailRecipient>;
  removeRecipient(recipientId: string): Promise<void>;
}

export type CreateEmailData = Omit<Email, 'id' | 'createdAt' | 'updatedAt'>;

export interface EmailRepository {
  create(data: CreateEmailData): Promise<Email>;
  findById(id: string): Promise<Email | null>;
  findByMessageId(messageId: string): Promise<Email | null>;
  list(filter: {
    direction?: Email['direction'];
    addressId?: string;
    threadId?: string;
    limit?: number;
    cursor?: string | null;
  }): Promise<Paginated<Email>>;
  updateStatus(id: string, status: Email['status']): Promise<Email>;

  addAttachment(
    data: Omit<EmailAttachment, 'id' | 'createdAt'>,
  ): Promise<EmailAttachment>;
  listAttachments(emailId: string): Promise<EmailAttachment[]>;
}

export interface ThreadRepository {
  create(data: { subject: string | null; lastMessageAt: Date }): Promise<Thread>;
  findById(id: string): Promise<Thread | null>;
  /** Thread resolution step: find the thread owning any of these message ids. */
  findByMessageIds(messageIds: string[]): Promise<Thread | null>;
  list(filter: {
    limit?: number;
    cursor?: string | null;
  }): Promise<Paginated<Thread>>;
  touch(id: string, lastMessageAt: Date): Promise<void>;
}

export interface EventRepository {
  create(data: {
    emailId: string | null;
    type: MailEventType;
    metadata: Record<string, unknown>;
  }): Promise<MailEvent>;
  list(filter: {
    emailId?: string;
    type?: MailEventType;
    limit?: number;
    cursor?: string | null;
  }): Promise<Paginated<MailEvent>>;
}

export interface DeliveryRepository {
  enqueue(data: {
    endpointId: string;
    eventId: string;
    recipientId: string | null;
  }): Promise<EndpointDelivery>;
  findById(id: string): Promise<EndpointDelivery | null>;
  /** Atomic claim. Two workers must never receive the same row. */
  claim(id: string, leaseOwner: string, leaseMs: number): Promise<EndpointDelivery | null>;
  markDelivered(id: string, responseCode: number): Promise<void>;
  markFailed(id: string, responseCode: number | null, error: string, nextAttemptAt: Date | null): Promise<void>;
  listForEvent(eventId: string): Promise<EndpointDelivery[]>;
}

export interface ReplyRelayRepository {
  create(data: Omit<ReplyRelay, 'id' | 'createdAt' | 'revokedAt'>): Promise<ReplyRelay>;
  findByTokenHash(tokenHash: string): Promise<ReplyRelay | null>;
  revoke(id: string): Promise<void>;
}

export interface ApiKeyRepository {
  create(data: {
    name: string;
    keyHash: string;
    keyPrefix: string;
    expiresAt: Date | null;
  }): Promise<ApiKey>;
  list(): Promise<ApiKey[]>;
  revoke(id: string): Promise<void>;
}
