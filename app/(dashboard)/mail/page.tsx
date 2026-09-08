import Link from 'next/link';

import { Icon } from '@/components/icon';
import { EmptyState, PageHeader } from '@/components/layout/page-shell';
import { ComposeForm } from '@/components/mail/compose';
import { QuotaBar } from '@/components/mail/quota-bar';
import { formatWhen, previewOf } from '@/lib/format';
import type { EmailListItem, EmailStatus } from '@/server/core/types';
import { getOutboundQuota } from '@/server/mail/emails/quota';
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
 * The conversation view still lives at `/threads`: a filter answers "what
 * happened", a thread answers "what is going on with this person", and those
 * are different questions. Threading is header-only by design (Phase 5), so a
 * flat list remains the reliable view — it never depends on a customer's mail
 * client having sent `References`.
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
} as const;

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
        actions={<ComposeForm addresses={sendable} />}
      />

      <nav className="mt-4 flex flex-wrap items-center gap-1.5">
        {(Object.keys(FILTERS) as FilterKey[]).map((key) => (
          <Link
            key={key}
            href={key === 'all' ? '/mail' : `/mail?show=${key}`}
            aria-current={key === active ? 'page' : undefined}
            className={`rounded-full border px-3 py-1 text-xs transition-colors ${
              key === active
                ? 'border-foreground/20 bg-foreground text-background'
                : 'border-border text-muted-foreground hover:bg-muted/40 hover:text-foreground'
            }`}
          >
            {FILTERS[key].label}
          </Link>
        ))}
      </nav>

      {showQuota ? <QuotaBar quota={quota} /> : null}

      <div className="mt-4">
        {page.items.length === 0 ? (
          <EmptyState
            icon="inbox"
            title={emptyTitle(active)}
            description={emptyDescription(active)}
          />
        ) : (
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            {page.items.map((email) => (
              <MailRow key={email.id} email={email} />
            ))}
          </div>
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
    <Link
      href={`/mail/${email.id}`}
      className="flex items-baseline gap-3 border-b border-border px-4 py-3 last:border-0 hover:bg-muted/40"
    >
      <span
        aria-label={outbound ? 'Sent' : 'Received'}
        className={`w-3 shrink-0 text-xs ${outbound ? 'text-muted-foreground' : 'text-transparent'}`}
      >
        →
      </span>

      <span className="w-48 shrink-0 truncate text-sm font-medium">
        {counterparty || <span className="text-muted-foreground">—</span>}
      </span>

      <span className="min-w-0 flex-1 truncate text-sm">
        {email.subject || (
          <span className="text-muted-foreground">(no subject)</span>
        )}
        {preview ? (
          <span className="ml-2 text-muted-foreground">— {preview}</span>
        ) : null}
      </span>

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
    </Link>
  );
}

const STATUS_TONE: Record<EmailStatus, string> = {
  received: 'border-border text-muted-foreground',
  queued: 'border-warning/40 text-warning',
  sent: 'border-success/40 text-success',
  delivered: 'border-success/40 text-success',
  soft_bounced: 'border-warning/40 text-warning',
  hard_bounced: 'border-destructive/40 text-destructive',
  failed: 'border-destructive/40 text-destructive',
};

/**
 * A bounce is not a failure and is worth telling apart at a glance: `failed`
 * means we never handed it to the provider, `hard_bounced` means the provider
 * did and the far end refused it.
 */
function StatusBadge({ status }: { status: EmailStatus }) {
  return (
    <span
      className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] ${STATUS_TONE[status]}`}
    >
      {status.replace('_', ' ')}
    </span>
  );
}

function emptyTitle(filter: FilterKey): string {
  return filter === 'bounced' ? 'Nothing has bounced' : 'No messages yet';
}

function emptyDescription(filter: FilterKey): string {
  switch (filter) {
    case 'received':
      return 'Send mail to one of your managed addresses. A verified provider POST becomes exactly one durable record here.';
    case 'sent':
      return 'Compose a message from a send-capable address, or reply to something you have received.';
    case 'bounced':
      return 'A send the far end refused would appear here, with the provider’s reason on the message.';
    default:
      return 'Mail to a managed address lands here, alongside everything sent from one.';
  }
}
