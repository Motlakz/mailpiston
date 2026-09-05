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
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
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
    );
  }

  return (parsed as { data: T }).data;
}
