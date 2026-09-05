'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Icon } from '@/components/icon';
import { Button } from '@/components/ui/button';
import { ApiRequestError, apiRequest } from '@/lib/api-client';

export function AddDomainForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [createCatchAll, setCreateCatchAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    try {
      await apiRequest('/api/v1/domains', {
        method: 'POST',
        body: JSON.stringify({ name, createCatchAll }),
      });

      setName('');
      setCreateCatchAll(false);
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
        placeholder="example.com"
        required
        className="h-7 rounded-md border border-input bg-card px-2 text-xs outline-none focus-visible:border-ring"
      />

      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={createCatchAll}
          onChange={(event) => setCreateCatchAll(event.target.checked)}
        />
        {/* Off by default: a catch-all means receiving mail for local parts
            that do not exist, which the inbound pipeline must then drop. */}
        Catch-all
      </label>

      <Button type="submit" disabled={pending}>
        <Icon name="add" size={13} />
        Add domain
      </Button>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </form>
  );
}

export function VerifyDomainButton({ domainId }: { domainId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function verify() {
    setBusy(true);
    setError(null);

    try {
      await apiRequest(`/api/v1/domains/${domainId}/verify`, { method: 'POST' });
      router.refresh();
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="flex items-center gap-2">
      <Button variant="outline" size="sm" onClick={verify} disabled={busy}>
        <Icon name="refresh" size={12} />
        {busy ? 'Checking…' : 'Verify'}
      </Button>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </span>
  );
}

export function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Copy value"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
    >
      <Icon name={copied ? 'verified' : 'copy'} size={12} />
    </Button>
  );
}

function messageFor(error: unknown): string {
  return error instanceof ApiRequestError
    ? error.message
    : 'Something went wrong. Check the server logs.';
}
