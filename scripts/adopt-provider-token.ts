/**
 * Move a provider token out of the environment and into a workspace.
 *
 * A one-time migration, not a second code path.
 *
 * Before tenancy there was one `FORWARD_EMAIL_API_TOKEN` for the whole
 * deployment. After it, credentials belong to a workspace and are stored
 * encrypted, because each tenant brings their own provider account. An install
 * that predates the change therefore has a perfectly good token in `.env.local`
 * that the application no longer looks at — and the first symptom is adding a
 * domain and being told to go to Settings.
 *
 * This moves the value across. It deliberately does not add a runtime fallback
 * to the environment: a fallback would mean two sources of truth forever, and
 * the one an operator forgot to remove would silently outrank the one they
 * meant to use.
 *
 * Run it once:
 *   bun --conditions react-server scripts/adopt-provider-token.ts default
 *
 * The condition is what lets a script import `server-only` modules — the
 * package maps it to an empty file, which is exactly what a Node process is
 * meant to get.
 */
import { eq } from 'drizzle-orm';

import { env } from '@/server/core/config';
import { setTenantApiToken } from '@/server/core/tenancy/credentials';
import { db } from '@/server/db/client';
import { tenants } from '@/server/db/schema';
import { mailProviderRegistry } from '@/server/providers/registry';

const target = process.argv[2] ?? 'default';

/**
 * Refuse under the mock provider.
 *
 * Credentials are stored per provider, so adopting one while `MAIL_PROVIDER` is
 * `mock` writes a row under "mock" — a provider that needs no credentials and
 * never reads them. The write succeeds, the verification passes against a fake,
 * and nothing about the real account has been proved. Better to say so than to
 * report a success that means nothing.
 */
if (env.MAIL_PROVIDER === 'mock') {
  console.error(
    'MAIL_PROVIDER is "mock", which needs no credentials — storing one would',
  );
  console.error(
    'prove nothing. Set MAIL_PROVIDER=forward-email and run this again.',
  );
  process.exit(1);
}

const token = env.FORWARD_EMAIL_API_TOKEN;

if (!token) {
  console.error(
    'FORWARD_EMAIL_API_TOKEN is not set, so there is nothing to adopt.\n' +
      'Paste the token into Settings → Mail provider instead.',
  );
  process.exit(1);
}

const [tenant] = await db
  .select({ id: tenants.id, name: tenants.name, slug: tenants.slug })
  .from(tenants)
  .where(eq(tenants.slug, target))
  .limit(1);

if (!tenant) {
  const all = await db.select({ slug: tenants.slug }).from(tenants);
  console.error(
    `No workspace with slug "${target}".` +
      (all.length ? ` Try one of: ${all.map((t) => t.slug).join(', ')}` : ''),
  );
  process.exit(1);
}

await setTenantApiToken(tenant.id, token);
console.log(`Stored the provider token for ${tenant.name} (${tenant.slug}).`);

// Prove it works rather than reporting success on a write. A token that saved
// but cannot call the provider is the failure this whole exercise is about.
try {
  const quota = await mailProviderRegistry.forTenant(tenant.id).outboundQuota();
  console.log('Verified against the provider. Outbound quota:', quota);
} catch (error) {
  console.error(
    '\nStored, but the provider rejected it:',
    error instanceof Error ? error.message : error,
  );
  console.error('Replace it in Settings → Mail provider.');
  process.exit(1);
}

process.exit(0);
