import 'server-only';

import { env } from '@/server/core/config';
import { mailProviderRegistry } from '@/server/providers/registry';
import { repositories } from '@/server/repositories';
import { getStorage } from '@/server/storage';

import { AddressService } from './addresses/address-service';
import { DomainService } from './domains/domain-service';
import { InboundService } from './inbound/inbound-service';
import { DefaultThreadResolver } from './threads/thread-resolver';

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
  );
  return inboundService;
}

export { AddressService, DomainService, InboundService };
