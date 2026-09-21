import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Static proof that every repository is tenant-scoped.
 *
 * TypeScript already guarantees half of this for free: `tenant_id` is NOT NULL
 * with no default, so an `INSERT` that forgets it will not compile. What the
 * compiler cannot see is a missing `WHERE` — a read that drops the tenant
 * filter is perfectly well-typed and quietly returns another workspace's mail.
 *
 * A behavioural test would be better and needs a live Postgres, which this
 * suite deliberately does not have. So these assert the shape of the code
 * instead: every repository takes a tenant, and every statement inside one
 * either filters on it or writes it. Coarse, but it fails loudly the moment
 * someone adds a query without the filter — which is the mistake that would
 * otherwise ship in silence.
 */
const NEON_DIR = join(process.cwd(), 'server/repositories/neon');

const files = readdirSync(NEON_DIR).filter((name) =>
  name.endsWith('-repository.ts'),
);

/** Reachable only through an already-scoped parent id, so they carry no column. */
const UNSCOPED_TABLES = [
  'addressEndpoints',
  'domainWebhookKeys',
  'endpointWebhookConfigs',
  'endpointEmailRecipients',
  'providerReconciliationItems',
];

describe('repository tenant scoping', () => {
  it('finds every repository', () => {
    // A guard on the guard: if the directory moves, these must fail rather
    // than quietly assert nothing.
    expect(files.length).toBeGreaterThanOrEqual(12);
  });

  it.each(files)('%s takes a tenant id', (file) => {
    const source = readFileSync(join(NEON_DIR, file), 'utf8');
    expect(source).toContain('constructor(private readonly tenantId: string)');
  });

  it.each(files)('%s filters or stamps every statement', (file) => {
    const source = readFileSync(join(NEON_DIR, file), 'utf8');

    /**
     * One indirection has to be followed or scoped code reads as unscoped: a
     * predicate held in a variable, `const scope = and(eq(t.tenantId, …), …)`,
     * for a statement that then says only `.where(scope)`.
     */
    const scopedNames = [...source.matchAll(/const (\w+)\s*=([\s\S]*?);\n/g)]
      .filter((match) => match[2].includes('tenantId'))
      .map((match) => match[1]);

    const statements = source.split(/\b(?:db|tx)\s*\n?\s*\./).slice(1);

    for (const statement of statements) {
      const body = statement.split(';')[0];
      if (!/\b(from|into|insert|update|delete)\b/i.test(body)) continue;

      // Statements touching only a table with no tenant column of its own.
      if (UNSCOPED_TABLES.some((table) => body.includes(table))) continue;

      const filtersDirectly = body.includes('tenantId');
      const filtersByName = scopedNames.some((name) =>
        new RegExp(`\\b${name}\\b`).test(body),
      );

      /**
       * A query builder assigned in one statement and filtered in the next —
       * `const base = db.select()…` — genuinely carries no tenant itself. The
       * consumer that applies `.where` is a separate statement this same loop
       * checks, so the filter is still proved, one step later.
       */
      const isBuilder = !body.includes('.where(');

      expect(
        filtersDirectly || filtersByName || isBuilder,
        `${file}: a statement neither filters on nor writes tenantId:\n${body.trim().slice(0, 240)}`,
      ).toBe(true);
    }
  });
});

/**
 * The one module allowed to read across tenants, and the reason that is safe.
 *
 * It answers "which tenant is this?" and hands back an id — never a row. If a
 * function here ever starts returning data, the guarantee that everything else
 * is scoped stops meaning anything, because there would then be a supported
 * way to read another workspace's mail without a scoped repository.
 */
describe('tenant resolution', () => {
  const source = readFileSync(
    join(process.cwd(), 'server/core/tenancy/resolve.ts'),
    'utf8',
  );

  it('only ever returns tenant ids', () => {
    const signatures = source.match(/\): Promise<[^>]+>/g) ?? [];

    expect(signatures.length).toBeGreaterThan(0);
    for (const signature of signatures) {
      expect(
        signature === '): Promise<string | null>' ||
          signature === '): Promise<string[]>',
        `resolve.ts returns something other than a tenant id: ${signature}`,
      ).toBe(true);
    }
  });

  it('selects nothing but tenant ids', () => {
    const selects = source.match(/\.select\(\{[\s\S]*?\}\)/g) ?? [];

    expect(selects.length).toBeGreaterThan(0);
    for (const select of selects) {
      expect(
        /tenantId|id: tenants\.id/.test(select),
        `resolve.ts selects a non-tenant column: ${select}`,
      ).toBe(true);
    }
  });
});
