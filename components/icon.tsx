import { HugeiconsIcon } from '@hugeicons/react';
import {
  Activity03Icon,
  AlertCircleIcon,
  ArrowLeft02Icon,
  ArrowRight02Icon,
  Attachment01Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  Copy01Icon,
  DashboardSquare01Icon,
  Delete02Icon,
  Download01Icon,
  GlobalIcon,
  InboxIcon,
  Key01Icon,
  Loading03Icon,
  Mail01Icon,
  MailSend01Icon,
  Message01Icon,
  PlusSignIcon,
  RefreshIcon,
  Settings02Icon,
  ShieldKeyIcon,
  WebhookIcon,
} from '@hugeicons/core-free-icons';

import { cn } from '@/lib/utils';

/**
 * The single import site for every icon in the app (roadmap §2.5).
 *
 * The standing stack rule is Hugeicons first, Heroicons as fallback,
 * react-icons only as a last resort. Routing every glyph through this one map
 * means the fallback tier of any icon is visible in one file instead of
 * scattered across features, and promoting a fallback to a Hugeicons glyph is a
 * one-line change here rather than a search across the codebase.
 *
 * Everything below is currently tier 1 (Hugeicons). If a glyph ever has to drop
 * a tier, note it inline so the debt is legible.
 */
const ICONS = {
  overview: DashboardSquare01Icon,
  inbox: InboxIcon,
  sent: MailSend01Icon,
  threads: Message01Icon,
  logs: Activity03Icon,
  domains: GlobalIcon,
  addresses: Mail01Icon,
  endpoints: WebhookIcon,
  apiKeys: Key01Icon,
  settings: Settings02Icon,

  add: PlusSignIcon,
  close: Cancel01Icon,
  copy: Copy01Icon,
  delete: Delete02Icon,
  refresh: RefreshIcon,
  verified: CheckmarkCircle02Icon,
  pending: Loading03Icon,
  failed: AlertCircleIcon,
  arrowRight: ArrowRight02Icon,
  arrowLeft: ArrowLeft02Icon,
  attachment: Attachment01Icon,
  download: Download01Icon,
  signIn: ShieldKeyIcon,
} as const;

export type IconName = keyof typeof ICONS;

export interface IconProps {
  name: IconName;
  className?: string;
  size?: number;
  strokeWidth?: number;
  'aria-label'?: string;
}

export function Icon({
  name,
  className,
  size = 16,
  strokeWidth = 1.8,
  ...rest
}: IconProps) {
  return (
    <HugeiconsIcon
      icon={ICONS[name]}
      size={size}
      strokeWidth={strokeWidth}
      className={cn('shrink-0', className)}
      // Icons here are decorative unless the caller names them; an unlabelled
      // one must not be announced twice alongside the text it sits beside.
      aria-hidden={rest['aria-label'] ? undefined : true}
      {...rest}
    />
  );
}
