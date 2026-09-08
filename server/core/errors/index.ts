/**
 * The structured API error hierarchy (execution plan §16), verbatim.
 *
 * Every error that may reach an HTTP boundary is an `APIError` carrying the
 * status code and stable machine-readable `code` the client sees. Anything
 * that is not an `APIError` is a bug and is reported as `INTERNAL_ERROR`
 * without leaking its message.
 */
export class APIError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 500,
    public readonly code = 'INTERNAL_ERROR',
  ) {
    super(message);
    this.name = 'APIError';
  }
}

export class ValidationError extends APIError {
  constructor(
    message: string,
    public readonly details?: unknown,
  ) {
    super(message, 400, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
  }
}

export class AuthError extends APIError {
  constructor(message = 'Unauthorized') {
    super(message, 401, 'AUTH_ERROR');
    this.name = 'AuthError';
  }
}

export class ForbiddenError extends APIError {
  constructor(message = 'Forbidden') {
    super(message, 403, 'FORBIDDEN');
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends APIError {
  constructor(message = 'Not found') {
    super(message, 404, 'NOT_FOUND');
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends APIError {
  constructor(message = 'Conflict') {
    super(message, 409, 'CONFLICT');
    this.name = 'ConflictError';
  }
}

export class RateLimitError extends APIError {
  constructor(public readonly resetAt: number) {
    super('Rate limit exceeded', 429, 'RATE_LIMIT_EXCEEDED');
    this.name = 'RateLimitError';
  }
}

export class ExternalAPIError extends APIError {
  constructor(
    message: string,
    public readonly provider: string,
  ) {
    super(message, 502, 'EXTERNAL_API_ERROR');
    this.name = 'ExternalAPIError';
  }
}

export class ProviderTimeoutError extends APIError {
  constructor(provider: string) {
    super(`${provider} timed out`, 504, 'PROVIDER_TIMEOUT');
    this.name = 'ProviderTimeoutError';
  }
}

/**
 * The resource existed and is deliberately gone (Phase 11 retention).
 *
 * A 404 would say "there is no such attachment", which is false and sends the
 * operator looking for a bug. 410 says the row is real and its bytes were
 * removed on purpose.
 */
export class GoneError extends APIError {
  constructor(message = 'No longer available') {
    super(message, 410, 'GONE');
    this.name = 'GoneError';
  }
}

export class WebhookVerificationError extends APIError {
  constructor(message = 'Webhook verification failed') {
    super(message, 401, 'WEBHOOK_VERIFICATION_FAILED');
    this.name = 'WebhookVerificationError';
  }
}

export interface ErrorResponseBody {
  error: {
    code: string;
    message: string;
    resetAt?: number;
    provider?: string;
    details?: unknown;
  };
}

export function formatErrorResponse(error: unknown): ErrorResponseBody {
  if (error instanceof APIError) {
    return {
      error: {
        code: error.code,
        message: error.message,

        ...(error instanceof RateLimitError && {
          resetAt: error.resetAt,
        }),

        ...(error instanceof ExternalAPIError && {
          provider: error.provider,
        }),

        ...(error instanceof ValidationError && {
          details: error.details,
        }),
      },
    };
  }

  console.error('Unexpected error:', error);

  return {
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    },
  };
}

export function statusCodeFor(error: unknown): number {
  return error instanceof APIError ? error.statusCode : 500;
}
