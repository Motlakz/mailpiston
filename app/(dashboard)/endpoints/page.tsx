import { EmptyState, PageHeader } from '@/components/layout/page-shell';
import { Accordion } from '@/components/ui/accordion';
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
        description="An endpoint is where a message goes after MailPiston stores it — your application over a signed webhook, or a mailbox you already read."
        actions={<AddEndpointForm />}
      />

      {/* One foldable explainer rather than four blocks competing with the
          endpoints themselves. Closed by default: it answers a question you
          have once, and the cards below are what you came for. */}
      <Accordion title="How endpoints work" className="endpoint-guide">
        <div className="endpoint-guide__body">
          <ol>
            <li>
              <b>Create it.</b> A webhook URL if your application should receive
              the mail, a mailbox if you should.
            </li>
            <li>
              <b>Verify the mailbox.</b> Mailbox endpoints only — we send a code,
              you paste it back. An unverified mailbox is skipped silently.
            </li>
            <li>
              <b>Connect an address.</b> The step that is easy to miss: until an
              address feeds it, an endpoint receives nothing at all.
            </li>
          </ol>

          <p>
            A forwarded message is sent <em>from</em> the managed address, so
            that address must be send-capable. If forwarding is failing, the
            Logs page carries <code>personal_forward.queued</code>,{' '}
            <code>.delivered</code> and <code>.failed</code> for every attempt.
          </p>

          {!env.RELAY_DOMAIN ? (
            <p className="endpoint-guide__warn">
              <b>Replies will not reach the customer.</b> No{' '}
              <code>RELAY_DOMAIN</code> is set, so forwarded mail carries no
              Reply-To — replying from your own mail client sends the answer
              back to the managed address instead of onward. Set a relay domain
              whose DNS you control to reply from anywhere.
            </p>
          ) : null}
        </div>
      </Accordion>

      <div className="mt-4">
        {detail.length === 0 ? (
          <EmptyState
            icon="endpoints"
            title="No endpoints yet"
            description="Nothing is being delivered anywhere. Create one above — a webhook if your application should receive the mail, a mailbox if you should."
          />
        ) : (
          <div className="flex flex-col gap-4">
            {detail.map(({ endpoint, recipients, bound, webhookUrl, deliveries }) => (
              <section
                key={endpoint.id}
                className="endpoint-card"
              >
                <header className="endpoint-card__head">
                  <div>
                    <h2>{endpoint.name}</h2>
                    <p>{readinessOf({ endpoint, recipients, bound })}</p>
                  </div>

                  <div className="endpoint-card__tags">
                    <span className="endpoint-tag">{TYPE_LABEL[endpoint.type]}</span>
                    {!endpoint.enabled ? (
                      <span className="endpoint-tag endpoint-tag--off">Disabled</span>
                    ) : null}
                  </div>
                </header>

                {endpoint.type === 'webhook' ? (
                  <>
                    <div className="border-b border-border px-5 py-3">
                      <WebhookPanel endpointId={endpoint.id} url={webhookUrl} />
                    </div>

                    {/* Folded away: useful when something is wrong, noise on
                        every other visit, and it was expanded by default on
                        every card at once. */}
                    <details className="endpoint-card__log">
                      <summary>
                        Recent deliveries
                        {deliveries.length > 0 ? ` (${deliveries.length})` : ''}
                      </summary>
                      <DeliveryLog deliveries={deliveries} />
                    </details>
                  </>
                ) : (
                  <div className="border-b border-border px-5 py-3">
                    <p className="endpoint-card__label">Forwards to</p>
                    <RecipientList
                      endpointId={endpoint.id}
                      recipients={recipients}
                      addresses={sendable}
                    />
                  </div>
                )}

                <div className="px-5 py-3">
                  <p className="endpoint-card__label">
                    Receives mail sent to
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

const TYPE_LABEL: Record<string, string> = {
  webhook: 'Webhook',
  email: 'Mailbox',
  email_group: 'Mailbox group',
};

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
