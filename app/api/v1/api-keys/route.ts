import { NextResponse } from 'next/server';

import { generateApiKey } from '@/server/core/auth/api-key';
import { withApi } from '@/server/core/http';
import {
  createApiKeySchema,
  type CreateApiKeyInput,
} from '@/server/core/validation';
import { repositories } from '@/server/repositories';

/**
 * Keys for the public `/v1` API (plan §24).
 *
 * `key` appears in the create response and nowhere else, ever. Unlike an
 * endpoint signing secret — which the server has to recover in order to sign —
 * nothing here needs the plaintext again: authentication is a lookup by
 * SHA-256, so a stolen database yields nothing usable.
 *
 * Creating a key requires an operator session or an existing key, which means
 * the first one has to be minted from the dashboard. That is the intended
 * bootstrap: GitHub OAuth behind an allow-list is a stronger front door than
 * any key-issuing endpoint we could leave open.
 */
export const GET = withApi(
  async () => NextResponse.json({ data: await repositories.apiKeys.list() }),
  { endpoint: '/v1/api-keys' },
);

export const POST = withApi<CreateApiKeyInput>(
  async ({ body }) => {
    const generated = generateApiKey();

    const key = await repositories.apiKeys.create({
      name: body.name,
      keyHash: generated.hash,
      keyPrefix: generated.prefix,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
    });

    return NextResponse.json(
      { data: { ...key, key: generated.plaintext } },
      { status: 201 },
    );
  },
  {
    endpoint: '/v1/api-keys',
    schema: createApiKeySchema,
    audit: { action: 'api_key.create', resourceType: 'api_key' },
  },
);
