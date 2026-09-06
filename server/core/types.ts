/**
 * The domain model from execution plan §4, as the rest of the application sees
 * it. Repositories map database rows to these; nothing above a repository ever
 * sees a Drizzle row type.
 */

export interface DomainDnsRecord {
  type: 'MX' | 'TXT' | 'CNAME';
  name: string;
  value: string;
  priority?: number;
  purpose: 'inbound' | 'verification' | 'spf' | 'dkim' | 'dmarc';
  present: boolean;
}

/** §4.1 */
export interface Domain {
  id: string;
  name: string;
  providerDomainId: string | null;
  status: 'pending' | 'verified' | 'failed' | 'disabled';
  catchAllAliasId: string | null;
  dnsRecords: DomainDnsRecord[];
  /**
   * Why the last check did not pass, in the provider's own words. Empty once
   * the domain verifies, and the dashboard shows it instead of an error.
   */
  verificationErrors: string[];
  lastVerifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** §4.2 */
export interface Address {
  id: string;
  domainId: string;
  localPart: string;
  providerAliasId: string | null;
  canSend: boolean;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** An address with its domain resolved — what the dashboard and routing need. */
export interface AddressWithDomain extends Address {
  domainName: string;
  email: string;
}

/** §4.3 */
export type EndpointType = 'webhook' | 'email' | 'email_group';

export interface Endpoint {
  id: string;
  name: string;
  type: EndpointType;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface EndpointWebhookConfig {
  endpointId: string;
  url: string;
  secretCiphertext: string;
}

export interface EndpointEmailRecipient {
  id: string;
  endpointId: string;
  email: string;
  verifiedAt: Date | null;
  /** Set while a challenge is outstanding; the token itself is never stored. */
  verificationExpiresAt: Date | null;
  enabled: boolean;
}

/** §4.4 */
export interface AddressEndpoint {
  addressId: string;
  endpointId: string;
}

/** §4.4A */
export interface ReplyRelay {
  id: string;
  tokenHash: string;
  addressId: string;
  threadId: string;
  endpointEmailRecipientId: string;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

/** §4.5 */
export interface Thread {
  id: string;
  subject: string | null;
  lastMessageAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

/** §4.6 */
export type EmailDirection = 'inbound' | 'outbound';

export type EmailStatus =
  | 'received'
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'soft_bounced'
  | 'hard_bounced'
  | 'failed';

export interface Email {
  id: string;
  threadId: string | null;
  addressId: string | null;

  providerMessageId: string | null;
  messageId: string | null;
  /** Inbound dedupe key (§10.1). Null on outbound. */
  fingerprint: string | null;

  direction: EmailDirection;
  status: EmailStatus;

  from: string;
  to: string[];
  cc: string[];

  subject: string | null;
  text: string | null;
  html: string | null;

  inReplyTo: string | null;
  references: string[];

  rawStorageKey: string | null;

  receivedAt: Date | null;
  sentAt: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

/**
 * A row in the Inbox list.
 *
 * The two extra fields are the ones the list renders and would otherwise cost
 * one query per row: which managed address received it, and whether there is
 * anything to download.
 */
export interface EmailListItem extends Email {
  addressEmail: string | null;
  attachmentCount: number;
}

/** §18 */
export interface EmailAttachment {
  id: string;
  emailId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  storageKey: string;
  createdAt: Date;
}

/** §4.7, plus `email.rejected` from roadmap Phase 4. */
export type MailEventType =
  | 'email.received'
  | 'email.rejected'
  | 'email.queued'
  | 'email.sent'
  | 'email.delivered'
  | 'email.forwarded'
  | 'email.soft_bounced'
  | 'email.hard_bounced'
  | 'email.failed'
  | 'personal_forward.queued'
  | 'personal_forward.delivered'
  | 'personal_forward.failed'
  | 'relay.reply_received'
  | 'relay.reply_rejected'
  | 'relay.reply_sent'
  | 'webhook.queued'
  | 'webhook.delivered'
  | 'webhook.failed';

export interface MailEvent {
  id: string;
  emailId: string | null;
  type: MailEventType;
  metadata: Record<string, unknown>;
  occurredAt: Date;
}

/** §4.8 */
export interface EndpointDelivery {
  id: string;
  endpointId: string;
  eventId: string;
  recipientId: string | null;

  status: 'pending' | 'delivering' | 'delivered' | 'failed';

  attempt: number;
  responseCode: number | null;
  lastError: string | null;

  nextAttemptAt: Date;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  deliveredAt: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

export interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
}
