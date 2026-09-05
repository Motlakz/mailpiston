import { EmptyState, PageHeader } from '@/components/layout/page-shell';

export const metadata = { title: 'Logs · MailPiston' };

export default function LogsPage() {
  return (
    <>
      <PageHeader title="Logs" description="One unified event stream, from receipt to final endpoint delivery." />
      <EmptyState
        icon="logs"
        title="No events yet"
        description="Every message will have a complete audit trail here, filterable by type, address, endpoint, and date."
        phase="Phase 9 (event timeline)"
      />
    </>
  );
}
