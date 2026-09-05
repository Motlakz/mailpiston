/**
 * Test stub for the `server-only` package.
 *
 * The real module throws on import so that a server file pulled into a client
 * bundle fails loudly at build time. Under Vitest there is no client bundle and
 * no React Server Component, so the guard would only make every service
 * untestable. Aliased in `vitest.config.ts`, nowhere else.
 */
export {};
