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

export interface ApiKeyRow {
  id: string;
  name: string;
  keyPrefix: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

/**
 * Keys for the public `/v1` API.
 *
 * The plaintext appears in the create response and nowhere else. Unlike an
 * endpoint signing secret, nothing on the server ever needs it again —
 * authentication is a lookup by SHA-256 — so it is hashed rather than
 * encrypted, and a stolen database yields nothing usable.
 */
export function ApiKeyManager({ keys }: { keys: ApiKeyRow[] }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [created, setCreated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    try {
      const key = await apiRequest<{ key: string }>('/api/v1/api-keys', {
        method: 'POST',
        body: JSON.stringify({ name, expiresAt: null }),
      });

      setName('');
      setCreated(key.key);
      startTransition(() => router.refresh());
    } catch (caught) {
      setError(messageFor(caught));
    }
  }

  async function revoke(id: string) {
    setError(null);

    try {
      await apiRequest(`/api/v1/api-keys/${id}`, { method: 'DELETE' });
      startTransition(() => router.refresh());
    } catch (caught) {
      setError(messageFor(caught));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={create} className="flex flex-wrap items-center gap-2">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Deploy script"
          required
          className={`${inputClass} w-56`}
        />
        <Button type="submit" disabled={pending}>
          <Icon name="add" size={13} />
          Create key
        </Button>
        {error ? <span className="text-xs text-destructive">{error}</span> : null}
      </form>

      {created ? (
        <div className="flex max-w-xl flex-col gap-1.5 rounded-lg border border-warning/40 bg-card px-4 py-3">
          <p className="text-xs text-warning">
            Copy this key now — it is not shown again, and it cannot be
            recovered.
          </p>
          <code className="rounded bg-muted px-2 py-1 font-mono text-[11px] break-all">
            {created}
          </code>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => navigator.clipboard.writeText(created)}
            >
              Copy
            </Button>
            <button
              type="button"
              onClick={() => setCreated(null)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Done
            </button>
          </div>
        </div>
      ) : null}

      {keys.length === 0 ? null : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-left text-xs">
            <thead className="text-muted-foreground">
              <tr className="border-b border-border">
                <th className="px-4 py-2 font-normal">Name</th>
                <th className="px-4 py-2 font-normal">Key</th>
                <th className="px-4 py-2 font-normal">Created</th>
                <th className="px-4 py-2 font-normal">Last used</th>
                <th className="px-4 py-2 font-normal" />
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => (
                <tr key={key.id} className="border-t border-border">
                  <td className="px-4 py-2">{key.name}</td>
                  <td className="px-4 py-2 font-mono">{key.keyPrefix}…</td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {new Date(key.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {key.lastUsedAt
                      ? new Date(key.lastUsedAt).toLocaleString()
                      : 'never'}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {key.revokedAt ? (
                      <span className="text-muted-foreground">revoked</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => revoke(key.id)}
                        disabled={pending}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
