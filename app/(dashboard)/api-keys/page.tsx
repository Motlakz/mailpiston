import { EmptyState, PageHeader } from '@/components/layout/page-shell';
import {
  numberedPageLinks,
  pageNumber,
  TablePagination,
} from '@/components/layout/pagination';
import { ApiKeyManager } from '@/components/mail/api-key-actions';
import { repositoriesFor } from '@/server/repositories';
import { requireOperatorPage } from '@/server/core/auth';

export const metadata = { title: 'API Keys · MailPiston' };

/**
 * The first key has to be minted here rather than over the API, and that is the
 * intended bootstrap: GitHub OAuth behind an allow-list is a stronger front
 * door than any key-issuing endpoint we could leave open.
 */
const PAGE_SIZE = 10;

export default async function ApiKeysPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { tenantId } = await requireOperatorPage();
  const params = await searchParams;
  const repositories = repositoriesFor(tenantId);
  const keys = (await repositories.apiKeys.list()).map((key) => ({
    id: key.id,
    name: key.name,
    keyPrefix: key.keyPrefix,
    lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
    expiresAt: key.expiresAt?.toISOString() ?? null,
    revokedAt: key.revokedAt?.toISOString() ?? null,
    createdAt: key.createdAt.toISOString(),
  }));
  const totalPages = Math.max(1, Math.ceil(keys.length / PAGE_SIZE));
  const currentPage = Math.min(pageNumber(params.page), totalPages);
  const visibleKeys = keys.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );
  const pagination = numberedPageLinks({
    pathname: '/api-keys',
    params,
    page: currentPage,
    totalPages,
  });

  return (
    <>
      <PageHeader
        title="API Keys"
        description="Keys for the public /v1 API. Shown once at creation, stored only as a hash."
      />

      <div className="mt-4">
        <ApiKeyManager keys={visibleKeys} />
        <TablePagination
          page={currentPage}
          itemCount={visibleKeys.length}
          noun="key"
          previousHref={pagination.previousHref}
          nextHref={pagination.nextHref}
        />
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
