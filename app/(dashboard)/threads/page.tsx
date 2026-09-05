import { EmptyState, PageHeader } from '@/components/layout/page-shell';

export const metadata = { title: 'Threads · MailPiston' };

export default function ThreadsPage() {
  return (
    <>
      <PageHeader title="Threads" description="Conversations resolved from In-Reply-To and References headers." />
      <EmptyState
        icon="threads"
        title="No threads yet"
        description="Thread resolution runs on headers only. A subject-and-participant fallback is deliberately not shipped: wrongly merging two customers' threads is a data-leak-shaped bug."
        phase="Phase 5 (threads)"
      />
    </>
  );
}
