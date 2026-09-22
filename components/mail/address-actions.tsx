'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Icon } from '@/components/icon';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog, useConfirm } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { keepWithin } from '@/lib/select-value';
import { apiRequest, messageFor } from '@/lib/api-client';

export interface DomainOption {
  id: string;
  name: string;
  hasCatchAll: boolean;
}

export function AddAddressForm({
  domains,
  defaultDomainId,
}: {
  domains: DomainOption[];
  /** The domain tab currently being viewed, when one is. */
  defaultDomainId?: string;
}) {
  const router = useRouter();
  // Only honour the default when it names a domain actually on offer: Base UI
  // prints the raw value when it cannot find it in `items`, so an unknown id
  // would render as itself in the trigger rather than as a domain name.
  const [domainId, setDomainId] = useState(() =>
    keepWithin(defaultDomainId ?? '', domains),
  );
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
      setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  if (domains.length === 0) return null;

  return (
    <form onSubmit={submit} className="dashboard-inline-form flex flex-wrap items-center gap-2">
      <Input
        value={localPart}
        onChange={(event) => setLocalPart(event.target.value)}
        placeholder="support"
        aria-label="Local part"
        required
        className="w-28"
      />

      <span className="text-xs text-muted-foreground">@</span>

      <Select
        // Without `items` the trigger shows the domain id rather than its name.
        items={domains.map((domain) => ({
          value: domain.id,
          label: domain.name,
        }))}
        value={domainId}
        onValueChange={(value) => setDomainId(String(value))}
      >
        <SelectTrigger className="w-44" aria-label="Domain">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {domains.map((domain) => (
            <SelectItem key={domain.id} value={domain.id}>
              {domain.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Label className="gap-1.5 text-xs font-normal text-muted-foreground">
        <Checkbox
          checked={canSend}
          onCheckedChange={(checked) => setCanSend(checked === true)}
        />
        Can send
      </Label>

      <Button type="submit" disabled={busy}>
        <Icon name="add" size={13} />
        {busy ? 'Adding…' : 'Add address'}
      </Button>

      {/* Sending needs a concrete provider alias; an inbound-only address is
          purely local and only works behind a catch-all. */}
      {!canSend && selected && !selected.hasCatchAll ? (
        <p className="w-full text-xs text-warning">
          {selected.name} has no catch-all, so an inbound-only address there
          would never receive mail.
        </p>
      ) : null}

      {error ? (
        <p className="w-full text-xs text-destructive">{error}</p>
      ) : null}
    </form>
  );
}

export function DeleteAddressButton({
  addressId,
  email,
}: {
  addressId: string;
  email: string;
}) {
  const router = useRouter();
  const { confirmProps, ask } = useConfirm();

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Delete ${email}`}
              className="text-muted-foreground hover:text-destructive"
              onClick={() =>
                ask({
                  title: `Delete ${email}?`,
                  // Naming the consequence rather than the operation: the row
                  // disappearing is the visible part, mail stopping is the part
                  // that matters and is easy not to think about.
                  description:
                    'This removes the provider alias as well, so mail sent to this address will stop arriving. Messages already received are kept.',
                  confirmLabel: 'Delete address',
                  destructive: true,
                  onConfirm: async () => {
                    await apiRequest(`/api/v1/addresses/${addressId}`, {
                      method: 'DELETE',
                    });
                    router.refresh();
                  },
                })
              }
            />
          }
        >
          <Icon name="delete" size={12} />
        </TooltipTrigger>
        <TooltipContent>Delete address</TooltipContent>
      </Tooltip>

      <ConfirmDialog {...confirmProps} />
    </>
  );
}

/**
 * Repoints this address's provider alias at the current ingress.
 *
 * The same action the drift banner offers, available where the address itself
 * is. Reconciliation only sweeps every six hours, so an operator who has just
 * moved `APP_URL` would otherwise have to wait for a banner to tell them what
 * they already know.
 */
export function RepairAliasButton({ addressId }: { addressId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="flex items-center gap-1">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Repoint provider alias at this deployment"
              disabled={busy}
              className="text-muted-foreground hover:text-foreground"
              onClick={async () => {
                setBusy(true);
                setError(null);

                try {
                  await apiRequest(`/api/v1/addresses/${addressId}/repair`, {
                    method: 'PUT',
                  });
                  router.refresh();
                } catch (caught) {
                  setError(messageFor(caught));
                } finally {
                  setBusy(false);
                }
              }}
            />
          }
        >
          <Icon name="refresh" size={12} />
        </TooltipTrigger>
        <TooltipContent>Repoint alias at this deployment</TooltipContent>
      </Tooltip>

      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </span>
  );
}

