import 'server-only';

import { NeonAddressRepository } from './neon/address-repository';
import { NeonApiKeyRepository } from './neon/api-key-repository';
import { NeonAuditRepository } from './neon/audit-repository';
import { NeonDomainRepository } from './neon/domain-repository';
import { NeonEmailRepository } from './neon/email-repository';
import { NeonEventRepository } from './neon/event-repository';
import { NeonMailFilterRepository } from './neon/mail-filter-repository';
import { NeonEndpointRepository } from './neon/endpoint-repository';
import { NeonDeliveryRepository } from './neon/delivery-repository';
import { NeonReconciliationRepository } from './neon/reconciliation-repository';
import { NeonReplyRelayRepository } from './neon/reply-relay-repository';
import { NeonThreadRepository } from './neon/thread-repository';

export * from './types';

/**
 * One scoped set of repositories per tenant.
 *
 * Tenancy is enforced here rather than at the call sites, and the difference
 * matters: there are twenty-seven places that read data and one place that
 * builds a repository. Binding the tenant at construction means a caller
 * cannot reach another tenant's row even holding a valid id belonging to it,
 * because there is no unscoped instance to ask.
 *
 * Cached per tenant, because these are stateless query builders — the cost is
 * a dozen object allocations, and a long-lived process would otherwise make
 * them on every request.
 */
const cache = new Map<string, Repositories>();

export function repositoriesFor(tenantId: string): Repositories {
  const existing = cache.get(tenantId);
  if (existing) return existing;

  const built = {
    domains: new NeonDomainRepository(tenantId),
    addresses: new NeonAddressRepository(tenantId),
    apiKeys: new NeonApiKeyRepository(tenantId),
    audit: new NeonAuditRepository(tenantId),
    events: new NeonEventRepository(tenantId),
    emails: new NeonEmailRepository(tenantId),
    threads: new NeonThreadRepository(tenantId),
    endpoints: new NeonEndpointRepository(tenantId),
    deliveries: new NeonDeliveryRepository(tenantId),
    replyRelays: new NeonReplyRelayRepository(tenantId),
    reconciliation: new NeonReconciliationRepository(tenantId),
    mailFilters: new NeonMailFilterRepository(tenantId),
  } as const;

  cache.set(tenantId, built);
  return built;
}

export interface Repositories {
  domains: NeonDomainRepository;
  addresses: NeonAddressRepository;
  apiKeys: NeonApiKeyRepository;
  audit: NeonAuditRepository;
  events: NeonEventRepository;
  emails: NeonEmailRepository;
  threads: NeonThreadRepository;
  endpoints: NeonEndpointRepository;
  deliveries: NeonDeliveryRepository;
  replyRelays: NeonReplyRelayRepository;
  reconciliation: NeonReconciliationRepository;
  mailFilters: NeonMailFilterRepository;
}
