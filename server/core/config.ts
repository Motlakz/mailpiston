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
  /**
   * The monthly send allowance advertised on the plan.
   *
   * Carried as configuration because the API reports the *daily* pair only.
   * Deriving a month from a day produces a confident number that is wrong, so
   * an unset value shows as unknown rather than as a guess.
   */
  FORWARD_EMAIL_MONTHLY_ALLOWANCE: z.coerce.number().int().positive().optional(),

  // --- Crypto ---------------------------------------------------------------
  /** 32-byte key, base64 or hex, for endpoint-secret encryption at rest. */
  SECRET_ENCRYPTION_KEY: z.string().min(32),

  // --- Storage --------------------------------------------------------------
  /**
   * All four together select the R2 driver. Absent, development falls back to
   * the filesystem driver and production refuses to start the first time
   * something needs to store bytes.
   */
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  /** Development-only object root. Git-ignored. */
  LOCAL_STORAGE_DIR: z.string().default('.mailpiston-storage'),
  /**
   * Raw MIME is the single best debugging artifact and it is large. Toggleable
   * from day one so the bill is a decision rather than a discovery.
   */
  STORE_RAW_MIME: booleanish.default(false),

  // --- Private reply relay (Phase 6) ---------------------------------------
  /**
   * Domain carrying opaque `reply+<token>@` addresses (roadmap §5.9). It must
   * be a domain whose DNS we control — a Vercel subdomain cannot publish MX —
   * but it is never customer-facing, so any owned domain works.
   */
  RELAY_DOMAIN: z
    .string()
    .transform((value) => value.toLowerCase())
    .optional(),
  /**
   * How long a relay address stays usable. Unbounded tokens are a standing
   * invitation: the address is public the moment a notification is delivered.
   */
  RELAY_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

  // --- Webhook endpoints (Phase 7) -----------------------------------------
  /**
   * How long a downstream endpoint has to answer the first attempt.
   *
   * Short on purpose: that attempt runs inside the provider's inbound request,
   * so a slow customer application must not push our own ingress towards the
   * platform timeout. Anything that misses it becomes a `pending` delivery and
   * is retried out of band.
   */
  WEBHOOK_TIMEOUT_MS: z.coerce.number().int().positive().default(8_000),
  /**
   * The replay window receivers are told to enforce, in seconds. Published by
   * the SDK and the docs from here so both halves of the contract agree on one
   * number.
   */
  WEBHOOK_REPLAY_WINDOW_SECONDS: z.coerce.number().int().positive().default(300),
  /**
   * Development escape hatch for `http://localhost` receivers.
   *
   * Off by default and refused in production: the SSRF guard exists to stop a
   * configured URL reaching the deployment's own network, and a flag that
   * disabled it in production would be the entire vulnerability.
   */
  WEBHOOK_ALLOW_INSECURE_TARGETS: booleanish.default(false),
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

  // The mock provider accepts any inbound webhook without a signature, because
  // it has no key to check one against. That is correct for development and a
  // wide-open ingress anywhere else, so it is refused outright rather than
  // documented as a footgun.
  if (
    parsed.data.MAIL_PROVIDER === 'mock' &&
    parsed.data.NODE_ENV === 'production'
  ) {
    throw new Error(
      'MAIL_PROVIDER=mock cannot be used in production: it accepts unsigned ' +
        'inbound webhooks. Set MAIL_PROVIDER=forward-email.',
    );
  }

  if (
    parsed.data.WEBHOOK_ALLOW_INSECURE_TARGETS &&
    parsed.data.NODE_ENV === 'production'
  ) {
    throw new Error(
      'WEBHOOK_ALLOW_INSECURE_TARGETS cannot be used in production: it lets a ' +
        'configured endpoint URL reach loopback and private addresses.',
    );
  }

  // The API token is optional in the schema so `mock` can run with no Forward
  // Email account, but it is mandatory once the real provider is selected.
  // The webhook key is only an optional fallback: per-domain keys live in the
  // database and the verifier safely rejects every request when no key exists.
  if (parsed.data.MAIL_PROVIDER === 'forward-email') {
    const missing = (['FORWARD_EMAIL_API_TOKEN'] as const).filter(
      (key) => !parsed.data[key],
    );

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

/**
 * Authenticated download URL for an attachment, as published in the webhook
 * payload (§13). Built from `APP_URL` for the same reason the ingress URL is:
 * the origin is a migration, not a runtime choice, and one builder means one
 * place to change.
 */
export function attachmentDownloadUrl(attachmentId: string): string {
  return new URL(
    `/api/v1/attachments/${attachmentId}/download`,
    env.APP_URL,
  ).toString();
}

/** The relay address a reply to this token should be sent to. */
export function relayAddressFor(token: string): string | null {
  return env.RELAY_DOMAIN ? `reply+${token}@${env.RELAY_DOMAIN}` : null;
}

/** Whether an inbound recipient belongs to the relay domain rather than a managed address. */
export function isRelayRecipient(recipient: string): boolean {
  if (!env.RELAY_DOMAIN) return false;
  return recipient.toLowerCase().endsWith(`@${env.RELAY_DOMAIN}`);
}

export function isOperatorEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return env.ALLOWED_OPERATOR_EMAILS.includes(email.toLowerCase());
}
