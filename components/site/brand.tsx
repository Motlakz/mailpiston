export function Brand({ href = "#top", label = "MailPiston home" }: { href?: string; label?: string }) {
  return (
    <a className="brand" href={href} aria-label={label}>
      <span className="brand-mark" aria-hidden="true">
        <span className="brand-mark__plate" />
        <span className="brand-mark__piston" />
      </span>
      <span>MailPiston</span>
    </a>
  );
}
