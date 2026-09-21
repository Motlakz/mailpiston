import 'server-only';

import { env } from '@/server/core/config';
import { inngestRetryScheduler } from '@/server/jobs/inngest-scheduler';
import { mailProviderRegistry } from '@/server/providers/registry';
import { assertWithinSendLimit } from '@/server/core/tenancy/limits';
import { repositoriesFor } from '@/server/repositories';
import { getStorage } from '@/server/storage';

import { AddressService } from './addresses/address-service';
import { DomainService } from './domains/domain-service';
import { OutboundService } from './emails/outbound-service';
import { EndpointService } from './endpoints/endpoint-service';
import { ForwardingService } from './forwarding/forwarding-service';
import { RelayService } from './forwarding/relay-service';
import { InboundService } from './inbound/inbound-service';
import { MailboxService } from './mailbox/mailbox-service';
import { ReconciliationService } from './reconciliation/reconciliation-service';
import { RetentionService } from './retention/retention-service';
import { DefaultThreadResolver } from './threads/thread-resolver';
import { WebhookService } from './webhooks/webhook-service';

/**
 * Production wiring for the mail services, per tenant.
 *
 * These used to be module-level singletons over a single global repository
 * set, which is exactly the shape that cannot become multi-tenant: a service
 * built once holds one tenant's repositories forever, and the second tenant to
 * call it reads the first one's mail.
 *
 * So the unit of construction is now a tenant. Everything inside a bundle is
 * wired to the same scoped repositories and the same provider client, which is
 * what makes a cross-tenant read impossible by construction rather than by
 * discipline — there is no service instance in the process that could reach
 * two tenants even if a caller wanted it to.
 *
 * Still lazy, and still cached: building a bundle resolves the provider client,
 * and a route that only lists addresses should not pay for one it never calls.
 */
export interface MailServices {
  domains: () => DomainService;
  addresses: () => AddressService;
  inbound: () => InboundService;
  mailbox: () => MailboxService;
  outbound: () => OutboundService;
  endpoints: () => EndpointService;
  forwarding: () => ForwardingService;
  relay: () => RelayService;
  webhooks: () => WebhookService;
  reconciliation: () => ReconciliationService;
  retention: () => RetentionService;
}

const bundles = new Map<string, MailServices>();

export function servicesFor(tenantId: string): MailServices {
  const existing = bundles.get(tenantId);
  if (existing) return existing;

  const repositories = repositoriesFor(tenantId);
  const provider = () => mailProviderRegistry.forTenant(tenantId);

  let domains: DomainService | undefined;
  let addresses: AddressService | undefined;
  let inbound: InboundService | undefined;
  let mailbox: MailboxService | undefined;
  let outbound: OutboundService | undefined;
  let endpoints: EndpointService | undefined;
  let forwarding: ForwardingService | undefined;
  let relay: RelayService | undefined;
  let webhooks: WebhookService | undefined;
  let reconciliation: ReconciliationService | undefined;
  let retention: RetentionService | undefined;

  const bundle: MailServices = {
    domains: () =>
      (domains ??= new DomainService(repositories.domains, provider())),

    addresses: () =>
      (addresses ??= new AddressService(
        repositories.addresses,
        repositories.domains,
        provider(),
      )),

    outbound: () =>
      (outbound ??= new OutboundService(
        repositories.emails,
        repositories.addresses,
        repositories.events,
        repositories.threads,
        provider(),
        {
          assert: () => assertWithinSendLimit(tenantId, repositories.emails),
        },
      )),

    forwarding: () =>
      (forwarding ??= new ForwardingService(
        repositories.endpoints,
        repositories.replyRelays,
        repositories.events,
        provider(),
        env.RELAY_TOKEN_TTL_DAYS,
      )),

    relay: () =>
      (relay ??= new RelayService(
        repositories.replyRelays,
        repositories.endpoints,
        repositories.emails,
        repositories.events,
        bundle.outbound(),
      )),

    webhooks: () =>
      (webhooks ??= new WebhookService(
        repositories.endpoints,
        repositories.deliveries,
        repositories.emails,
        repositories.events,
        {
          tenantId,
          timeoutMs: env.WEBHOOK_TIMEOUT_MS,
          scheduler: inngestRetryScheduler,
        },
      )),

    inbound: () =>
      (inbound ??= new InboundService(
        repositories.emails,
        repositories.addresses,
        repositories.events,
        new DefaultThreadResolver(repositories.threads),
        // Object storage is only needed when a message has attachments or raw
        // MIME retention is enabled. Resolve it lazily so plain messages can
        // still be captured in production before R2 is configured.
        getStorage,
        { storeRawMime: env.STORE_RAW_MIME },
        {
          relay: bundle.relay(),
          forwarding: bundle.forwarding(),
          webhooks: bundle.webhooks(),
          filters: repositories.mailFilters,
        },
      )),

    mailbox: () =>
      (mailbox ??= new MailboxService(
        repositories.emails,
        repositories.events,
        // Lazy for the same reason the inbound pipeline is: only a purge ever
        // reaches object storage, and binning must work on a deployment where
        // R2 has not been configured yet.
        getStorage,
      )),

    reconciliation: () =>
      (reconciliation ??= new ReconciliationService(
        repositories.reconciliation,
        repositories.domains,
        repositories.addresses,
        provider(),
      )),

    retention: () =>
      (retention ??= new RetentionService(repositories.emails, getStorage, {
        rawMimeDays: env.RETENTION_RAW_MIME_DAYS,
        attachmentDays: env.RETENTION_ATTACHMENT_DAYS,
      })),

    endpoints: () =>
      (endpoints ??= new EndpointService(
        repositories.endpoints,
        repositories.addresses,
        bundle.outbound(),
      )),
  };

  bundles.set(tenantId, bundle);
  return bundle;
}

export {
  AddressService,
  DomainService,
  EndpointService,
  ForwardingService,
  InboundService,
  OutboundService,
  ReconciliationService,
  RelayService,
  RetentionService,
  WebhookService,
};
