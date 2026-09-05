import { describe, expect, it } from 'vitest';

import {
  ConflictError,
  ExternalAPIError,
  RateLimitError,
  ValidationError,
  formatErrorResponse,
  statusCodeFor,
} from './index';

describe('formatErrorResponse', () => {
  it('renders an APIError with its code and status', () => {
    const error = new ConflictError('Domain already exists');

    expect(statusCodeFor(error)).toBe(409);
    expect(formatErrorResponse(error)).toEqual({
      error: { code: 'CONFLICT', message: 'Domain already exists' },
    });
  });

  it('includes resetAt on a rate-limit error', () => {
    const resetAt = Date.now() + 60_000;
    const body = formatErrorResponse(new RateLimitError(resetAt));

    expect(body.error.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(body.error.resetAt).toBe(resetAt);
  });

  it('includes the provider on an external API error', () => {
    const body = formatErrorResponse(
      new ExternalAPIError('upstream exploded', 'forward-email'),
    );

    expect(body.error.provider).toBe('forward-email');
  });

  it('includes validation details', () => {
    const body = formatErrorResponse(
      new ValidationError('bad body', [{ path: ['name'] }]),
    );

    expect(body.error.details).toEqual([{ path: ['name'] }]);
  });

  it('never leaks an unexpected error message to the client', () => {
    const body = formatErrorResponse(
      new Error('connection string postgres://user:hunter2@host/db failed'),
    );

    expect(statusCodeFor(new Error('x'))).toBe(500);
    expect(body).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    });
  });
});
