import { EmptyState, PageHeader } from '@/components/layout/page-shell';

export const metadata = { title: 'Endpoints · MailPiston' };

export default function EndpointsPage() {
  return (
    <>
      <PageHeader title="Endpoints" description="Where mail goes next: an HTTPS application, a verified mailbox, or a group of them." />
      <EmptyState
        icon="endpoints"
        title="No endpoints yet"
        description="An endpoint is the destination an address fans out to. Webhook secrets are encrypted at rest so deliveries can be signed."
        phase="Phase 6 and 7 (endpoints)"
      />
    </>
  );
}
