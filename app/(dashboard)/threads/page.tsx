import Link from 'next/link';

import { EmptyState, PageHeader } from '@/components/layout/page-shell';
import { repositories } from '@/server/repositories';

export const metadata = { title: 'Threads · MailPiston' };

export default async function ThreadsPage() {
  const { items } = await repositories.threads.list({ limit: 100 });

  return (
    <>
      <PageHeader
        title="Threads"
        description="Conversations resolved from In-Reply-To and References headers."
      />

      {items.length === 0 ? (
        <EmptyState
          icon="threads"
          title="No threads yet"
          description="Thread resolution runs on headers only. A subject-and-participant fallback is deliberately not shipped: wrongly merging two customers' threads is a data-leak-shaped bug."
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          {items.map((thread) => (
            <Link
              key={thread.id}
              href={`/threads/${thread.id}`}
              className="flex items-baseline gap-3 border-b border-border px-4 py-3 last:border-0 hover:bg-muted/40"
            >
              <span className="min-w-0 flex-1 truncate text-sm">
                {thread.subject || (
                  <span className="text-muted-foreground">(no subject)</span>
                )}
              </span>
              <time
                dateTime={thread.lastMessageAt.toISOString()}
                className="shrink-0 text-xs text-muted-foreground"
              >
                {thread.lastMessageAt.toISOString().replace('T', ' ').slice(0, 16)}
              </time>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
