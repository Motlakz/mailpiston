import 'server-only';

import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';

import { env, isOperatorEmail } from '@/server/core/config';
import { db, schema } from '@/server/db/client';

/**
 * Single-operator authentication (roadmap §1.7.1, §5.5).
 *
 * GitHub OAuth only. There is no sign-up flow, no password reset, and no user
 * management UI — the allow-list in `ALLOWED_OPERATOR_EMAILS` is the entire
 * authorisation model, enforced in a `before` hook so a non-operator never gets
 * as far as having a row created for them.
 *
 * This is not tenancy. No mail table carries an owner column (roadmap §5.4).
 */
export const auth = betterAuth({
  baseURL: env.APP_URL,
  secret: env.BETTER_AUTH_SECRET,

  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
    },
  }),

  emailAndPassword: { enabled: false },

  socialProviders: {
    github: {
      clientId: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET,
    },
  },

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
