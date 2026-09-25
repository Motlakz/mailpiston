import Link from 'next/link';

import { NavTabs } from '@/components/layout/nav-tabs';
import { EmptyState, PageHeader } from '@/components/layout/page-shell';
import {
  cursorPageLinks,
  TablePagination,
} from '@/components/layout/pagination';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { formatWhen } from '@/lib/format';
import { repositoriesFor } from '@/server/repositories';
import { requireOperatorPage } from '@/server/core/auth';

export const metadata = { title: 'Threads · MailPiston' };

/**
 * Conversations, which is not the same thing as threads.
 *
 * Every captured message gets a thread, so a list of all threads is the mail
 * list again with less information — which is exactly why this page felt
 * redundant. A conversation is a thread somebody actually replied in, and that
 * is what this page shows by default.
 *
 * Single-message threads are still reachable behind the toggle rather than
 * removed. They are not wrong, they are just not news, and an operator chasing
 * a specific message should not find a page that denies it exists.
 */
export default async function ThreadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { tenantId } = await requireOperatorPage();
  const repositories = repositoriesFor(tenantId);
  const params = await searchParams;
  const raw = Array.isArray(params.show) ? params.show[0] : params.show;
  const cursor = Array.isArray(params.cursor) ? params.cursor[0] : params.cursor;
  const showAll = raw === 'all';

  const { items, nextCursor } = await repositories.threads.list({
    limit: 50,
    cursor: cursor || undefined,
    minMessages: showAll ? 1 : 2,
  });
  const pagination = cursorPageLinks({
    pathname: '/threads',
    params,
    nextCursor,
  });

  return (
    <>
      <PageHeader
        title="Threads"
        description="Conversations with a reply in them, resolved from In-Reply-To and References headers."
        toolbar={
          <NavTabs
            aria-label="Filter conversations"
            active={showAll ? 'all' : 'conversations'}
            tabs={[
              { key: 'conversations', label: 'Conversations', href: '/threads' },
              {
                key: 'all',
                label: 'Including single messages',
                href: '/threads?show=all',
              },
            ]}
          />
        }
      />

      {items.length === 0 ? (
        <EmptyState
          icon="threads"
          title={showAll ? 'No threads yet' : 'No conversations yet'}
          description={
            showAll
              ? 'Thread resolution runs on headers only. A subject-and-participant fallback is deliberately not shipped: wrongly merging two customers’ threads is a data-leak-shaped bug.'
              : 'A conversation appears here once somebody replies. Everything received so far is a first message, and all of it is on Mail.'
          }
        />
      ) : (
        <>
        <Card className="gap-0 overflow-hidden py-0">
          {items.map((thread) => (
            <Link
              key={thread.id}
              href={`/threads/${thread.id}`}
              className="flex items-center gap-3.5 border-b border-border px-4 py-3.5 transition-colors last:border-0 hover:bg-muted/40"
            >
              <span className="w-48 shrink-0 truncate text-sm font-medium">
                {/* Who is in it matters more than the subject when scanning:
                    a conversation is with a person, about a subject. */}
                {thread.participants.join(', ') || (
                  <span className="text-muted-foreground">—</span>
                )}
              </span>

              <span className="min-w-0 flex-1 truncate text-sm text-foreground/90">
                {thread.subject || (
                  <span className="text-muted-foreground">(no subject)</span>
                )}
              </span>

              <Badge variant="outline" className="tabular-nums">
                {thread.messageCount}{' '}
                {thread.messageCount === 1 ? 'message' : 'messages'}
              </Badge>

              <time
                dateTime={thread.lastMessageAt.toISOString()}
                title={`${thread.lastMessageAt.toISOString().replace('T', ' ').slice(0, 19)} UTC`}
                className="w-24 shrink-0 text-right text-xs text-muted-foreground"
              >
                {formatWhen(thread.lastMessageAt)}
              </time>
            </Link>
          ))}
        </Card>
        <TablePagination
          page={pagination.page}
          itemCount={items.length}
          noun="conversation"
          previousHref={pagination.previousHref}
          nextHref={pagination.nextHref}
        />
        </>
      )}
    </>
  );
}
