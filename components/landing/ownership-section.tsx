import { HugeiconsIcon } from "@hugeicons/react";
import { AiMail01Icon, CheckmarkCircle02Icon } from "@hugeicons/core-free-icons";

export function OwnershipSection() {
  return (
    <section className="section-pad ownership-section" id="ownership">
      <div className="ownership-wrap">
        <div className="ownership-copy">
          <span className="eyebrow eyebrow--light">Maximum ownership, sensibly placed</span>
          <h2>Own the control plane.<br /><em>Rent the plumbing.</em></h2>
          <p>Infrastructure independence is not about cloning a provider. It is about keeping provider-specific details behind an adapter so your product and history remain yours.</p>
          <div className="ownership-quote"><span>“</span><p>As much ownership as possible from both worlds.</p></div>
        </div>
        <div className="boundary-board">
          <div className="boundary-column boundary-column--mine">
            <span className="boundary-label"><i /> MailPiston owns</span>
            <ul>
              <li><HugeiconsIcon icon={CheckmarkCircle02Icon} size={18} /> Domains &amp; addresses</li>
              <li><HugeiconsIcon icon={CheckmarkCircle02Icon} size={18} /> Threads &amp; messages</li>
              <li><HugeiconsIcon icon={CheckmarkCircle02Icon} size={18} /> Routes &amp; policies</li>
              <li><HugeiconsIcon icon={CheckmarkCircle02Icon} size={18} /> Reply authorization</li>
              <li><HugeiconsIcon icon={CheckmarkCircle02Icon} size={18} /> Application experience</li>
            </ul>
          </div>
          <div className="boundary-divider"><span>clean adapter</span></div>
          <div className="boundary-column boundary-column--theirs">
            <span className="boundary-label"><i /> Provider operates</span>
            <ul>
              <li><HugeiconsIcon icon={AiMail01Icon} size={18} /> SMTP transport</li>
              <li><HugeiconsIcon icon={AiMail01Icon} size={18} /> MX receiving</li>
              <li><HugeiconsIcon icon={AiMail01Icon} size={18} /> Deliverability</li>
              <li><HugeiconsIcon icon={AiMail01Icon} size={18} /> Reputation systems</li>
              <li><HugeiconsIcon icon={AiMail01Icon} size={18} /> Abuse operations</li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
