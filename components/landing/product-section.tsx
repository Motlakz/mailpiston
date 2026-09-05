import { HugeiconsIcon } from "@hugeicons/react";
import { benefits } from "./content";

export function ProductSection() {
  return (
    <section className="section-pad problem-section" id="product">
      <div className="section-heading section-heading--center">
        <span className="eyebrow">The better boundary</span>
        <h2>You should not have to choose between control and becoming an SMTP company.</h2>
        <p>Keep the parts that compound in value. Hand off the parts that demand a specialist network.</p>
      </div>
      <div className="benefit-grid">
        {benefits.map((benefit, index) => (
          <article className="benefit-card glass-panel" key={benefit.title}>
            <span className={`benefit-card__icon benefit-card__icon--${index + 1}`}><HugeiconsIcon icon={benefit.icon} size={25} strokeWidth={1.6} /></span>
            <span className="benefit-card__number">0{index + 1}</span>
            <h3>{benefit.title}</h3>
            <p>{benefit.copy}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
