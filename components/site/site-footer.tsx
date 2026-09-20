import Link from "next/link";
import { Brand } from "./brand";
import { ThemeToggle } from "./theme-toggle";

export function SiteFooter() {
  return (
    <footer className="site-footer" id="footer">
      <div className="site-footer__top">
        <div className="site-footer__brand">
          <Brand label="Back to top" />
          <p>An ownership-first email control plane.</p>
        </div>

        <nav className="site-footer__nav" aria-label="Footer navigation">
          <a href="#ownership">Principles</a>
          <a href="#pricing">Access</a>
          <Link href="/sign-in">Sign in</Link>
        </nav>
      </div>

      <div className="site-footer__bar">
        <p className="site-footer__legal">
          MailPiston stores the mail you receive. It is never sold, used for
          training, or read by anyone but you.
        </p>

        <div className="site-footer__controls">
          <ThemeToggle />
          <a className="site-footer__top-link" href="#top">Back to top ↑</a>
        </div>
      </div>
    </footer>
  );
}
