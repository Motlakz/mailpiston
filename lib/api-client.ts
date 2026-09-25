/**
 * Browser-side client for the same `/v1` API the SDK will use.
 *
 * The dashboard deliberately does not get a private back door: it authenticates
 * with the operator session cookie and otherwise hits exactly the routes a
 * third-party integration would, so a bug in the public API surfaces in our own
 * UI first.
 */
export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    /**
     * The field-level issues behind a 400.
     *
     * `formatErrorResponse` attaches these for a `ValidationError` and nothing
     * else, so a validation failure is the one case where the server can say
     * which field is wrong and why. Dropping them left every 400 in the
     * dashboard reading "Request body failed validation", which names neither.
     */
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

interface FieldIssue {
  path?: unknown;
  message?: unknown;
}

function isFieldIssue(value: unknown): value is FieldIssue {
  return typeof value === 'object' && value !== null && 'message' in value;
}

/**
 * The most specific message an error carries.
 *
 * Zod's envelope ("Request body failed validation") describes the category;
 * the issue underneath it describes the mistake. Only the second is worth
 * showing someone who has just typed something into a form.
 *
 * The field name is prefixed only when a form has more than one input, because
 * on a single-field form it says nothing the label has not already said.
 */
export function messageFor(
  error: unknown,
  options: { withField?: boolean } = {},
): string {
  if (!(error instanceof ApiRequestError)) {
    return 'Something went wrong. Check the server logs.';
  }

  const issues = Array.isArray(error.details)
    ? error.details.filter(isFieldIssue)
    : [];

  if (issues.length === 0) return error.message;

  return issues
    .map((issue) => {
      const message = String(issue.message ?? '').trim();
      const field = Array.isArray(issue.path) ? issue.path.join('.') : '';

      return options.withField && field ? `${field}: ${message}` : message;
    })
    .filter(Boolean)
    .join('; ');
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });

  const text = await response.text();
  const parsed: unknown = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const body = parsed as ApiErrorBody | null;

    throw new ApiRequestError(
      body?.error?.message ?? `Request failed with ${response.status}`,
      body?.error?.code ?? 'UNKNOWN',
      response.status,
      body?.error?.details,
    );
  }

  return (parsed as { data: T }).data;
}

/** Use when pagination metadata sits beside `data` in the response envelope. */
export async function apiEnvelope<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  const text = await response.text();
  const parsed: unknown = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const body = parsed as ApiErrorBody | null;
    throw new ApiRequestError(
      body?.error?.message ?? `Request failed with ${response.status}`,
      body?.error?.code ?? 'UNKNOWN',
      response.status,
      body?.error?.details,
    );
  }

  return parsed as T;
}
