"use client";

import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Archive02Icon,
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  ArrowUpRight01Icon,
  Attachment01Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  Database01Icon,
  FileEditIcon,
  Globe02Icon,
  Mail01Icon,
  MailSend01Icon,
  MoreHorizontalIcon,
  PencilEdit02Icon,
  Remove01Icon,
  Search01Icon,
  ShieldKeyIcon,
  SourceCodeIcon,
  SquareIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";

const conversations = [
  {
    id: "MP-1042",
    initials: "AM",
    avatar: "orange",
    name: "Alex Morgan",
    email: "alex@fieldnotes.co",
    subject: "Question about multi-domain setup",
    preview: "Can I connect two product domains...",
    time: "10:42",
    received: "Today at 10:42",
    label: "Product",
    address: "support@northstar.studio",
    body: "Hi there,\n\nCan I connect two product domains and keep the conversations together, or would each address need a separate workspace?\n\nAlex",
    draft: "Absolutely. Each verified domain uses the same thread and routing model, so the workspace stays unified.",
  },
  {
    id: "MP-1041",
    initials: "RK",
    avatar: "blue",
    name: "Riley Kim",
    email: "riley@arcform.dev",
    subject: "Re: Domain verification",
    preview: "The DNS records are resolving now...",
    time: "09:18",
    received: "Today at 09:18",
    label: "Setup",
    address: "hello@northstar.studio",
    body: "Morning,\n\nThe DNS records are resolving now. Could you confirm whether the sending identity is ready too?\n\nThanks,\nRiley",
    draft: "Confirmed. Receiving is verified, and the sending identity is ready for a test reply.",
  },
  {
    id: "MP-1038",
    initials: "JN",
    avatar: "pink",
    name: "Jamie Noor",
    email: "jamie@craftledger.app",
    subject: "Reply relay came through",
    preview: "The public sender stayed intact...",
    time: "Yesterday",
    received: "Yesterday at 16:31",
    label: "Resolved",
    address: "support@northstar.studio",
    body: "Just confirming the reply came through correctly. The public sender stayed intact and the thread grouped as expected.\n\nJamie",
    draft: "Great, thanks for confirming. I will close this thread.",
  },
] as const;

export function HeroInboxMock() {
  const [selectedId, setSelectedId] = useState<(typeof conversations)[number]["id"]>(conversations[0].id);
  const [draft, setDraft] = useState<string>(conversations[0].draft);
  const [queued, setQueued] = useState(false);
  const reduceMotion = useReducedMotion();
  const selected = conversations.find((item) => item.id === selectedId) ?? conversations[0];

  function selectConversation(id: (typeof conversations)[number]["id"]) {
    const next = conversations.find((item) => item.id === id) ?? conversations[0];
    setSelectedId(id);
    setDraft(next.draft);
    setQueued(false);
  }

  function queueReply() {
    if (!draft.trim()) return;
    setQueued(true);
  }

  return (
    <div className="mail-app" aria-label="Interactive MailPiston inbox preview">
      <div className="mail-app__browser">
        <span className="window-dots" aria-hidden="true"><i /><i /><i /></span>
        <div className="browser-address"><ShieldKeyIconView /> mailpiston.vercel.app/inbox</div>
        <div className="browser-actions" aria-hidden="true">
            <span><HugeiconsIcon icon={Remove01Icon} size={9} /></span>
            <span><HugeiconsIcon icon={SquareIcon} size={9} /></span>
            <span><HugeiconsIcon icon={Cancel01Icon} size={9} /></span>
          </div>
      </div>

      <div className="mail-app__shell">
        <aside className="mail-nav">
          <div className="mail-workspace">
            <span className="mail-workspace__mark">N</span>
            <span><strong>Northstar</strong><small>Workspace</small></span>
            <button type="button" aria-label="Workspace menu"><HugeiconsIcon icon={ArrowDown01Icon} size={11} /></button>
          </div>

          <button className="compose-button" type="button"><HugeiconsIcon icon={PencilEdit02Icon} size={12} /> Compose</button>

          <nav aria-label="Inbox preview navigation">
            <button className="is-active" type="button"><HugeiconsIcon icon={Mail01Icon} size={15} /><span>Inbox</span><b>3</b></button>
            <button type="button"><HugeiconsIcon icon={MailSend01Icon} size={15} /><span>Sent</span></button>
            <button type="button"><HugeiconsIcon icon={FileEditIcon} size={15} /><span>Drafts</span><b>1</b></button>
          </nav>

          <div className="address-list">
            <span className="mail-nav__label">Addresses</span>
            <button type="button"><i className="address-dot address-dot--orange" /> support@</button>
            <button type="button"><i className="address-dot address-dot--blue" /> hello@</button>
            <button type="button"><i className="address-dot address-dot--pink" /> billing@</button>
          </div>

          <div className="provider-status">
            <span><i /> Transport healthy</span>
            <small>Forward Email · 28ms</small>
          </div>
        </aside>

        <section className="conversation-list" aria-label="Conversations">
          <div className="conversation-list__head">
            <div><strong>Inbox</strong><span>3 open</span></div>
            <button type="button" aria-label="Conversation options"><HugeiconsIcon icon={MoreHorizontalIcon} size={12} /></button>
          </div>
          <label className="mail-search">
            <HugeiconsIcon icon={Search01Icon} size={11} />
            <input aria-label="Search conversations" placeholder="Search mail" readOnly />
            <kbd>⌘ K</kbd>
          </label>
          <div className="list-filter"><button className="is-active" type="button">All</button><button type="button">Unread</button><button type="button">Assigned</button></div>

          <div className="conversation-items">
            {conversations.map((item, index) => (
              <button
                className={item.id === selectedId ? "conversation-item is-selected" : "conversation-item"}
                key={item.id}
                onClick={() => selectConversation(item.id)}
                type="button"
              >
                <span className={`sender-avatar sender-avatar--${item.avatar}`}>{item.initials}</span>
                <span className="conversation-item__content">
                  <span className="conversation-item__top"><strong>{item.name}</strong><time>{item.time}</time></span>
                  <b>{item.subject}</b>
                  <span className="conversation-item__preview">{item.preview}</span>
                  <span className="conversation-item__meta"><i>{item.label}</i><small>{item.id}</small></span>
                </span>
                {index < 2 && <span className="unread-dot" aria-label="Unread" />}
              </button>
            ))}
          </div>
        </section>

        <section className="conversation-detail" aria-live="polite">
          <div className="detail-toolbar">
            <div>
              <button type="button" aria-label="Back"><HugeiconsIcon icon={ArrowLeft01Icon} size={12} /></button>
              <button type="button" aria-label="Archive"><HugeiconsIcon icon={Archive02Icon} size={12} /></button>
              <button type="button" aria-label="Mark complete"><HugeiconsIcon icon={Tick02Icon} size={12} /></button>
            </div>
            <div>
              <span>{selected.id}</span>
              <button type="button" aria-label="More options"><HugeiconsIcon icon={MoreHorizontalIcon} size={12} /></button>
            </div>
          </div>

          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              className="detail-content"
              key={selected.id}
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -5 }}
              transition={{ duration: reduceMotion ? 0 : .18 }}
            >
              <div className="detail-title">
                <div><span className="detail-status"><i /> Open</span><h2>{selected.subject}</h2></div>
                <span className="detail-label">{selected.label}</span>
              </div>

              <div className="route-audit">
                <span><HugeiconsIcon icon={Globe02Icon} size={13} /> {selected.address}</span>
                <b aria-hidden="true"><HugeiconsIcon icon={ArrowRight01Icon} size={11} /></b>
                <span><HugeiconsIcon icon={Database01Icon} size={13} /> Inbox</span>
                <small>rule: support-primary</small>
              </div>

              <article className="mail-message">
                <span className={`sender-avatar sender-avatar--${selected.avatar}`}>{selected.initials}</span>
                <div className="mail-message__body">
                  <div className="mail-message__from"><span><strong>{selected.name}</strong><small>{selected.email}</small></span><time>{selected.received}</time></div>
                  {selected.body.split("\n").map((line, index) => <p key={`${selected.id}-${index}`}>{line || <br />}</p>)}
                </div>
              </article>

              <div className="reply-composer">
                <div className="reply-composer__identity">
                  <span>Reply as</span><strong><i /> {selected.address}</strong><button type="button" aria-label="Change reply identity"><HugeiconsIcon icon={ArrowDown01Icon} size={11} /></button>
                </div>
                <textarea value={draft} onChange={(event) => { setDraft(event.target.value); setQueued(false); }} aria-label="Reply draft" />
                <div className="reply-composer__footer">
                  <div>
                    <button type="button" aria-label="Attach file"><HugeiconsIcon icon={Attachment01Icon} size={12} /></button>
                    <button type="button" aria-label="Insert variable"><HugeiconsIcon icon={SourceCodeIcon} size={12} /></button>
                    <span>Saved</span>
                  </div>
                  <button className="send-button" onClick={queueReply} type="button">Send reply <HugeiconsIcon icon={ArrowUpRight01Icon} size={13} /></button>
                </div>
              </div>
            </motion.div>
          </AnimatePresence>
        </section>
      </div>

      <AnimatePresence>
        {queued && (
          <motion.div className="send-toast" initial={{ opacity: 0, y: 8, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0 }}>
            <HugeiconsIcon icon={CheckmarkCircle02Icon} size={17} />
            <span><strong>Reply queued</strong><small>Sending from {selected.address}</small></span>
            <button type="button" onClick={() => setQueued(false)}>Dismiss</button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ShieldKeyIconView() {
  return <HugeiconsIcon icon={ShieldKeyIcon} size={11} strokeWidth={1.8} />;
}
