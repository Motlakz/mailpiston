import { PageSkeleton } from '@/components/layout/page-skeleton';

export default function Loading() {
  // Domain cards are tall and there are rarely many, so three wide blocks read
  // closer to the truth than a dozen table rows would.
  return <PageSkeleton rows={3} toolbar={false} />;
}
