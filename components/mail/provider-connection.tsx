'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Icon } from '@/components/icon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiRequestError, apiRequest } from '@/lib/api-client';

interface ConnectResult {
  connected: boolean;
  verified: boolean;
  reason?: string;
}

/**
 * Connecting a workspace to its own mail provider.
 *
 * The token is write-only here, and that is not a UI nicety — there is no read
 * path for it anywhere in the product. The field shows whether one is stored,
 * never what it is, so this screen cannot become a way to recover a secret
 * from a borrowed laptop.
 *
 * Verification is reported separately from storage, because they fail for
 * different reasons and the operator can act on each: a token that saved but
 * did not verify is a typo or a revoked key, not a broken deployment.
 */
export function ProviderConnection({ connected }: { connected: boolean }) {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [result, setResult] = useState<ConnectResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [refreshing, startTransition] = useTransition();

  const pending = saving || refreshing;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setResult(null);

    try {
      const response = await apiRequest<{ data: ConnectResult }>(
        '/api/v1/provider-credentials',
        { method: 'PUT', body: JSON.stringify({ apiToken: token }) },
      );

      setResult(response.data);
      setToken('');

      if (response.data.verified) {
        toast('Provider connected.');
      } else {
        toast.error('Saved, but the provider rejected it.');
      }

      startTransition(() => router.refresh());
    } catch (caught) {
      const message =
        caught instanceof ApiRequestError
          ? caught.message
          : 'Something went wrong. Check the server logs.';
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="provider-connection">
      <p className="provider-connection__state" data-connected={connected ? '' : undefined}>
        <Icon name={connected ? 'verified' : 'pending'} size={14} />
        {connected
          ? 'A provider account is connected to this workspace.'
          : 'No provider is connected yet. Nothing can send or receive until one is.'}
      </p>

      <div className="provider-connection__row">
        <Input
          type="password"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder={connected ? 'Replace the stored token' : 'Paste your provider API token'}
          aria-label="Provider API token"
          autoComplete="off"
          required
          className="flex-1"
        />
        <Button type="submit" disabled={pending || token.trim().length === 0}>
          {pending ? 'Checking…' : connected ? 'Replace' : 'Connect'}
        </Button>
      </div>

      {result && !result.verified ? (
        <p className="provider-connection__warn">
          Stored, but the provider would not accept it
          {result.reason ? `: ${result.reason}` : '.'} The token is kept so you
          can correct it rather than retype it from scratch.
        </p>
      ) : null}

      {error ? <p className="provider-connection__warn">{error}</p> : null}

      <p className="provider-connection__note">
        Your account, your sending reputation, your quota. MailPiston stores the
        token encrypted and uses it only to manage your own domains — it is
        never shown again, here or anywhere else.
      </p>
    </form>
  );
}
