import Link from 'next/link';

import { Icon } from '@/components/icon';
import { NavTabs } from '@/components/layout/nav-tabs';
import { EmptyState, PageHeader } from '@/components/layout/page-shell';
import { ComposeForm } from '@/components/mail/compose';
import {
  EmptyBinButton,
  MessageActions,
} from '@/components/mail/message-actions';
import { QuotaBar } from '@/components/mail/quota-bar';
import { Card } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { formatWhen, previewOf } from '@/lib/format';
import type { EmailListItem, EmailStatus, SpamCategory } from '@/server/core/types';
import { getOutboundQuota } from '@/server/mail/emails/quota';
import type { EmailFilter } from '@/server/repositories';
import { repositories } from '@/server/repositories';

export const metadata = { title: 'Mail · MailPiston' };

const PAGE_SIZE = 100;

/**
 * One list for everything that arrived and everything that left.
 *
 * Inbox and Sent used to be two pages over one table, which meant a
 * conversation was never visible in one place and the operator had to know
 * which half of it they were looking for. Direction is a filter here, not a
 * destination.
 *
 * Spam and Bin are filters too, for the same reason — they are not different
 * kinds of thing, they are the same messages in a different state, and a
 * message moves between them. What separates them from the rest is that they
 * are the only two views that are *excluded* by default: quarantined and binned
 * mail is opted into everywhere in the stack, so a query that forgets to say
 * hides it rather than leaking it.
 *
 * The conversation view still lives at `/threads`: a filter answers "what
 * happened", a thread answers "what is going on with this person", and those
 * are different questions.
 */
const FILTERS = {
  all: { label: 'All', query: {} },
  received: { label: 'Received', query: { direction: 'inbound' as const } },
  sent: { label: 'Sent', query: { direction: 'outbound' as const } },
  bounced: {
    label: 'Bounced',
    // Soft and hard together: which one it was is our retry decision, not the
    // question the operator is asking.
    query: { statuses: ['soft_bounced', 'hard_bounced'] as EmailStatus[] },
  },
  spam: { label: 'Spam', query: { spamVerdicts: ['spam' as const] } },
  bin: {
    label: 'Bin',
    // Every verdict, because the bin holds whatever was put in it — including
    // quarantined mail binned from the Spam view, which would otherwise be
    // unreachable from the only screen that can restore it.
    query: {
      deleted: true,
      spamVerdicts: ['clean', 'suspicious', 'spam'] as const,
    },
  },
} as const satisfies Record<string, { label: string; query: EmailFilter }>;

type FilterKey = keyof typeof FILTERS;

export default async function MailPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = Array.isArray(params.show) ? params.show[0] : params.show;
  const active: FilterKey = raw && raw in FILTERS ? (raw as FilterKey) : 'all';

  const [page, addresses, quota] = await Promise.all([
    repositories.emails.list({ ...FILTERS[active].query, limit: PAGE_SIZE }),
    repositories.addresses.list(),
    getOutboundQuota(),
  ]);

  const sendable = addresses
    .filter((address) => address.canSend && address.enabled && address.providerAliasId)
    .map((address) => ({ id: address.id, email: address.email }));

  // Only where it is the question being asked. On the received view it is noise.
  const showQuota = quota && (active === 'sent' || active === 'bounced');

  return (
    <>
      <PageHeader
        title="Mail"
        description="Everything a managed address received or sent, newest first."
        actions={
          active === 'bin' ? (
            <EmptyBinButton count={page.items.length} />
          ) : (
            <ComposeForm addresses={sendable} />
          )
        }
        toolbar={
          <NavTabs
            aria-label="Filter mail"
            active={active}
            tabs={(Object.keys(FILTERS) as FilterKey[]).map((key) => ({
              key,
              label: FILTERS[key].label,
              href: key === 'all' ? '/mail' : `/mail?show=${key}`,
            }))}
          />
        }
      />

      {showQuota ? <QuotaBar quota={quota} /> : null}

      {active === 'spam' ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          Quarantined, not deleted. None of these reached a webhook or a personal
          inbox. Releasing one makes it visible again — it does not re-send the
          delivery your application never received.
        </p>
      ) : null}

      {active === 'bin' ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          Still here and still restorable. Emptying the bin removes these
          messages and their attachments for good.
        </p>
      ) : null}

      <div>
        {page.items.length === 0 ? (
          <EmptyState
            icon={EMPTY_ICON[active]}
            title={emptyTitle(active)}
            description={emptyDescription(active)}
          />
        ) : (
          <Card className="gap-0 overflow-hidden py-0">
            {page.items.map((email) => (
              <MailRow key={email.id} email={email} />
            ))}
          </Card>
        )}

        {page.nextCursor ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Showing the most recent {PAGE_SIZE}.
          </p>
        ) : null}
      </div>
    </>
  );
}

/**
 * One row shape for both directions.
 *
 * The counterparty is what the operator scans for, so it takes the fixed
 * column: the sender on inbound, the recipient on outbound. The arrow is what
 * tells the two apart at a glance, which matters most in the unfiltered view
 * where they interleave.
 */
function MailRow({ email }: { email: EmailListItem }) {
  const outbound = email.direction === 'outbound';
  const when = outbound
    ? (email.sentAt ?? email.createdAt)
    : (email.receivedAt ?? email.createdAt);

  const counterparty = outbound ? email.to.join(', ') : email.from;
  const preview = previewOf(email.text);

  return (
    <div className="group relative flex items-center gap-3.5 border-b border-border px-4 py-3.5 transition-colors last:border-0 hover:bg-muted/40">
      <Link
        href={`/mail/${email.id}`}
        className="absolute inset-0"
        aria-label={email.subject || '(no subject)'}
      />

      <span
        aria-label={outbound ? 'Sent' : 'Received'}
        className={`w-3 shrink-0 text-xs ${outbound ? 'text-muted-foreground' : 'text-transparent'}`}
      >
        →
      </span>

      {/* The counterparty is the scan target, so it gets the weight. The
          subject sits one step down and the preview one below that — three
          levels in a row that previously had one. */}
      <span className="w-48 shrink-0 truncate text-sm font-medium">
        {counterparty || <span className="text-muted-foreground">—</span>}
      </span>

      <span className="min-w-0 flex-1 truncate text-sm text-foreground/90">
        {email.subject || (
          <span className="text-muted-foreground">(no subject)</span>
        )}
        {preview ? (
          <span className="ml-2 text-xs text-muted-foreground">
            {preview}
          </span>
        ) : null}
      </span>

      <SpamBadge email={email} />

      {email.attachmentCount > 0 ? (
        <Icon
          name="attachment"
          size={13}
          className="shrink-0 text-muted-foreground"
          aria-label={`${email.attachmentCount} attachments`}
        />
      ) : null}

      {/* Inbound status is always `received`, which says nothing worth a pill. */}
      {outbound ? <StatusBadge status={email.status} /> : null}

      <span className="hidden shrink-0 font-mono text-[11px] text-muted-foreground md:inline">
        {outbound ? email.from : (email.addressEmail ?? '—')}
      </span>

      <time
        dateTime={when.toISOString()}
        title={`${when.toISOString().replace('T', ' ').slice(0, 19)} UTC`}
        className="w-24 shrink-0 text-right text-xs text-muted-foreground"
      >
        {formatWhen(when)}
      </time>

      {/* Sits above the overlay link so acting on a row does not open it. */}
      <span className="relative z-10 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <MessageActions
          emailId={email.id}
          verdict={email.spamVerdict}
          binned={Boolean(email.deletedAt)}
          outbound={outbound}
          compact
        />
      </span>
    </div>
  );
}

/**
 * Why a message was classified, in one word.
 *
 * `suspicious` is shown as well as `spam`, and that is the point of having
 * three states: the operator can see what the engine nearly hid without it
 * having been hidden.
 */
function SpamBadge({ email }: { email: EmailListItem }) {
  if (email.spamVerdict === 'clean') return null;

  return (
    <StatusBadge
      status={email.spamVerdict}
      label={
        email.spamCategory ? CATEGORY_LABEL[email.spamCategory] : undefined
      }
      // The rules that fired, so hovering a badge answers "why" without
      // opening the message.
      title={email.spamSignals.map((signal) => signal.rule).join(', ')}
    />
  );
}

export const CATEGORY_LABEL: Record<SpamCategory, string> = {
  authentication: 'forged',
  phishing: 'phishing',
  malware: 'malware',
  promotional: 'promo',
  gibberish: 'gibberish',
  cold_outreach: 'pitch',
  empty: 'empty',
};


const EMPTY_ICON: Record<FilterKey, 'inbox' | 'spam' | 'delete'> = {
  all: 'inbox',
  received: 'inbox',
  sent: 'inbox',
  bounced: 'inbox',
  spam: 'spam',
  bin: 'delete',
};

function emptyTitle(filter: FilterKey): string {
  switch (filter) {
    case 'bounced':
      return 'Nothing has bounced';
    case 'spam':
      return 'Nothing quarantined';
    case 'bin':
      return 'The bin is empty';
    default:
      return 'No messages yet';
  }
}

function emptyDescription(filter: FilterKey): string {
  switch (filter) {
    case 'received':
      return 'Send mail to one of your managed addresses. A verified provider POST becomes exactly one durable record here.';
    case 'sent':
      return 'Compose a message from a send-capable address, or reply to something you have received.';
    case 'bounced':
      return 'A send the far end refused would appear here, with the provider’s reason on the message.';
    case 'spam':
      return 'Phishing, malware, bulk campaigns, bot noise and cold pitches land here instead of reaching your webhooks. Nothing is ever deleted by the filter.';
    case 'bin':
      return 'Messages you bin stay here until you empty it. Nothing arrives here on its own.';
    default:
      return 'Mail to a managed address lands here, alongside everything sent from one.';
  }
}
