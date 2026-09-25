import { PageSkeleton } from '@/components/layout/page-skeleton';

export default function Loading() {
  return <PageSkeleton variant="endpoints" toolbar={false} rows={2} />;
}
