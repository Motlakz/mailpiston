/**
 * A thin client over the same `/v1` routes the dashboard uses.
 *
 * There is no private API: the dashboard authenticates with an operator
 * session and this client with an API key, and both hit identical routes. A
 * bug in the public surface therefore shows up in our own UI first.
 */
import type { MailpistonEmail } from './payload';

export interface MailpistonClientOptions {
  /** Deployment origin, e.g. `https://mailpiston.com`. */
  baseUrl: string;
  apiKey: string;
  fetch?: typeof fetch;
}

export interface SendInput {
  addressId: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text?: string;
  html?: string;
}

export interface ReplyInput {
  to?: string[];
  cc?: string[];
  text?: string;
  html?: string;
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
  send(input: SendInput): Promise<MailpistonEmail> {
    return this.post('/api/v1/emails/send', input);
  }

  /**
   * Replies to a message. The threading headers are MailPiston's to set — a
   * reply built by hand would land as a new conversation in the recipient's
   * client.
   */
  reply(emailId: string, input: ReplyInput): Promise<MailpistonEmail> {
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
