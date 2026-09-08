import { EmptyState, PageHeader } from '@/components/layout/page-shell';
import {
  AddEndpointForm,
  DeliveryLog,
  EndpointBindings,
  RecipientList,
  WebhookPanel,
} from '@/components/mail/endpoint-actions';
import { env } from '@/server/core/config';
import { repositories } from '@/server/repositories';

export const metadata = { title: 'Endpoints · MailPiston' };

/** Enough of the log to see a pattern, not so much that it needs paging. */
const DELIVERY_LOG_LIMIT = 10;

export default async function EndpointsPage() {
  const [endpoints, addresses] = await Promise.all([
    repositories.endpoints.list(),
    repositories.addresses.list(),
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

  return (
    <>
      <PageHeader
        title="Endpoints"
        description="Where mail goes next: a verified mailbox, a group of them, or a signed POST to your application."
        actions={<AddEndpointForm />}
      />

      {!env.RELAY_DOMAIN ? (
        <p className="mt-4 rounded-lg border border-warning/40 px-4 py-2.5 text-xs text-warning">
          No RELAY_DOMAIN configured. Forwarded mail still arrives, but it carries
          no reply relay — replying to it lands back on the managed address
          instead of reaching the customer.
        </p>
      ) : null}

      <div className="mt-4">
        {detail.length === 0 ? (
          <EmptyState
            icon="endpoints"
            title="No endpoints yet"
            description="An endpoint is the destination an address fans out to. Add one, verify the mailbox, and bind it to an address."
          />
        ) : (
          <div className="flex flex-col gap-4">
            {detail.map(({ endpoint, recipients, bound, webhookUrl, deliveries }) => (
              <section
                key={endpoint.id}
                className="rounded-lg border border-border bg-card"
              >
                <header className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
                  <h2 className="text-sm font-medium">{endpoint.name}</h2>
                  <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                    {endpoint.type}
                  </span>
                  {!endpoint.enabled ? (
                    <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                      disabled
                    </span>
                  ) : null}
                </header>

                {endpoint.type === 'webhook' ? (
                  <>
                    <div className="border-b border-border px-5 py-3">
                      <WebhookPanel endpointId={endpoint.id} url={webhookUrl} />
                    </div>

                    <div className="border-b border-border px-5 py-3">
                      <p className="mb-2 text-xs text-muted-foreground">
                        Recent deliveries
                      </p>
                      <DeliveryLog deliveries={deliveries} />
                    </div>
                  </>
                ) : (
                  <div className="border-b border-border px-5 py-3">
                    <p className="mb-2 text-xs text-muted-foreground">Recipients</p>
                    <RecipientList
                      endpointId={endpoint.id}
                      recipients={recipients}
                      addresses={sendable}
                    />
                  </div>
                )}

                <div className="px-5 py-3">
                  <p className="mb-2 text-xs text-muted-foreground">
                    Bound addresses
                  </p>
                  <EndpointBindings
                    endpointId={endpoint.id}
                    bound={bound}
                    addresses={addressOptions}
                  />
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
