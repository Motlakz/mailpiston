import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowRight01Icon,
} from "@hugeicons/core-free-icons";
import { HeroInboxMock } from "./hero-inbox-mock";

export function HeroSection() {
  return (
    <section className="hero section-pad">
      <div className="hero-orb hero-orb--blue" aria-hidden="true" />
      <div className="hero-orb hero-orb--coral" aria-hidden="true" />
      <div className="hero-grid" aria-hidden="true" />

      <div className="hero-copy">
        <span className="eyebrow"><span className="eyebrow__dot" /> Private build · opening carefully</span>
        <h1>Own the inbox.<br /><em>Offload the server.</em></h1>
        <p className="hero-lede">
          MailPiston gives every address on every domain you manage a programmable,
          reply-ready inbox - while proven providers handle SMTP, MX, and delivery.
        </p>
        <div className="hero-actions">
          <a className="button button--primary" href="#flow">
            See how mail moves
            <HugeiconsIcon icon={ArrowRight01Icon} size={18} strokeWidth={1.8} />
          </a>
          <a className="button button--ghost" href="#ownership">Draw the ownership line</a>
        </div>
        <div className="hero-note">
          <span className="avatar-stack" aria-hidden="true"><i>M</i><i>@</i><i>P</i></span>
          <span>One control plane. Your domains, data, and reply identity.</span>
        </div>
      </div>

      <div className="hero-visual">
        <HeroInboxMock />
      </div>
    </section>
  );
}
