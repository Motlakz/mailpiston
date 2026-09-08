'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Icon } from '@/components/icon';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { ApiRequestError, apiRequest } from '@/lib/api-client';

const inputClass =
  'h-7 rounded-md border border-input bg-card px-2 text-xs outline-none focus-visible:border-ring';

function messageFor(error: unknown): string {
  return error instanceof ApiRequestError
    ? error.message
    : 'Something went wrong. Check the server logs.';
}

type EndpointType = 'email' | 'email_group' | 'webhook';

const labelClass = 'text-[11px] font-medium tracking-wide text-muted-foreground';

const fieldClass =
  'h-8 w-full rounded-md border border-input bg-background px-2.5 text-xs outline-none transition-colors focus-visible:border-ring';

const TYPE_HELP: Record<EndpointType, string> = {
  email: 'One verified mailbox. Mail arrives as a constructed notification.',
  email_group: 'Several verified mailboxes, each verified separately.',
  webhook: 'A signed POST of the public v1 payload to your application.',
};

/**
 * Creating an endpoint, in a modal.
 *
 * The webhook signing secret is returned by exactly one response and never
 * again, so the dialog stays open after a successful create and switches to
 * showing it. Dismissing it is the operator saying they have copied it — which
 * is a different thing from the form having submitted, and worth a separate
 * click.
 */
export function AddEndpointForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<EndpointType>('email');
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function close() {
    setOpen(false);
    setSecret(null);
    setError(null);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    try {
      const created = await apiRequest<{ secret: string | null }>(
        '/api/v1/endpoints',
        {
          method: 'POST',
          body: JSON.stringify({
            name,
            type,
            ...(type === 'webhook' ? { url } : {}),
          }),
        },
      );

      setName('');
      setUrl('');
      startTransition(() => router.refresh());

      // A mailbox endpoint has nothing to show, so it closes; a webhook has a
      // secret that exists in this response and nowhere else.
      if (created.secret) setSecret(created.secret);
      else setOpen(false);
    } catch (caught) {
      setError(messageFor(caught));
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Icon name="add" size={13} />
        Add endpoint
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => (next ? setOpen(true) : close())}
        title={secret ? 'Endpoint created' : 'New endpoint'}
        description={
          secret
            ? undefined
            : 'Where an address fans out to once mail arrives for it.'
        }
      >
        {secret ? (
          <div className="flex flex-col gap-3">
            <SecretOnce secret={secret} />
            <div className="flex justify-end border-t border-border pt-3">
              <Button onClick={close}>Done</Button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label className={labelClass} htmlFor="endpoint-name">
                Name
              </label>
              <input
                id="endpoint-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="My inbox"
                required
                className={fieldClass}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className={labelClass} htmlFor="endpoint-type">
                Type
              </label>
              <select
                id="endpoint-type"
                value={type}
                onChange={(event) => setType(event.target.value as EndpointType)}
                className={fieldClass}
              >
                <option value="email">email</option>
                <option value="email_group">email_group</option>
                <option value="webhook">webhook</option>
              </select>
              <p className="text-xs text-muted-foreground">{TYPE_HELP[type]}</p>
            </div>

            {type === 'webhook' ? (
              <div className="flex flex-col gap-1.5">
                <label className={labelClass} htmlFor="endpoint-url">
                  URL
                </label>
                <input
                  id="endpoint-url"
                  type="url"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="https://app.example/api/mail"
                  required
                  className={`${fieldClass} font-mono`}
                />
                <p className="text-xs text-muted-foreground">
                  HTTPS only, and never an address inside this deployment&apos;s
                  own network — checked again before every delivery.
                </p>
              </div>
            ) : null}

            {error ? (
              <p className="rounded-md border border-destructive/40 px-2.5 py-1.5 text-xs text-destructive">
                {error}
              </p>
            ) : null}

            <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
              <button
                type="button"
                onClick={close}
                className="text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                Cancel
              </button>
              <Button type="submit" disabled={pending}>
                Create endpoint
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </>
  );
}

/**
 * The signing secret, shown once.
 *
 * It is stored encrypted rather than hashed, because the server has to recover
 * it to sign every delivery — so "shown once" is the only thing between an
 * encrypted column and a read endpoint that hands it back. Losing it means
 * rotating it, which is a button rather than a disaster.
 */
function SecretOnce({ secret }: { secret: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-warning/40 bg-warning/5 px-4 py-3">
      <p className="text-xs text-warning">
        Copy this signing secret now — it is not shown again, and it cannot be
        recovered. Losing it means rotating it.
      </p>

      <code className="rounded-md border border-border bg-background px-2.5 py-2 font-mono text-[11px] break-all">
        {secret}
      </code>

      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            navigator.clipboard.writeText(secret);
            setCopied(true);
          }}
        >
          <Icon name={copied ? 'verified' : 'copy'} size={12} />
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
    </div>
  );
}

export interface RecipientRow {
  id: string;
  email: string;
  verified: boolean;
}

export interface SendableAddressOption {
  id: string;
  email: string;
}

/**
 * Recipients, and the two-step proof of control they need.
 *
 * Nothing is forwarded to an unverified address, so the state that matters on
 * this row is "verified" and not "saved".
 */
export function RecipientList({
  endpointId,
  recipients,
  addresses,
}: {
  endpointId: string;
  recipients: RecipientRow[];
  addresses: SendableAddressOption[];
}) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function add(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    try {
      await apiRequest(`/api/v1/endpoints/${endpointId}/recipients`, {
        method: 'POST',
        body: JSON.stringify({ email }),
      });

      setEmail('');
      startTransition(() => router.refresh());
    } catch (caught) {
      setError(messageFor(caught));
    }
  }

  async function remove(recipientId: string) {
    setError(null);

    try {
      await apiRequest(
        `/api/v1/endpoints/${endpointId}/recipients/${recipientId}`,
        { method: 'DELETE' },
      );
      startTransition(() => router.refresh());
    } catch (caught) {
      setError(messageFor(caught));
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {recipients.map((recipient) => (
        <div key={recipient.id} className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs">{recipient.email}</span>

          {recipient.verified ? (
            <span className="rounded-full border border-success/40 px-2 py-0.5 text-[11px] text-success">
              verified
            </span>
          ) : (
            <VerifyRecipient
              endpointId={endpointId}
              recipientId={recipient.id}
              addresses={addresses}
            />
          )}

          <button
            type="button"
            onClick={() => remove(recipient.id)}
            disabled={pending}
            className="text-xs text-muted-foreground hover:text-destructive"
          >
            Remove
          </button>
        </div>
      ))}

      <form onSubmit={add} className="flex flex-wrap items-center gap-2">
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@personal.example"
          required
          className={`${inputClass} w-56`}
        />
        <Button type="submit" variant="outline" size="sm" disabled={pending}>
          Add recipient
        </Button>
        {error ? <span className="text-xs text-destructive">{error}</span> : null}
      </form>
    </div>
  );
}

function VerifyRecipient({
  endpointId,
  recipientId,
  addresses,
}: {
  endpointId: string;
  recipientId: string;
  addresses: SendableAddressOption[];
}) {
  const router = useRouter();
  const [addressId, setAddressId] = useState(addresses[0]?.id ?? '');
  const [token, setToken] = useState('');
  const [challengeSent, setChallengeSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const path = `/api/v1/endpoints/${endpointId}/recipients/${recipientId}/verify`;

  async function sendChallenge() {
    setError(null);

    try {
      await apiRequest(path, {
        method: 'POST',
        body: JSON.stringify({ action: 'send', fromAddressId: addressId }),
      });
      setChallengeSent(true);
    } catch (caught) {
      setError(messageFor(caught));
    }
  }

  async function confirm(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    try {
      await apiRequest(path, {
        method: 'POST',
        body: JSON.stringify({ action: 'confirm', token }),
      });
      startTransition(() => router.refresh());
    } catch (caught) {
      setError(messageFor(caught));
    }
  }

  if (addresses.length === 0) {
    return (
      <span className="text-xs text-muted-foreground">
        needs a send-capable address to verify from
      </span>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="rounded-full border border-warning/40 px-2 py-0.5 text-[11px] text-warning">
        unverified
      </span>

      {challengeSent ? (
        <form onSubmit={confirm} className="flex items-center gap-2">
          <input
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="Code from the email"
            required
            className={`${inputClass} w-44 font-mono`}
          />
          <Button type="submit" size="sm" disabled={pending}>
            Confirm
          </Button>
        </form>
      ) : (
        <>
          <select
            value={addressId}
            onChange={(event) => setAddressId(event.target.value)}
            className={inputClass}
          >
            {addresses.map((address) => (
              <option key={address.id} value={address.id}>
                from {address.email}
              </option>
            ))}
          </select>
          <Button type="button" variant="outline" size="sm" onClick={sendChallenge}>
            Send code
          </Button>
        </>
      )}

      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </span>
  );
}

/**
 * The webhook half of an endpoint: where it points, and whether it answers.
 *
 * The test delivery is here rather than buried in a menu because it is the one
 * thing worth doing before a customer's mail depends on the receiver working.
 */
export function WebhookPanel({
  endpointId,
  url,
}: {
  endpointId: string;
  url: string | null;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(url ?? '');
  const [secret, setSecret] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setResult(null);

    try {
      await apiRequest(`/api/v1/endpoints/${endpointId}`, {
        method: 'PATCH',
        body: JSON.stringify({ url: draft }),
      });
      startTransition(() => router.refresh());
    } catch (caught) {
      setError(messageFor(caught));
    }
  }

  async function test() {
    setError(null);
    setResult(null);

    try {
      const outcome = await apiRequest<{
        ok: boolean;
        responseCode: number | null;
        error: string | null;
      }>(`/api/v1/endpoints/${endpointId}/test`, { method: 'POST' });

      setResult(
        outcome.ok
          ? `Receiver answered ${outcome.responseCode}.`
          : (outcome.error ?? 'No response.'),
      );
    } catch (caught) {
      setError(messageFor(caught));
    }
  }

  async function rotate() {
    setError(null);
    setResult(null);

    try {
      const rotated = await apiRequest<{ secret: string }>(
        `/api/v1/endpoints/${endpointId}/rotate-secret`,
        { method: 'POST' },
      );
      setSecret(rotated.secret);
    } catch (caught) {
      setError(messageFor(caught));
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">Destination</p>

      <form onSubmit={save} className="flex flex-wrap items-center gap-2">
        <input
          type="url"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          required
          className={`${inputClass} w-80 font-mono`}
        />
        <Button type="submit" variant="outline" size="sm" disabled={pending}>
          Save
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={test}>
          Send test
        </Button>
        <button
          type="button"
          onClick={rotate}
          className="text-xs text-muted-foreground hover:text-destructive"
        >
          Rotate secret
        </button>
      </form>

      {result ? <p className="text-xs text-muted-foreground">{result}</p> : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      <Dialog
        open={secret !== null}
        onOpenChange={(next) => (next ? undefined : setSecret(null))}
        title="Secret rotated"
        description="Deliveries fail verification until your application is redeployed with this secret."
      >
        {secret ? (
          <div className="flex flex-col gap-3">
            <SecretOnce secret={secret} />
            <div className="flex justify-end border-t border-border pt-3">
              <Button onClick={() => setSecret(null)}>Done</Button>
            </div>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}

export interface DeliveryRow {
  id: string;
  status: string;
  attempt: number;
  responseCode: number | null;
  lastError: string | null;
  createdAt: string | Date;
}

const STATUS_CLASS: Record<string, string> = {
  delivered: 'border-success/40 text-success',
  failed: 'border-destructive/40 text-destructive',
  pending: 'border-warning/40 text-warning',
  delivering: 'border-border text-muted-foreground',
};

/** Status, response code, last error, attempt count — plan §13's delivery log. */
export function DeliveryLog({ deliveries }: { deliveries: DeliveryRow[] }) {
  const router = useRouter();
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /**
   * Routed through the same claim path a scheduled retry uses. It is not a
   * shortcut — an operator presses this exactly when a retry is due, and a path
   * that skipped the claim would be the easiest way to deliver twice.
   */
  async function retry(deliveryId: string) {
    setError(null);
    setNote(null);

    try {
      const result = await apiRequest<{ skipped: boolean; ok?: boolean }>(
        `/api/v1/deliveries/${deliveryId}/retry`,
        { method: 'POST' },
      );

      setNote(
        result.skipped
          ? 'Nothing to retry — already delivered, or in flight.'
          : result.ok
            ? 'Delivered.'
            : 'Still failing. Check the last error.',
      );

      startTransition(() => router.refresh());
    } catch (caught) {
      setError(messageFor(caught));
    }
  }

  if (deliveries.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Nothing delivered yet. Bind this endpoint to an address and send it mail.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-1 pr-4 font-normal">When</th>
              <th className="py-1 pr-4 font-normal">Status</th>
              <th className="py-1 pr-4 font-normal">Code</th>
              <th className="py-1 pr-4 font-normal">Attempts</th>
              <th className="py-1 pr-4 font-normal">Last error</th>
              <th className="py-1 font-normal" />
            </tr>
          </thead>
          <tbody>
            {deliveries.map((delivery) => (
              <tr key={delivery.id} className="border-t border-border align-top">
                <td className="py-1.5 pr-4 whitespace-nowrap text-muted-foreground">
                  {new Date(delivery.createdAt).toLocaleString()}
                </td>
                <td className="py-1.5 pr-4">
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[11px] ${
                      STATUS_CLASS[delivery.status] ?? 'border-border'
                    }`}
                  >
                    {delivery.status}
                  </span>
                </td>
                <td className="py-1.5 pr-4 font-mono">
                  {delivery.responseCode ?? '—'}
                </td>
                <td className="py-1.5 pr-4 font-mono">{delivery.attempt}</td>
                <td className="max-w-md py-1.5 pr-4 break-all text-muted-foreground">
                  {delivery.lastError ?? '—'}
                </td>
                <td className="py-1.5">
                  {delivery.status === 'delivered' ? null : (
                    <button
                      type="button"
                      onClick={() => retry(delivery.id)}
                      disabled={pending}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      Retry
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

/** Which addresses fan out to this endpoint. */
export function EndpointBindings({
  endpointId,
  bound,
  addresses,
}: {
  endpointId: string;
  bound: string[];
  addresses: Array<{ id: string; email: string }>;
}) {
  const router = useRouter();
  const [addressId, setAddressId] = useState(addresses[0]?.id ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const unbound = addresses.filter((address) => !bound.includes(address.id));

  async function bind() {
    setError(null);

    try {
      await apiRequest(`/api/v1/addresses/${addressId}/endpoints`, {
        method: 'POST',
        body: JSON.stringify({ endpointId }),
      });
      startTransition(() => router.refresh());
    } catch (caught) {
      setError(messageFor(caught));
    }
  }

  async function unbind(id: string) {
    setError(null);

    try {
      await apiRequest(`/api/v1/addresses/${id}/endpoints/${endpointId}`, {
        method: 'DELETE',
      });
      startTransition(() => router.refresh());
    } catch (caught) {
      setError(messageFor(caught));
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {bound.length === 0 ? (
        <span className="text-xs text-muted-foreground">
          Not bound to any address yet.
        </span>
      ) : (
        bound.map((id) => {
          const address = addresses.find((candidate) => candidate.id === id);
          return (
            <span
              key={id}
              className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px]"
            >
              {address?.email ?? id}
              <button
                type="button"
                onClick={() => unbind(id)}
                disabled={pending}
                aria-label="Unbind"
                className="text-muted-foreground hover:text-destructive"
              >
                ×
              </button>
            </span>
          );
        })
      )}

      {unbound.length > 0 ? (
        <>
          <select
            value={addressId}
            onChange={(event) => setAddressId(event.target.value)}
            className={inputClass}
          >
            {unbound.map((address) => (
              <option key={address.id} value={address.id}>
                {address.email}
              </option>
            ))}
          </select>
          <Button type="button" variant="outline" size="sm" onClick={bind}>
            Bind
          </Button>
        </>
      ) : null}

      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </div>
  );
}
