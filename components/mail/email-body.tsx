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

/* A typographic floor for mail that arrives with none of its own. */

const FRAME_STYLES = `
  html { color-scheme: light; }
  body {
    margin: 0 auto;
    padding: 22px 24px;
    font: 15px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    color: #16181d;
    background: #fff;
    word-break: break-word;
  }

  /* Never let a sender's asset force the frame to scroll sideways. */
  img, table, pre { max-width: 100%; }
  a { color: #2f6df6; }

  /* Block rhythm. Close to the browser defaults on purpose — the goal is
     readable spacing, not a house style imposed on someone else's mail. */
  p { margin: 0 0 1em; }
  h1, h2, h3, h4, h5, h6 { margin: 1.5em 0 .5em; font-weight: 600; line-height: 1.25; }
  h1 { font-size: 1.5em; }
  h2 { font-size: 1.3em; }
  h3 { font-size: 1.12em; }
  h4, h5, h6 { font-size: 1em; }
  ul, ol { margin: 0 0 1em; padding-left: 1.4em; }
  li { margin: .25em 0; }
  hr { border: 0; border-top: 1px solid #e4e7ee; margin: 1.75em 0; }

  /* Quoted replies: the most common unstyled structure in ordinary mail. */
  blockquote {
    border-left: 3px solid #d8dce4;
    color: #52596b;
    margin: 1em 0;
    padding: .2em 0 .2em 1em;
  }

  pre {
    background: #f5f6f8;
    border-radius: 6px;
    overflow-x: auto;
    padding: 12px 14px;
    white-space: pre-wrap;
  }
  code { background: #f5f6f8; border-radius: 4px; font-size: .92em; padding: .15em .35em; }
  pre code { background: none; padding: 0; }

  /* The frame supplies the outer padding; a leading or trailing margin on top
     of it just looks like a mistake. */
  body > :first-child { margin-top: 0; }
  body > :last-child { margin-bottom: 0; }

  /* A message with no table in it is not a designed campaign — it is somebody
     typing into a mail client — so it can have a real measure and a little more
     room. Anything table-based keeps the full width its layout was built for. */
  body:not(:has(table)) { max-width: 68ch; padding: 26px 28px; }
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
    return <PlainTextBody text={text} />;
  }

  return (
    <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
      This message has no text or HTML body.
    </p>
  );
}

/**
 * A plain-text body, set as prose rather than as a code block.
 *
 * `<pre>` was honest about preserving the bytes and wrong about everything
 * else: a hard-wrapped plain-text mail rendered as one undifferentiated slab
 * with no paragraph rhythm, which is what made these read as unstyled beside an
 * HTML message.
 *
 * Blank lines are the only structure plain text has, so they become paragraph
 * breaks. Within a paragraph `pre-wrap` keeps the sender's own line breaks,
 * because in plain text those are frequently deliberate — a signature block, an
 * address, a list.
 *
 * Runs of `>`-prefixed lines are the other near-universal convention: they are
 * a quoted reply, and showing them as one is the difference between a readable
 * exchange and a wall of text.
 */
function PlainTextBody({ text }: { text: string }) {
  const blocks = text.replace(/\r\n/g, '\n').split(/\n{2,}/);

  return (
    <div className="email-body-plain">
      {blocks.map((block, index) => {
        const quoted = block
          .split('\n')
          .every((line) => line.trim() === '' || /^\s*>/.test(line));

        if (quoted) {
          return (
            <blockquote key={index}>
              {block.replace(/^[ \t]*>[ ]?/gm, '')}
            </blockquote>
          );
        }

        return <p key={index}>{block}</p>;
      })}
    </div>
  );
}
