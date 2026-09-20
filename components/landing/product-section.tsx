import { HugeiconsIcon } from "@hugeicons/react";
import { benefits } from "./content";

export function ProductSection() {
  return (
    <section className="section-pad problem-section" id="product" data-motion-section>
      <div className="section-heading section-heading--center">
        <span className="eyebrow">The better boundary</span>
        <h2>You should not have to choose between control and becoming an SMTP company.</h2>
        <p>Keep the parts that compound in value. Hand off the parts that demand a specialist network.</p>
      </div>
      <div className="benefit-grid">
        {benefits.map((benefit, index) => (
          <article className={`benefit-card benefit-card--${index + 1} glass-panel spotlight-card`} key={benefit.title}>
            <div className="spotlight-card__glow" aria-hidden="true" />
            <span className={`benefit-card__icon benefit-card__icon--${index + 1}`}><HugeiconsIcon icon={benefit.icon} size={25} strokeWidth={1.6} /></span>
            <h3>{benefit.title}</h3>
            <p>{benefit.copy}</p>
            <span className="benefit-card__trace" aria-hidden="true" />
          </article>
        ))}
      </div>
    </section>
  );
}
