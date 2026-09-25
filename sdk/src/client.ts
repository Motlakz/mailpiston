/**
 * A thin client over the same `/v1` routes the dashboard uses.
 *
 * There is no private API: the dashboard authenticates with an operator
 * session and this client with an API key, and both hit identical routes. A
 * bug in the public surface therefore shows up in our own UI first.
 */

/**
 * What `/v1/emails/send` and `/v1/emails/:id/reply` hand back: the stored row,
 * with its dates as ISO strings.
 *
 * Not `MailpistonEmail` — that is the *webhook* payload, a narrower shape built
 * for a receiver, and the two are not interchangeable. Keep `id`: it is what a
 * later `reply()` addresses, and it works straight away, with no round trip
 * through a delivery first.
 */
export interface SentEmail {
  id: string;
  threadId: string | null;
  addressId: string | null;
  direction: 'inbound' | 'outbound';
  status: string;
  /** The RFC 5322 Message-ID, once the provider has assigned one. */
  messageId: string | null;
  providerMessageId: string | null;
  from: string;
  to: string[];
  cc: string[];
  subject: string | null;
  text: string | null;
  html: string | null;
  inReplyTo: string | null;
  references: string[];
  sentAt: string | null;
  createdAt: string;
}

export interface MailpistonClientOptions {
  /** Deployment origin, e.g. `https://mailpiston.com`. */
  baseUrl: string;
  apiKey: string;
  fetch?: typeof fetch;
}

/**
 * Who a message goes out as: `from`, or `addressId`. Exactly one.
 *
 * `from` is the one to reach for — `user@example.com`, or
 * `Display Name <user@example.com>`, the same string every other mail API
 * takes. It has to be one of your managed addresses, because sending is
 * authorised by a provider alias and an address you do not hold has none.
 *
 * `addressId` says the same thing with our id for the address. It is here for
 * callers that already hold one (the dashboard does); nothing needs it.
 */
export type Sender =
  | { from: string; addressId?: never }
  | { addressId: string; from?: never };

export type SendInput = Sender & {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text?: string;
  html?: string;
};

export interface ReplyInput {
  to?: string[];
  cc?: string[];
  text?: string;
  html?: string;
  /**
   * Optional, and only ever a display name: a reply goes out as the address
   * the message it answers belongs to. Naming a different address is an error
   * rather than a silent substitution.
   */
  from?: string;
}

export class MailpistonApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'MailpistonApiError';
  }
}

export class MailpistonClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: MailpistonClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  /** Sends a new message from one of your managed addresses. */
  send(input: SendInput): Promise<SentEmail> {
    return this.post('/api/v1/emails/send', input);
  }

  /**
   * Replies to a message. The threading headers are MailPiston's to set — a
   * reply built by hand would land as a new conversation in the recipient's
   * client.
   */
  reply(emailId: string, input: ReplyInput): Promise<SentEmail> {
    return this.post(`/api/v1/emails/${encodeURIComponent(emailId)}/reply`, input);
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const text = await response.text();
    const parsed: unknown = text ? JSON.parse(text) : null;

    if (!response.ok) {
      const error = (parsed as { error?: { code?: string; message?: string } } | null)
        ?.error;

      throw new MailpistonApiError(
        error?.message ?? `Request failed with ${response.status}`,
        error?.code ?? 'UNKNOWN',
        response.status,
      );
    }

    return (parsed as { data: T }).data;
  }
}
