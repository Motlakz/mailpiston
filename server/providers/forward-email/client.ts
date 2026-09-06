import 'server-only';

import { ExternalAPIError, ProviderTimeoutError } from '@/server/core/errors';

/**
 * Thin typed HTTP client over api.forwardemail.net.
 *
 * Deliberately dumb: no retries, no backoff, no caching. Retry policy belongs
 * to Inngest (§15), and a client that quietly retries a `POST /v1/emails`
 * sends the message twice.
 *
 * Auth is HTTP Basic with the API token as the username and an empty password.
 */

export interface ForwardEmailDomain {
  id: string;
  name: string;
  has_mx_record?: boolean;
  has_txt_record?: boolean;
  has_dkim_record?: boolean;
  has_return_path_record?: boolean;
  has_dmarc_record?: boolean;
  verification_record?: string;
  plan?: string;
}

export interface ForwardEmailAlias {
  id: string;
  name: string;
  recipients: string[];
  is_enabled: boolean;
  description?: string;
  domain?: ForwardEmailDomain | string;
}

export interface ForwardEmailVerifyResponse {
  has_mx_record?: boolean;
  has_txt_record?: boolean;
  has_dkim_record?: boolean;
  has_return_path_record?: boolean;
  has_dmarc_record?: boolean;
  verification_record?: string;
  errors?: Array<{ message?: string } | string>;
}

export interface ForwardEmailSendResponse {
  id?: string;
  message_id?: string;
  messageId?: string;
  accepted?: string[];
  created_at?: string;
}

export interface ForwardEmailLimitResponse {
  count?: number;
  limit?: number;
}

export interface ForwardEmailClientOptions {
  apiToken: string;
  baseUrl: string;
  timeoutMs: number;
}

const PROVIDER = 'forward-email';

export class ForwardEmailClient {
  constructor(private readonly options: ForwardEmailClientOptions) {}

  // --- Domains --------------------------------------------------------------

  createDomain(name: string): Promise<ForwardEmailDomain> {
    return this.request<ForwardEmailDomain>('POST', '/v1/domains', {
      domain: name,
      // Enhanced Protection is the plan the whole cost thesis rests on
      // (roadmap §1.1): unlimited domains and aliases, priced on volume.
      plan: 'enhanced_protection',
    });
  }

  getDomain(domain: string): Promise<ForwardEmailDomain> {
    return this.request<ForwardEmailDomain>('GET', `/v1/domains/${encode(domain)}`);
  }

  findDomain(domain: string): Promise<ForwardEmailDomain | null> {
    return this.request<ForwardEmailDomain | null>(
      'GET',
      `/v1/domains/${encode(domain)}`,
      undefined,
      { allowNotFound: true },
    );
  }

  deleteDomain(domain: string): Promise<void> {
    return this.request<void>('DELETE', `/v1/domains/${encode(domain)}`);
  }

  /**
   * Triggers a fresh check of the receiving records.
   *
   * Records that have not propagated yet come back as a 400 whose body lists
   * what is missing. Mid-onboarding that is the expected answer, not a provider
   * failure, so the reasons are returned rather than thrown; only a genuinely
   * broken response still raises.
   */
  verifyRecords(domain: string): Promise<string[]> {
    return this.runVerification(`/v1/domains/${encode(domain)}/verify-records`);
  }

  /** Reports the DKIM/SPF/DMARC set required for *sending*, not just receiving. */
  verifySmtp(domain: string): Promise<string[]> {
    return this.runVerification(`/v1/domains/${encode(domain)}/verify-smtp`);
  }

  private async runVerification(path: string): Promise<string[]> {
    const response = await this.fetchRaw('GET', path);
    const body = await safeText(response, 4000);

    if (response.ok) return [];
    if (response.status === 400) return parseVerificationIssues(body);

    throw new ExternalAPIError(
      `Forward Email GET ${path} returned ${response.status}: ${body.slice(0, 500)}`,
      PROVIDER,
    );
  }

  // --- Aliases --------------------------------------------------------------

  listAliases(domain: string): Promise<ForwardEmailAlias[]> {
    return this.request<ForwardEmailAlias[]>(
      'GET',
      `/v1/domains/${encode(domain)}/aliases`,
    );
  }

  findAlias(domain: string, localPart: string): Promise<ForwardEmailAlias | null> {
    return this.request<ForwardEmailAlias | null>(
      'GET',
      `/v1/domains/${encode(domain)}/aliases/${encode(localPart)}`,
      undefined,
      { allowNotFound: true },
    );
  }

  createAlias(
    domain: string,
    body: {
      name: string;
      recipients: string[];
      is_enabled?: boolean;
      description?: string;
    },
  ): Promise<ForwardEmailAlias> {
    return this.request<ForwardEmailAlias>(
      'POST',
      `/v1/domains/${encode(domain)}/aliases`,
      body,
    );
  }

  updateAlias(
    domain: string,
    aliasId: string,
    body: {
      name?: string;
      recipients?: string[];
      is_enabled?: boolean;
    },
  ): Promise<ForwardEmailAlias> {
    return this.request<ForwardEmailAlias>(
      'PUT',
      `/v1/domains/${encode(domain)}/aliases/${encode(aliasId)}`,
      body,
    );
  }

  deleteAlias(domain: string, aliasId: string): Promise<void> {
    return this.request<void>(
      'DELETE',
      `/v1/domains/${encode(domain)}/aliases/${encode(aliasId)}`,
    );
  }

  // --- Outbound -------------------------------------------------------------

  /** Today's outbound usage. Forward Email reports the daily pair only. */
  getEmailLimit(): Promise<ForwardEmailLimitResponse> {
    return this.request<ForwardEmailLimitResponse>('GET', '/v1/emails/limit');
  }

  sendEmail(body: Record<string, unknown>): Promise<ForwardEmailSendResponse> {
    return this.request<ForwardEmailSendResponse>('POST', '/v1/emails', body);
  }

  // --- Transport ------------------------------------------------------------

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options: {
      allowNotFound?: boolean;
      responseType?: 'json' | 'none';
    } = {},
  ): Promise<T> {
    const response = await this.fetchRaw(method, path, body);

    if (options.allowNotFound && response.status === 404) return null as T;

    if (!response.ok) {
      throw new ExternalAPIError(
        `Forward Email ${method} ${path} returned ${response.status}: ${await safeText(response)}`,
        PROVIDER,
      );
    }

    if (response.status === 204) return undefined as T;

    // Forward Email's verification endpoints acknowledge with text/plain.
    // Their updated state is retrieved separately from the domain endpoint.
    if (options.responseType === 'none') {
      await response.text();
      return undefined as T;
    }

    const text = await response.text();
    if (!text) return undefined as T;

    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ExternalAPIError(
        `Forward Email ${method} ${path} returned a non-JSON body`,
        PROVIDER,
      );
    }
  }

  /** The transport itself, shared by the JSON and verification paths. */
  private async fetchRaw(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);

    try {
      return await fetch(new URL(path, this.options.baseUrl), {
        method,
        signal: controller.signal,
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.options.apiToken}:`).toString('base64')}`,
          Accept: 'application/json',
          ...(body !== undefined && { 'Content-Type': 'application/json' }),
        },
        ...(body !== undefined && { body: JSON.stringify(body) }),
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ProviderTimeoutError(PROVIDER);
      }
      throw new ExternalAPIError(
        `Forward Email request failed: ${(error as Error).message}`,
        PROVIDER,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Splits a verification 400 into one string per complaint.
 *
 * Forward Email packs them all into a single `message` joined by a comma and a
 * blank line, with MX entries as bullet lines under their own heading — so the
 * split is on that joiner rather than on newlines, which keeps each complaint
 * together with its bullets.
 */
function parseVerificationIssues(body: string): string[] {
  let message = body;

  try {
    const parsed = JSON.parse(body) as { message?: unknown };
    if (typeof parsed.message === 'string') message = parsed.message;
  } catch {
    // Some responses are text/plain; the raw body is then the message.
  }

  const issues = message
    .split(/\s*,\s*\n\s*\n\s*|\s*\n\s*\n\s*,\s*/)
    .map((issue) => issue.replace(/^[\s,]+|[\s,]+$/g, ''))
    .filter(Boolean);

  return issues.length > 0 ? issues : [message.trim()].filter(Boolean);
}

function encode(value: string): string {
  return encodeURIComponent(value);
}

async function safeText(response: Response, limit = 500): Promise<string> {
  try {
    return (await response.text()).slice(0, limit);
  } catch {
    return '<unreadable body>';
  }
}
