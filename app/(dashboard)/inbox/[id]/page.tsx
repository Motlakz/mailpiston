import { redirect } from 'next/navigation';

/** Messages moved to `/mail/[id]`; old links still resolve. */
export default async function LegacyEmailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/mail/${id}`);
}
