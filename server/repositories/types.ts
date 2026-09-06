import type {
  Address,
  AddressWithDomain,
  ApiKey,
  Domain,
  DomainDnsRecord,
  Email,
  EmailListItem,
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
  verificationErrors?: string[];
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

export type CreateAttachmentData = Omit<
  EmailAttachment,
  'id' | 'emailId' | 'createdAt'
>;

/**
 * Where an inbound message lands in the thread graph.
 *
 * Resolution happens before the write (it is a read of existing messages), but
 * *creating* a thread has to happen inside the capture transaction: a message
 * that turns out to be a duplicate must not leave a thread behind with nothing
 * in it.
 */
export type InboundThreadTarget =
  | { existingId: string; subject?: undefined }
  | { existingId?: undefined; subject: string | null };

/**
 * Result of an inbound capture. `duplicate` means the provider re-delivered a
 * message we already hold — not an error, and the caller returns 200.
 */
export type InboundCaptureResult =
  | { duplicate: false; email: Email; event: MailEvent }
  | { duplicate: true; email: null; event: null };

export interface EmailRepository {
  create(data: CreateEmailData): Promise<Email>;

  /**
   * Writes an inbound message, its attachment metadata, and its
   * `email.received` event as one transaction.
   *
   * This is one method rather than three calls because the three rows are one
   * fact. A partially-written message — stored, but with no attachments and no
   * event — cannot be repaired by the provider's retry, since the retry will
   * see the fingerprint already present and correctly conclude "already
   * stored". Either all of it lands or none of it does.
   */
  createInbound(input: {
    /**
     * The id is supplied by the caller, not minted here: attachment and raw
     * MIME storage keys embed it, and those bytes are written before this row
     * exists.
     */
    email: CreateEmailData & { id: string; fingerprint: string };
    attachments: CreateAttachmentData[];
    eventMetadata: Record<string, unknown>;
    /** Resolved by the thread resolver; the thread row is written here. */
    thread: InboundThreadTarget;
  }): Promise<InboundCaptureResult>;

  findById(id: string): Promise<Email | null>;
  findByMessageId(messageId: string): Promise<Email | null>;
  list(filter: {
    direction?: Email['direction'];
    addressId?: string;
    threadId?: string;
    limit?: number;
    cursor?: string | null;
  }): Promise<Paginated<EmailListItem>>;
  updateStatus(id: string, status: Email['status']): Promise<Email>;

  addAttachment(
    data: Omit<EmailAttachment, 'id' | 'createdAt'>,
  ): Promise<EmailAttachment>;
  listAttachments(emailId: string): Promise<EmailAttachment[]>;
  findAttachment(id: string): Promise<EmailAttachment | null>;
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
