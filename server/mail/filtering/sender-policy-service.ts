import 'server-only';

import { ConflictError, NotFoundError, ValidationError } from '@/server/core/errors';
import {
  AUTO_BLOCK_AFTER_DAYS,
  type Email,
  type SpamVerdict,
} from '@/server/core/types';
import type {
  EmailRepository,
  EventRepository,
  MailFilterRepository,
} from '@/server/repositories/types';

import { addressOf, matchesList } from './classifier';
import {
  isSharedMailboxDomain,
  isTrustedPlatform,
  registrableDomain,
} from './sender-reputation';

export type SenderDecision = 'trust' | 'block';
export type SenderScope = 'address' | 'domain';

/** What the dashboard may offer for one sender. Computed here, rendered there. */
export interface SenderScopes {
  address: string;
  /** The registrable domain, or null when the sender has none worth naming. */
  domain: string | null;
  canTrustDomain: boolean;
  canBlockDomain: boolean;
}

export interface SenderDecisionResult {
  pattern: string;
  decision: SenderDecision;
  /** Messages moved into or out of quarantine as a consequence. */
  moved: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Enough to see a rotation pattern; more rows would change no decision. */
const FLAGGED_SCAN_LIMIT = 200;
/** Upper bound on messages restyled by one decision, so a click stays a click. */
const MOVE_LIMIT = 1000;

/**
 * Standing decisions about *senders*, as opposed to `MailboxService`'s
 * decisions about messages.
 *
 * Two ways in, one effect. An operator says "trust" or "block" from a message;
 * or a sender writes again after their flagged mail sat unreviewed past
 * `AUTO_BLOCK_AFTER_DAYS`, and is blocked on the operator's behalf. Either way
 * the result is an allow or deny entry — the same rows Settings edits. An
 * operator's decision also moves the sender's mail already on screen to match,
 * so it is visible the moment it is made.
 *
 * Everything here is reversible: deleting the entry in Settings undoes it, and
 * the messages it moved are released or quarantined with recorded events, not
 * deleted.
 */
export class SenderPolicyService {
  constructor(
    private readonly emails: EmailRepository,
    private readonly filters: MailFilterRepository,
    private readonly events: EventRepository,
  ) {}

  async decideForEmail(
    emailId: string,
    decision: SenderDecision,
    scope: SenderScope = 'address',
  ): Promise<SenderDecisionResult> {
    const email = await this.inbound(emailId);
    const scopes = senderScopes(email.from);
    const pattern = patternFor(scopes, decision, scope);

    const moved = await this.apply(pattern, decision);
    return { pattern, decision, moved };
  }

  /**
   * The bulk form: one decision for the sender of each selected message.
   *
   * Always address scope. A domain block from a multi-select would turn "these
   * twelve rows" into "everyone at these nine companies", which is not what
   * ticking boxes says.
   */
  async decideForEmails(
    emailIds: string[],
    decision: SenderDecision,
  ): Promise<{
    patterns: string[];
    moved: number;
    failures: Array<{ id: string; message: string }>;
  }> {
    const patterns = new Set<string>();
    const failures: Array<{ id: string; message: string }> = [];

    for (const id of emailIds) {
      try {
        const email = await this.inbound(id);
        patterns.add(patternFor(senderScopes(email.from), decision, 'address'));
      } catch (error) {
        failures.push({ id, message: (error as Error).message });
      }
    }

    let moved = 0;
    for (const pattern of patterns) {
      moved += await this.apply(pattern, decision);
    }

    return { patterns: [...patterns], moved, failures };
  }

  /**
   * Whether this sender has crossed the line, decided at the moment they write.
   *
   * No timer: a sender only matters when they send again, so the three-day
   * rule is checked then, inside the inbound request that is already running.
   * It costs one or two indexed reads on a delivery and nothing at all between
   * deliveries — no scheduled function, no idle invocations.
   *
   * The line is: mail from this sender still marked suspicious or spam,
   * received more than `AUTO_BLOCK_AFTER_DAYS` ago. "Still marked" means
   * unreviewed — binned or not, because binning a pitch is reviewing it as
   * junk. Releasing a message is the review that counts the other way.
   *
   * Never blocked automatically, whatever their mail looks like:
   *  - anyone on the allow list;
   *  - trusted platforms — a forged Google alert must not cost the real ones;
   *  - anyone this workspace has sent mail to, or released mail from.
   *
   * The whole domain is blocked instead of the address when two or more of its
   * addresses have stale flagged mail — the shape of a sender rotating local
   * parts, which also catches the *new* address they are trying today. Never
   * for a shared mailbox provider (one Gmail spammer is not a reason to refuse
   * Gmail) and never when anyone at that domain is vouched for.
   *
   * Returns the pattern it blocked, so the caller can refuse this delivery, or
   * null. Writes only the list entry: the sender's older mail is already
   * flagged, and restyling it here would put a loop of writes on the path a
   * provider is waiting on.
   */
  async blockIfPersistent(
    from: string,
    allowList: string[],
    now: Date = new Date(),
  ): Promise<string | null> {
    const address = addressOf(from);
    const host = address.split('@')[1];
    if (!host) return null;
    if (isTrustedPlatform(host) || matchesList(address, allowList)) return null;

    const owner = registrableDomain(host);
    const shared = isSharedMailboxDomain(owner);
    const scope = shared ? address : owner;
    const cutoff = new Date(now.getTime() - AUTO_BLOCK_AFTER_DAYS * DAY_MS);

    const [flagged, vouchedRaw] = await Promise.all([
      this.emails.listFlaggedBefore(scope, cutoff, FLAGGED_SCAN_LIMIT),
      this.emails.findVouched(scope),
    ]);
    if (flagged.length === 0) return null;

    const vouched = new Set(vouchedRaw.map(addressOf));
    if (vouched.has(address)) return null;

    const stale = new Map<string, number>();
    for (const message of flagged) {
      const sender = addressOf(message.from);
      if (vouched.has(sender) || matchesList(sender, allowList)) continue;
      stale.set(sender, (stale.get(sender) ?? 0) + 1);
    }

    const domainWide =
      !shared && stale.size >= 2 && vouched.size === 0 && !isTrustedPlatform(owner);

    let pattern: string;
    let note: string;

    if (domainWide) {
      const messages = [...stale.values()].reduce((total, count) => total + count, 0);
      pattern = owner;
      note = `Auto: ${messages} flagged messages from ${stale.size} addresses, unreviewed for ${AUTO_BLOCK_AFTER_DAYS}+ days`;
    } else if (stale.has(address)) {
      const messages = stale.get(address)!;
      pattern = address;
      note = `Auto: ${messages} flagged ${messages === 1 ? 'message' : 'messages'}, unreviewed for ${AUTO_BLOCK_AFTER_DAYS}+ days`;
    } else {
      return null;
    }

    try {
      await this.filters.add({ kind: 'deny', pattern, note, source: 'auto' });
    } catch (error) {
      if (!(error instanceof ConflictError)) throw error;
    }

    return pattern;
  }

  /**
   * Writes the list entry, clears its opposite, and moves the sender's mail.
   *
   * The opposite entry is removed only when it is the *same* pattern. Trusting
   * `bob@acme.test` leaves a block on `acme.test` alone — the allow entry wins
   * for Bob, which is the more specific decision, and everyone else at Acme
   * stays blocked.
   */
  private async apply(pattern: string, decision: SenderDecision): Promise<number> {
    const kind = decision === 'trust' ? 'allow' : 'deny';

    await this.filters.removePattern(decision === 'trust' ? 'deny' : 'allow', pattern);

    try {
      await this.filters.add({
        kind,
        pattern,
        note: decision === 'trust' ? 'Trusted from a message' : 'Blocked from a message',
      });
    } catch (error) {
      // Already on the list: the decision stands, and the mail below may still
      // need moving — that is the case for a second click after a failure.
      if (!(error instanceof ConflictError)) throw error;
    }

    return decision === 'trust'
      ? this.moveMail(pattern, ['suspicious', 'spam'], 'clean')
      : this.moveMail(pattern, ['clean', 'suspicious'], 'spam');
  }

  private async moveMail(
    pattern: string,
    from: SpamVerdict[],
    to: 'clean' | 'spam',
  ): Promise<number> {
    let moved = 0;
    let cursor: string | null = null;

    do {
      const page = await this.emails.list({
        direction: 'inbound',
        sender: pattern,
        spamVerdicts: from,
        limit: 200,
        cursor,
      });

      for (const email of page.items) {
        await this.emails.setSpamVerdict(
          email.id,
          to,
          to === 'spam'
            ? [
                {
                  rule: 'sender_blocked',
                  category: email.spamCategory ?? 'cold_outreach',
                  score: 100,
                  detail: pattern,
                },
              ]
            : [],
        );

        await this.events.create({
          emailId: email.id,
          type: to === 'spam' ? 'email.quarantined' : 'email.released',
          metadata: {
            by: 'operator',
            from: email.from,
            pattern,
            previousVerdict: email.spamVerdict,
          },
        });

        moved += 1;
      }

      cursor = page.nextCursor;
    } while (cursor && moved < MOVE_LIMIT);

    return moved;
  }

  private async inbound(id: string): Promise<Email> {
    const email = await this.emails.findById(id);
    if (!email) throw new NotFoundError(`Email ${id} not found`);

    if (email.direction === 'outbound') {
      throw new ValidationError(
        'Outbound mail has no sender to trust or block: it was sent by this deployment.',
      );
    }

    return email;
  }
}

/**
 * Which scopes make sense for a sender.
 *
 * Domain scope is withheld for shared mailbox providers in both directions —
 * trusting `gmail.com` trusts every spammer on it, blocking it blocks every
 * customer — and withheld for *blocking* a trusted platform, where the operator
 * almost certainly means the one address that annoyed them.
 */
export function senderScopes(from: string): SenderScopes {
  const address = addressOf(from);
  const host = address.split('@')[1] ?? null;
  const domain = host ? registrableDomain(host) : null;
  const shared = isSharedMailboxDomain(domain);

  return {
    address,
    domain,
    canTrustDomain: Boolean(domain) && !shared,
    canBlockDomain: Boolean(domain) && !shared && !isTrustedPlatform(domain),
  };
}

/**
 * Adds `autoBlockAt` to list rows, from the same rules `blockIfPersistent`
 * applies — minus the vouched-sender check, which needs a query per sender and
 * only ever makes the real outcome *more* lenient than the label.
 */
export function withAutoBlock<T extends Email>(
  items: T[],
  allowList: string[],
): Array<T & { autoBlockAt: Date | null }> {
  return items.map((email) => {
    const address = addressOf(email.from);
    const exempt =
      email.direction !== 'inbound' ||
      email.spamVerdict === 'clean' ||
      isTrustedPlatform(address.split('@')[1]) ||
      matchesList(address, allowList);

    return {
      ...email,
      autoBlockAt: exempt
        ? null
        : new Date(email.createdAt.getTime() + AUTO_BLOCK_AFTER_DAYS * DAY_MS),
    };
  });
}

/** Where a message's sender stands, for the reading pane's Trust/Block controls. */
export function senderStandingFor(
  from: string,
  lists: { allow: string[]; deny: string[] },
): Omit<SenderScopes, 'address'> & { standing: 'trusted' | 'blocked' | null } {
  const { address, ...scopes } = senderScopes(from);

  return {
    ...scopes,
    // Allow is checked first because it wins at the door, too.
    standing: matchesList(address, lists.allow)
      ? 'trusted'
      : matchesList(address, lists.deny)
        ? 'blocked'
        : null,
  };
}

function patternFor(
  scopes: SenderScopes,
  decision: SenderDecision,
  scope: SenderScope,
): string {
  if (!scopes.address.includes('@')) {
    throw new ValidationError('This message has no sender address to act on.');
  }

  if (scope === 'address') return scopes.address;

  const allowed = decision === 'trust' ? scopes.canTrustDomain : scopes.canBlockDomain;
  if (!allowed || !scopes.domain) {
    throw new ValidationError(
      `${scopes.domain ?? 'This domain'} cannot be ${decision === 'trust' ? 'trusted' : 'blocked'} as a whole. Act on the address instead.`,
    );
  }

  return scopes.domain;
}
