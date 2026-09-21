'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Icon } from '@/components/icon';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog, useConfirm } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/status-badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ApiRequestError, apiRequest } from '@/lib/api-client';

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
  const { confirmProps, ask } = useConfirm();

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
      <form onSubmit={create} className="dashboard-inline-form flex flex-wrap items-center gap-2">
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Deploy script"
          aria-label="Key name"
          required
          className="w-56"
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
        <Card className="gap-0 overflow-hidden py-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-10 px-4">Name</TableHead>
                <TableHead className="h-10 px-4">Key</TableHead>
                <TableHead className="h-10 px-4">Created</TableHead>
                <TableHead className="h-10 px-4">Last used</TableHead>
                <TableHead className="h-10 px-4 text-right">State</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((key) => (
                <TableRow key={key.id}>
                  <TableCell className="px-4 py-3.5 text-sm font-medium">
                    {key.name}
                  </TableCell>
                  <TableCell className="px-4 py-3.5 font-mono text-muted-foreground">
                    {key.keyPrefix}…
                  </TableCell>
                  <TableCell className="px-4 py-3.5 text-muted-foreground tabular-nums">
                    {new Date(key.createdAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="px-4 py-3.5 text-muted-foreground tabular-nums">
                    {key.lastUsedAt
                      ? new Date(key.lastUsedAt).toLocaleString()
                      : 'never'}
                  </TableCell>
                  <TableCell className="px-4 py-3.5 text-right">
                    {key.revokedAt ? (
                      <StatusBadge status="disabled" label="revoked" />
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          ask({
                            title: `Revoke "${key.name}"?`,
                            description:
                              'Anything still using this key stops working immediately. Revoking cannot be undone — issue a new key instead.',
                            confirmLabel: 'Revoke key',
                            destructive: true,
                            onConfirm: () => revoke(key.id),
                          })
                        }
                        disabled={pending}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        Revoke
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <ConfirmDialog {...confirmProps} />
    </div>
  );
}
