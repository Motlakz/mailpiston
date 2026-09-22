#!/usr/bin/env node
/**
 * Read or change a workspace's monthly send limit.
 *
 * Deliberately a script and not a screen. The limit is the platform's decision
 * about a tenant, not the tenant's decision about themselves — a self-serve
 * "raise my own ceiling" button is not a ceiling. Until there is billing to
 * move it automatically, the honest shape is an operator running a command.
 *
 * Usage:
 *   node scripts/send-limit.mjs                     # list every workspace
 *   node scripts/send-limit.mjs <slug|id>           # show one
 *   node scripts/send-limit.mjs <slug|id> 5000      # set it
 *
 * Reads DATABASE_URL from the environment first and `.env.local` second, so
 *
 *   DATABASE_URL='<production url>' node scripts/send-limit.mjs acme 5000
 *
 * changes production without editing a file — the same rule `drizzle.config.ts`
 * follows, and for the same reason: anything that reads its target from a
 * checked-out file eventually runs against the wrong database.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { neon } from '@neondatabase/serverless';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  try {
    const file = readFileSync(join(root, '.env.local'), 'utf8');
    for (const line of file.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const eq = trimmed.indexOf('=');
      if (trimmed.slice(0, eq).trim() === 'DATABASE_URL') {
        return trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      }
    }
  } catch {
    // No .env.local. The error below says what to do about it.
  }

  return null;
}

const url = databaseUrl();

if (!url) {
  console.error(
    'DATABASE_URL is not set. Add it to .env.local, or pass it inline:\n' +
      "  DATABASE_URL='postgresql://…' node scripts/send-limit.mjs",
  );
  process.exit(1);
}

const sql = neon(url);
const [target, rawLimit] = process.argv.slice(2);

/** Usage this month, so a limit is set against what the workspace actually does. */
async function usedThisMonth(tenantId) {
  const [row] = await sql`
    select count(*)::int as used
    from emails
    where tenant_id = ${tenantId}
      and direction = 'outbound'
      and created_at >= date_trunc('month', now() at time zone 'utc')
  `;

  return row.used;
}

if (!target) {
  const rows = await sql`
    select t.id, t.slug, t.name, t.monthly_send_limit,
           (select count(*)::int from emails e
             where e.tenant_id = t.id
               and e.direction = 'outbound'
               and e.created_at >= date_trunc('month', now() at time zone 'utc')
           ) as used
    from tenants t
    order by t.created_at
  `;

  if (rows.length === 0) {
    console.log('No workspaces yet.');
    process.exit(0);
  }

  for (const row of rows) {
    console.log(
      `${row.slug.padEnd(24)} ${String(row.used).padStart(6)} / ${String(row.monthly_send_limit).padEnd(7)} ${row.id}  ${row.name}`,
    );
  }
  process.exit(0);
}

const [tenant] = await sql`
  select id, slug, name, monthly_send_limit
  from tenants
  where id = ${target} or slug = ${target}
  limit 1
`;

if (!tenant) {
  console.error(`No workspace matches "${target}". Run with no arguments to list them.`);
  process.exit(1);
}

const used = await usedThisMonth(tenant.id);

if (rawLimit === undefined) {
  console.log(`${tenant.name} (${tenant.slug})`);
  console.log(`  id     ${tenant.id}`);
  console.log(`  limit  ${tenant.monthly_send_limit} per month`);
  console.log(`  used   ${used} this month`);
  process.exit(0);
}

const limit = Number(rawLimit);

// A limit of zero is a valid decision — a suspended workspace — but a
// fractional or negative one is a typo, and applying it would be worse than
// refusing it.
if (!Number.isInteger(limit) || limit < 0) {
  console.error(`"${rawLimit}" is not a whole number of messages.`);
  process.exit(1);
}

if (limit < used) {
  console.warn(
    `Note: ${tenant.slug} has already sent ${used} this month, so a limit of ` +
      `${limit} stops further sending until the window rolls over.`,
  );
}

await sql`
  update tenants
  set monthly_send_limit = ${limit}, updated_at = now()
  where id = ${tenant.id}
`;

console.log(
  `${tenant.slug}: ${tenant.monthly_send_limit} → ${limit} messages per month (${used} used).`,
);
