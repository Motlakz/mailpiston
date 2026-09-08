import { redirect } from 'next/navigation';

/**
 * Inbox folded into the unified Mail view.
 *
 * Kept as a redirect rather than deleted: this path is in the operator's
 * browser history and their bookmarks, and a 404 on a URL that worked
 * yesterday is a worse answer than the page they wanted.
 */
export default function InboxPage() {
  redirect('/mail?show=received');
}
