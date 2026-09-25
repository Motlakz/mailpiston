import { redirect } from 'next/navigation';

import { DevSignInForm } from '@/components/layout/dev-sign-in-form';
import { SignInButton } from '@/components/layout/sign-in-button';
import { getOperatorSession } from '@/server/core/auth';
import { isDevEmailLoginEnabled, isGithubLoginEnabled } from '@/server/core/config';
import { safeInternalRedirect } from '@/server/core/http/redirect';

export const metadata = { title: 'Sign in · MailPiston' };

/**
 * The whole authentication surface.
 *
 * There is no password reset and no account recovery, because there is exactly
 * one operator and their identity is an allow-listed email on a GitHub account.
 * An account outside the allow-list never gets a row.
 *
 * Locally, `DEV_EMAIL_LOGIN=true` adds a password form below the OAuth button
 * so a checkout works without registering an OAuth app. Both routes end at the
 * same allow-list.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const session = await getOperatorSession();
  const { next, error } = await searchParams;
  const githubEnabled = isGithubLoginEnabled();
  const devEmailEnabled = isDevEmailLoginEnabled();
  const destination = safeInternalRedirect(next);

  if (session) redirect(destination);

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

        {githubEnabled ? (
          <div className="mt-6">
            <SignInButton next={destination} />
          </div>
        ) : null}

        {devEmailEnabled ? (
          <>
            {githubEnabled ? (
              <div className="mt-6 flex items-center gap-3">
                <span className="h-px flex-1 bg-border" />
                <span className="text-[11px] tracking-wide text-muted-foreground uppercase">
                  or
                </span>
                <span className="h-px flex-1 bg-border" />
              </div>
            ) : null}

            <DevSignInForm next={destination} />
          </>
        ) : null}
      </div>
    </main>
  );
}
