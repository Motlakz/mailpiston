'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { authClient } from '@/lib/auth-client';

/**
 * Local email-and-password sign-in. Rendered only when `DEV_EMAIL_LOGIN` is on,
 * which `server/core/config` refuses in production.
 *
 * It signs in, and creates the account first if there is not one yet. That
 * fallback is not a convenience so much as the only sensible shape: there is no
 * sign-up page to send anyone to, and the address has to be in
 * `ALLOWED_OPERATOR_EMAILS` for the row to be created at all — so "register"
 * and "sign in" collapse into the same button for the one person who can use
 * either.
 */
export function DevSignInForm({ next }: { next: string }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const credentials = { email: email.trim(), password };
    let result = await authClient.signIn.email(credentials);

    if (result.error) {
      // No account for this address yet. Create it — the allow-list hook
      // decides whether that is permitted — and sign in with the same values.
      const created = await authClient.signUp.email({
        ...credentials,
        name: credentials.email.split('@')[0] ?? 'Operator',
      });

      result = created.error
        ? result
        : await authClient.signIn.email(credentials);
    }

    if (result.error) {
      setError(
        result.error.message ??
          'Sign-in failed. Check the address is in ALLOWED_OPERATOR_EMAILS.',
      );
      setBusy(false);
      return;
    }

    router.push(next);
    router.refresh();
  }

  return (
    <form className="mt-5 flex flex-col gap-3" onSubmit={submit}>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="dev-email">Email</Label>
        <Input
          id="dev-email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="dev-password">Password</Label>
        <Input
          id="dev-password"
          type="password"
          autoComplete="current-password"
          required
          minLength={8}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="At least 8 characters"
        />
      </div>

      {error ? (
        <p className="rounded-md border border-destructive/40 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}

      <Button type="submit" variant="outline" className="w-full" disabled={busy}>
        {busy ? 'Signing in…' : 'Sign in with email'}
      </Button>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Local development only. The address must be listed in{' '}
        <code className="font-mono">ALLOWED_OPERATOR_EMAILS</code>; the account
        is created on first use.
      </p>
    </form>
  );
}
