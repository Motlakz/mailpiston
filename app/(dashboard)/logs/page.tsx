import Link from 'next/link';

import { EmptyState, PageHeader } from '@/components/layout/page-shell';
import { EventTimeline } from '@/components/mail/event-timeline';
import { MAIL_EVENT_TYPES, type MailEventType } from '@/server/core/types';
import { repositories } from '@/server/repositories';

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
  const params = await searchParams;

  const type = single(params.type);
  const addressId = single(params.addressId);
  const endpointId = single(params.endpointId);
  const since = single(params.since);

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
  });

  const filtered = Boolean(type || addressId || endpointId || since);

  return (
    <>
      <PageHeader
        title="Logs"
        description="One unified event stream, from receipt to final endpoint delivery."
      />

      <form method="get" className="mt-4 flex flex-wrap items-center gap-2">
        <Select name="type" value={type} placeholder="All event types">
          {MAIL_EVENT_TYPES.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </Select>

        <Select name="addressId" value={addressId} placeholder="All addresses">
          {addresses.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.email}
            </option>
          ))}
        </Select>

        <Select name="endpointId" value={endpointId} placeholder="All endpoints">
          {endpoints.map((endpoint) => (
            <option key={endpoint.id} value={endpoint.id}>
              {endpoint.name}
            </option>
          ))}
        </Select>

        <Select name="since" value={since} placeholder="All time">
          <option value="1h">Last hour</option>
          <option value="24h">Last 24 hours</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
        </Select>

        <button
          type="submit"
          className="h-7 rounded-md border border-border px-3 text-xs hover:bg-muted/40"
        >
          Filter
        </button>

        {filtered ? (
          <Link href="/logs" className="text-xs text-muted-foreground hover:text-foreground">
            Clear
          </Link>
        ) : null}
      </form>

      <div className="mt-4">
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

            {page.nextCursor ? (
              <p className="mt-3 text-xs text-muted-foreground">
                Showing the most recent {PAGE_SIZE}. Narrow the filters to see
                further back.
              </p>
            ) : null}
          </>
        )}
      </div>
    </>
  );
}

function Select({
  name,
  value,
  placeholder,
  children,
}: {
  name: string;
  value: string | undefined;
  placeholder: string;
  children: React.ReactNode;
}) {
  return (
    <select
      name={name}
      defaultValue={value ?? ''}
      className="h-7 rounded-md border border-input bg-card px-2 text-xs outline-none focus-visible:border-ring"
    >
      <option value="">{placeholder}</option>
      {children}
    </select>
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
