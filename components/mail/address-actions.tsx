'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Icon } from '@/components/icon';
import { Button } from '@/components/ui/button';
import { ApiRequestError, apiRequest } from '@/lib/api-client';

export interface DomainOption {
  id: string;
  name: string;
  hasCatchAll: boolean;
}

export function AddAddressForm({ domains }: { domains: DomainOption[] }) {
  const router = useRouter();
  const [domainId, setDomainId] = useState(domains[0]?.id ?? '');
  const [localPart, setLocalPart] = useState('');
  const [canSend, setCanSend] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selected = domains.find((domain) => domain.id === domainId);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);

    try {
      await apiRequest('/api/v1/addresses', {
        method: 'POST',
        body: JSON.stringify({ domainId, localPart, canSend, enabled: true }),
      });

      setLocalPart('');
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof ApiRequestError
          ? caught.message
          : 'Something went wrong. Check the server logs.',
      );
    } finally {
      setBusy(false);
    }
  }

  if (domains.length === 0) return null;

  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
      <input
        value={localPart}
        onChange={(event) => setLocalPart(event.target.value)}
        placeholder="support"
        required
        className="h-7 w-32 rounded-md border border-input bg-card px-2 text-xs outline-none focus-visible:border-ring"
      />

      <span className="text-xs text-muted-foreground">@</span>

      <select
        value={domainId}
        onChange={(event) => setDomainId(event.target.value)}
        className="h-7 rounded-md border border-input bg-card px-2 text-xs outline-none focus-visible:border-ring"
      >
        {domains.map((domain) => (
          <option key={domain.id} value={domain.id}>
            {domain.name}
          </option>
        ))}
      </select>

      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={canSend}
          onChange={(event) => setCanSend(event.target.checked)}
        />
        Can send
      </label>

      <Button type="submit" disabled={busy}>
        <Icon name="add" size={13} />
        Add address
      </Button>

      {/* Sending needs a concrete provider alias; an inbound-only address is
          purely local and only works behind a catch-all. */}
      {!canSend && selected && !selected.hasCatchAll ? (
        <p className="text-xs text-warning">
          {selected.name} has no catch-all, so an inbound-only address there
          would never receive mail.
        </p>
      ) : null}

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </form>
  );
}

export function DeleteAddressButton({ addressId }: { addressId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Delete address"
      disabled={busy}
      onClick={async () => {
        // Deleting removes the provider alias too, so it stops mail arriving.
        if (!window.confirm('Delete this address and its provider alias?')) return;

        setBusy(true);
        try {
          await apiRequest(`/api/v1/addresses/${addressId}`, { method: 'DELETE' });
          router.refresh();
        } finally {
          setBusy(false);
        }
      }}
    >
      <Icon name="delete" size={12} />
    </Button>
  );
}
