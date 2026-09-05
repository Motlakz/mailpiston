import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowUpRight01Icon } from "@hugeicons/core-free-icons";
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
      <a className="button button--nav" href="#flow">
        Explore the flow
        <HugeiconsIcon icon={ArrowUpRight01Icon} size={17} strokeWidth={1.8} />
      </a>
    </header>
  );
}
