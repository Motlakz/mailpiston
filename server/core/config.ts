import 'server-only';
import { z } from 'zod';

/**
 * The single place `process.env` is read (roadmap Phase 1.1).
 *
 * Parsing happens once at module load and throws on a missing or malformed
 * variable, so a misconfigured deployment fails at boot rather than on the
 * first inbound email. Nothing else in the codebase may touch `process.env`;
 * the provider-boundary and env-access CI greps enforce that.
 */
const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((value) =>
    typeof value === 'boolean' ? value : ['1', 'true', 'yes', 'on'].includes(value.toLowerCase()),
  );

const csv = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean),
  );

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  /** Public origin of this deployment, used to build ingress and OAuth URLs. */
  APP_URL: z.url(),

  // --- Database -------------------------------------------------------------
  /** Neon connection string. Used by both the pooled and HTTP clients. */
  DATABASE_URL: z.string().min(1),

  // --- Auth (single operator) ----------------------------------------------
  BETTER_AUTH_SECRET: z.string().min(32),
  GITHUB_CLIENT_ID: z.string().min(1),
  GITHUB_CLIENT_SECRET: z.string().min(1),
  /** Comma-separated allow-list. Anyone outside it cannot hold a session. */
  ALLOWED_OPERATOR_EMAILS: csv.pipe(z.array(z.email()).min(1)),

  // --- Mail provider --------------------------------------------------------
  MAIL_PROVIDER: z.enum(['forward-email', 'mock']).default('forward-email'),
  FORWARD_EMAIL_API_TOKEN: z.string().min(1).optional(),
  FORWARD_EMAIL_API_URL: z.url().default('https://api.forwardemail.net'),
  /** Shared key Forward Email signs inbound webhook bodies with. */
  FORWARD_EMAIL_WEBHOOK_KEY: z.string().min(1).optional(),
  FORWARD_EMAIL_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),

  // --- Crypto ---------------------------------------------------------------
  /** 32-byte key, base64 or hex, for endpoint-secret encryption at rest. */
  SECRET_ENCRYPTION_KEY: z.string().min(32),

  // --- Storage (Phase 4; optional until then) -------------------------------
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  STORE_RAW_MIME: booleanish.default(false),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');

    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  // Provider credentials are optional in the schema so `mock` can run with no
  // Forward Email account at all, but they are mandatory once the real
  // provider is selected. Check that here rather than at the first API call.
  if (parsed.data.MAIL_PROVIDER === 'forward-email') {
    const missing = (
      ['FORWARD_EMAIL_API_TOKEN', 'FORWARD_EMAIL_WEBHOOK_KEY'] as const
    ).filter((key) => !parsed.data[key]);

    if (missing.length > 0) {
      throw new Error(
        `MAIL_PROVIDER=forward-email requires: ${missing.join(', ')}`,
      );
    }
  }

  return parsed.data;
}

export const env: Env = loadEnv();

/** Absolute URL of the provider ingress every alias points at. */
export function inboundIngressUrl(): string {
  return new URL('/api/providers/forward-email/inbound', env.APP_URL).toString();
}

export function isOperatorEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return env.ALLOWED_OPERATOR_EMAILS.includes(email.toLowerCase());
}
