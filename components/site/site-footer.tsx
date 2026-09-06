import Link from "next/link";
import { Brand } from "./brand";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <Brand label="Back to top" />
      <p>An ownership-first email control plane.</p>
      <div>
        <a href="#ownership">Principles</a>
        <a href="#pricing">Access</a>
        <Link href="/sign-in">Sign in</Link>
        <a href="#top">Back to top ↑</a>
      </div>
    </footer>
  );
}
