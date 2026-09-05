import { HugeiconsIcon } from "@hugeicons/react";
import { AiMail01Icon, Database01Icon, Globe02Icon, ShieldKeyIcon } from "@hugeicons/core-free-icons";

export function TrustRail() {
  return (
    <section className="trust-rail" aria-label="MailPiston ownership principles">
      <span><HugeiconsIcon icon={Globe02Icon} size={18} /> Your domains</span><i aria-hidden="true" />
      <span><HugeiconsIcon icon={Database01Icon} size={18} /> Your data model</span><i aria-hidden="true" />
      <span><HugeiconsIcon icon={ShieldKeyIcon} size={18} /> Your reply identity</span><i aria-hidden="true" />
      <span><HugeiconsIcon icon={AiMail01Icon} size={18} /> Proven delivery underneath</span>
    </section>
  );
}
