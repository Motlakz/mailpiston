import { EmptyState, PageHeader } from '@/components/layout/page-shell';

export const metadata = { title: 'Sent · MailPiston' };

export default function SentPage() {
  return (
    <>
      <PageHeader title="Sent" description="Messages sent from a managed address, including relayed replies." />
      <EmptyState
        icon="sent"
        title="Nothing sent yet"
        description="Sending needs a send-capable address and the outbound service. Create the address now; the rest follows."
        phase="Phase 6 (outbound and replies)"
      />
    </>
  );
}
