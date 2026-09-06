/**
 * Provider-neutral types (execution plan §5).
 *
 * Nothing here may name a concrete provider. `server/providers/forward-email`
 * is the only directory in the repo allowed to know Forward Email exists, and
 * the CI grep in `scripts/check-provider-boundary.sh` enforces that.
 */

export interface ProviderDomain {
  id: string;
  name: string;
  verified: boolean;
  /** Records the operator must publish before the domain works. */
  records: DnsRecord[];
}

export interface DnsRecord {
  type: 'MX' | 'TXT' | 'CNAME';
  name: string;
  value: string;
  priority?: number;
  /** What this record is for, so the dashboard can group them. */
  purpose: 'inbound' | 'verification' | 'spf' | 'dkim' | 'dmarc';
  present: boolean;
}

export interface DomainVerification {
  verified: boolean;
  records: DnsRecord[];
  /** Human-readable reasons verification did not pass, if any. */
  errors: string[];
}

export interface CreateDomainInput {
  name: string;
}

export interface ProviderAlias {
  id: string;
  /** `*` for a catch-all, otherwise the concrete local part. */
  localPart: string;
  domain: string;
  recipients: string[];
  enabled: boolean;
}

export interface CreateAliasInput {
  domainId: string;
  localPart: string;
  /** Where the provider delivers. For MailPiston this is the ingress URL. */
  recipients: string[];
  enabled?: boolean;
  description?: string;
}

export interface UpdateAliasInput {
  domainId: string;
  localPart?: string;
  recipients?: string[];
  enabled?: boolean;
}

export interface EmailAddressInput {
  address: string;
  name?: string;
}

export interface OutboundAttachment {
  filename: string;
  contentType: string;
  /** Base64. Bytes are read from R2 at send time, never held in Postgres. */
  content: string;
}

export interface SendEmailInput {
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  replyTo?: string;
  subject: string;
  text?: string;
  html?: string;
  headers?: Record<string, string>;
  attachments?: OutboundAttachment[];
}

export interface ReplyEmailInput extends SendEmailInput {
  inReplyTo: string;
  references: string[];
}

export interface ProviderSendResult {
  /** The provider's own id for the message, if it exposes one. */
  providerMessageId: string | null;
  /** The RFC 5322 Message-ID, when the provider reports it. */
  messageId: string | null;
  acceptedAt: Date;
}

export interface NormalizedAttachment {
  filename: string;
  contentType: string;
  sizeBytes: number;
  /** Base64 bytes as delivered inline by the provider. */
  content: string;
  contentId: string | null;
}

/**
 * One inbound delivery, provider-shaped detail removed.
 *
 * `recipient` is derived from the SMTP envelope, never from the `To:` header:
 * a message BCC'd to a managed address carries no `To:` header naming it at
 * all (roadmap §1.4).
 */
export interface NormalizedInboundEmail {
  provider: string;
  providerMessageId: string | null;
  messageId: string | null;

  /** The envelope recipient that caused THIS delivery. */
  recipient: string;
  /** Every envelope recipient in the delivery, for diagnostics. */
  envelopeRecipients: string[];
  /** Envelope sender (MAIL FROM), which may differ from the From: header. */
  envelopeSender: string | null;

  from: string;
  to: string[];
  cc: string[];

  subject: string | null;
  text: string | null;
  html: string | null;

  inReplyTo: string | null;
  references: string[];

  receivedAt: Date;
  attachments: NormalizedAttachment[];
  /** Complete original MIME source, when the provider supplies it. */
  raw: string | null;
  headers: Record<string, string | string[]>;
}

export type NormalizedMailEventType =
  | 'delivered'
  | 'soft_bounced'
  | 'hard_bounced'
  | 'failed';

export interface NormalizedMailEvent {
  provider: string;
  type: NormalizedMailEventType;
  providerMessageId: string | null;
  messageId: string | null;
  recipient: string | null;
  occurredAt: Date;
  detail: Record<string, unknown>;
}

export interface MailProvider {
  readonly id: string;

  /** Find a provider domain by name so an existing domain can be adopted. */
  findDomain(name: string): Promise<ProviderDomain | null>;
  createDomain(input: CreateDomainInput): Promise<ProviderDomain>;
  verifyDomain(domainId: string): Promise<DomainVerification>;
  deleteDomain(domainId: string): Promise<void>;

  /** Find a concrete alias by local part so existing aliases can be adopted. */
  findAlias(domainId: string, localPart: string): Promise<ProviderAlias | null>;
  createAlias(input: CreateAliasInput): Promise<ProviderAlias>;
  updateAlias(aliasId: string, input: UpdateAliasInput): Promise<ProviderAlias>;
  deleteAlias(aliasId: string, domainId: string): Promise<void>;
  listAliases(domainId: string): Promise<ProviderAlias[]>;

  send(input: SendEmailInput): Promise<ProviderSendResult>;
  reply(input: ReplyEmailInput): Promise<ProviderSendResult>;

  verifyInboundWebhook(request: Request): Promise<boolean>;

  normalizeInbound(payload: unknown): Promise<NormalizedInboundEmail>;
  normalizeDeliveryEvent(payload: unknown): Promise<NormalizedMailEvent>;
}
