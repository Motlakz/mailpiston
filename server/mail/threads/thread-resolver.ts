import 'server-only';

import type { Thread } from '@/server/core/types';
import type { ThreadRepository } from '@/server/repositories/types';

/**
 * Which conversation a message belongs to (plan §12, roadmap Phase 5).
 *
 * Header chains only, in this order:
 *
 *   1. `In-Reply-To` — the direct parent, and the strongest signal there is.
 *   2. `References` — the ancestry chain, for clients that drop `In-Reply-To`
 *      or when the direct parent never reached us.
 *   3. the provider's own message id, matched by the repository alongside ours,
 *      because the id a customer's client replies to is the one their copy
 *      carried.
 *
 * And then it stops. The plan lists a fourth step — a "conservative subject +
 * participant fallback" — which is deliberately **not** implemented. Two
 * customers who both write "Invoice" would be merged into one conversation,
 * and that is a data-leak-shaped bug: the operator replies in a thread and the
 * wrong person is on it. An orphan thread is cosmetic by comparison. Ship the
 * header steps, measure how many messages land thread-less, and only then
 * decide whether the fallback earns its risk.
 */
export interface ThreadResolver {
  resolve(headers: ThreadHeaders): Promise<Thread | null>;
}

export interface ThreadHeaders {
  inReplyTo: string | null;
  references: string[];
}

export class DefaultThreadResolver implements ThreadResolver {
  constructor(private readonly threads: ThreadRepository) {}

  async resolve({ inReplyTo, references }: ThreadHeaders): Promise<Thread | null> {
    // Two queries rather than one over the union: the direct parent has to win
    // over an ancestor when a chain has been split, and a single `IN` cannot
    // express that preference.
    if (inReplyTo) {
      const parent = await this.threads.findByMessageIds([inReplyTo]);
      if (parent) return parent;
    }

    if (references.length > 0) {
      // The whole chain in one query. Where several ancestors are known, the
      // repository returns the thread of the most recently stored one — the
      // live conversation rather than an older branch of it.
      return this.threads.findByMessageIds(references);
    }

    return null;
  }
}
