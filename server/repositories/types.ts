import type {
  Address,
  AddressWithDomain,
  ApiKey,
  AuditEntry,
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
  MailFilterEntry,
  Paginated,
  ReconciliationItem,
  ReconciliationItemStatus,
  ReconciliationRun,
  ReplyRelay,
  SpamSignal,
  SpamVerdict,
  Thread,
  ThreadListItem,
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
  /** Sending needs the domain too: the `From:` is built from both halves. */
  findByIdWithDomain(id: string): Promise<AddressWithDomain | null>;
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
  findRecipient(id: string): Promise<EndpointEmailRecipient | null>;
  addRecipient(
    endpointId: string,
    email: string,
  ): Promise<EndpointEmailRecipient>;
  /** Stores the hash of an outstanding challenge, never the token itself. */
  setRecipientChallenge(
    recipientId: string,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<void>;
  /**
   * Verifies only if the hash matches an unexpired challenge. Returns null
   * otherwise, so there is no branch that can verify on a failed comparison.
   */
  verifyRecipientWithToken(
    recipientId: string,
    tokenHash: string,
    now: Date,
  ): Promise<EndpointEmailRecipient | null>;
  markRecipientVerified(recipientId: string): Promise<EndpointEmailRecipient>;
  removeRecipient(recipientId: string): Promise<void>;
}

/**
 * Classification and the bin are omitted and re-added as optional: both have
 * column defaults, outbound mail is never classified, and every existing caller
 * would otherwise have to write `spamVerdict: 'clean', deletedAt: null` to say
 * nothing at all.
 */
export type CreateEmailData = Omit<
  Email,
  | 'id'
  | 'createdAt'
  | 'updatedAt'
  | 'spamVerdict'
  | 'spamScore'
  | 'spamCategory'
  | 'spamSignals'
  | 'deletedAt'
> &
  Partial<
    Pick<Email, 'spamVerdict' | 'spamScore' | 'spamCategory' | 'spamSignals'>
  >;

/**
 * The message list, as the unified Mail view queries it.
 *
 * `statuses` is a set rather than a single value because the states an operator
 * actually asks about are groups: "bounced" means soft *or* hard, since which
 * one it was is our retry decision and not the question being asked.
 */
export interface EmailFilter {
  direction?: Email['direction'];
  statuses?: Email['status'][];
  addressId?: string;
  threadId?: string;
  /**
   * Which classifications to include (roadmap Phase 12).
   *
   * Unset means `clean` and `suspicious` — the ordinary views must not show
   * quarantined mail, and forgetting to pass this should hide spam rather than
   * reveal it. Spam is opted into, never defaulted into.
   */
  spamVerdicts?: SpamVerdict[];
  /**
   * `false` (the default) excludes binned messages, `true` returns only them.
   * There is no "both": the bin is a place, and a message is either in it or
   * not.
   */
  deleted?: boolean;
  limit?: number;
  cursor?: string | null;
}

/** `prunedAt` is set by retention, never at capture. */
export type CreateAttachmentData = Omit<
  EmailAttachment,
  'id' | 'emailId' | 'createdAt' | 'prunedAt'
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
  /** Bounce mapping: provider events name their own id, not ours. */
  findByProviderMessageId(providerMessageId: string): Promise<Email | null>;
  list(filter: EmailFilter): Promise<Paginated<EmailListItem>>;
  updateStatus(id: string, status: Email['status']): Promise<Email>;
  /**
   * The outbound acknowledgement: the ids the provider assigned, plus the
   * status they imply. Separate from `updateStatus` because a send that
   * succeeded must record its ids and its status as one write — a row that is
   * `sent` with no message id cannot be threaded against or reconciled.
   */
  recordSent(
    id: string,
    data: {
      status: Email['status'];
      providerMessageId: string | null;
      messageId: string | null;
      sentAt: Date | null;
    },
  ): Promise<Email>;

  addAttachment(
    data: Omit<EmailAttachment, 'id' | 'createdAt'>,
  ): Promise<EmailAttachment>;
  listAttachments(emailId: string): Promise<EmailAttachment[]>;
  findAttachment(id: string): Promise<EmailAttachment | null>;

  /**
   * Retention (Phase 11). Both list methods return the oldest first and only
   * rows whose bytes are still present, so a sweep that is interrupted resumes
   * exactly where it stopped and re-running one costs nothing.
   */
  listPrunableRawMime(
    before: Date,
    limit: number,
  ): Promise<Array<{ id: string; rawStorageKey: string }>>;
  clearRawStorageKey(id: string): Promise<void>;
  listPrunableAttachments(
    before: Date,
    limit: number,
  ): Promise<EmailAttachment[]>;
  markAttachmentPruned(id: string): Promise<void>;

  /**
   * Reclassification by hand (roadmap Phase 12) — "this is spam", "this is
   * not". Overwrites the engine's verdict and replaces its signals with a
   * single one naming the operator, so the message can still say why it is
   * where it is.
   */
  setSpamVerdict(
    id: string,
    verdict: SpamVerdict,
    signals: SpamSignal[],
  ): Promise<Email>;

  /** Bin and un-bin. Neither touches stored bytes. */
  softDelete(id: string): Promise<Email>;
  restore(id: string): Promise<Email>;

  /**
   * Emptying the bin: the only path in the system that destroys a message.
   *
   * Returns the storage keys it removed rows for, because the bytes live in
   * object storage and the caller has to delete them separately — a repository
   * does not reach across to R2. Callers delete bytes *after* the rows are
   * gone: an orphaned object is cheap and collectable, a row pointing at
   * bytes that no longer exist is indistinguishable from corruption.
   */
  purgeDeleted(before?: Date): Promise<{ count: number; storageKeys: string[] }>;
  purgeOne(id: string): Promise<{ storageKeys: string[] }>;
}

/**
 * The operator's standing allow and deny decisions (roadmap Phase 12).
 *
 * Global rather than per domain: one person runs several apps, and an agency
 * worth blocking on one is worth blocking on all of them.
 */
export interface MailFilterRepository {
  list(): Promise<MailFilterEntry[]>;
  /** The two lists the classifier takes, in one round trip. */
  lists(): Promise<{ allow: string[]; deny: string[] }>;
  add(data: {
    kind: MailFilterEntry['kind'];
    pattern: string;
    note: string | null;
  }): Promise<MailFilterEntry>;
  remove(id: string): Promise<void>;
}

export interface ThreadRepository {
  create(data: { subject: string | null; lastMessageAt: Date }): Promise<Thread>;
  findById(id: string): Promise<Thread | null>;
  /** Thread resolution step: find the thread owning any of these message ids. */
  findByMessageIds(messageIds: string[]): Promise<Thread | null>;
  /**
   * The conversation list.
   *
   * `minMessages` stops this page duplicating the mail list: every captured
   * message creates a thread, so listing all of them shows every message
   * twice. A conversation is a thread somebody replied in.
   */
  list(filter: {
    limit?: number;
    cursor?: string | null;
    minMessages?: number;
  }): Promise<Paginated<ThreadListItem>>;
  touch(id: string, lastMessageAt: Date): Promise<void>;
}

export interface EventRepository {
  create(data: {
    emailId: string | null;
    type: MailEventType;
    metadata: Record<string, unknown>;
  }): Promise<MailEvent>;
  /** A retry rebuilds its payload from the event it was enqueued for. */
  findById(id: string): Promise<MailEvent | null>;
  list(filter: EventFilter): Promise<Paginated<MailEvent>>;
}

/**
 * The unified event stream (roadmap Phase 9).
 *
 * `addressId` and `recipient` are two halves of one question. Most events hang
 * off a message, and a message knows its address — but `email.rejected` has no
 * message at all, and it is the single event an operator most often goes
 * looking for ("where did that mail go?"). Its recipient lives in the metadata,
 * so filtering by address matches both.
 */
export interface EventFilter {
  emailId?: string;
  types?: MailEventType[];
  /** Events for messages this address received or sent. */
  addressId?: string;
  /** Also match address-less events (rejections) aimed at this mailbox. */
  recipient?: string;
  /** Matches `metadata.endpointId`, which fan-out events all carry. */
  endpointId?: string;
  since?: Date;
  until?: Date;
  limit?: number;
  cursor?: string | null;
}

/**
 * Whether this enqueue is the one that created the row.
 *
 * The unique index on (event, endpoint, recipient) makes enqueueing idempotent,
 * but idempotent is not the same as safe: two concurrent ingests of the same
 * event would both go on to *deliver* unless exactly one of them learns it lost
 * the race. `created` is how it finds out.
 */
export interface EnqueueResult {
  delivery: EndpointDelivery;
  created: boolean;
}

export interface DeliveryRepository {
  enqueue(data: {
    endpointId: string;
    eventId: string;
    recipientId: string | null;
  }): Promise<EnqueueResult>;
  findById(id: string): Promise<EndpointDelivery | null>;
  /**
   * Atomic claim (plan §15.5). Two executions must never receive the same row.
   *
   * Takes a `pending` delivery, or a `delivering` one whose lease has expired —
   * a process that dies mid-attempt would otherwise strand the row in
   * `delivering` forever, and no schedule of retries can rescue a delivery that
   * nothing is allowed to pick up.
   *
   * `failed` is deliberately not claimable: that is the terminal state, and a
   * stray event must not resurrect a delivery the schedule already gave up on.
   * Manual retry goes through `requeue` first.
   */
  claim(
    id: string,
    leaseOwner: string,
    leaseMs: number,
  ): Promise<EndpointDelivery | null>;
  /**
   * Manual retry: puts a delivery back in the queue, due now, so the ordinary
   * claim path can pick it up. Returns null if there is nothing to requeue.
   */
  requeue(id: string): Promise<EndpointDelivery | null>;
  /** Both outcomes increment `attempt` in the same statement that sets status. */
  markDelivered(id: string, responseCode: number): Promise<void>;
  /**
   * A `nextAttemptAt` leaves the delivery `pending` and due then; `null` is the
   * final failure and sets `failed`.
   */
  markFailed(
    id: string,
    responseCode: number | null,
    error: string,
    nextAttemptAt: Date | null,
  ): Promise<void>;
  listForEvent(eventId: string): Promise<EndpointDelivery[]>;
  /** The delivery log, newest first. */
  listForEndpoint(
    endpointId: string,
    limit?: number,
  ): Promise<EndpointDelivery[]>;
}

export interface ReplyRelayRepository {
  create(data: Omit<ReplyRelay, 'id' | 'createdAt' | 'revokedAt'>): Promise<ReplyRelay>;
  findByTokenHash(tokenHash: string): Promise<ReplyRelay | null>;
  revoke(id: string): Promise<void>;
}

/**
 * Phase 10 — drift detection against the provider.
 *
 * A run is opened before any comparison happens, so a crash mid-sweep leaves a
 * `running` row rather than nothing. "We do not know what happened" is a
 * finding; silence is not.
 */
export interface ReconciliationRepository {
  startRun(provider: string): Promise<ReconciliationRun>;
  finishRun(
    id: string,
    status: 'completed' | 'failed',
    error?: string | null,
  ): Promise<ReconciliationRun>;
  addItem(data: {
    runId: string;
    resourceType: string;
    resourceId: string;
    status: ReconciliationItemStatus;
    detail: Record<string, unknown>;
  }): Promise<ReconciliationItem>;
  /** The most recent run, whatever its state. */
  latestRun(): Promise<ReconciliationRun | null>;
  listRuns(limit?: number): Promise<ReconciliationRun[]>;
  listItems(runId: string): Promise<ReconciliationItem[]>;
}

/**
 * §24 — privileged mutations, recorded.
 *
 * Append-only by construction: there is no update and no delete. A log that can
 * be edited answers a different question from the one it was built for.
 */
export interface AuditRepository {
  record(data: {
    actor: string;
    action: string;
    resourceType: string;
    resourceId: string | null;
    metadata: Record<string, unknown>;
  }): Promise<AuditEntry>;
  list(filter: {
    action?: string;
    limit?: number;
    cursor?: string | null;
  }): Promise<Paginated<AuditEntry>>;
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
