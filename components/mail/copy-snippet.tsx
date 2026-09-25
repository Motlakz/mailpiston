'use client';

import { useState } from 'react';

import { Icon } from '@/components/icon';
import { Button } from '@/components/ui/button';

export function CopySnippet({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="copy-snippet mt-3 overflow-hidden rounded-lg border border-border bg-muted/40">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={async () => {
            await navigator.clipboard.writeText(value);
            setCopied(true);
          }}
        >
          <Icon name={copied ? 'verified' : 'copy'} size={12} />
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      {/* Wrapped, not scrolled. A snippet you have to drag sideways to read is
          a snippet nobody reads — and these are meant to be understood before
          they are copied, not just copied. */}
      <pre className="copy-snippet__code p-3 text-[11px] leading-relaxed"><code>{value}</code></pre>
    </div>
  );
}
