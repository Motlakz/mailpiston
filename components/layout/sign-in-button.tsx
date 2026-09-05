'use client';

import { useState } from 'react';

import { Icon } from '@/components/icon';
import { Button } from '@/components/ui/button';
import { authClient } from '@/lib/auth-client';

export function SignInButton({ next }: { next: string }) {
  const [busy, setBusy] = useState(false);

  return (
    <Button
      size="lg"
      className="w-full"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await authClient.signIn.social({
          provider: 'github',
          callbackURL: next,
          // A rejected (non-allow-listed) account lands back here with a flag
          // rather than on a raw provider error page.
          errorCallbackURL: '/sign-in?error=not_allowed',
        });
      }}
    >
      <Icon name="signIn" size={14} />
      {busy ? 'Redirecting…' : 'Continue with GitHub'}
    </Button>
  );
}
