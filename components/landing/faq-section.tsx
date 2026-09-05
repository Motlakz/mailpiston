import { frequentlyAskedQuestions } from "./content";

export function FaqSection() {
  return (
    <section className="section-pad faq-section">
      <div className="faq-intro">
        <span className="eyebrow">Clear before clever</span>
        <h2>The questions behind the architecture.</h2>
        <p>Mail infrastructure is already complicated. The product boundary should not be.</p>
      </div>
      <div className="faq-list">
        {frequentlyAskedQuestions.map((item, index) => (
          <details key={item.question} open={index === 0}>
            <summary><span>{item.question}</span><i aria-hidden="true" /></summary>
            <p>{item.answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
