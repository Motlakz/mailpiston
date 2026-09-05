import type { ReactNode } from 'react';

import { Sidebar } from '@/components/layout/sidebar';
import { SignOutButton } from '@/components/layout/sign-out-button';
import { requireOperatorPage } from '@/server/core/auth';

/**
 * The authenticated shell.
 *
 * `proxy.ts` redirects anonymous requests here optimistically on a cookie, but
 * this is where authorisation actually happens: the allow-list is checked
 * against the live session on every render, so removing an operator takes
 * effect immediately rather than at session expiry.
 */
export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const operator = await requireOperatorPage();

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center justify-end gap-3 border-b border-border px-6">
          <span className="text-xs text-muted-foreground">{operator.email}</span>
          <SignOutButton />
        </header>

        <main className="flex min-w-0 flex-1 flex-col gap-6 px-6 py-6">
          {children}
        </main>
      </div>
    </div>
  );
}
