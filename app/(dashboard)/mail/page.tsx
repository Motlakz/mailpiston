import { Suspense } from 'react';

import Link from 'next/link';

import { Icon } from '@/components/icon';
import { EmptyState, PageHeader } from '@/components/layout/page-shell';
import { ComposeForm } from '@/components/mail/compose';
import { BulkActions } from '@/components/mail/bulk-actions';
import { ConversationList } from '@/components/mail/conversation-list';
import {
  ReadingPane,
  ReadingPanePlaceholder,
  ReadingPaneSkeleton,
} from './reading-pane';
import { EmptyBinButton } from '@/components/mail/message-actions';
import { QuotaBar } from '@/components/mail/quota-bar';
import type { EmailStatus } from '@/server/core/types';
import { getOutboundQuota } from '@/server/mail/emails/quota';
import type { EmailFilter } from '@/server/repositories';
import { repositories } from '@/server/repositories';

export const metadata = { title: 'Mail · MailPiston' };

const PAGE_SIZE = 50;

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
  const selectedId = Array.isArray(params.id) ? params.id[0] : params.id;

  /** Selection is a query parameter, so it survives a filter change and a refresh. */
  const hrefFor = (id?: string) => {
    const query = new URLSearchParams();
    if (active !== 'all') query.set('show', active);
    if (id) query.set('id', id);
    const suffix = query.toString();
    return suffix ? `/mail?${suffix}` : '/mail';
  };

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
          <div className="mail-split" data-reading={selectedId ? '' : undefined}>
            <div className="mail-list-col">
              {/* The sticky lives on an inner box, not on the column itself:
                  the column has to stretch for the divider between the halves to
                  run their full shared height, and a stretched box has nothing
                  left to stick to. */}
              <div className="mail-list-sticky">
              <div className="mail-list-head">
                <div className="mail-list-title">
                  <strong>{FILTERS[active].label}</strong>
                  <span>
                    {page.items.length}
                    {page.nextCursor ? '+' : ''} message
                    {page.items.length === 1 ? '' : 's'}
                  </span>
                </div>

                <BulkActions binned={active === 'bin'} />

                <nav className="mail-list-filters" aria-label="Filter mail">
                  {(Object.keys(FILTERS) as FilterKey[]).map((key) => (
                    <Link
                      key={key}
                      href={key === 'all' ? '/mail' : `/mail?show=${key}`}
                      aria-current={key === active ? 'page' : undefined}
                      data-active={key === active ? '' : undefined}
                    >
                      {FILTERS[key].label}
                    </Link>
                  ))}
                </nav>
              </div>

              <div className="mail-list-scroll">
                {/* First page from the server, the rest fetched as you reach
                    the bottom. The old cap was not a display limit — mail past
                    the hundredth message had no route to the screen. */}
                <ConversationList
                  initialItems={page.items}
                  initialCursor={page.nextCursor}
                  show={active}
                  selectedId={selectedId}
                />
              </div>
              </div>
            </div>

            <div className="mail-read-col">
              {/* A back affordance only where the panes are stacked. */}
              {selectedId ? (
                <Link href={hrefFor()} className="mail-read-back">
                  <Icon name="arrowLeft" size={13} />
                  All mail
                </Link>
              ) : null}

              {selectedId ? (
                <Suspense key={selectedId} fallback={<ReadingPaneSkeleton />}>
                  <ReadingPane emailId={selectedId} />
                </Suspense>
              ) : (
                <ReadingPanePlaceholder />
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

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
