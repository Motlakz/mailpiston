import 'server-only';

import { NeonAddressRepository } from './neon/address-repository';
import { NeonApiKeyRepository } from './neon/api-key-repository';
import { NeonDomainRepository } from './neon/domain-repository';
import { NeonEmailRepository } from './neon/email-repository';
import { NeonEventRepository } from './neon/event-repository';
import {
  NeonDeliveryRepository,
  NeonEndpointRepository,
  NeonReplyRelayRepository,
} from './neon/pending';
import { NeonThreadRepository } from './neon/thread-repository';

export * from './types';

/**
 * One instance per aggregate, constructed once.
 *
 * Services take repositories as constructor arguments so a test can pass a fake
 * without touching a database; this object is only the production wiring.
 */
export const repositories = {
  domains: new NeonDomainRepository(),
  addresses: new NeonAddressRepository(),
  apiKeys: new NeonApiKeyRepository(),
  events: new NeonEventRepository(),
  emails: new NeonEmailRepository(),
  threads: new NeonThreadRepository(),
  endpoints: new NeonEndpointRepository(),
  deliveries: new NeonDeliveryRepository(),
  replyRelays: new NeonReplyRelayRepository(),
} as const;

export type Repositories = typeof repositories;
