import 'server-only';

import { APIError } from '@/server/core/errors';
import type {
  DeliveryRepository,
  EndpointRepository,
  ReplyRelayRepository,
  ThreadRepository,
} from '@/server/repositories/types';

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

export class NeonThreadRepository implements ThreadRepository {
  create(): never {
    notImplemented('Phase 5 (threads)', 'ThreadRepository.create');
  }
  findById(): never {
    notImplemented('Phase 5 (threads)', 'ThreadRepository.findById');
  }
  findByMessageIds(): never {
    notImplemented('Phase 5 (threads)', 'ThreadRepository.findByMessageIds');
  }
  list(): never {
    notImplemented('Phase 5 (threads)', 'ThreadRepository.list');
  }
  touch(): never {
    notImplemented('Phase 5 (threads)', 'ThreadRepository.touch');
  }
}

export class NeonEndpointRepository implements EndpointRepository {
  create(): never {
    notImplemented('Phase 6/7 (endpoints)', 'EndpointRepository.create');
  }
  findById(): never {
    notImplemented('Phase 6/7 (endpoints)', 'EndpointRepository.findById');
  }
  list(): never {
    notImplemented('Phase 6/7 (endpoints)', 'EndpointRepository.list');
  }
  update(): never {
    notImplemented('Phase 6/7 (endpoints)', 'EndpointRepository.update');
  }
  delete(): never {
    notImplemented('Phase 6/7 (endpoints)', 'EndpointRepository.delete');
  }
  listForAddress(): never {
    notImplemented('Phase 6/7 (endpoints)', 'EndpointRepository.listForAddress');
  }
  bindToAddress(): never {
    notImplemented('Phase 6/7 (endpoints)', 'EndpointRepository.bindToAddress');
  }
  unbindFromAddress(): never {
    notImplemented('Phase 6/7 (endpoints)', 'EndpointRepository.unbindFromAddress');
  }
  getWebhookConfig(): never {
    notImplemented('Phase 7 (webhooks)', 'EndpointRepository.getWebhookConfig');
  }
  setWebhookConfig(): never {
    notImplemented('Phase 7 (webhooks)', 'EndpointRepository.setWebhookConfig');
  }
  listRecipients(): never {
    notImplemented('Phase 6 (personal forwarding)', 'EndpointRepository.listRecipients');
  }
  addRecipient(): never {
    notImplemented('Phase 6 (personal forwarding)', 'EndpointRepository.addRecipient');
  }
  markRecipientVerified(): never {
    notImplemented(
      'Phase 6 (personal forwarding)',
      'EndpointRepository.markRecipientVerified',
    );
  }
  removeRecipient(): never {
    notImplemented('Phase 6 (personal forwarding)', 'EndpointRepository.removeRecipient');
  }
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

export class NeonReplyRelayRepository implements ReplyRelayRepository {
  create(): never {
    notImplemented('Phase 6 (private relay)', 'ReplyRelayRepository.create');
  }
  findByTokenHash(): never {
    notImplemented('Phase 6 (private relay)', 'ReplyRelayRepository.findByTokenHash');
  }
  revoke(): never {
    notImplemented('Phase 6 (private relay)', 'ReplyRelayRepository.revoke');
  }
}
