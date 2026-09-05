"use client";

import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowUpRight01Icon,
  CheckmarkCircle02Icon,
  Database01Icon,
  Mail01Icon,
  ShieldKeyIcon,
  WorkflowCircle01Icon,
} from "@hugeicons/core-free-icons";

const flowModes = [
  {
    id: "receive",
    label: "Receive",
    title: "Inbound, made legible.",
    copy: "A provider accepts the message. MailPiston verifies the event, stores the canonical message, and attaches it to the right conversation.",
    event: "message.received",
    status: "Thread created",
  },
  {
    id: "route",
    label: "Route",
    title: "One address, deliberate paths.",
    copy: "Rules can notify a private mailbox, call your application, or deliver to a group - without making any destination the source of truth.",
    event: "route.matched",
    status: "2 destinations",
  },
  {
    id: "reply",
    label: "Reply",
    title: "Your private inbox stays private.",
    copy: "Reply from the mailbox you already use. MailPiston validates the relay token, restores thread context, and sends from the public support identity.",
    event: "reply.authorized",
    status: "Identity protected",
  },
] as const;

export function MailFlowDemo() {
  const [activeId, setActiveId] = useState<(typeof flowModes)[number]["id"]>("receive");
  const reduceMotion = useReducedMotion();
  const active = flowModes.find((mode) => mode.id === activeId) ?? flowModes[0];

  return (
    <div className="flow-demo" aria-label="Interactive MailPiston email flow demonstration">
      <div className="flow-demo__tabs" role="tablist" aria-label="Email workflow stages">
        {flowModes.map((mode) => (
          <button
            className={mode.id === activeId ? "flow-tab is-active" : "flow-tab"}
            id={`flow-tab-${mode.id}`}
            key={mode.id}
            onClick={() => setActiveId(mode.id)}
            role="tab"
            aria-controls="flow-panel"
            aria-selected={mode.id === activeId}
            type="button"
          >
            {mode.label}
          </button>
        ))}
      </div>

      <div className="flow-demo__body">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            animate={{ opacity: 1, y: 0 }}
            className="flow-demo__copy"
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
            key={active.id}
            role="tabpanel"
            id="flow-panel"
            aria-labelledby={`flow-tab-${active.id}`}
            transition={{ duration: reduceMotion ? 0 : 0.24, ease: "easeOut" }}
          >
            <span className="eyebrow eyebrow--small">{active.event}</span>
            <h3>{active.title}</h3>
            <p>{active.copy}</p>
            <span className="flow-status">
              <HugeiconsIcon icon={CheckmarkCircle02Icon} size={17} strokeWidth={1.8} />
              {active.status}
            </span>
          </motion.div>
        </AnimatePresence>

        <div className={`route-map route-map--${active.id}`} aria-hidden="true">
          <div className="route-map__line route-map__line--one" />
          <div className="route-map__line route-map__line--two" />

          <motion.div
            className="route-node route-node--sender"
            animate={reduceMotion ? undefined : { y: [0, -5, 0] }}
            transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut" }}
          >
            <span className="route-node__icon route-node__icon--blue">
              <HugeiconsIcon icon={Mail01Icon} size={19} strokeWidth={1.7} />
            </span>
            <span><small>Customer</small>alex@outside.co</span>
          </motion.div>

          <motion.div
            className="route-node route-node--core"
            animate={reduceMotion ? undefined : { scale: [1, 1.025, 1] }}
            transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
          >
            <span className="route-node__icon route-node__icon--orange">
              <HugeiconsIcon icon={WorkflowCircle01Icon} size={20} strokeWidth={1.7} />
            </span>
            <span><small>MailPiston</small>support@yourdomain.com</span>
          </motion.div>

          <motion.div
            className="route-node route-node--store"
            animate={reduceMotion ? undefined : { y: [0, 4, 0] }}
            transition={{ duration: 4.1, repeat: Infinity, ease: "easeInOut", delay: 0.4 }}
          >
            <span className="route-node__icon route-node__icon--pink">
              {active.id === "reply" ? (
                <HugeiconsIcon icon={ShieldKeyIcon} size={19} strokeWidth={1.7} />
              ) : (
                <HugeiconsIcon icon={Database01Icon} size={19} strokeWidth={1.7} />
              )}
            </span>
            <span>
              <small>{active.id === "reply" ? "Private reply" : "Your record"}</small>
              {active.id === "route" ? "Inbox + webhook" : active.id === "reply" ? "you@personal.com" : "Thread #MP-1042"}
            </span>
          </motion.div>

          {!reduceMotion && (
            <motion.span
              animate={{ left: ["23%", "51%"], opacity: [0, 1, 0] }}
              className="route-pulse route-pulse--one"
              transition={{ duration: 2.1, repeat: Infinity, ease: "easeInOut" }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export function PricingPreview() {
  const [annual, setAnnual] = useState(true);
  const reduceMotion = useReducedMotion();

  return (
    <div className="pricing-preview">
      <div className="pricing-toggle" aria-label="Billing period">
        <button type="button" className={!annual ? "is-active" : ""} onClick={() => setAnnual(false)} aria-pressed={!annual}>
          Monthly
        </button>
        <button type="button" className={annual ? "is-active" : ""} onClick={() => setAnnual(true)} aria-pressed={annual}>
          Annual <span>save 20%</span>
        </button>
      </div>

      <div className="price-card price-card--featured">
        <div className="price-card__glow" aria-hidden="true" />
        <span className="eyebrow eyebrow--small">Hosted</span>
        <div className="price-line" aria-live="polite">
          <AnimatePresence mode="wait" initial={false}>
            <motion.strong
              animate={{ opacity: 1, y: 0 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
              key={annual ? "annual" : "monthly"}
              transition={{ duration: reduceMotion ? 0 : 0.2 }}
            >
              ${annual ? "12" : "15"}
            </motion.strong>
          </AnimatePresence>
          <span>/ month{annual ? ", billed yearly" : ""}</span>
        </div>
        <p>The managed control plane, for operators who would rather not run the application layer themselves.</p>
        <ul>
          <li><HugeiconsIcon icon={CheckmarkCircle02Icon} size={18} /> Managed MailPiston workspace</li>
          <li><HugeiconsIcon icon={CheckmarkCircle02Icon} size={18} /> Multiple domains and reply identities</li>
          <li><HugeiconsIcon icon={CheckmarkCircle02Icon} size={18} /> Provider and usage costs billed at cost</li>
        </ul>
        <a className="button button--dark button--wide" href="#access-note">
          Understand the model
          <HugeiconsIcon icon={ArrowUpRight01Icon} size={18} />
        </a>
        <small>Your delivery, database, and storage providers bill you directly.</small>
      </div>
    </div>
  );
}
