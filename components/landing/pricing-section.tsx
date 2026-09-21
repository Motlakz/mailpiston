import { HugeiconsIcon } from "@hugeicons/react";
import { CheckmarkCircle02Icon, CodeIcon } from "@hugeicons/core-free-icons";

export function PricingSection() {
  return (
    <section className="section-pad pricing-section" id="pricing" data-motion-section>
      <div className="section-heading section-heading--center">
        <span className="eyebrow">Priced on volume, not domain count</span>
        <h2>Every domain you own.<br /><em>One flat fee.</em></h2>
        <p>MailPiston is the control plane. You bring your own mail provider account, so your sending reputation, your send quota and your provider bill stay yours — and adding a domain costs you nothing here.</p>
      </div>

      <div className="pricing-grid">
        <article className="price-card">
          <span className="eyebrow eyebrow--small">Single domain</span>
          <div className="price-line"><strong>$0</strong><span>free, indefinitely</span></div>
          <p>One verified domain with the full inbox — enough to run the mail for a single product or an org address.</p>
          <ul>
            <li><HugeiconsIcon icon={CheckmarkCircle02Icon} size={18} /> One domain, unlimited addresses</li>
            <li><HugeiconsIcon icon={CheckmarkCircle02Icon} size={18} /> Threads, routing, and reply relay</li>
            <li><HugeiconsIcon icon={CheckmarkCircle02Icon} size={18} /> Signed webhooks and the full API</li>
          </ul>
          <a className="button button--ghost button--wide" href="#flow">See how mail moves</a>
          <small>Your provider account, your data.</small>
        </article>

        <div className="pricing-preview">
          <div className="price-card price-card--featured">
            <div className="price-card__glow" aria-hidden="true" />
            <span className="eyebrow eyebrow--small">Unlimited domains</span>
            <div className="price-line">
              <strong>$6</strong>
              <span>/ month &middot; indicative</span>
            </div>
            <p>Every domain you manage in one inbox, for the same price whether that is two or twenty.</p>
            <ul>
              <li><HugeiconsIcon icon={CheckmarkCircle02Icon} size={18} /> Unlimited domains and addresses</li>
              <li><HugeiconsIcon icon={CheckmarkCircle02Icon} size={18} /> One inbox across all of them</li>
              <li><HugeiconsIcon icon={CheckmarkCircle02Icon} size={18} /> Metered on messages, never on domains</li>
            </ul>
            <a className="button button--dark button--wide" href="#access-note">
              Understand the model
            </a>
            <small>Indicative while the hosted workspace is in build.</small>
          </div>
        </div>

        <article className="price-card">
          <span className="eyebrow eyebrow--small">Your provider</span>
          <div className="price-line"><strong>At cost</strong></div>
          <p>Mail transport is bought from a specialist and paid for directly. We never mark it up, because we never touch it.</p>
          <ul>
            <li><HugeiconsIcon icon={CheckmarkCircle02Icon} size={18} /> Your own provider account and token</li>
            <li><HugeiconsIcon icon={CheckmarkCircle02Icon} size={18} /> Your sending reputation, not a shared one</li>
            <li><HugeiconsIcon icon={CheckmarkCircle02Icon} size={18} /> Leave whenever — the domains are yours</li>
          </ul>
          <a className="button button--ghost button--wide" href="#ownership">Where the boundary sits</a>
          <small>Around $3 a month at the time of writing.</small>
        </article>
      </div>

      <div className="access-note" id="access-note">
        <HugeiconsIcon icon={CodeIcon} size={24} strokeWidth={1.6} />
        <div>
          <strong>Why nothing is priced per domain</strong>
          <p>Because domains are not what costs money. Storage and volume are, and those scale with the mail you actually receive — so a second product, or a fifth, changes nothing on this bill. Providers that charge per domain make adding one a decision; here it is not.</p>
        </div>
      </div>
    </section>
  );
}
