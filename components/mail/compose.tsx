'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Icon } from '@/components/icon';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { ApiRequestError, apiRequest } from '@/lib/api-client';

export interface SendableAddress {
  id: string;
  email: string;
}

const inputClass =
  'h-8 w-full rounded-md border border-input bg-background px-2.5 text-xs outline-none transition-colors focus-visible:border-ring';

const labelClass = 'text-[11px] font-medium tracking-wide text-muted-foreground';

/**
 * Compose, as a modal rather than an expanding panel.
 *
 * It used to render its form directly into the page header's action slot, so
 * opening it inflated the header and pushed the message list down the screen —
 * the content the operator was looking at moved the moment they clicked. Only
 * the trigger belongs up there now, and it never changes size.
 */
export function ComposeForm({ addresses }: { addresses: SendableAddress[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [addressId, setAddressId] = useState(addresses[0]?.id ?? '');
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (addresses.length === 0) {
    return (
      <p className="max-w-xs text-right text-xs text-muted-foreground">
        No send-capable address yet — create one with sending enabled.
      </p>
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    try {
      await apiRequest('/api/v1/emails/send', {
        method: 'POST',
        body: JSON.stringify({
          addressId,
          to: to.split(',').map((value) => value.trim()).filter(Boolean),
          subject,
          text,
        }),
      });

      setTo('');
      setSubject('');
      setText('');
      setOpen(false);
      startTransition(() => router.refresh());
    } catch (caught) {
      setError(
        caught instanceof ApiRequestError
          ? caught.message
          : 'Something went wrong. Check the server logs.',
      );
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Icon name="add" size={13} />
        Compose
      </Button>

      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="New message"
        description="Sent from a managed address, and recorded in Sent before it leaves."
      >
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className={labelClass} htmlFor="compose-from">
              From
            </label>
            <select
              id="compose-from"
              value={addressId}
              onChange={(event) => setAddressId(event.target.value)}
              className={inputClass}
            >
              {addresses.map((address) => (
                <option key={address.id} value={address.id}>
                  {address.email}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className={labelClass} htmlFor="compose-to">
              To
            </label>
            <input
              id="compose-to"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              placeholder="customer@example.com, another@example.com"
              required
              className={inputClass}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className={labelClass} htmlFor="compose-subject">
              Subject
            </label>
            <input
              id="compose-subject"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              placeholder="What this is about"
              required
              className={inputClass}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className={labelClass} htmlFor="compose-body">
              Message
            </label>
            <textarea
              id="compose-body"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Plain text. Attachments are not carried on outbound mail yet."
              required
              rows={8}
              className="w-full resize-y rounded-md border border-input bg-background px-2.5 py-2 text-xs leading-relaxed outline-none transition-colors focus-visible:border-ring"
            />
          </div>

          {error ? (
            <p className="rounded-md border border-destructive/40 px-2.5 py-1.5 text-xs text-destructive">
              {error}
            </p>
          ) : null}

          <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              Cancel
            </button>
            <Button type="submit" disabled={pending}>
              <Icon name="sent" size={13} />
              Send
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

/**
 * Replies from the message view.
 *
 * Recipient, subject, and the threading headers are all derived server-side
 * from the message being answered — the operator supplies the body and nothing
 * else, because a reply whose `In-Reply-To` is editable is a reply that breaks
 * threading in the customer's client.
 */
export function ReplyForm({ emailId }: { emailId: string }) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    try {
      await apiRequest(`/api/v1/emails/${emailId}/reply`, {
        method: 'POST',
        body: JSON.stringify({ text }),
      });

      setText('');
      setSent(true);
      startTransition(() => router.refresh());
    } catch (caught) {
      setError(
        caught instanceof ApiRequestError
          ? caught.message
          : 'Something went wrong. Check the server logs.',
      );
    }
  }

  return (
    <form onSubmit={submit} className="mt-5 flex flex-col gap-2">
      <label className="text-sm font-medium">Reply</label>
      <textarea
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setSent(false);
        }}
        rows={5}
        required
        placeholder="Your reply. Threading headers are set from this message."
        className="w-full rounded-md border border-input bg-card px-2 py-1.5 text-xs outline-none focus-visible:border-ring"
      />
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending}>
          <Icon name="sent" size={13} />
          Send reply
        </Button>
        {sent ? <span className="text-xs text-success">Sent.</span> : null}
        {error ? <span className="text-xs text-destructive">{error}</span> : null}
      </div>
    </form>
  );
}
