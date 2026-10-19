'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Icon } from '@/components/icon';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { apiRequest, messageFor } from '@/lib/api-client';
import type { MailFilterEntry } from '@/server/core/types';

/**
 * The operator's standing decisions about senders (roadmap Phase 12).
 *
 * These are the escape hatch that makes an opinionated filter safe to ship. The
 * rule engine is deterministic and will be wrong about somebody eventually, and
 * when it is, the fix should be one line typed here rather than a code change.
 *
 * Both lists are global rather than per domain, because the person running
 * three apps has one opinion about an agency, not three.
 *
 * Automatic blocks are listed with everything else, badged, rather than in a
 * separate place: the operator should be able to see in one list everything
 * that is refused, whoever decided it.
 */
export function FilterLists({ entries }: { entries: MailFilterEntry[] }) {
  const allow = entries.filter((entry) => entry.kind === 'allow');
  const deny = entries.filter((entry) => entry.kind === 'deny');

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <FilterList
        kind="allow"
        title="Trusted senders"
        caption="Always reach your inbox, whatever the rules say, and are never blocked automatically. A trusted address gets through even if its domain is blocked."
        entries={allow}
      />
      <FilterList
        kind="deny"
        title="Blocked senders"
        caption="Refused on arrival: nothing is stored or delivered, and the attempt is logged as rejected. Remove an entry to let them back in."
        entries={deny}
      />
    </div>
  );
}

function FilterList({
  kind,
  title,
  caption,
  entries,
}: {
  kind: MailFilterEntry['kind'];
  title: string;
  caption: string;
  entries: MailFilterEntry[];
}) {
  const router = useRouter();
  const [pattern, setPattern] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function add(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    try {
      await apiRequest('/api/v1/mail-filters', {
        method: 'POST',
        body: JSON.stringify({
          kind,
          pattern,
          note: note.trim() || null,
        }),
      });

      setPattern('');
      setNote('');
      startTransition(() => router.refresh());
    } catch (caught) {
      setError(messageFor(caught));
    }
  }

  async function remove(id: string) {
    setError(null);

    try {
      await apiRequest(`/api/v1/mail-filters/${id}`, { method: 'DELETE' });
      startTransition(() => router.refresh());
    } catch (caught) {
      setError(messageFor(caught));
    }
  }

  return (
    <Card className="gap-0 py-0">
      <CardHeader className="border-b px-5 py-3.5">
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{caption}</p>
      </CardHeader>

      <form onSubmit={add} className="flex flex-wrap gap-2 border-b border-border px-5 py-3.5">
        <Input
          value={pattern}
          onChange={(event) => setPattern(event.target.value)}
          placeholder="name@example.com or example.com"
          aria-label="Address or domain"
          required
          className="min-w-0 flex-1 font-mono"
        />
        <Input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="why (optional)"
          aria-label="Note"
          className="w-32"
        />
        <Button type="submit" disabled={pending}>
          <Icon name="add" size={13} />
          Add
        </Button>
      </form>

      {error ? (
        <p className="px-5 pt-2 text-xs text-destructive">{error}</p>
      ) : null}

      {entries.length === 0 ? (
        <p className="px-5 py-4 text-xs text-muted-foreground">
          Nothing here yet. Add one here, or use Trust and Block on any message.
          A bare domain covers its subdomains.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="flex items-center gap-3 px-5 py-2"
            >
              <code className="min-w-0 flex-1 truncate font-mono text-xs">
                {entry.pattern}
              </code>
              {entry.source === 'auto' ? (
                <Badge variant="muted" className="shrink-0">Auto</Badge>
              ) : null}
              {entry.note ? (
                <span
                  className="max-w-[45%] shrink truncate text-xs text-muted-foreground"
                  title={entry.note}
                >
                  {entry.note.replace(/^Auto: /, '')}
                </span>
              ) : null}
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove ${entry.pattern}`}
                disabled={pending}
                onClick={() => remove(entry.id)}
              >
                <Icon name="delete" size={12} />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

