'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Icon } from '@/components/icon';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { StatusBadge } from '@/components/ui/status-badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Dialog } from '@/components/ui/dialog';
import { keepWithin } from '@/lib/select-value';
import { apiRequest, messageFor } from '@/lib/api-client';

type EndpointType = 'email' | 'email_group' | 'webhook';

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
          <form onSubmit={submit} className="flex flex-col gap-3.5">
            <Field>
              <FieldLabel htmlFor="endpoint-name">Name</FieldLabel>
              <Input
                id="endpoint-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="My inbox"
                required
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="endpoint-type">Type</FieldLabel>
              <Select
                value={type}
                onValueChange={(value) => setType(value as EndpointType)}
              >
                <SelectTrigger id="endpoint-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="email">email</SelectItem>
                  <SelectItem value="email_group">email_group</SelectItem>
                  <SelectItem value="webhook">webhook</SelectItem>
                </SelectContent>
              </Select>
              <FieldDescription>{TYPE_HELP[type]}</FieldDescription>
            </Field>

            {type === 'webhook' ? (
              <Field>
                <FieldLabel htmlFor="endpoint-url">URL</FieldLabel>
                <Input
                  id="endpoint-url"
                  type="url"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="https://app.example/api/mail"
                  required
                  className="font-mono"
                />
                <FieldDescription>
                  HTTPS only, and never an address inside this deployment&apos;s
                  own network — checked again before every delivery.
                </FieldDescription>
              </Field>
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
  type,
  recipients,
  addresses,
}: {
  endpointId: string;
  type: EndpointType;
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

  /**
   * Widens the endpoint so it can hold more than one mailbox.
   *
   * An `email` endpoint created with one recipient was otherwise a dead end:
   * a second is refused, and the only escape was deleting the endpoint, which
   * means verifying the mailbox again and re-binding every address.
   */
  async function convertToGroup() {
    setError(null);

    try {
      await apiRequest(`/api/v1/endpoints/${endpointId}`, {
        method: 'PATCH',
        body: JSON.stringify({ type: 'email_group' }),
      });
      startTransition(() => router.refresh());
    } catch (caught) {
      setError(messageFor(caught));
    }
  }

  const atCapacity = type === 'email' && recipients.length >= 1;

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

      {atCapacity ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">
            This endpoint holds one mailbox.
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={convertToGroup}
            disabled={pending}
          >
            Convert to group
          </Button>
          {error ? <span className="text-xs text-destructive">{error}</span> : null}
        </div>
      ) : (
        <form onSubmit={add} className="flex flex-wrap items-center gap-2">
          <Input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@personal.example"
            aria-label="Recipient email"
            required
            className="w-56"
          />
          <Button type="submit" variant="outline" size="sm" disabled={pending}>
            Add recipient
          </Button>
          {error ? <span className="text-xs text-destructive">{error}</span> : null}
        </form>
      )}
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
      <StatusBadge status="pending" label="unverified" />

      {challengeSent ? (
        <form onSubmit={confirm} className="flex items-center gap-2">
          <Input
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="Code from the email"
            aria-label="Verification code"
            required
            className="w-44 font-mono"
          />
          <Button type="submit" size="sm" disabled={pending}>
            Confirm
          </Button>
        </form>
      ) : (
        <>
          <Select
            items={addresses.map((address) => ({
              value: address.id,
              label: `from ${address.email}`,
            }))}
            value={addressId}
            onValueChange={(value) => setAddressId(String(value))}
          >
            <SelectTrigger aria-label="Send the challenge from" className="w-auto min-w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {addresses.map((address) => (
                <SelectItem key={address.id} value={address.id}>
                  from {address.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
      <form onSubmit={save} className="flex flex-wrap items-center gap-2">
        <Input
          type="url"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          aria-label="Webhook URL"
          required
          className="w-80 font-mono"
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
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="h-8 ps-0">When</TableHead>
            <TableHead className="h-8">Status</TableHead>
            <TableHead className="h-8">Code</TableHead>
            <TableHead className="h-8">Attempts</TableHead>
            <TableHead className="h-8">Last error</TableHead>
            <TableHead className="h-8 text-right">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {deliveries.map((delivery) => (
            <TableRow key={delivery.id}>
              <TableCell className="py-2.5 ps-0 align-top whitespace-nowrap text-muted-foreground tabular-nums">
                {new Date(delivery.createdAt).toLocaleString()}
              </TableCell>
              <TableCell className="py-2.5 align-top">
                <StatusBadge status={delivery.status} />
              </TableCell>
              <TableCell className="py-2.5 align-top font-mono tabular-nums">
                {delivery.responseCode ?? '—'}
              </TableCell>
              <TableCell className="py-2.5 align-top font-mono tabular-nums">
                {delivery.attempt}
              </TableCell>
              <TableCell className="max-w-md py-2.5 align-top break-all text-muted-foreground">
                {delivery.lastError ?? '—'}
              </TableCell>
              <TableCell className="py-2.5 text-right align-top">
                {delivery.status === 'delivered' ? null : (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => retry(delivery.id)}
                    disabled={pending}
                  >
                    Retry
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

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

  /**
   * The value has to be a member of the list it is chosen from.
   *
   * Base UI resolves the trigger label by looking the value up in `items`
   * and prints the raw value when it is missing — so a selection that has
   * since been bound, or an initial pick taken from the full list, renders
   * as a bare id. Falling back to the first still-available address keeps
   * the two in step as the list shrinks.
   */
  const selectedId = keepWithin(addressId, unbound);

  async function bind() {
    if (!selectedId) return;
    setError(null);

    try {
      await apiRequest(`/api/v1/addresses/${selectedId}/endpoints`, {
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
    <div className="endpoint-source-picker">
      {bound.length === 0 ? (
        <p className="endpoint-source-picker__empty">
          Not bound to any address yet.
        </p>
      ) : (
        <div className="endpoint-source-list" role="list">
          {bound.map((id) => {
            const address = addresses.find((candidate) => candidate.id === id);
            return (
              <div key={id} className="endpoint-source-row" role="listitem">
                <span className="endpoint-source-row__mark" aria-hidden />
                <code>{address?.email ?? id}</code>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => unbind(id)}
                  disabled={pending}
                  aria-label={`Unbind ${address?.email ?? id}`}
                  title="Unbind address"
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Icon name="close" size={11} />
                </Button>
              </div>
            );
          })}
        </div>
      )}

      {unbound.length > 0 ? (
        <div className="endpoint-source-add">
          <Select
            items={unbound.map((address) => ({
              value: address.id,
              label: address.email,
            }))}
            value={selectedId}
            onValueChange={(value) => setAddressId(String(value))}
          >
            <SelectTrigger aria-label="Address to bind" className="min-w-0 flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {unbound.map((address) => (
                <SelectItem key={address.id} value={address.id}>
                  {address.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={bind}
            disabled={pending || !selectedId}
          >
            Bind
          </Button>
        </div>
      ) : null}

      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </div>
  );
}

/** Manage one address's fan-out without leaving the Addresses screen. */
export function AddressEndpointBindings({
  addressId,
  bound,
  endpoints,
}: {
  addressId: string;
  bound: string[];
  endpoints: Array<{ id: string; name: string; type: EndpointType; enabled: boolean }>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [endpointId, setEndpointId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const unbound = endpoints.filter((endpoint) => !bound.includes(endpoint.id));
  const selectedId = keepWithin(endpointId, unbound);

  async function bind() {
    if (!selectedId) return;
    setError(null);
    try {
      await apiRequest(`/api/v1/addresses/${addressId}/endpoints`, {
        method: 'POST',
        body: JSON.stringify({ endpointId: selectedId }),
      });
      startTransition(() => router.refresh());
    } catch (caught) {
      setError(messageFor(caught));
    }
  }

  async function unbind(id: string) {
    setError(null);
    try {
      await apiRequest(`/api/v1/addresses/${addressId}/endpoints/${id}`, {
        method: 'DELETE',
      });
      startTransition(() => router.refresh());
    } catch (caught) {
      setError(messageFor(caught));
    }
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        {bound.length === 0 ? 'Add route' : `${bound.length} route${bound.length === 1 ? '' : 's'}`}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Address destinations"
        description="Choose where mail captured for this address is delivered."
      >
        <div className="flex flex-col gap-3">
          {bound.length === 0 ? (
            <p className="text-xs text-muted-foreground">No endpoint is bound yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {bound.map((id) => {
                const endpoint = endpoints.find((candidate) => candidate.id === id);
                return (
                  <div key={id} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
                    <span className="min-w-0">
                      <strong className="block truncate text-sm">{endpoint?.name ?? id}</strong>
                      <small className="text-muted-foreground">{endpoint?.type ?? 'endpoint'}</small>
                    </span>
                    <Button variant="ghost" size="sm" disabled={pending} onClick={() => unbind(id)}>
                      Unbind
                    </Button>
                  </div>
                );
              })}
            </div>
          )}

          {unbound.length > 0 ? (
            <div className="flex items-center gap-2 border-t border-border pt-3">
              <Select
                items={unbound.map((endpoint) => ({ value: endpoint.id, label: endpoint.name }))}
                value={selectedId}
                onValueChange={(value) => setEndpointId(String(value))}
              >
                <SelectTrigger className="min-w-52 flex-1" aria-label="Endpoint to bind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {unbound.map((endpoint) => (
                    <SelectItem key={endpoint.id} value={endpoint.id}>
                      {endpoint.name} · {endpoint.type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button disabled={pending || !selectedId} onClick={bind}>Bind</Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Every endpoint is already bound.</p>
          )}

          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>
      </Dialog>
    </>
  );
}
