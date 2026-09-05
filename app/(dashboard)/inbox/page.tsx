import { EmptyState, PageHeader } from '@/components/layout/page-shell';

export const metadata = { title: 'Inbox · MailPiston' };

export default function InboxPage() {
  return (
    <>
      <PageHeader title="Inbox" description="Every message received by a managed address." />
      <EmptyState
        icon="inbox"
        title="No messages yet"
        description="Inbound capture is not wired up. Once it is, a verified provider POST becomes exactly one durable record here."
        phase="Phase 4 (inbound email)"
      />
    </>
  );
}
