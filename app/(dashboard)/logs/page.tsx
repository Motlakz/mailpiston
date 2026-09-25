import { EmptyState, PageHeader } from '@/components/layout/page-shell';
import {
  cursorPageLinks,
  TablePagination,
} from '@/components/layout/pagination';
import { LogFilters } from '@/components/mail/log-filters';
import { EventTimeline } from '@/components/mail/event-timeline';
import { MAIL_EVENT_TYPES, type MailEventType } from '@/server/core/types';
import { repositoriesFor } from '@/server/repositories';
import { requireOperatorPage } from '@/server/core/auth';

export const metadata = { title: 'Logs · MailPiston' };

const PAGE_SIZE = 100;

/**
 * The unified event stream (roadmap Phase 9).
 *
 * Filters live in the URL rather than in component state, so a filtered view is
 * a link. That matters more here than anywhere else in the dashboard: the
 * output of this page is usually pasted into a conversation about what happened
 * to somebody's mail.
 */
export default async function LogsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { tenantId } = await requireOperatorPage();
  const repositories = repositoriesFor(tenantId);
  const params = await searchParams;

  const type = single(params.type);
  const addressId = single(params.addressId);
  const endpointId = single(params.endpointId);
  const since = single(params.since);
  const cursor = single(params.cursor);

  const [addresses, endpoints] = await Promise.all([
    repositories.addresses.list(),
    repositories.endpoints.list(),
  ]);

  const address = addressId
    ? addresses.find((candidate) => candidate.id === addressId)
    : undefined;

  const page = await repositories.events.list({
    types: type ? [type as MailEventType] : undefined,
    addressId: address?.id,
    // Rejections carry no message and therefore no address — only a recipient.
    // Passing it in is what stops the address filter from hiding exactly the
    // events someone filtering by address is usually looking for.
    recipient: address?.email,
    endpointId: endpointId ?? undefined,
    since: since ? sinceDate(since) : undefined,
    limit: PAGE_SIZE,
    cursor,
  });

  const filtered = Boolean(type || addressId || endpointId || since);
  const pagination = cursorPageLinks({
    pathname: '/logs',
    params,
    nextCursor: page.nextCursor,
  });

  return (
    <>
      <PageHeader
        title="Logs"
        description="One unified event stream, from receipt to final endpoint delivery."
      />

      <div>
        <LogFilters
          current={{ type, addressId, endpointId, since }}
          eventTypes={MAIL_EVENT_TYPES.map((value) => ({
            value,
            label: value,
          }))}
          addresses={addresses.map((candidate) => ({
            value: candidate.id,
            label: candidate.email,
          }))}
          endpoints={endpoints.map((endpoint) => ({
            value: endpoint.id,
            label: endpoint.name,
          }))}
        />
      </div>
      <div>
        {page.items.length === 0 ? (
          <EmptyState
            icon="logs"
            title={filtered ? 'No events match those filters' : 'No events yet'}
            description={
              filtered
                ? 'Widen the range, or clear the filters to see the whole stream.'
                : 'Every message gets a complete audit trail here, from receipt to final endpoint delivery.'
            }
          />
        ) : (
          <>
            <EventTimeline events={page.items} showMessageLink />

            <TablePagination
              page={pagination.page}
              itemCount={page.items.length}
              noun="event"
              previousHref={pagination.previousHref}
              nextHref={pagination.nextHref}
            />
          </>
        )}
      </div>
    </>
  );
}

/** A repeated query parameter is a client mistake here, not a feature. */
function single(value: string | string[] | undefined): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  return first || undefined;
}

const WINDOWS_MS: Record<string, number> = {
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

function sinceDate(window: string): Date | undefined {
  const ms = WINDOWS_MS[window];
  return ms ? new Date(Date.now() - ms) : undefined;
}
