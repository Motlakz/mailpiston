import { HugeiconsIcon } from "@hugeicons/react";
import { CheckmarkCircle02Icon, CodeIcon } from "@hugeicons/core-free-icons";
import { PricingPreview } from "./landing-interactions";

export function PricingSection() {
  return (
    <section className="section-pad pricing-section" id="pricing">
      <div className="section-heading section-heading--center">
        <span className="eyebrow">Built privately. Packaged thoughtfully.</span>
        <h2>Useful to one owner first.<br /><em>Flexible enough to share later.</em></h2>
        <p>There is no public checkout today. This model shows how access could fund broader costs without compromising the ownership premise.</p>
      </div>

      <div className="pricing-grid">
        <article className="price-card">
          <span className="eyebrow eyebrow--small">Owner build</span>
          <div className="price-line"><strong>$0</strong><span>MailPiston product fee</span></div>
          <p>Run the internal control plane and pay the infrastructure provider you choose directly.</p>
          <ul>
            <li><HugeiconsIcon icon={CheckmarkCircle02Icon} size={18} /> Maximum application ownership</li>
            <li><HugeiconsIcon icon={CheckmarkCircle02Icon} size={18} /> Bring your own supported provider</li>
            <li><HugeiconsIcon icon={CheckmarkCircle02Icon} size={18} /> Provider costs stay visible</li>
          </ul>
          <a className="button button--ghost button--wide" href="#flow">Explore the architecture</a>
          <small>Current private-build direction.</small>
        </article>

        <PricingPreview />

        <article className="price-card">
          <span className="eyebrow eyebrow--small">Managed setup</span>
          <div className="price-line"><strong>Later</strong></div>
          <p>Optional migration and configuration help for teams with several domains or existing mail flows.</p>
          <ul>
            <li><HugeiconsIcon icon={CheckmarkCircle02Icon} size={18} /> Domain and route planning</li>
            <li><HugeiconsIcon icon={CheckmarkCircle02Icon} size={18} /> Provider migration support</li>
            <li><HugeiconsIcon icon={CheckmarkCircle02Icon} size={18} /> Custom integration review</li>
          </ul>
          <a className="button button--ghost button--wide" href="#access-note">Why this stays optional</a>
          <small>No service package is currently for sale.</small>
        </article>
      </div>

      <div className="access-note" id="access-note">
        <HugeiconsIcon icon={CodeIcon} size={24} strokeWidth={1.6} />
        <div><strong>The pricing principle</strong><p>A simple base fee should fund the managed product. Large provider, storage, or volume costs should remain transparent rather than being hidden in a confusing tier maze.</p></div>
      </div>
    </section>
  );
}
