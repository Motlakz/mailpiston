'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Icon } from '@/components/icon';
import { Button } from '@/components/ui/button';
import { ApiRequestError, apiRequest } from '@/lib/api-client';

export interface SendableAddress {
  id: string;
  email: string;
}

const inputClass =
  'h-7 w-full rounded-md border border-input bg-card px-2 text-xs outline-none focus-visible:border-ring';

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
      <p className="text-xs text-muted-foreground">
        No send-capable address yet — create one with sending enabled.
      </p>
    );
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)}>
        <Icon name="add" size={13} />
        Compose
      </Button>
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
    <form
      onSubmit={submit}
      className="flex w-full max-w-xl flex-col gap-2 rounded-lg border border-border bg-card p-3"
    >
      <div className="flex gap-2">
        <select
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
        <input
          value={to}
          onChange={(event) => setTo(event.target.value)}
          placeholder="to@example.com, another@example.com"
          required
          className={inputClass}
        />
      </div>

      <input
        value={subject}
        onChange={(event) => setSubject(event.target.value)}
        placeholder="Subject"
        required
        className={inputClass}
      />

      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="Message"
        required
        rows={6}
        className="w-full rounded-md border border-input bg-card px-2 py-1.5 text-xs outline-none focus-visible:border-ring"
      />

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending}>
          Send
        </Button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Cancel
        </button>
        {error ? <span className="text-xs text-destructive">{error}</span> : null}
      </div>
    </form>
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
