import type { ReactNode } from 'react';

import { Breadcrumbs } from '@/components/layout/breadcrumbs';
import { PageTransition } from '@/components/layout/page-transition';
import { Sidebar } from '@/components/layout/sidebar';
import { SignOutButton } from '@/components/layout/sign-out-button';
import { ActivityBar } from '@/components/layout/activity-bar';
import { QueryProvider } from '@/components/layout/query-provider';
import { ThemeToggle } from '@/components/site/theme-toggle';
import { Toaster } from '@/components/ui/sonner';
import { Separator } from '@/components/ui/separator';
import { requireOperatorPage } from '@/server/core/auth';
import './dashboard.css';

/**
 * The authenticated shell.
 *
 * `proxy.ts` redirects anonymous requests here optimistically on a cookie, but
 * this is where authorisation actually happens: the allow-list is checked
 * against the live session on every render, so removing an operator takes
 * effect immediately rather than at session expiry.
 *
 * The header carries the breadcrumb trail. It used to hold only the operator's
 * email and a sign-out button, which meant the top of every page was a bar that
 * said nothing about where you were — and with detail pages two levels deep
 * that is the moment a trail earns its place.
 */
export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const operator = await requireOperatorPage();

  return (
    <QueryProvider>
      <div className="dashboard-shell flex min-h-screen bg-background text-foreground">
        <ActivityBar />
        <Sidebar />

      <div className="dashboard-workspace flex min-w-0 flex-1 flex-col">
        <header className="dashboard-topbar sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background/80 px-6 backdrop-blur-sm">
          <Breadcrumbs />

          <div className="ml-auto flex items-center gap-3">
            <span className="dashboard-health hidden items-center gap-2 text-[11px] text-muted-foreground lg:inline-flex">
              <i aria-hidden="true" /> Control plane online
            </span>
            <ThemeToggle />
            <Separator orientation="vertical" className="hidden h-4 sm:block" />
            <span className="hidden text-xs text-muted-foreground sm:inline">
              {operator.email}
            </span>
            <Separator orientation="vertical" className="hidden h-4 sm:block" />
            <SignOutButton />
          </div>
        </header>

        <main className="dashboard-content flex min-w-0 flex-1 flex-col px-6 py-6">
          <PageTransition>{children}</PageTransition>
        </main>
        </div>

        <Toaster />
      </div>
    </QueryProvider>
  );
}
