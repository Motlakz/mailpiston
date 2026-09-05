import { MailFlowDemo } from "./landing-interactions";

export function FlowSection() {
  return (
    <section className="section-pad flow-section" id="flow">
      <div className="section-kicker">
        <div><span className="eyebrow">A thread, not a forwarding trick</span><h2>Receive. Route. Reply.<br /><em>Without losing the plot.</em></h2></div>
        <p>Provider events stop at an adapter boundary. Inside MailPiston, every message follows one stable model your application can understand.</p>
      </div>
      <MailFlowDemo />
    </section>
  );
}
