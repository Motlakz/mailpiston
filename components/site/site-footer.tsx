import Link from "next/link";
import { Brand } from "./brand";
import { ThemeToggle } from "./theme-toggle";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <Brand label="Back to top" />
      <p>An ownership-first email control plane.</p>
      <div>
        <a href="#ownership">Principles</a>
        <a href="#pricing">Access</a>
        <Link href="/sign-in">Sign in</Link>
        {/* The header hides the toggle on narrow screens, so this is the only
            place a phone can reach it. */}
        <ThemeToggle />
        <a href="#top">Back to top ↑</a>
      </div>
      {/* The data claim, stated plainly. A product that stores other people's
          mail is one people are entitled to ask about before signing up.

          No Privacy or Terms links yet, deliberately: /privacy and /terms do
          not exist, and a footer that links to two 404s is worse than one that
          does not claim to have them. They go here when the pages do. */}
      <p className="site-footer__legal">
        MailPiston stores the mail you receive. It is never sold, never used for
        training, and never read by anyone but you.
      </p>
    </footer>
  );
}
