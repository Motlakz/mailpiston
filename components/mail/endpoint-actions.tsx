'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Icon } from '@/components/icon';
import { Button } from '@/components/ui/button';
import { ApiRequestError, apiRequest } from '@/lib/api-client';

const inputClass =
  'h-7 rounded-md border border-input bg-card px-2 text-xs outline-none focus-visible:border-ring';

function messageFor(error: unknown): string {
  return error instanceof ApiRequestError
    ? error.message
    : 'Something went wrong. Check the server logs.';
}

export function AddEndpointForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [type, setType] = useState<'email' | 'email_group'>('email');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    try {
      await apiRequest('/api/v1/endpoints', {
        method: 'POST',
        body: JSON.stringify({ name, type }),
      });

      setName('');
      startTransition(() => router.refresh());
    } catch (caught) {
      setError(messageFor(caught));
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
      <input
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="My inbox"
        required
        className={inputClass}
      />

      <select
        value={type}
        onChange={(event) =>
          setType(event.target.value as 'email' | 'email_group')
        }
        className={inputClass}
      >
        <option value="email">email (one mailbox)</option>
        <option value="email_group">email_group (several)</option>
      </select>

      <Button type="submit" disabled={pending}>
        <Icon name="add" size={13} />
        Add endpoint
      </Button>

      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </form>
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
