import { EmptyState, PageHeader } from '@/components/layout/page-shell';

export const metadata = { title: 'API Keys · MailPiston' };

export default function ApiKeysPage() {
  return (
    <>
      <PageHeader title="API Keys" description="Keys for the public /v1 API. Shown once at creation, stored only as a hash." />
      <EmptyState
        icon="apiKeys"
        title="No API keys yet"
        description="Keys are hashed with SHA-256 and looked up by hash, so a stolen database yields nothing usable."
        phase="Phase 7 (public API and SDK)"
      />
    </>
  );
}
