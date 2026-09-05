import Image from "next/image";

import logo from "@/public/mailpistonlogo.png";

export function Brand({ href = "#top", label = "MailPiston home" }: { href?: string; label?: string }) {
  return (
    <a className="brand" href={href} aria-label={label}>
      {/* The logo is the wordmark, so it carries the name on its own — the
          alt text is the only place "MailPiston" needs to be written out. */}
      <Image className="brand-logo" src={logo} alt="MailPiston" priority />
    </a>
  );
}
