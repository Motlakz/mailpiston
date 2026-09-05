import { HugeiconsIcon } from "@hugeicons/react";
import { CheckmarkCircle02Icon, Globe02Icon, Mail01Icon, ShieldKeyIcon } from "@hugeicons/core-free-icons";

export function PrivacySection() {
  return (
    <section className="section-pad privacy-section">
      <div className="privacy-visual glass-panel">
        <div className="privacy-orbit privacy-orbit--one" aria-hidden="true" /><div className="privacy-orbit privacy-orbit--two" aria-hidden="true" />
        <div className="identity-card identity-card--public">
          <span><HugeiconsIcon icon={Globe02Icon} size={18} /> Public identity</span><strong>support@yourdomain.com</strong><small>What your customer sees</small>
        </div>
        <div className="relay-core"><HugeiconsIcon icon={ShieldKeyIcon} size={30} strokeWidth={1.5} /><span>signed relay</span></div>
        <div className="identity-card identity-card--private">
          <span><HugeiconsIcon icon={Mail01Icon} size={18} /> Private destination</span><strong>you@personal.com</strong><small>Never used as the visible sender</small>
        </div>
      </div>
      <div className="privacy-copy">
        <span className="eyebrow">Familiar inbox, protected identity</span>
        <h2>Reply where you already work. Show only the address you chose.</h2>
        <p>Private forwarding becomes an operator interface - not an identity leak. MailPiston keeps the thread context and public sender between your customer and your personal mailbox.</p>
        <ul className="check-list">
          <li><HugeiconsIcon icon={CheckmarkCircle02Icon} size={19} /> Signed, expiring reply authorization</li>
          <li><HugeiconsIcon icon={CheckmarkCircle02Icon} size={19} /> Header rewriting and loop prevention</li>
          <li><HugeiconsIcon icon={CheckmarkCircle02Icon} size={19} /> One audit trail for received and sent mail</li>
        </ul>
      </div>
    </section>
  );
}
