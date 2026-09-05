import { HugeiconsIcon } from "@hugeicons/react";
import { CheckmarkCircle02Icon, CodeIcon } from "@hugeicons/core-free-icons";
import { PricingPreview } from "./landing-interactions";

export function PricingSection() {
  return (
    <section className="section-pad pricing-section" id="pricing">
      <div className="section-heading section-heading--center">
        <span className="eyebrow">Priced on volume, not domain count</span>
        <h2>Run it yourself for nothing.<br /><em>Or let us run it for you.</em></h2>
        <p>Every plan bills the same way underneath: a flat product fee, with provider, storage, and volume costs left visible instead of buried in a tier maze.</p>
      </div>

      <div className="pricing-grid">
        <article className="price-card">
          <span className="eyebrow eyebrow--small">Self-hosted</span>
          <div className="price-line"><strong>$0</strong><span>MailPiston product fee</span></div>
          <p>Deploy the control plane on your own infrastructure and pay your providers directly, at their prices.</p>
          <ul>
            <li><HugeiconsIcon icon={CheckmarkCircle02Icon} size={18} /> Full application ownership</li>
            <li><HugeiconsIcon icon={CheckmarkCircle02Icon} size={18} /> Your database, your object storage</li>
            <li><HugeiconsIcon icon={CheckmarkCircle02Icon} size={18} /> Infrastructure costs stay visible</li>
          </ul>
          <a className="button button--ghost button--wide" href="#flow">Explore the architecture</a>
          <small>Your database, your bucket, your domains.</small>
        </article>

        <PricingPreview />

        <article className="price-card">
          <span className="eyebrow eyebrow--small">Managed setup</span>
          <div className="price-line"><strong>Custom</strong></div>
          <p>Migration and configuration help for teams moving several domains or an existing mail flow across.</p>
          <ul>
            <li><HugeiconsIcon icon={CheckmarkCircle02Icon} size={18} /> Domain and route planning</li>
            <li><HugeiconsIcon icon={CheckmarkCircle02Icon} size={18} /> Provider migration support</li>
            <li><HugeiconsIcon icon={CheckmarkCircle02Icon} size={18} /> Custom integration review</li>
          </ul>
          <a className="button button--ghost button--wide" href="#access-note">Why this stays optional</a>
          <small>One-off engagement. Never a requirement.</small>
        </article>
      </div>

      <div className="access-note" id="access-note">
        <HugeiconsIcon icon={CodeIcon} size={24} strokeWidth={1.6} />
        <div><strong>The pricing principle</strong><p>A simple base fee funds the managed product. Large provider, storage, and volume costs stay transparent rather than hidden inside a confusing tier maze - and nothing is priced per domain, because domains are not what costs money.</p></div>
      </div>
    </section>
  );
}
