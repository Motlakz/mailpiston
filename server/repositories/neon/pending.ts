import 'server-only';

import { APIError } from '@/server/core/errors';
import type { DeliveryRepository } from '@/server/repositories/types';

/**
 * Repositories whose *shape* is the Phase 1 deliverable and whose bodies land
 * with the phase that needs them (roadmap Phase 1.4).
 *
 * They exist now so that services written against them compile, the aggregate
 * boundaries are settled before any of them has behaviour, and nothing is
 * tempted to reach into `db` directly in the meantime.
 *
 * Every method throws rather than returning a plausible empty value: a silent
 * `[]` from an unimplemented repository is a bug that hides for weeks.
 */
function notImplemented(phase: string, method: string): never {
  throw new APIError(
    `${method} is not implemented yet — lands in ${phase}`,
    501,
    'NOT_IMPLEMENTED',
  );
}

export class NeonDeliveryRepository implements DeliveryRepository {
  enqueue(): never {
    notImplemented('Phase 7 (webhooks)', 'DeliveryRepository.enqueue');
  }
  findById(): never {
    notImplemented('Phase 7 (webhooks)', 'DeliveryRepository.findById');
  }
  claim(): never {
    notImplemented('Phase 8 (retries)', 'DeliveryRepository.claim');
  }
  markDelivered(): never {
    notImplemented('Phase 7 (webhooks)', 'DeliveryRepository.markDelivered');
  }
  markFailed(): never {
    notImplemented('Phase 7 (webhooks)', 'DeliveryRepository.markFailed');
  }
  listForEvent(): never {
    notImplemented('Phase 7 (webhooks)', 'DeliveryRepository.listForEvent');
  }
}

