import { MailFlowDemo } from "./landing-interactions";

export function FlowSection() {
  const statement = "Every message keeps one identity, one history, and one route you can inspect.";

  return (
    <section className="section-pad flow-section" id="flow" data-motion-section>
      <div className="section-kicker">
        <div><span className="eyebrow">A thread, not a forwarding trick</span><h2>Receive. Route. Reply.<br /><em>Without losing the plot.</em></h2></div>
        <p>Provider events stop at an adapter boundary. Inside MailPiston, every message follows one stable model your application can understand.</p>
      </div>
      <p className="scroll-statement" aria-label={statement}>
        {statement.split(" ").map((word, index) => (
          <span className="scroll-word" aria-hidden="true" key={`${word}-${index}`}>{word}&nbsp;</span>
        ))}
      </p>
      <MailFlowDemo />
    </section>
  );
}
