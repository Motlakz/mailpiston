import { EmptyState, PageHeader } from '@/components/layout/page-shell';

export const metadata = { title: 'Settings · MailPiston' };

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" description="Operator configuration, provider status, and retention." />
      <EmptyState
        icon="settings"
        title="Nothing configurable yet"
        description="Configuration currently lives entirely in environment variables, parsed once at boot so a misconfigured deployment fails immediately."
        phase="Phase 11 (hardening)"
      />
    </>
  );
}
