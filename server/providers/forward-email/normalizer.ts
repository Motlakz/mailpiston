import { ValidationError } from '@/server/core/errors';
import type {
  NormalizedAttachment,
  NormalizedInboundEmail,
  NormalizedMailEvent,
  NormalizedMailEventType,
} from '@/server/providers/types';

/**
 * Forward Email's inbound POST body is `mailparser` output plus SMTP session
 * context (roadmap §1.4). This turns it into `NormalizedInboundEmail` and is
 * the only place that shape is understood.
 *
 * The one rule worth stating loudly: the recipient is taken from the envelope
 * `recipients` array, never from the `To:` header. A message BCC'd to a managed
 * address has no `To:` header naming it, so keying off headers loses the
 * delivery entirely.
 */

export const PROVIDER_ID = 'forward-email';

interface ParsedAddressValue {
  address?: string | null;
  name?: string | null;
}

interface ParsedAddress {
  value?: ParsedAddressValue[];
  text?: string;
}

interface ForwardEmailAttachment {
  filename?: string;
  contentType?: string;
  size?: number;
  content?: string | { type?: string; data?: number[] };
  cid?: string;
  contentId?: string;
}

interface ForwardEmailInboundPayload {
  messageId?: string;
  inReplyTo?: string;
  references?: string | string[];
  subject?: string;
  date?: string;
  text?: string;
  html?: string | false;
  textAsHtml?: string;
  from?: ParsedAddress | string;
  to?: ParsedAddress | string;
  cc?: ParsedAddress | string;
  recipients?: string[];
  attachments?: ForwardEmailAttachment[];
  raw?: string;
  headers?: Record<string, unknown>;
  headerLines?: Array<{ key: string; line: string }>;
  session?: {
    sender?: string;
    recipient?: string;
    arrivalDate?: string;
    arrivalTime?: string;
    helo?: string;
    clientHostname?: string;
    remoteAddress?: string;
  };
}

export class ForwardEmailNormalizer {
  async normalizeInbound(payload: unknown): Promise<NormalizedInboundEmail> {
    const body = payload as ForwardEmailInboundPayload;

    if (!body || typeof body !== 'object') {
      throw new ValidationError('Inbound payload is not an object');
    }

    const envelopeRecipients = collectEnvelopeRecipients(body);

    if (envelopeRecipients.length === 0) {
      throw new ValidationError(
        'Inbound payload carries no envelope recipient; cannot route it',
      );
    }

    const from = flattenAddresses(body.from);

    return {
      provider: PROVIDER_ID,
      // Forward Email does not expose an id of its own on the inbound path;
      // the RFC 5322 Message-ID is what we have, and the idempotency
      // fingerprint accounts for it being absent.
      providerMessageId: null,
      messageId: normalizeMessageId(body.messageId),

      recipient: envelopeRecipients[0],
      envelopeRecipients,
      envelopeSender: body.session?.sender?.toLowerCase() ?? null,

      from: from[0] ?? '',
      to: flattenAddresses(body.to),
      cc: flattenAddresses(body.cc),

      subject: body.subject ?? null,
      text: body.text ?? null,
      html: typeof body.html === 'string' ? body.html : null,

      inReplyTo: normalizeMessageId(body.inReplyTo),
      references: normalizeReferences(body.references),

      receivedAt: parseDate(body.date ?? body.session?.arrivalDate),
      attachments: (body.attachments ?? []).map(normalizeAttachment),
      raw: typeof body.raw === 'string' ? body.raw : null,
      headers: normalizeHeaders(body),
    };
  }

  async normalizeDeliveryEvent(payload: unknown): Promise<NormalizedMailEvent> {
    const body = payload as Record<string, unknown>;

    if (!body || typeof body !== 'object') {
      throw new ValidationError('Delivery event payload is not an object');
    }

    const bounce = (body.bounce ?? {}) as Record<string, unknown>;
    const rawCategory = String(
      bounce.category ?? bounce.action ?? body.event ?? body.type ?? '',
    ).toLowerCase();

    return {
      provider: PROVIDER_ID,
      type: classifyEvent(rawCategory, bounce),
      providerMessageId: asString(body.id) ?? null,
      messageId: normalizeMessageId(
        asString(body.messageId) ?? asString(body.message_id),
      ),
      recipient:
        asString(bounce.address)?.toLowerCase() ??
        asString(body.recipient)?.toLowerCase() ??
        null,
      occurredAt: parseDate(asString(body.date) ?? asString(body.created_at)),
      detail: { ...body },
    };
  }
}

// --- helpers -----------------------------------------------------------------

/**
 * `session.recipient` is the envelope recipient for THIS delivery and is the
 * authoritative one; `recipients` is the whole envelope. Order matters — the
 * first entry is what the caller routes on.
 */
function collectEnvelopeRecipients(body: ForwardEmailInboundPayload): string[] {
  const primary = body.session?.recipient?.toLowerCase();
  const all = (body.recipients ?? [])
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.toLowerCase());

  const ordered = primary ? [primary, ...all.filter((r) => r !== primary)] : all;

  return Array.from(new Set(ordered.filter(Boolean)));
}

function flattenAddresses(field: ParsedAddress | string | undefined): string[] {
  if (!field) return [];

  if (typeof field === 'string') {
    return field
      .split(',')
      .map((part) => extractAddress(part))
      .filter(Boolean);
  }

  const fromValue = (field.value ?? [])
    .map((entry) => entry.address?.trim().toLowerCase() ?? '')
    .filter(Boolean);

  if (fromValue.length > 0) return fromValue;

  // Some payloads carry only the rendered `text` form.
  return field.text
    ? field.text
        .split(',')
        .map((part) => extractAddress(part))
        .filter(Boolean)
    : [];
}

function extractAddress(value: string): string {
  const angled = value.match(/<([^>]+)>/);
  return (angled ? angled[1] : value).trim().toLowerCase();
}

/** Strips the surrounding angle brackets so ids compare cleanly across headers. */
function normalizeMessageId(value: string | undefined | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.replace(/^</, '').replace(/>$/, '');
}

function normalizeReferences(value: string | string[] | undefined): string[] {
  if (!value) return [];

  const parts = Array.isArray(value) ? value : value.split(/\s+/);

  return parts
    .map((part) => normalizeMessageId(part))
    .filter((part): part is string => Boolean(part));
}

function normalizeAttachment(
  attachment: ForwardEmailAttachment,
): NormalizedAttachment {
  const content = decodeContent(attachment.content);

  return {
    filename: attachment.filename ?? 'attachment',
    contentType: attachment.contentType ?? 'application/octet-stream',
    sizeBytes:
      attachment.size ??
      (content ? Buffer.from(content, 'base64').byteLength : 0),
    content: content ?? '',
    contentId: normalizeMessageId(attachment.contentId ?? attachment.cid),
  };
}

/**
 * Content arrives either as a base64 string or as a serialised Node Buffer
 * (`{ type: 'Buffer', data: [...] }`) depending on how the payload was encoded.
 */
function decodeContent(
  content: ForwardEmailAttachment['content'],
): string | null {
  if (typeof content === 'string') return content;

  if (content && Array.isArray(content.data)) {
    return Buffer.from(content.data).toString('base64');
  }

  return null;
}

function normalizeHeaders(
  body: ForwardEmailInboundPayload,
): Record<string, string | string[]> {
  const headers: Record<string, string | string[]> = {};

  // headerLines is the ordered raw array and survives duplicate keys, which the
  // object form silently collapses. Prefer it when present.
  if (Array.isArray(body.headerLines)) {
    for (const line of body.headerLines) {
      if (!line?.key || typeof line.line !== 'string') continue;

      const value = line.line.slice(line.line.indexOf(':') + 1).trim();
      const existing = headers[line.key];

      headers[line.key] = existing
        ? ([] as string[]).concat(existing, value)
        : value;
    }

    return headers;
  }

  for (const [key, value] of Object.entries(body.headers ?? {})) {
    headers[key.toLowerCase()] =
      typeof value === 'string' ? value : JSON.stringify(value);
  }

  return headers;
}

function classifyEvent(
  category: string,
  bounce: Record<string, unknown>,
): NormalizedMailEventType {
  if (category.includes('delivered') || category === 'delivery') {
    return 'delivered';
  }

  if (bounce.is_hard === true || category.includes('hard') || category === 'blocked') {
    return 'hard_bounced';
  }

  if (bounce.is_hard === false || category.includes('soft') || category.includes('defer')) {
    return 'soft_bounced';
  }

  return 'failed';
}

function parseDate(value: string | undefined): Date {
  if (!value) return new Date();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
