import { NextResponse } from 'next/server';
import { z } from 'zod';

import { withApi } from '@/server/core/http';
import {
  hasTenantApiToken,
  markTenantTokenVerified,
  setTenantApiToken,
} from '@/server/core/tenancy/credentials';
import { mailProviderRegistry } from '@/server/providers/registry';

/**
 * Connecting a workspace to its own mail provider.
 *
 * This is the step that makes bring-your-own-provider real: until a tenant
 * stores a token, nothing in their workspace can reach a provider at all, and
 * every send or verify fails with a message telling them to come here.
 *
 * The token is never returned. `GET` answers only whether one exists, because
 * "is this connected?" is the entire question a settings screen needs and
 * handing the secret back would make every read path a way to leak it.
 */
export const GET = withApi(
  async ({ tenantId }) =>
    NextResponse.json({ data: { connected: await hasTenantApiToken(tenantId) } }),
  { endpoint: '/v1/provider-credentials' },
);

const connectSchema = z.object({
  apiToken: z.string().min(1, 'An API token is required'),
});

export const PUT = withApi<z.infer<typeof connectSchema>>(
  async ({ body, tenantId }) => {
    // Stored first, then proved. The provider client reads the token through
    // the credential store, so there is no way to test one that has not been
    // written — and a token that fails verification is still the operator's
    // best guess, worth keeping so they can see and correct it rather than
    // retyping it blind.
    await setTenantApiToken(tenantId, body.apiToken);

    try {
      // A cheap authenticated call. If the token is wrong, this is where it
      // says so — rather than on the first inbound message at 3am.
      const quota = await mailProviderRegistry.forTenant(tenantId).outboundQuota();
      await markTenantTokenVerified(tenantId);

      return NextResponse.json({ data: { connected: true, verified: true, quota } });
    } catch (error) {
      return NextResponse.json({
        data: {
          connected: true,
          verified: false,
          reason:
            error instanceof Error
              ? error.message
              : 'The provider rejected this token.',
        },
      });
    }
  },
  {
    endpoint: '/v1/provider-credentials',
    schema: connectSchema,
    audit: {
      action: 'provider_credentials.set',
      resourceType: 'tenant',
    },
  },
);
