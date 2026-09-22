'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Icon } from '@/components/icon';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, useConfirm } from '@/components/ui/confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { apiRequest, messageFor } from '@/lib/api-client';

export function DomainMenu({
  domainId,
  name,
  hasCatchAll,
}: {
  domainId: string;
  name: string;
  hasCatchAll: boolean;
}) {
  const router = useRouter();
  const { confirmProps, ask } = useConfirm();
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function call(path: string, method: 'POST' | 'DELETE') {
    setError(null);

    try {
      await apiRequest(path, { method });
      startTransition(() => router.refresh());
    } catch (caught) {
      setError(messageFor(caught));
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`More actions for ${name}`}
            />
          }
        >
          <Icon name="more" size={14} />
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-56">
          {hasCatchAll ? (
            <DropdownMenuItem
              onClick={() =>
                ask({
                  title: `Remove the catch-all on ${name}?`,
                  description:
                    'Mail to any local part without its own address will stop reaching MailPiston. Addresses that have their own alias keep working.',
                  confirmLabel: 'Remove catch-all',
                  destructive: true,
                  onConfirm: () =>
                    call(`/api/v1/domains/${domainId}/catch-all`, 'DELETE'),
                })
              }
            >
              <Icon name="inbox" size={13} />
              Remove catch-all
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              onClick={() =>
                ask({
                  title: `Add a catch-all to ${name}?`,
                  // The cost is real and not obvious, so it is stated before
                  // the button rather than discovered afterwards.
                  description:
                    'Every local part on this domain starts arriving here, including ones that do not exist. Mail for an unknown address is recorded and dropped, never bounced.',
                  confirmLabel: 'Add catch-all',
                  onConfirm: () =>
                    call(`/api/v1/domains/${domainId}/catch-all`, 'POST'),
                })
              }
            >
              <Icon name="inbox" size={13} />
              Add catch-all
            </DropdownMenuItem>
          )}

          <DropdownMenuSeparator />

          <DropdownMenuItem
            variant="destructive"
            onClick={() =>
              ask({
                title: `Delete ${name}?`,
                description:
                  'The domain is removed from MailPiston and from the provider, along with every alias on it, so all mail to this domain stops. Messages already received are kept.',
                confirmLabel: 'Delete domain',
                destructive: true,
                onConfirm: () => call(`/api/v1/domains/${domainId}`, 'DELETE'),
              })
            }
          >
            <Icon name="delete" size={13} />
            Delete domain
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {error ? <span className="text-xs text-destructive">{error}</span> : null}

      <ConfirmDialog {...confirmProps} />
    </>
  );
}
