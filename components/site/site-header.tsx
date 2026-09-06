import { HugeiconsIcon } from "@hugeicons/react";
import { Login03Icon } from "@hugeicons/core-free-icons";
import Link from "next/link";
import { Brand } from "./brand";

export function SiteHeader() {
  return (
    <header className="site-header">
      <Brand />
      <nav className="site-nav" aria-label="Primary navigation">
        <a href="#product">Product</a>
        <a href="#flow">Flow</a>
        <a href="#ownership">Ownership</a>
        <a href="#pricing">Access</a>
      </nav>
      <Link className="button button--nav" href="/sign-in">
        Sign in
        <HugeiconsIcon icon={Login03Icon} size={17} strokeWidth={1.8} />
      </Link>
    </header>
  );
}
