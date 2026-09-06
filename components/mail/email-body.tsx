/**
 * Renders an inbound message body.
 *
 * HTML mail is attacker-controlled markup. It is never handed to
 * `dangerouslySetInnerHTML` — that would run scripts on our origin, with our
 * session cookie. It goes into an iframe with two independent defences:
 *
 *  - **`sandbox` with no allow-tokens.** No scripts, no forms, no navigation,
 *    and — crucially — no `allow-same-origin`, so the frame gets an opaque
 *    origin and cannot read anything of ours even if it finds a way to run.
 *  - **A CSP inside the document.** `default-src 'none'` blocks remote images,
 *    which is not primarily an XSS control: a remote `<img>` in an email is a
 *    tracking pixel, and loading it tells the sender when the operator opened
 *    the message and roughly where from. Inline styles and `data:` images
 *    survive, which is what makes most newsletters still look right.
 *
 * The two are deliberately redundant. Either alone would be defensible; a mail
 * client is the wrong place to find out which one had the gap.
 */
const CSP = [
  "default-src 'none'",
  "img-src data:",
  "style-src 'unsafe-inline'",
  "font-src data:",
].join('; ');

const FRAME_STYLES = `
  html { color-scheme: light; }
  body {
    margin: 0;
    padding: 12px 4px;
    font: 14px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    color: #16181d;
    background: #fff;
    word-break: break-word;
  }
  img, table { max-width: 100%; }
  a { color: #2f6df6; }
`;

export function EmailBody({
  html,
  text,
}: {
  html: string | null;
  text: string | null;
}) {
  if (html) {
    const srcDoc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}"><style>${FRAME_STYLES}</style></head><body>${html}</body></html>`;

    return (
      <iframe
        title="Message body"
        sandbox=""
        srcDoc={srcDoc}
        className="h-[60vh] w-full rounded-md border border-border bg-white"
      />
    );
  }

  if (text) {
    return (
      <pre className="whitespace-pre-wrap break-words rounded-md border border-border bg-muted/30 p-4 font-sans text-sm leading-relaxed">
        {text}
      </pre>
    );
  }

  return (
    <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
      This message has no text or HTML body.
    </p>
  );
}
