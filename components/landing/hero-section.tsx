import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowRight01Icon,
} from "@hugeicons/core-free-icons";
import { HeroInboxMock } from "./hero-inbox-mock";

export function HeroSection() {
  return (
    <section className="hero section-pad" data-motion-section>
      <div className="hero-orb hero-orb--blue" aria-hidden="true" />
      <div className="hero-orb hero-orb--coral" aria-hidden="true" />
      <div className="hero-grid" aria-hidden="true" />
      <div className="hero-thread hero-thread--one" aria-hidden="true" />
      <div className="hero-thread hero-thread--two" aria-hidden="true" />

      <div className="hero-copy">
        <span className="eyebrow hero-reveal"><span className="eyebrow__dot" /> Email control plane · every domain you manage</span>
        <h1 className="hero-title">
          <span className="hero-title__line">Own the inbox.</span>
          <span className="hero-title__line hero-title__line--accent">
            <em>Offload the</em>
            <span className="hero-title__packet" aria-hidden="true"><i /><b>@</b><i /></span>
            <em>server.</em>
          </span>
        </h1>
        <p className="hero-lede hero-reveal">
          MailPiston gives every address on every domain you manage a programmable,
          reply-ready inbox - while proven providers handle SMTP, MX, and delivery.
        </p>
        <div className="hero-actions hero-reveal">
          <a className="button button--primary" href="#flow">
            See how mail moves
            <HugeiconsIcon icon={ArrowRight01Icon} size={18} strokeWidth={1.8} />
          </a>
          <a className="button button--ghost" href="#ownership">Draw the ownership line</a>
        </div>
        <div className="hero-note hero-reveal">
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
