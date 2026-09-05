import 'server-only';

import { env, inboundIngressUrl } from '@/server/core/config';
import { NotFoundError } from '@/server/core/errors';

import { ForwardEmailClient } from './forward-email/client';
import { ForwardEmailProvider } from './forward-email/provider';
import { ForwardEmailVerifier } from './forward-email/verifier';
import { MockMailProvider } from './mock/provider';
import type { MailProvider } from './types';

export type ProviderId = 'forward-email' | 'mock';

/**
 * The one place a concrete provider is constructed.
 *
 * Everything upstream asks for `mailProviderRegistry.active()` and receives a
 * `MailProvider`. Nothing outside `server/providers/` may import a concrete
 * implementation — `bun run check:provider-boundary` fails the build if it does.
 */
class MailProviderRegistry {
  private readonly instances = new Map<ProviderId, MailProvider>();

  get(id: ProviderId): MailProvider {
    const existing = this.instances.get(id);
    if (existing) return existing;

    const created = this.create(id);
    this.instances.set(id, created);
    return created;
  }

  /** The provider selected by `MAIL_PROVIDER`. */
  active(): MailProvider {
    return this.get(env.MAIL_PROVIDER);
  }

  private create(id: ProviderId): MailProvider {
    switch (id) {
      case 'mock':
        return new MockMailProvider();

      case 'forward-email':
        return new ForwardEmailProvider(
          new ForwardEmailClient({
            // config.ts has already refused to boot without these when this
            // provider is selected, so the assertions cannot fire in practice.
            apiToken: env.FORWARD_EMAIL_API_TOKEN!,
            baseUrl: env.FORWARD_EMAIL_API_URL,
            timeoutMs: env.FORWARD_EMAIL_TIMEOUT_MS,
          }),
          new ForwardEmailVerifier(env.FORWARD_EMAIL_WEBHOOK_KEY!),
          inboundIngressUrl(),
        );

      default:
        throw new NotFoundError(`Unknown mail provider: ${id}`);
    }
  }
}

export const mailProviderRegistry = new MailProviderRegistry();
export type { MailProvider };
