import 'server-only';

import { ExternalAPIError } from '@/server/core/errors';
import type {
  CreateAliasInput,
  CreateDomainInput,
  DnsRecord,
  DomainVerification,
  MailProvider,
  NormalizedInboundEmail,
  NormalizedMailEvent,
  OutboundQuota,
  ProviderAlias,
  ProviderDomain,
  ProviderSendResult,
  ReplyEmailInput,
  SendEmailInput,
  UpdateAliasInput,
} from '@/server/providers/types';

import {
  ForwardEmailClient,
  type ForwardEmailAlias,
  type ForwardEmailDomain,
} from './client';
import { ForwardEmailNormalizer, PROVIDER_ID } from './normalizer';
import { ForwardEmailVerifier } from './verifier';

/**
 * `MailProvider` implemented against Forward Email.
 *
 * ⚠️ Deviation from execution plan §5, recorded here: `deleteAlias` takes the
 * domain as a second argument. Forward Email addresses aliases as
 * `/v1/domains/{domain}/aliases/{id}`, so an alias id alone is not routable.
 * The alternative — a lookup across every domain on every delete — is a worse
 * interface, not a cleaner one.
 *
 * Forward Email also identifies domains by *name* in its URLs, so
 * `providerDomainId` holds the domain name. That is a provider detail and it
 * stops at this file's boundary.
 */
export class ForwardEmailProvider implements MailProvider {
  readonly id = PROVIDER_ID;

  private readonly normalizer = new ForwardEmailNormalizer();

  constructor(
    private readonly client: ForwardEmailClient,
    private readonly verifier: ForwardEmailVerifier,
    /** Every alias MailPiston creates delivers here. */
    private readonly ingressUrl: string,
    /** Advertised on the plan; the API reports only the daily pair. */
    private readonly monthlyAllowance: number | null = null,
  ) {}

  // --- Domains --------------------------------------------------------------

  async findDomain(name: string): Promise<ProviderDomain | null> {
    const domain = await this.client.findDomain(name);
    return domain ? this.toProviderDomain(domain) : null;
  }

  async createDomain(input: CreateDomainInput): Promise<ProviderDomain> {
    const domain = await this.client.createDomain(input.name);
    return this.toProviderDomain(domain);
  }

  async verifyDomain(domainId: string): Promise<DomainVerification> {
    // The verification endpoints trigger fresh DNS checks and answer in plain
    // text, reporting anything missing as a 400 the client hands back as
    // issues. `verify-smtp` only covers sending, so it never decides the
    // outcome here. The updated JSON state comes from the domain endpoint.
    const [recordIssues, smtpIssues] = await Promise.all([
      this.client.verifyRecords(domainId),
      this.client.verifySmtp(domainId).catch(() => [] as string[]),
    ]);

    const domain = await this.client.getDomain(domainId);
    const verified = Boolean(domain.has_mx_record && domain.has_txt_record);

    return {
      verified,
      records: dnsRecordsFor(domainId, domain),
      errors: verified ? [] : [...new Set([...recordIssues, ...smtpIssues])],
    };
  }

  async deleteDomain(domainId: string): Promise<void> {
    await this.client.deleteDomain(domainId);
  }

  // --- Aliases --------------------------------------------------------------

  async findAlias(
    domainId: string,
    localPart: string,
  ): Promise<ProviderAlias | null> {
    const alias = await this.client.findAlias(domainId, localPart);
    return alias ? this.toProviderAlias(alias, domainId) : null;
  }

  async createAlias(input: CreateAliasInput): Promise<ProviderAlias> {
    const alias = await this.client.createAlias(input.domainId, {
      name: input.localPart,
      recipients: input.recipients.length > 0 ? input.recipients : [this.ingressUrl],
      is_enabled: input.enabled ?? true,
      description: input.description ?? 'Managed by MailPiston',
    });

    return this.toProviderAlias(alias, input.domainId);
  }

  async updateAlias(
    aliasId: string,
    input: UpdateAliasInput,
  ): Promise<ProviderAlias> {
    const alias = await this.client.updateAlias(input.domainId, aliasId, {
      ...(input.localPart !== undefined && { name: input.localPart }),
      ...(input.recipients !== undefined && { recipients: input.recipients }),
      ...(input.enabled !== undefined && { is_enabled: input.enabled }),
    });

    return this.toProviderAlias(alias, input.domainId);
  }

  async deleteAlias(aliasId: string, domainId: string): Promise<void> {
    await this.client.deleteAlias(domainId, aliasId);
  }

  async listAliases(domainId: string): Promise<ProviderAlias[]> {
    const aliases = await this.client.listAliases(domainId);
    return aliases.map((alias) => this.toProviderAlias(alias, domainId));
  }

  // --- Outbound -------------------------------------------------------------

  /**
   * Forward Email reports one pair — today's count and today's limit.
   *
   * The monthly figure is the plan's advertised allowance and is passed in as
   * configuration; nothing here multiplies the daily limit to invent one.
   */
  async outboundQuota(): Promise<OutboundQuota> {
    const limit = await this.client.getEmailLimit();

    return {
      daily: {
        used: limit.count ?? 0,
        limit: typeof limit.limit === 'number' ? limit.limit : null,
      },
      monthlyAllowance: this.monthlyAllowance,
      checkedAt: new Date(),
    };
  }

  async send(input: SendEmailInput): Promise<ProviderSendResult> {
    return this.dispatch(input);
  }

  async reply(input: ReplyEmailInput): Promise<ProviderSendResult> {
    return this.dispatch(input, {
      inReplyTo: input.inReplyTo,
      references: input.references,
    });
  }

  private async dispatch(
    input: SendEmailInput,
    threading?: { inReplyTo: string; references: string[] },
  ): Promise<ProviderSendResult> {
    const response = await this.client.sendEmail({
      from: input.from,
      to: input.to.join(', '),
      ...(input.cc?.length && { cc: input.cc.join(', ') }),
      ...(input.bcc?.length && { bcc: input.bcc.join(', ') }),
      ...(input.replyTo && { replyTo: input.replyTo }),
      subject: input.subject,
      ...(input.text && { text: input.text }),
      ...(input.html && { html: input.html }),
      ...(threading && {
        inReplyTo: bracket(threading.inReplyTo),
        references: threading.references.map(bracket).join(' '),
      }),
      ...(input.headers && { headers: input.headers }),
      ...(input.attachments?.length && {
        attachments: input.attachments.map((attachment) => ({
          filename: attachment.filename,
          contentType: attachment.contentType,
          content: attachment.content,
          encoding: 'base64',
        })),
      }),
    });

    const messageId =
      response.message_id ?? response.messageId ?? null;

    return {
      providerMessageId: response.id ?? null,
      messageId: messageId ? messageId.replace(/^</, '').replace(/>$/, '') : null,
      acceptedAt: response.created_at ? new Date(response.created_at) : new Date(),
    };
  }

  // --- Ingress --------------------------------------------------------------

  verifyInboundWebhook(request: Request): Promise<boolean> {
    return this.verifier.verify(request);
  }

  normalizeInbound(payload: unknown): Promise<NormalizedInboundEmail> {
    return this.normalizer.normalizeInbound(payload);
  }

  normalizeDeliveryEvent(payload: unknown): Promise<NormalizedMailEvent> {
    return this.normalizer.normalizeDeliveryEvent(payload);
  }

  // --- Mapping --------------------------------------------------------------

  private toProviderDomain(domain: ForwardEmailDomain): ProviderDomain {
    if (!domain?.name) {
      throw new ExternalAPIError(
        'Forward Email returned a domain with no name',
        PROVIDER_ID,
      );
    }

    return {
      // The name, not `domain.id`: it is what every subsequent URL needs.
      id: domain.name,
      name: domain.name,
      verified: Boolean(domain.has_mx_record && domain.has_txt_record),
      records: dnsRecordsFor(domain.name, domain),
    };
  }

  private toProviderAlias(
    alias: ForwardEmailAlias,
    domain: string,
  ): ProviderAlias {
    return {
      id: alias.id,
      localPart: alias.name,
      domain:
        typeof alias.domain === 'string'
          ? alias.domain
          : (alias.domain?.name ?? domain),
      recipients: alias.recipients ?? [],
      enabled: alias.is_enabled ?? true,
    };
  }
}

function bracket(messageId: string): string {
  return messageId.startsWith('<') ? messageId : `<${messageId}>`;
}

/**
 * The record set the operator must publish, as the dashboard displays it.
 *
 * Values are Forward Email's documented public records; `present` comes from
 * whichever verify call reported on them.
 *
 * ⚠️ The DKIM/return-path row is the one to re-check against spike 0.10, which
 * has not run: `verify-smtp` is the authority on what sending actually demands,
 * and it may want a per-domain key rather than the shared CNAME below.
 */
function dnsRecordsFor(
  domain: string,
  status: ForwardEmailDomain,
): DnsRecord[] {
  return [
    {
      type: 'MX',
      name: '@',
      value: 'mx1.forwardemail.net',
      priority: 10,
      purpose: 'inbound',
      present: Boolean(status.has_mx_record),
    },
    {
      type: 'MX',
      name: '@',
      value: 'mx2.forwardemail.net',
      priority: 10,
      purpose: 'inbound',
      present: Boolean(status.has_mx_record),
    },
    {
      type: 'TXT',
      name: '@',
      value: status.verification_record
        ? `forward-email-site-verification=${status.verification_record}`
        : 'forward-email-site-verification=<pending>',
      purpose: 'verification',
      present: Boolean(status.has_txt_record),
    },
    {
      type: 'TXT',
      name: '@',
      value: 'v=spf1 include:spf.forwardemail.net -all',
      purpose: 'spf',
      present: Boolean(status.has_txt_record),
    },
    {
      type: 'CNAME',
      name: `fe-bounces.${domain}`,
      value: 'forwardemail.net',
      purpose: 'dkim',
      present: Boolean(status.has_return_path_record),
    },
    {
      type: 'TXT',
      name: '_dmarc',
      value: `v=DMARC1; p=none; rua=mailto:dmarc@${domain};`,
      purpose: 'dmarc',
      present: Boolean(status.has_dmarc_record),
    },
  ];
}
