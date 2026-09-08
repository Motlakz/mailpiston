import 'server-only';

import { env } from '@/server/core/config';
import { mailProviderRegistry } from '@/server/providers/registry';
import { repositories } from '@/server/repositories';
import { getStorage } from '@/server/storage';

import { AddressService } from './addresses/address-service';
import { DomainService } from './domains/domain-service';
import { OutboundService } from './emails/outbound-service';
import { EndpointService } from './endpoints/endpoint-service';
import { ForwardingService } from './forwarding/forwarding-service';
import { RelayService } from './forwarding/relay-service';
import { InboundService } from './inbound/inbound-service';
import { DefaultThreadResolver } from './threads/thread-resolver';
import { WebhookService } from './webhooks/webhook-service';

/**
 * Production wiring for the mail services.
 *
 * Lazy, because constructing the provider reads configuration and opens no
 * connection until something actually asks — and because a route that only
 * lists addresses should not pay for a provider client it never calls.
 */
let domainService: DomainService | undefined;
let addressService: AddressService | undefined;
let inboundService: InboundService | undefined;
let outboundService: OutboundService | undefined;
let endpointService: EndpointService | undefined;
let forwardingService: ForwardingService | undefined;
let relayService: RelayService | undefined;
let webhookService: WebhookService | undefined;

export function getDomainService(): DomainService {
  domainService ??= new DomainService(
    repositories.domains,
    mailProviderRegistry.active(),
  );
  return domainService;
}

export function getAddressService(): AddressService {
  addressService ??= new AddressService(
    repositories.addresses,
    repositories.domains,
    mailProviderRegistry.active(),
  );
  return addressService;
}

export function getInboundService(): InboundService {
  inboundService ??= new InboundService(
    repositories.emails,
    repositories.addresses,
    repositories.events,
    new DefaultThreadResolver(repositories.threads),
    // Object storage is only needed when a message has attachments or raw MIME
    // retention is enabled. Resolve it lazily so plain messages can still be
    // captured in production before R2 is configured.
    getStorage,
    { storeRawMime: env.STORE_RAW_MIME },
    {
      relay: getRelayService(),
      forwarding: getForwardingService(),
      webhooks: getWebhookService(),
    },
  );
  return inboundService;
}

export function getOutboundService(): OutboundService {
  outboundService ??= new OutboundService(
    repositories.emails,
    repositories.addresses,
    repositories.events,
    repositories.threads,
    mailProviderRegistry.active(),
  );
  return outboundService;
}

export function getForwardingService(): ForwardingService {
  forwardingService ??= new ForwardingService(
    repositories.endpoints,
    repositories.replyRelays,
    repositories.events,
    mailProviderRegistry.active(),
    env.RELAY_TOKEN_TTL_DAYS,
  );
  return forwardingService;
}

export function getRelayService(): RelayService {
  relayService ??= new RelayService(
    repositories.replyRelays,
    repositories.endpoints,
    repositories.emails,
    repositories.events,
    getOutboundService(),
  );
  return relayService;
}

export function getWebhookService(): WebhookService {
  webhookService ??= new WebhookService(
    repositories.endpoints,
    repositories.deliveries,
    repositories.emails,
    repositories.events,
    { timeoutMs: env.WEBHOOK_TIMEOUT_MS },
  );
  return webhookService;
}

export function getEndpointService(): EndpointService {
  endpointService ??= new EndpointService(
    repositories.endpoints,
    repositories.addresses,
    getOutboundService(),
  );
  return endpointService;
}

export {
  AddressService,
  DomainService,
  EndpointService,
  ForwardingService,
  InboundService,
  OutboundService,
  RelayService,
  WebhookService,
};
