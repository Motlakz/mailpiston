'use client';

import { useRouter } from 'next/navigation';

import { authClient } from '@/lib/auth-client';

/**
 * A button, not a link: sign-out is a state change, and a GET-able sign-out URL
 * can be triggered by any page that embeds it.
 */
export function SignOutButton() {
  const router = useRouter();

  return (
    <button
      type="button"
      className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      onClick={async () => {
        await authClient.signOut();
        router.push('/sign-in');
        router.refresh();
      }}
    >
      Sign out
    </button>
  );
}
