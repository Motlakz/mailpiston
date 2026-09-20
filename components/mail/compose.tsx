'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Icon } from '@/components/icon';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Dialog } from '@/components/ui/dialog';
import { ApiRequestError, apiRequest } from '@/lib/api-client';

export interface SendableAddress {
  id: string;
  email: string;
}

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
        <form onSubmit={submit} className="flex flex-col gap-3.5">
          <Field>
            <FieldLabel htmlFor="compose-from">From</FieldLabel>
            <Select
              // Gives Select.Value the label for the selected id; without it the
              // trigger renders the raw address id.
              items={addresses.map((address) => ({
                value: address.id,
                label: address.email,
              }))}
              value={addressId}
              onValueChange={(value) => setAddressId(String(value))}
            >
              <SelectTrigger id="compose-from" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {addresses.map((address) => (
                  <SelectItem key={address.id} value={address.id}>
                    {address.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field>
            <FieldLabel htmlFor="compose-to">To</FieldLabel>
            <Input
              id="compose-to"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              placeholder="customer@example.com, another@example.com"
              required
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="compose-subject">Subject</FieldLabel>
            <Input
              id="compose-subject"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              placeholder="What this is about"
              required
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="compose-body">Message</FieldLabel>
            <Textarea
              id="compose-body"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Plain text. Attachments are not carried on outbound mail yet."
              required
              rows={8}
              className="resize-y leading-relaxed"
            />
          </Field>

          {error ? (
            <p className="rounded-md border border-destructive/40 px-2.5 py-1.5 text-xs text-destructive">
              {error}
            </p>
          ) : null}

          <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              <Icon name="sent" size={13} />
              {pending ? 'Sending…' : 'Send'}
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
export function ReplyForm({
  emailId,
  replyAs,
}: {
  emailId: string;
  /** The managed address this reply will be sent from, where it is known. */
  replyAs?: string | null;
}) {
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
    // Three bands — identity, body, actions — as one bordered object, the way
    // the product mock has drawn it from the start. It used to be a bare form on
    // the page background, so the dashboard's grid ran behind the textarea and
    // the composer read as floating debris rather than as part of the message.
    //
    // The identity band is the point of it: a reply goes out as the managed
    // address, never the operator's own mailbox, and that is worth stating on
    // the surface rather than leaving as something you have to know.
    <form onSubmit={submit} className="reply-panel">
      <div className="reply-panel__identity">
        <span>Reply as</span>
        {replyAs ? (
          <strong>
            <i aria-hidden /> {replyAs}
          </strong>
        ) : (
          <strong>
            <i aria-hidden /> the managed address
          </strong>
        )}
      </div>

      <Textarea
        id="reply-body"
        aria-label="Reply"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setSent(false);
        }}
        rows={5}
        required
        placeholder="Your reply. Threading headers are set from this message."
        className="reply-panel__body"
      />

      <div className="reply-panel__footer">
        <span className="reply-panel__status">
          {sent ? (
            <span className="text-success">Sent.</span>
          ) : error ? (
            <span className="text-destructive">{error}</span>
          ) : (
            'Threading headers are taken from this message.'
          )}
        </span>

        <Button type="submit" size="sm" disabled={pending}>
          <Icon name="sent" size={13} />
          {pending ? 'Sending…' : 'Send reply'}
        </Button>
      </div>
    </form>
  );
}
