/**
 * Environment for unit tests.
 *
 * `server/core/config.ts` parses at module load and throws on anything missing,
 * which is what we want in production and what needs satisfying here. These are
 * obvious fakes: the mock provider needs no credentials, and no test in this
 * suite opens a socket. NODE_ENV is left alone: Vitest already sets it, and
 * it is read-only in the Node type definitions.
 */
process.env.APP_URL ??= 'https://mailpiston.test';
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.BETTER_AUTH_SECRET ??= 'test-secret-that-is-at-least-32-chars-long';
process.env.GITHUB_CLIENT_ID ??= 'test-client-id';
process.env.GITHUB_CLIENT_SECRET ??= 'test-client-secret';
process.env.ALLOWED_OPERATOR_EMAILS ??= 'operator@mailpiston.test';
process.env.MAIL_PROVIDER ??= 'mock';
process.env.SECRET_ENCRYPTION_KEY ??= '0'.repeat(64);
