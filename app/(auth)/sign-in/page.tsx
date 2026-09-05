import { redirect } from 'next/navigation';

import { SignInButton } from '@/components/layout/sign-in-button';
import { getOperatorSession } from '@/server/core/auth';

export const metadata = { title: 'Sign in · MailPiston' };

/**
 * The whole authentication surface.
 *
 * There is no sign-up, no password reset, and no account recovery, because
 * there is exactly one operator and their identity is an allow-listed email on
 * a GitHub account. An account outside the allow-list never gets a row.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const session = await getOperatorSession();
  const { next, error } = await searchParams;

  if (session) redirect(next ?? '/overview');

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6">
        <h1 className="font-serif text-2xl tracking-tight">MailPiston</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Operator access only.
        </p>

        {error ? (
          <p className="mt-4 rounded-md border border-destructive/40 px-3 py-2 text-xs text-destructive">
            That account is not allow-listed for this deployment.
          </p>
        ) : null}

        <div className="mt-6">
          <SignInButton next={next ?? '/overview'} />
        </div>
      </div>
    </main>
  );
}
