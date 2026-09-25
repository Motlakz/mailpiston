import Link from 'next/link';

import { Icon } from '@/components/icon';
import { EmptyState, PageHeader } from '@/components/layout/page-shell';
import {
  numberedPageLinks,
  pageNumber,
  TablePagination,
} from '@/components/layout/pagination';
import { Accordion } from '@/components/ui/accordion';
import { StatusDot } from '@/components/ui/status-badge';
import {
  AddEndpointForm,
  DeliveryLog,
  EndpointBindings,
  RecipientList,
  WebhookPanel,
} from '@/components/mail/endpoint-actions';
import { repositoriesFor } from '@/server/repositories';
import { requireOperatorPage } from '@/server/core/auth';

export const metadata = { title: 'Endpoints · MailPiston' };

/** Enough of the log to see a pattern, not so much that it needs paging. */
const DELIVERY_LOG_LIMIT = 25;
const PAGE_SIZE = 10;

export default async function EndpointsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { tenantId } = await requireOperatorPage();
  const params = await searchParams;
  const repositories = repositoriesFor(tenantId);
  const [endpoints, addresses, relayDomain] = await Promise.all([
    repositories.endpoints.list(),
    repositories.addresses.list(),
    repositories.domains.findRelayDomain(),
  ]);

  const addressOptions = addresses.map((address) => ({
    id: address.id,
    email: address.email,
  }));

  const sendable = addresses
    .filter((address) => address.canSend && address.enabled && address.providerAliasId)
    .map((address) => ({ id: address.id, email: address.email }));

  // One query per endpoint rather than a join: this page holds a handful of
  // rows, and the shape stays obvious.
  const detail = await Promise.all(
    endpoints.map(async (endpoint) => ({
      endpoint,
      // The URL only. The signing secret was shown once, at creation, and there
      // is deliberately no path that reads it back.
      webhookUrl:
        endpoint.type === 'webhook'
          ? ((await repositories.endpoints.getWebhookConfig(endpoint.id))?.url ??
            null)
          : null,
      deliveries:
        endpoint.type === 'webhook'
          ? await repositories.deliveries.listForEndpoint(
              endpoint.id,
              DELIVERY_LOG_LIMIT,
            )
          : [],
      recipients: (await repositories.endpoints.listRecipients(endpoint.id)).map(
        (recipient) => ({
          id: recipient.id,
          email: recipient.email,
          verified: Boolean(recipient.verifiedAt),
        }),
      ),
      bound: (
        await Promise.all(
          addresses.map(async (address) => ({
            id: address.id,
            endpoints: await repositories.endpoints.listForAddress(address.id),
          })),
        )
      )
        .filter((row) => row.endpoints.some((bound) => bound.id === endpoint.id))
        .map((row) => row.id),
    })),
  );

  const live = detail.filter(({ endpoint, recipients, bound }) =>
    isEndpointLive({ endpoint, recipients, bound }),
  ).length;
  const routes = detail.reduce((count, item) => count + item.bound.length, 0);
  const totalPages = Math.max(1, Math.ceil(detail.length / PAGE_SIZE));
  const currentPage = Math.min(pageNumber(params.page), totalPages);
  const visibleDetail = detail.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );
  const pagination = numberedPageLinks({
    pathname: '/endpoints',
    params,
    page: currentPage,
    totalPages,
  });

  return (
    <>
      <PageHeader
        title="Endpoints"
        description="An endpoint is where a message goes after MailPiston stores it — your application over a signed webhook, or a mailbox you already read."
        actions={<AddEndpointForm />}
      />

      <section className="endpoint-summary" aria-label="Endpoint readiness">
        <div>
          <span>Destinations</span>
          <strong>{detail.length}</strong>
          <small>{live} ready to deliver</small>
        </div>
        <div>
          <span>Address routes</span>
          <strong>{routes}</strong>
          <small>managed address connections</small>
        </div>
        <div data-warning={!relayDomain ? '' : undefined}>
          <span>Inbox replies</span>
          <strong>{relayDomain ? 'Ready' : 'Paused'}</strong>
          <small>{relayDomain?.name ?? 'select a reply domain'}</small>
        </div>
      </section>

      {/* One foldable explainer rather than four blocks competing with the
          endpoints themselves. Closed by default: it answers a question you
          have once, and the cards below are what you came for. */}
      <Accordion title="How endpoints work" className="endpoint-guide">
        <div className="endpoint-guide__body">
          <div className="endpoint-guide__steps">
            <section>
              <span>01</span>
              <div>
                <strong>Choose a destination</strong>
                <p>A signed webhook for an app, or a mailbox you already read.</p>
              </div>
            </section>
            <section>
              <span>02</span>
              <div>
                <strong>Prove the mailbox</strong>
                <p>Each personal recipient verifies once. Webhooks skip this step.</p>
              </div>
            </section>
            <section>
              <span>03</span>
              <div>
                <strong>Connect source addresses</strong>
                <p>Nothing is delivered until at least one managed address is bound.</p>
              </div>
            </section>
          </div>

          <div className="endpoint-guide__notes">
            <p>
              Mailbox notifications leave from the managed address. Delivery
              attempts appear in Logs as <code>personal_forward.*</code> events.
            </p>

            {!relayDomain ? (
              <p className="endpoint-guide__warn">
                <b>Inbox forwarding is paused.</b> Select a verified reply domain
                on <Link href="/domains">Domains</Link> so every notification has
                a safe route back through MailPiston.
              </p>
            ) : (
              <p className="endpoint-guide__ready">
                <b>Reply route ready.</b> New inbox notifications use{' '}
                <code>{relayDomain.name}</code>.
              </p>
            )}
          </div>
        </div>
      </Accordion>

      <div className="mt-4">
        {detail.length === 0 ? (
          <EmptyState
            icon="endpoints"
            title="No endpoints yet"
            description="Nothing is being delivered anywhere. Create one above — a webhook if your application should receive the mail, a mailbox if you should."
          >
            <AddEndpointForm />
          </EmptyState>
        ) : (
          <div className="flex flex-col gap-4">
            {visibleDetail.map(({ endpoint, recipients, bound, webhookUrl, deliveries }) => (
              <section
                key={endpoint.id}
                className="endpoint-card"
              >
                <header className="endpoint-card__head">
                  <div className="endpoint-card__identity">
                    <span className="endpoint-card__icon" aria-hidden>
                      <Icon
                        name={endpoint.type === 'webhook' ? 'endpoints' : 'inbox'}
                        size={17}
                      />
                    </span>
                    <div>
                      <h2>{endpoint.name}</h2>
                      <p>{readinessOf({ endpoint, recipients, bound })}</p>
                    </div>
                  </div>

                  <div className="endpoint-card__tags">
                    <StatusDot
                      status={
                        isEndpointLive({ endpoint, recipients, bound })
                          ? 'verified'
                          : 'pending'
                      }
                      label={
                        isEndpointLive({ endpoint, recipients, bound })
                          ? 'Live'
                          : 'Needs setup'
                      }
                    />
                    <span className="endpoint-tag">{TYPE_LABEL[endpoint.type]}</span>
                    {!endpoint.enabled ? (
                      <span className="endpoint-tag endpoint-tag--off">Disabled</span>
                    ) : null}
                  </div>
                </header>

                <div className="endpoint-card__routes">
                  <section className="endpoint-card__route">
                    <p className="endpoint-card__label">01 · Destination</p>
                    {endpoint.type === 'webhook' ? (
                      <WebhookPanel endpointId={endpoint.id} url={webhookUrl} />
                    ) : (
                      <RecipientList
                        endpointId={endpoint.id}
                        type={endpoint.type}
                        recipients={recipients}
                        addresses={sendable}
                      />
                    )}
                  </section>

                  <section className="endpoint-card__route">
                    <p className="endpoint-card__label">02 · Source addresses</p>
                    <EndpointBindings
                      endpointId={endpoint.id}
                      bound={bound}
                      addresses={addressOptions}
                    />
                  </section>
                </div>

                {endpoint.type === 'webhook' ? (
                  <details className="endpoint-card__log">
                    <summary>
                      Recent deliveries
                      {deliveries.length > 0 ? ` (${deliveries.length})` : ''}
                    </summary>
                    <DeliveryLog deliveries={deliveries} />
                    <Link
                      href={`/logs?endpointId=${endpoint.id}`}
                      className="mt-2 inline-flex text-xs text-primary hover:underline"
                    >
                      View all endpoint events
                    </Link>
                  </details>
                ) : null}
              </section>
            ))}
            <TablePagination
              page={currentPage}
              itemCount={visibleDetail.length}
              noun="endpoint"
              previousHref={pagination.previousHref}
              nextHref={pagination.nextHref}
            />
          </div>
        )}
      </div>
    </>
  );
}

const TYPE_LABEL: Record<string, string> = {
  webhook: 'Webhook',
  email: 'Mailbox',
  email_group: 'Mailbox group',
};

function isEndpointLive({
  endpoint,
  recipients,
  bound,
}: {
  endpoint: { type: string; enabled: boolean };
  recipients: Array<{ verified: boolean }>;
  bound: string[];
}): boolean {
  if (!endpoint.enabled || bound.length === 0) return false;
  if (endpoint.type === 'webhook') return true;
  return recipients.some((recipient) => recipient.verified);
}

/**
 * One sentence saying whether this endpoint is actually going to receive
 * anything.
 *
 * The page previously showed configuration without ever stating the outcome,
 * so an endpoint that was fully set up and one that was connected to nothing
 * looked identical. The unbound case is the common dead end.
 */
function readinessOf({
  endpoint,
  recipients,
  bound,
}: {
  endpoint: { type: string; enabled: boolean };
  recipients: Array<{ verified: boolean }>;
  bound: string[];
}): string {
  if (!endpoint.enabled) return 'Disabled — nothing is delivered here.';

  if (endpoint.type !== 'webhook') {
    const verified = recipients.filter((recipient) => recipient.verified).length;
    if (recipients.length === 0) return 'Add a mailbox to forward to.';
    if (verified === 0) return 'Waiting on mailbox verification.';
  }

  if (bound.length === 0) {
    return 'Not connected to an address yet, so nothing reaches it.';
  }

  return `Live — delivering mail from ${bound.length} address${bound.length === 1 ? '' : 'es'}.`;
}
