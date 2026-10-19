import { readFileSync } from 'node:fs';
import { config } from 'dotenv';
import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import { migrate } from 'drizzle-orm/neon-serverless/migrator';
import ws from 'ws';

config({ path: '.env.local', quiet: true });
config({ path: '.env', quiet: true });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is not set');

const journal = JSON.parse(
  readFileSync(new URL('../server/db/migrations/meta/_journal.json', import.meta.url), 'utf8'),
);
const expected = journal.entries.length;
const target = new URL(connectionString);

neonConfig.webSocketConstructor = ws;
const pool = new Pool({ connectionString });

try {
  await migrate(drizzle({ client: pool }), {
    migrationsFolder: './server/db/migrations',
  });

  const { rows } = await pool.query(`
    select current_database() as database,
      exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name = 'mail_filter_entries'
          and column_name = 'source'
      ) as source_column,
      (select count(*)::int from drizzle.__drizzle_migrations) as applied_migrations
  `);
  const state = rows[0];

  console.log(
    JSON.stringify({
      target: target.host,
      database: state?.database,
      appliedMigrations: state?.applied_migrations,
      expectedMigrations: expected,
      sourceColumn: state?.source_column,
    }),
  );

  if (state?.applied_migrations < expected || !state?.source_column) {
    throw new Error('Migration verification failed: database schema is behind this build');
  }
} finally {
  await pool.end();
}
