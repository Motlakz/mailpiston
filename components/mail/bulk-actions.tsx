'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Icon } from '@/components/icon';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, useConfirm } from '@/components/ui/confirm-dialog';
import { apiRequest } from '@/lib/api-client';
import { useOptimisticStore } from '@/lib/optimistic-store';

/**
 * Acting on many messages at once.
 *
 * There is no bulk route on the API, so this fans out one request per message
 * — deliberately, rather than adding an endpoint that takes a list of ids. A
 * bulk delete that half-succeeds has to report *which* half, and per-message
 * requests give that for free: each one either worked or did not, and the
 * failures are counted and named rather than collapsing into one 207.
 *
 * Concurrency is capped. Fifty parallel deletes against the provider is a way
 * to get rate-limited, and the operator gains nothing from it finishing in one
 * second instead of three.
 */
const CONCURRENCY = 5;

export function BulkActions({ binned = false }: { binned?: boolean }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [running, setRunning] = useState(false);
  const { confirmProps, ask } = useConfirm();

  const selected = useOptimisticStore((state) => Object.keys(state.selected));
  const applyEmail = useOptimisticStore((state) => state.applyEmail);
  const clearSelection = useOptimisticStore((state) => state.clearSelection);
  const clearAll = useOptimisticStore((state) => state.clearAll);

  if (selected.length === 0) return null;

  const count = selected.length;
  const noun = count === 1 ? 'message' : 'messages';

  async function runAll(
    ids: string[],
    call: (id: string) => Promise<unknown>,
  ): Promise<number> {
    let failed = 0;
    const queue = [...ids];

    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
        for (let id = queue.shift(); id; id = queue.shift()) {
          try {
            await call(id);
          } catch {
            failed += 1;
          }
        }
      }),
    );

    return failed;
  }

  async function bin() {
    setRunning(true);
    const ids = [...selected];
    for (const id of ids) applyEmail(id, { binned: true, gone: true });

    const failed = await runAll(ids, (id) =>
      apiRequest(`/api/v1/emails/${id}`, { method: 'DELETE' }),
    );

    finish(ids.length - failed, failed, 'Moved to the bin');
  }

  async function purge() {
    setRunning(true);
    const ids = [...selected];
    for (const id of ids) applyEmail(id, { gone: true });

    const failed = await runAll(ids, (id) =>
      apiRequest(`/api/v1/emails/${id}?purge=true`, { method: 'DELETE' }),
    );

    finish(ids.length - failed, failed, 'Deleted for good');
  }

  function finish(done: number, failed: number, verb: string) {
    setRunning(false);
    clearSelection();
    // Every overlay is about to be answered by the refreshed markup.
    clearAll();
    startTransition(() => router.refresh());

    if (failed > 0) {
      toast.error(
        `${verb}: ${done} of ${done + failed}. ${failed} could not be changed.`,
      );
    } else {
      toast(`${verb} — ${done} ${done === 1 ? 'message' : 'messages'}.`);
    }
  }

  return (
    <div className="bulk-actions" role="status">
      <span className="bulk-actions__count">
        {count} selected
      </span>

      {binned ? (
        <Button
          variant="destructive"
          size="sm"
          disabled={running}
          onClick={() =>
            ask({
              title: `Delete ${count} ${noun} permanently?`,
              description:
                'These messages and their attachments are removed for good. This cannot be undone.',
              confirmLabel: `Delete ${count} ${noun}`,
              destructive: true,
              onConfirm: purge,
            })
          }
        >
          <Icon name="delete" size={13} />
          {running ? 'Deleting…' : 'Delete forever'}
        </Button>
      ) : (
        // Reversible, and the bin is one click away — so no dialog, the way a
        // single bin has none either.
        <Button variant="outline" size="sm" disabled={running} onClick={bin}>
          <Icon name="delete" size={13} />
          {running ? 'Binning…' : `Bin ${count}`}
        </Button>
      )}

      <Button
        variant="ghost"
        size="sm"
        disabled={running}
        onClick={clearSelection}
      >
        Clear
      </Button>

      <ConfirmDialog {...confirmProps} />
    </div>
  );
}
