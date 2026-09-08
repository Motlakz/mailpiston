import { redirect } from 'next/navigation';

/** Sent is a filter on the Mail view now, not a separate page. */
export default function SentPage() {
  redirect('/mail?show=sent');
}
