import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowUpRight01Icon } from "@hugeicons/core-free-icons";

export function FinalCta() {
  return (
    <section className="final-cta section-pad">
      <div className="final-cta__glow" aria-hidden="true" />
      <span className="eyebrow eyebrow--light">Mail, on your terms</span>
      <h2>The identity is yours.<br />The history is yours.<br /><em>The mail server does not have to be.</em></h2>
      <div className="final-cta__actions">
        <a className="button button--cream" href="#flow">See the system</a>
        <a className="text-link" href="#pricing">Review the access model <HugeiconsIcon icon={ArrowUpRight01Icon} size={17} /></a>
      </div>
    </section>
  );
}
