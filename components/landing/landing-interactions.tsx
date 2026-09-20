"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Background,
  BackgroundVariant,
  MarkerType,
  ReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
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
  const graph = useMemo(() => createFlowGraph(active.id), [active.id]);

  return (
    <div className="flow-demo" id="flow-canvas" aria-label="Interactive MailPiston email flow demonstration">
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

        <div className={`route-map route-map--${active.id}`} aria-label={`${active.label} routing diagram`}>
          <ReactFlow
            nodes={graph.nodes}
            edges={graph.edges}
            fitView
            fitViewOptions={{ padding: 0.18 }}
            minZoom={0.65}
            maxZoom={1.1}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            panOnDrag={false}
            zoomOnDoubleClick={false}
            zoomOnPinch={false}
            zoomOnScroll={false}
            preventScrolling={false}
          >
            <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
          </ReactFlow>
        </div>
      </div>
    </div>
  );
}

type FlowModeId = (typeof flowModes)[number]["id"];

function createFlowGraph(mode: FlowModeId): { nodes: Node[]; edges: Edge[] } {
  const destination = mode === "reply"
    ? { overline: "Private reply", value: "you@personal.com", icon: ShieldKeyIcon }
    : mode === "route"
      ? { overline: "Destinations", value: "Inbox + webhook", icon: Database01Icon }
      : { overline: "Canonical record", value: "Thread #MP-1042", icon: Database01Icon };

  const nodes: Node[] = [
    {
      id: "sender",
      type: "input",
      position: { x: 24, y: 30 },
      className: "flow-node flow-node--sender",
      data: { label: <FlowNodeLabel icon={Mail01Icon} overline="Customer" value="alex@outside.co" /> },
    },
    {
      id: "core",
      position: { x: 245, y: 142 },
      className: "flow-node flow-node--core",
      data: { label: <FlowNodeLabel icon={WorkflowCircle01Icon} overline="MailPiston" value="support@yourdomain.com" /> },
    },
    {
      id: "destination",
      type: "output",
      position: { x: 500, y: 264 },
      className: "flow-node flow-node--destination",
      data: { label: <FlowNodeLabel icon={destination.icon} overline={destination.overline} value={destination.value} /> },
    },
  ];

  const edges: Edge[] = [
    {
      id: `sender-core-${mode}`,
      source: "sender",
      target: "core",
      animated: true,
      type: "smoothstep",
      markerEnd: { type: MarkerType.ArrowClosed },
      label: mode === "receive" ? "verified event" : mode === "route" ? "rule match" : "signed relay",
      className: "flow-edge",
    },
    {
      id: `core-destination-${mode}`,
      source: "core",
      target: "destination",
      animated: true,
      type: "smoothstep",
      markerEnd: { type: MarkerType.ArrowClosed },
      label: mode === "receive" ? "stored once" : mode === "route" ? "fan-out" : "identity restored",
      className: "flow-edge flow-edge--accent",
    },
  ];

  return { nodes, edges };
}

function FlowNodeLabel({ icon, overline, value }: { icon: typeof Mail01Icon; overline: string; value: string }) {
  return (
    <span className="flow-node__content">
      <span className="flow-node__icon"><HugeiconsIcon icon={icon} size={19} strokeWidth={1.7} /></span>
      <span><small>{overline}</small><strong>{value}</strong></span>
    </span>
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
