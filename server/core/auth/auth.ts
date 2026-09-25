import 'server-only';

import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';

import {
  env,
  isDevEmailLoginEnabled,
  isGithubLoginEnabled,
  isOperatorEmail,
} from '@/server/core/config';
import { provisionTenantForUser } from '@/server/core/tenancy/provision';
import { db, schema } from '@/server/db/client';

/**
 * Single-operator authentication (roadmap §1.7.1, §5.5).
 *
 * GitHub OAuth in production. There is no password reset and no user
 * management UI — the allow-list in `ALLOWED_OPERATOR_EMAILS` is the entire
 * authorisation model, enforced in a `before` hook so a non-operator never gets
 * as far as having a row created for them.
 *
 * Locally, `DEV_EMAIL_LOGIN=true` adds email and password so a checkout works
 * without registering an OAuth app. It rides on the *same* allow-list hook
 * rather than a parallel check: sign-up creates a row only for an address in
 * `ALLOWED_OPERATOR_EMAILS`, so the dev door is exactly as wide as the real
 * one. `server/core/config` refuses the flag in production.
 *
 * This is not tenancy. No mail table carries an owner column (roadmap §5.4).
 */
export const auth = betterAuth({
  baseURL: env.APP_URL,
  secret: env.BETTER_AUTH_SECRET,

  // Better Auth enables this automatically only in production. Keep local and
  // preview deployments honest too, and tighten every credential-creation
  // path beyond the general API ceiling.
  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    customRules: {
      '/sign-in/*': { window: 60, max: 5 },
      '/sign-up/*': { window: 60, max: 3 },
    },
  },

  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
    },
  }),

  emailAndPassword: {
    enabled: isDevEmailLoginEnabled(),
    // Nothing here can send mail — the mail pipeline is the product, not the
    // auth system — so a verification requirement would lock the door it just
    // opened. The allow-list is what makes the address trusted, not an inbox
    // round-trip.
    requireEmailVerification: false,
    minPasswordLength: 8,
  },

  // Omitted entirely when unconfigured: passing `undefined` credentials leaves
  // a provider that advertises itself and fails at the redirect.
  socialProviders: isGithubLoginEnabled()
    ? {
        github: {
          clientId: env.GITHUB_CLIENT_ID!,
          clientSecret: env.GITHUB_CLIENT_SECRET!,
        },
      }
    : {},

  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
  },

  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          if (!isOperatorEmail(user.email)) {
            // Returning false aborts creation, so the OAuth callback fails
            // rather than provisioning an account we would then have to police.
            return false;
          }
          return { data: user };
        },

        /**
         * Every account gets a workspace of its own, immediately.
         *
         * A session is refused without a membership, so skipping this would
         * let someone authenticate successfully and then be told they belong
         * to nothing. Doing it here rather than lazily on first page load
         * means the account is never in that half-made state.
         */
        after: async (user) => {
          await provisionTenantForUser({
            userId: user.id,
            email: user.email,
            name: user.name,
          });
        },
      },
    },
    session: {
      create: {
        before: async (session) => {
          // Belt and braces: an allow-list edit must revoke access on the next
          // sign-in even if a user row already exists from an earlier config.
          const user = await db.query.users.findFirst({
            where: (users, { eq }) => eq(users.id, session.userId),
          });

          if (!isOperatorEmail(user?.email)) {
            return false;
          }

          return { data: session };
        },
      },
    },
  },
});

export type Auth = typeof auth;
