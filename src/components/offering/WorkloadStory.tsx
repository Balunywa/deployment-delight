/*
 * The workload's flows, drawn in the architecture standard: who reaches it and how (traffic), which identity
 * reaches which service with which role (identity), where every diagnostic ends up (logging), and how the
 * pipeline ships it (deploy). Computed from the design by the flows engine, so adding a service changes the picture.
 */
import { useMemo, useState } from "react";

import {
  type StoryData,
  type StoryLayout,
  type StoryNode,
  StoryView,
} from "@/components/lz/diagram/Story";
import { iconName } from "@/components/lz/diagram/theme";
import type { Architecture } from "@/lib/architecture";
import { type DiagramNode, type WorkloadFlow, nodesFor, workloadFlows } from "@/lib/offering/flows";
import { cn } from "@/lib/utils";

export type Lens = WorkloadFlow["kind"];

const LENSES: { id: Lens; title: string; body: string }[] = [
  { id: "traffic", title: "Traffic", body: "Requests in, calls between services, and the way out" },
  {
    id: "identity",
    title: "Identity",
    body: "Which identity reaches which service, with which role",
  },
  { id: "logging", title: "Logging", body: "Where diagnostics and telemetry end up" },
  { id: "deploy", title: "Deploy", body: "How the pipeline ships each release" },
];

const W = 1240;
const H = 880;
const ROWS = [
  { y: 30, h: 62 },
  { y: 176, h: 62 },
  { y: 312, h: 62 },
  { y: 448, h: 62 },
  { y: 584, h: 62 },
  { y: 760, h: 62 },
];
const GAPS = [
  { top: 100, bottom: 168 },
  { top: 244, bottom: 300 },
  { top: 380, bottom: 436 },
  { top: 516, bottom: 576 },
  { top: 680, bottom: 748 },
];
/** Containers, not things that talk: drawn as boundaries rather than cards. */
const HIDDEN = new Set(["resource-group", "private-endpoints"]);
const ROW_OF: Record<DiagramNode["row"], number> = {
  outside: 0,
  edge: 1,
  app: 2,
  integration: 3,
  data: 3,
  shared: 4,
  platform: 5,
};

/** Where every node sits: one row per tier, spread evenly, tighter when a row is crowded. */
function workloadLayout(arch: Architecture, marks?: Map<string, "added" | "removed">): StoryLayout {
  const all = nodesFor(arch).filter((n) => !HIDDEN.has(n.id));
  // The spoke itself only matters for its flow logs; it sits with the shared services.
  const rowOf = (n: DiagramNode) => (n.id === "network-spoke" ? 4 : ROW_OF[n.row]);
  const nodes: StoryNode[] = [];
  for (let r = 0; r < ROWS.length; r++) {
    const items = all.filter((n) => rowOf(n) === r);
    if (!items.length) continue;
    const x0 = r === 0 ? 40 : 300 - (r === 5 ? 20 : 0);
    const x1 = r === 0 ? 1200 : 1180;
    const gap = 20;
    const w = Math.min(220, (x1 - x0 - gap * (items.length - 1)) / items.length);
    const span = items.length * w + gap * (items.length - 1);
    const start = x0 + (x1 - x0 - span) / 2;
    items.forEach((n, i) =>
      nodes.push({
        id: n.id,
        title: n.title,
        // "Compute · Microsoft.ContainerService/managedClusters" is unreadable in a card; the category is enough.
        sub: n.sub.includes("Microsoft.") ? n.sub.split(" · ")[0]! : n.sub,
        icon: iconName(n.id, n.icon || "subscription"),
        row: r,
        x: start + i * (w + gap),
        y: ROWS[r]!.y,
        w,
        h: ROWS[r]!.h,
        ...(w < 160 ? { tight: true } : {}),
        ...(r === 0 && n.id !== "users" ? { optional: true } : {}),
        ...(marks?.get(n.id) ? { mark: marks.get(n.id) } : {}),
      }),
    );
  }
  const hosted = arch.topology.landing === "isv-hosted";
  const hub = arch.topology.landing === "existing-customer-hub";
  return {
    width: W,
    height: H,
    rows: ROWS,
    gaps: GAPS,
    nodes,
    zones: [
      {
        x: 280,
        y: 288,
        w: 920,
        h: 236,
        label: "Spoke virtual network · application, integration and data subnets",
        dashed: true,
      },
      { x: 280, y: 560, w: 920, h: 104, label: "Shared services" },
    ],
    outer: {
      x: 260,
      y: 140,
      w: 960,
      h: 548,
      title: hosted ? "Your subscription" : "Customer subscription",
      sub: `${arch.topology.regions.join(", ")} · ${arch.topology.landingZone} landing zone`,
    },
    lower: {
      x: 240,
      y: 712,
      w: 980,
      h: 140,
      labelAt: "bottom",
      label: hub
        ? "The customer's landing zone: hub, firewall, private DNS and Log Analytics this workload uses"
        : "Platform services this workload uses: Microsoft Entra ID, private DNS, Log Analytics",
    },
  };
}

export function WorkloadStory({
  arch,
  compareWith,
  lens: fixedLens,
  compact,
  marks,
}: {
  arch: Architecture;
  compareWith?: { label: string; arch: Architecture } | undefined;
  /** Show one lens only (e.g. in a guided step). */
  lens?: Lens | undefined;
  compact?: boolean;
  /** Highlight what a change adds or removes. */
  marks?: Map<string, "added" | "removed"> | undefined;
}) {
  const [lens, setLens] = useState<Lens>(fixedLens ?? "traffic");
  const active = fixedLens ?? lens;
  const mine = useMemo<StoryData>(() => {
    const flows = workloadFlows(arch, arch.workload);
    return { layout: workloadLayout(arch, marks), flows };
  }, [arch, marks]);
  const other = useMemo(() => {
    if (!compareWith) return undefined;
    return {
      label: compareWith.label,
      layout: workloadLayout(compareWith.arch),
      flows: workloadFlows(compareWith.arch, compareWith.arch.workload),
    };
  }, [compareWith]);
  const all = mine.flows as WorkloadFlow[];
  const only = [...all, ...((other?.flows ?? []) as WorkloadFlow[])]
    .filter((f) => f.kind === active)
    .map((f) => f.id);
  return (
    <div className="space-y-3">
      {!fixedLens && (
        <div role="tablist" aria-label="Flows" className="flex flex-wrap gap-1.5">
          {LENSES.map((l) => {
            const n = all.filter((f) => f.kind === l.id && f.available).length;
            return (
              <button
                key={l.id}
                role="tab"
                aria-selected={active === l.id}
                onClick={() => setLens(l.id)}
                title={l.body}
                className={cn(
                  "rounded-lg border px-3 py-1.5 text-left text-[12.5px] transition-colors",
                  active === l.id
                    ? "border-primary/50 bg-primary/[0.07] font-semibold text-primary"
                    : "border-border bg-card text-muted-foreground hover:text-foreground",
                )}
              >
                {l.title} <span className="font-normal opacity-70">· {n}</span>
              </button>
            );
          })}
        </div>
      )}
      <StoryView
        key={active}
        mine={mine}
        other={other}
        only={only}
        compact={compact ?? false}
        fileName={`workload-${active}`}
        label={`${LENSES.find((l) => l.id === active)!.title} flows of this workload`}
        categories={`${LENSES.find((l) => l.id === active)!.title} flows`}
        intro="The pieces of this workload. Press Next to add one flow at a time."
        allLabel={active === "traffic" ? "All traffic" : `All ${active} flows`}
      />
    </div>
  );
}
