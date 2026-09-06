'use client';

import { Popover } from '@base-ui/react/popover';
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
        Add or import
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

/**
 * The provider's reasons a check did not pass, behind a disclosure.
 *
 * They arrive as prose — "Domain is missing required DNS MX records of: …" —
 * and there can be several, so they belong in a panel the operator opens next
 * to the status rather than as inline text beside the button.
 */
export function VerificationIssues({ issues }: { issues: string[] }) {
  if (issues.length === 0) return null;

  return (
    <Popover.Root>
      <Popover.Trigger
        render={
          <button
            type="button"
            className="flex items-center gap-1 rounded-full border border-warning/40 px-2 py-0.5 text-[11px] text-warning outline-none hover:bg-warning/10 focus-visible:ring-2 focus-visible:ring-ring/30"
          />
        }
      >
        <Icon name="failed" size={11} />
        {issues.length} DNS {issues.length === 1 ? 'issue' : 'issues'}
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Positioner sideOffset={6} align="start">
          <Popover.Popup className="z-50 max-h-80 w-[min(28rem,calc(100vw-2rem))] overflow-y-auto rounded-lg border border-border bg-popover p-3 text-xs shadow-lg outline-none">
            <Popover.Title className="mb-2 font-medium">
              Waiting on DNS
            </Popover.Title>
            <ul className="flex flex-col gap-2">
              {issues.map((issue, index) => (
                <li
                  key={index}
                  className="border-t border-border pt-2 text-muted-foreground whitespace-pre-wrap first:border-t-0 first:pt-0"
                >
                  {issue}
                </li>
              ))}
            </ul>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
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

/**
 * Stores the per-domain inbound webhook key.
 *
 * Write-only by design. Forward Email issues one webhook key per domain, and
 * the plaintext is needed only on the server to recompute an HMAC — so there is
 * no route that reads it back and nothing here ever displays it. The only
 * thing the operator needs to see is whether one is stored.
 */
export function WebhookKeyForm({
  domainId,
  configured,
}: {
  domainId: string;
  configured: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    try {
      await apiRequest(`/api/v1/domains/${domainId}/webhook-key`, {
        method: 'PUT',
        body: JSON.stringify({ webhookKey: value }),
      });

      setValue('');
      startTransition(() => router.refresh());
    } catch (caught) {
      setError(messageFor(caught));
    }
  }

  async function clear() {
    setError(null);

    try {
      await apiRequest(`/api/v1/domains/${domainId}/webhook-key`, {
        method: 'DELETE',
      });
      startTransition(() => router.refresh());
    } catch (caught) {
      setError(messageFor(caught));
    }
  }

  return (
    <form onSubmit={save} className="flex flex-wrap items-center gap-2">
      <input
        type="password"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={configured ? 'Replace stored key' : 'Paste webhook key'}
        autoComplete="off"
        required
        className="h-7 w-56 rounded-md border border-input bg-card px-2 font-mono text-xs outline-none focus-visible:border-ring"
      />

      <Button type="submit" disabled={pending}>
        {configured ? 'Replace' : 'Save'}
      </Button>

      {configured ? (
        <button
          type="button"
          onClick={clear}
          disabled={pending}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Remove
        </button>
      ) : null}

      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </form>
  );
}
