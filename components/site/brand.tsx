import Image from "next/image";

import mark from "@/public/mailpistonlogo-2.png";

export type BrandSize = "sm" | "md" | "lg";

export function Brand({
  href = "#top",
  label = "MailPiston home",
  size = "md",
  wordmark = true,
}: {
  href?: string;
  label?: string;
  size?: BrandSize;
  /** False for a collapsed rail, where only the mark fits. */
  wordmark?: boolean;
}) {
  return (
    <a className="brand" data-size={size} href={href} aria-label={label}>
      <Image className="brand-mark" src={mark} alt="" aria-hidden priority />
      {wordmark ? <BrandWordmark /> : null}
    </a>
  );
}

export function BrandWordmark() {
  return (
    <span className="brand-word" aria-hidden>
      Mail<span className="brand-word__accent">Piston</span>
    </span>
  );
}
