import { EmptyState, PageHeader } from '@/components/layout/page-shell';
import { ApiKeyManager } from '@/components/mail/api-key-actions';
import { repositories } from '@/server/repositories';

export const metadata = { title: 'API Keys · MailPiston' };

/**
 * The first key has to be minted here rather than over the API, and that is the
 * intended bootstrap: GitHub OAuth behind an allow-list is a stronger front
 * door than any key-issuing endpoint we could leave open.
 */
export default async function ApiKeysPage() {
  const keys = (await repositories.apiKeys.list()).map((key) => ({
    id: key.id,
    name: key.name,
    keyPrefix: key.keyPrefix,
    lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
    expiresAt: key.expiresAt?.toISOString() ?? null,
    revokedAt: key.revokedAt?.toISOString() ?? null,
    createdAt: key.createdAt.toISOString(),
  }));

  return (
    <>
      <PageHeader
        title="API Keys"
        description="Keys for the public /v1 API. Shown once at creation, stored only as a hash."
      />

      <div className="mt-4">
        <ApiKeyManager keys={keys} />
      </div>

      {keys.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            icon="apiKeys"
            title="No API keys yet"
            description="Keys are hashed with SHA-256 and looked up by hash, so a stolen database yields nothing usable. Revoking one takes effect on the next request."
          />
        </div>
      ) : null}
    </>
  );
}
