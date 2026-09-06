import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

/**
 * `dotenv/config` reads `.env` and nothing else, but this project's local
 * variables live in `.env.local` — the file Next.js loads and the one
 * `.gitignore` is written around. Loading it explicitly is what makes
 * `bun run db:migrate` work without exporting DATABASE_URL by hand.
 *
 * Neither call overrides a variable already in the environment, so
 *
 *   DATABASE_URL='<production url>' bun run db:migrate
 *
 * still migrates production without editing a file — which is how a production
 * migration should be run, since anything that reads the target from a
 * checked-out file eventually runs against the wrong database.
 */
config({ path: '.env.local' });
config({ path: '.env' });

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. Add it to .env.local, or pass it inline:\n' +
      "  DATABASE_URL='postgresql://…' bun run db:migrate",
  );
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './server/db/schema/index.ts',
  out: './server/db/migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  strict: true,
  verbose: true,
});
