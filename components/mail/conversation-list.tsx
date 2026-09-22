'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { ConversationRow } from '@/components/mail/conversation-row';
import { apiRequest } from '@/lib/api-client';
import type { EmailListItem } from '@/server/core/types';

interface Page {
  items: EmailListItem[];
  nextCursor: string | null;
}

/**
 * The conversation column, paged.
 *
 * This is the one place TanStack Query is doing the job it exists for. The
 * first page still comes from the server component — so the list is in the
 * initial HTML, with no spinner on first paint and no client waterfall — and is
 * handed straight to Query as `initialData`. Everything after that is fetched
 * on the client as the operator reaches the bottom.
 *
 * Before this, the page rendered `limit: 100` and printed "Showing the most
 * recent 100" underneath. That was not a display choice, it was the end of the
 * list: mail older than the hundredth message had no route to the screen at
 * all.
 */
export function ConversationList({
  initialItems,
  initialCursor,
  show,
  selectedId,
}: {
  initialItems: EmailListItem[];
  initialCursor: string | null;
  /** The active filter key, carried into both the query and the row links. */
  show: string;
  selectedId?: string;
}) {
  const query = useInfiniteQuery<Page>({
    queryKey: ['emails', show],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams(FILTER_PARAMS[show] ?? '');
      params.set('limit', String(PAGE_SIZE));
      if (pageParam) params.set('cursor', String(pageParam));

      const body = await apiRequest<{
        data: EmailListItem[];
        nextCursor: string | null;
      }>(`/api/v1/emails?${params}`);

      return { items: body.data.map(reviveDates), nextCursor: body.nextCursor };
    },
    getNextPageParam: (last) => last.nextCursor,
    initialData: {
      pages: [{ items: initialItems, nextCursor: initialCursor }],
      pageParams: [null],
    },
    // The server just rendered this; re-fetching page one on mount would throw
    // away the work and flash the same rows back in.
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const sentinel = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;

  /**
   * Fetch when the end of the list comes into view.
   *
   * `rootMargin` starts the request a screen early, so on an ordinary scroll
   * the next page has usually landed before the operator reaches the bottom and
   * there is nothing to wait for.
   */
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !hasNextPage) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !isFetchingNextPage) fetchNextPage();
      },
      { rootMargin: '400px' },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const items = query.data.pages.flatMap((page) => page.items);

  return (
    <>
      {items.map((email) => (
        <ConversationRow
          key={email.id}
          email={email}
          href={hrefFor(show, email.id)}
          selected={email.id === selectedId}
        />
      ))}

      <div ref={sentinel} className="conversation-sentinel">
        {isFetchingNextPage ? (
          <span className="skeleton-bar" style={{ width: '9rem' }} />
        ) : hasNextPage ? null : items.length > 0 ? (
          <span>That is all of it.</span>
        ) : null}
      </div>
    </>
  );
}

const PAGE_SIZE = 50;

/**
 * The query string each dashboard filter maps to on `/v1/emails`.
 *
 * Kept as literal params rather than reconstructed from the server's filter
 * table, because this runs on the client and that table imports the repository
 * layer. The two have to agree; a mismatch shows up as a first page that does
 * not match the second.
 */
const FILTER_PARAMS: Record<string, string> = {
  all: '',
  received: 'direction=inbound',
  sent: 'direction=outbound',
  bounced: 'status=soft_bounced&status=hard_bounced',
  spam: 'spamVerdict=spam',
  bin: 'deleted=true&spamVerdict=clean&spamVerdict=suspicious&spamVerdict=spam',
};

function hrefFor(show: string, id: string): string {
  const params = new URLSearchParams();
  if (show !== 'all') params.set('show', show);
  params.set('id', id);
  return `/mail?${params}`;
}

/**
 * JSON has no date type, so everything the API returns arrives as a string
 * while the server-rendered first page holds real `Date`s. The row formats
 * dates, so the two pages have to be the same shape or row fifty-one throws.
 */
function reviveDates(email: EmailListItem): EmailListItem {
  return {
    ...email,
    createdAt: new Date(email.createdAt),
    sentAt: email.sentAt ? new Date(email.sentAt) : null,
    receivedAt: email.receivedAt ? new Date(email.receivedAt) : null,
  };
}
