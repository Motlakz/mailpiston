import 'server-only';

import { PayloadTooLargeError, ValidationError } from '@/server/core/errors';

/**
 * Reads an HTTP request body without trusting Content-Length.
 *
 * The header is an inexpensive early refusal, but it is only a claim made by
 * the caller. The stream counter is the actual security boundary and catches
 * chunked requests, omitted lengths, and deliberately false small lengths.
 */
export async function readBodyText(
  request: Request,
  limitBytes: number,
): Promise<string> {
  const declared = request.headers.get('content-length');

  if (declared !== null) {
    const length = Number(declared);
    if (Number.isFinite(length) && length > limitBytes) {
      throw new PayloadTooLargeError(limitBytes);
    }
  }

  if (!request.body) return '';

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      bytesRead += value.byteLength;
      if (bytesRead > limitBytes) {
        await reader.cancel().catch(() => undefined);
        throw new PayloadTooLargeError(limitBytes);
      }

      text += decoder.decode(value, { stream: true });
    }

    text += decoder.decode();
    return text;
  } finally {
    reader.releaseLock();
  }
}

export async function readJsonBody(
  request: Request,
  limitBytes: number,
): Promise<unknown> {
  const text = await readBodyText(request, limitBytes);

  try {
    return JSON.parse(text);
  } catch {
    throw new ValidationError('Request body is not valid JSON');
  }
}
