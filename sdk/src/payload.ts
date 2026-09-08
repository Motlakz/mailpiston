/**
 * The MailPiston webhook payload — a public contract, versioned from its first
 * delivery (roadmap §5.7).
 *
 * This file is the single definition. The server builds payloads from these
 * types and receivers verify against them, so there is no second copy to drift.
 *
 * What is deliberately *absent* is as much a part of the contract as what is
 * here: no inline attachment bytes, no raw MIME, no provider session objects,
 * no relay tokens, no personal forwarding destinations, and none of the
 * transport headers of the personal mailboxes a message may also have reached.
 * A receiver is an application integrating with a mailbox, not an operator of
 * one.
 */

/** Every event type that can be delivered to a webhook endpoint. */
export const MAILPISTON_EVENT_TYPES = ['email.received'] as const;

export type MailpistonEventType = (typeof MAILPISTON_EVENT_TYPES)[number];

/**
 * Delivery state as the receiving application sees it.
 *
 * A narrower vocabulary than MailPiston's internal `EmailStatus`: internal
 * states like `queued` describe our own pipeline and would leak implementation
 * timing into a public contract.
 */
export type MailpistonDeliveryState =
  | 'received'
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'bounced'
  | 'failed';

export interface MailpistonAddress {
  /** Display name, when the message carried one. */
  name: string | null;
  email: string;
}

export interface MailpistonAttachment {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  /**
   * Authenticated download URL. It carries no credential of its own — the
   * caller presents their own API key — so it is safe to log and to store.
   */
  downloadUrl: string;
}

/**
 * The envelope, kept explicit and separate from the headers.
 *
 * They disagree more often than people expect: a BCC delivery has a `To:`
 * naming someone else entirely, and routing follows the envelope. A contract
 * that offered only the headers would make that case unrepresentable.
 */
export interface MailpistonEnvelope {
  from: string | null;
  recipients: string[];
}

export interface MailpistonEmail {
  id: string;
  threadId: string | null;
  direction: 'inbound' | 'outbound';
  state: MailpistonDeliveryState;

  envelope: MailpistonEnvelope;

  from: MailpistonAddress;
  to: string[];
  cc: string[];

  subject: string | null;
  text: string | null;
  /**
   * The HTML body exactly as it arrived. It is untrusted input from a stranger
   * — sanitize before rendering, and never inject it into a page as-is.
   */
  html: string | null;

  inReplyTo: string | null;
  references: string[];

  receivedAt: string | null;
  attachments: MailpistonAttachment[];
}

export interface MailpistonWebhookEvent {
  /** Bumped only for a breaking change to this shape. */
  version: '1';
  /** The event id, stable across every retry of the same delivery. */
  id: string;
  type: MailpistonEventType;
  createdAt: string;
  data: MailpistonEmail;
}

/**
 * Runtime guard for the payload shape.
 *
 * Deliberately shallow: it establishes that this is a MailPiston v1 event with
 * an email in it, which is what a receiver branches on. Validating every leaf
 * would turn an added optional field into a rejected delivery, and adding
 * fields is exactly what a versioned contract is allowed to do.
 */
export function isMailpistonEvent(value: unknown): value is MailpistonWebhookEvent {
  if (typeof value !== 'object' || value === null) return false;

  const event = value as Record<string, unknown>;

  return (
    event.version === '1' &&
    typeof event.id === 'string' &&
    typeof event.createdAt === 'string' &&
    MAILPISTON_EVENT_TYPES.includes(event.type as MailpistonEventType) &&
    typeof event.data === 'object' &&
    event.data !== null &&
    typeof (event.data as Record<string, unknown>).id === 'string'
  );
}
