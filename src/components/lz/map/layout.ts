/*
 * Where everything goes, computed from the design — nobody places a box by hand, so the picture is the same
 * every time and connectors only join things that are actually related.
 *
 * Architecture reads left to right the way traffic does: outside Azure → connectivity (and identity) →
 * landing zones with the customer installs → platform services. Management groups are a left-to-right tree.
 * Every size is fixed, so the layout is a pure function of the design.
 */
import {
  Boxes,
  Globe,
  Layers,
  LayoutDashboard,
  Network,
  UserCog,
  Users,
  type LucideIcon,
} from "lucide-react";

import {
  type AlzLibrary,
  type Answers,
  LANDING_ZONE_LABEL,
  type MgNode,
  type OptionalGroup,
  REMOVABLE_GROUPS,
  hasFirewall,
  hasHub,
  isCustomGroup,
  on,
  placementGroup,
  platformResources,
  spokeOf,
} from "@/lib/alz/engine";
import type { Sel, Spoke } from "@/lib/alz/scene";
import { workloadById } from "@/lib/alz/workloads";
import { AZURE_REGIONS } from "@/lib/regions";

import { ICON, TONE, removeGroup, toggleGroup } from "./parts";
import type { Adding } from "../HierarchyEditor";

type Patch = (p: Partial<Answers>) => void;

export type Rect = { x: number; y: number; w: number; h: number };
export type Action = { label: string; title: string; onClick: () => void; danger?: boolean };

export type ZoneData = {
  kind: "zone";
  title: string;
  subtitle?: string | undefined;
  tone: "sub" | "vnet" | "lz" | "quiet";
  on: boolean;
  toggle?: (() => void) | undefined;
  sel?: Sel | undefined;
};
export type ItemData = {
  kind: "item";
  label: string;
  detail?: string | undefined;
  icon?: LucideIcon | undefined;
  color?: string | undefined;
  on: boolean;
  variant?: "res" | "spoke" | "ghost" | "add" | "more" | "extra";
  toggle?: (() => void) | undefined;
  sel?: Sel | undefined;
  onClick?: (() => void) | undefined;
  actions?: Action[] | undefined;
};
export type ExtData = {
  kind: "ext";
  label: string;
  detail: string;
  icon: LucideIcon;
  sel: Sel;
};
export type LabelData = { kind: "label"; text: string };
export type MgData = {
  kind: "mg";
  title: string;
  counts: string;
  tags: { label: string; on: boolean; pending?: boolean }[];
  included: boolean;
  custom: boolean;
  root?: boolean;
  sel?: Sel | undefined;
  /** A library group this design leaves out; clicking puts it back. */
  restore?: (() => void) | undefined;
  toggle?: (() => void) | undefined;
  actions?: Action[] | undefined;
};
export type NodeData = ZoneData | ItemData | ExtData | LabelData | MgData;

export type MapNode = {
  id: string;
  type: NodeData["kind"];
  parentId?: string | undefined;
  /** Position relative to the parent (or the canvas). */
  rel: { x: number; y: number };
  abs: Rect;
  data: NodeData;
};
export type MapEdge = {
  id: string;
  source: string;
  target: string;
  kind: "peering" | "onprem" | "public" | "tree" | "ghost";
  label?: string | undefined;
};
export type Graph = {
  nodes: MapNode[];
  edges: MapEdge[];
  sections: { label: string; ids: string[] }[];
};

const IW = 164;
const IH = 46;
const GAP = 8;
const PAD = 12;
const HEAD = 52;
const TWO = PAD * 2 + IW * 2 + GAP;
const EXT = { w: 176, h: 58 };
const ONE = 212;

type ItemSpec = { id: string; data: ItemData; wide?: boolean };

class Builder {
  nodes: MapNode[] = [];
  edges: MapEdge[] = [];

  private push(
    id: string,
    type: MapNode["type"],
    abs: Rect,
    data: NodeData,
    parent?: MapNode | undefined,
  ) {
    const n: MapNode = {
      id,
      type,
      parentId: parent?.id,
      rel: parent ? { x: abs.x - parent.abs.x, y: abs.y - parent.abs.y } : { x: abs.x, y: abs.y },
      abs,
      data,
    };
    this.nodes.push(n);
    return n;
  }

  item(spec: ItemSpec, x: number, y: number, w: number, parent?: MapNode) {
    return this.push(spec.id, "item", { x, y, w, h: IH }, spec.data, parent);
  }

  ext(id: string, x: number, y: number, data: ExtData) {
    return this.push(id, "ext", { x, y, ...EXT }, data);
  }

  label(id: string, x: number, y: number, w: number, text: string) {
    return this.push(id, "label", { x, y, w, h: 24 }, { kind: "label", text });
  }

  /** A box (subscription, virtual network, landing zone group) with its contents laid out inside it. */
  zone(
    id: string,
    x: number,
    y: number,
    w: number,
    data: ZoneData,
    fill?: (z: {
      items: (list: ItemSpec[]) => void;
      nest: (id: string, data: ZoneData, fill?: Parameters<Builder["zone"]>[5]) => void;
    }) => void,
    parent?: MapNode,
    cols: 1 | 2 = 2,
  ): MapNode {
    const node = this.push(id, "zone", { x, y, w, h: HEAD }, data, parent);
    const iw = (w - PAD * 2 - (cols - 1) * GAP) / cols;
    let cy = y + HEAD;
    let used = false;
    if (data.on && fill)
      fill({
        items: (list) => {
          let col = 0;
          for (const it of list) {
            if (it.wide) {
              if (col) cy += IH + GAP;
              this.item(it, x + PAD, cy, w - PAD * 2, node);
              cy += IH + GAP;
              col = 0;
            } else {
              this.item(it, x + PAD + col * (iw + GAP), cy, iw, node);
              col = (col + 1) % cols;
              if (!col) cy += IH + GAP;
            }
            used = true;
          }
          if (col) cy += IH + GAP;
        },
        nest: (cid, cdata, cfill) => {
          const child = this.zone(cid, x + PAD, cy, w - PAD * 2, cdata, cfill, node);
          cy += child.abs.h + GAP;
          used = true;
        },
      });
    node.abs.h = used ? cy - GAP + PAD - y : HEAD;
    return node;
  }

  edge(source: string, target: string, kind: MapEdge["kind"], label?: string) {
    if (!this.nodes.some((n) => n.id === source) || !this.nodes.some((n) => n.id === target))
      return;
    this.edges.push({ id: `${kind}:${source}->${target}`, source, target, kind, label });
  }
}

export type BuildInput = {
  lib: AlzLibrary;
  tree: MgNode[];
  answers: Answers;
  spokes: Spoke[];
  set?: Patch | undefined;
  onAdd: (a: Adding) => void;
  /** A scanned tenant: the parts and management groups actually found, and ALZ coverage per group. */
  asIs?: { parts: Set<string>; counts: Record<string, string>; present: Set<string> } | undefined;
};

/** Parts a tenant scan can find; the rest follow the design. */
const SCANNED = new Set([
  "firewall",
  "vpngw",
  "ergw",
  "bastion",
  "dnsresolver",
  "dnszones",
  "ddos",
  "law",
  "sentinel",
]);

const toggleLz = (set: Patch, a: Answers, g: OptionalGroup) => toggleGroup(set, a, g);

/* ------------------------------------------------------------ architecture */

export function architecture({
  lib,
  tree,
  answers: a,
  spokes,
  set,
  onAdd,
  asIs,
}: BuildInput): Graph {
  const b = new Builder();
  const edit = !!set;
  const wan = a.connectivity === "virtual_wan";
  const hub = hasHub(a);
  const fw = hasFirewall(a);
  const second = hub && !!a.secondaryRegion && a.secondaryRegion !== a.primaryRegion;
  const res = new Set(platformResources(a).map((r) => r.id));
  const has = (id: string) => tree.some((n) => n.libraryId === id);
  const exists = (id: string) => lib.managementGroups.some((m) => m.id === id);
  const vended = new Set(a.extraSubscriptions.map((x) => x.customerId).filter(Boolean));
  const extras = a.extraSubscriptions.map((x, i) => ({ x, ...spokeOf(a, lib, x, i) }));

  const C0 = 0;
  const C1 = EXT.w + 80;
  const W1 = TWO + PAD * 2;
  const C2 = C1 + W1 + 80;
  const C3 = C2 + TWO + 80;
  const TOP = 96;

  const found = (id: string, designed: boolean) => {
    const base = id === "seclaw" ? "sentinel" : id.replace(/2$/, "");
    return asIs && SCANNED.has(base) ? asIs.parts.has(base) : designed;
  };
  const res$ = (
    id: string,
    label: string,
    designed: boolean,
    toggle?: (() => void) | false,
    detail?: string,
    sel?: Sel,
  ): ItemSpec => {
    const isOn = found(id, designed);
    return {
      id,
      data: {
        kind: "item",
        label,
        detail: asIs && !isOn ? "Not found" : detail,
        icon: ICON[id.replace(/2$/, "")] ?? Boxes,
        color: TONE[id.replace(/2$/, "")] ?? "#0078d4",
        on: isOn,
        variant: "res",
        toggle: set && toggle ? toggle : undefined,
        sel: sel ?? { kind: "res", id: id.replace(/2$/, "") },
      },
    };
  };
  const addItem = (id: string, label: string, onClick: () => void): ItemSpec => ({
    id,
    wide: true,
    data: { kind: "item", label, on: true, variant: "add", onClick },
  });

  /* Connectivity and identity */
  const hubItems = (n: 1 | 2): ItemSpec[] => {
    const s = n === 2 ? "2" : "";
    return [
      // Gateways face on-premises (left), the firewall faces the spokes (right).
      res$(`vpngw${s}`, "VPN gateway", on(a.vpnGateway), () =>
        set?.({ vpnGateway: on(a.vpnGateway) ? "no" : "yes" }),
      ),
      res$(
        `firewall${s}`,
        "Azure Firewall",
        fw,
        () => set?.({ firewall: fw ? "none" : "Standard" }),
        fw ? `${a.firewall} · central egress` : undefined,
      ),
      res$(`ergw${s}`, "ExpressRoute gateway", on(a.expressRoute), () =>
        set?.({ expressRoute: on(a.expressRoute) ? "no" : "yes" }),
      ),
      res$(`dnsresolver${s}`, "DNS Private Resolver", a.privateDns === "platform", () =>
        set?.({ privateDns: a.privateDns === "platform" ? "none" : "platform" }),
      ),
      ...(wan
        ? []
        : [
            res$(`bastion${s}`, "Azure Bastion", on(a.bastion), () =>
              set?.({ bastion: on(a.bastion) ? "no" : "yes" }),
            ),
          ]),
    ];
  };
  const nextRegion =
    AZURE_REGIONS.find(
      (r) =>
        r.name !== a.primaryRegion &&
        r.geo === AZURE_REGIONS.find((x) => x.name === a.primaryRegion)?.geo,
    )?.name ?? "centralus";
  const conn = b.zone(
    "sub:connectivity",
    C1,
    TOP,
    W1,
    {
      kind: "zone",
      title: "Connectivity subscription",
      subtitle: hub ? (wan ? "Virtual WAN" : "Hub and spoke") : "No central network",
      tone: "sub",
      on: hub,
      toggle: set && (() => set({ connectivity: hub ? "none" : "hub_and_spoke" })),
      sel: { kind: "sub", id: "connectivity" },
    },
    (z) => {
      z.items([
        res$("ddos", "DDoS Network Protection", on(a.ddosPlan), () =>
          set?.({ ddosPlan: on(a.ddosPlan) ? "no" : "yes" }),
        ),
        res$("dnszones", "Private DNS zones", a.privateDns === "platform", () =>
          set?.({ privateDns: a.privateDns === "platform" ? "none" : "platform" }),
        ),
        ...(wan
          ? [
              res$(
                "bastion",
                "Azure Bastion",
                on(a.bastion),
                () => set?.({ bastion: on(a.bastion) ? "no" : "yes" }),
                "In a sidecar network",
              ),
            ]
          : []),
      ]);
      z.nest(
        "hub1",
        {
          kind: "zone",
          title: `${wan ? "Virtual hub" : "Hub virtual network"} · ${a.primaryRegion}`,
          subtitle: wan ? "Secured hub with routing intent" : "Every Corp install peers here",
          tone: "vnet",
          on: true,
          sel: { kind: "res", id: wan ? "vhub" : "hubvnet" },
        },
        (h) => h.items(hubItems(1)),
      );
      if (second)
        z.nest(
          "hub2",
          {
            kind: "zone",
            title: `${wan ? "Virtual hub" : "Hub virtual network"} · ${a.secondaryRegion}`,
            subtitle: "Second region",
            tone: "vnet",
            on: true,
            sel: { kind: "res", id: wan ? "vhub2" : "hubvnet2" },
          },
          (h) =>
            h.items([
              ...hubItems(2),
              ...(edit
                ? [
                    addItem("remove-hub2", "Remove the second region", () =>
                      set?.({ secondaryRegion: "" }),
                    ),
                  ]
                : []),
            ]),
        );
      else if (edit)
        z.items([
          addItem("add-hub2", "Add a hub in a second region", () =>
            set?.({ secondaryRegion: nextRegion }),
          ),
        ]);
    },
  );
  const idn = b.zone(
    "sub:identity",
    C1,
    TOP + conn.abs.h + 56,
    W1,
    {
      kind: "zone",
      title: "Identity subscription",
      subtitle: on(a.identity)
        ? "Domain controllers, peered to the hub"
        : "Left out of this design",
      tone: "sub",
      on: on(a.identity),
      toggle: set && (() => set({ identity: on(a.identity) ? "no" : "yes" })),
      sel: { kind: "sub", id: "identity" },
    },
    (z) =>
      z.items([
        {
          id: "identityvnet",
          wide: true,
          data: {
            kind: "item",
            label: `Virtual network · ${a.primaryRegion}`,
            detail: "Domain controllers or Entra Domain Services, DNS, backup vault",
            icon: Network,
            color: "#0078d4",
            on: true,
            variant: "res",
            sel: { kind: "sub", id: "identity" },
          },
        },
      ]),
  );

  /* Landing zones: the customer installs */
  let y2 = 0;
  const lzZone = (
    group: string,
    title: string,
    subtitle: string,
    opts: { optional: boolean; peeredNote: string },
  ) => {
    const isOn = has(group);
    const list = [
      ...new Map(
        spokes
          .filter((s) => s.group === group && !(s.placement && vended.has(s.placement.customerId)))
          .map((s) => [s.id, s]),
      ).values(),
    ];
    const live = list.filter((s) => !s.ghost);
    const shown = list.slice(0, 6);
    const items: ItemSpec[] = shown.map((s) => ({
      id: `spoke:${s.id}`,
      data: {
        kind: "item",
        label: s.placement ? s.placement.customerName : "Next customer install",
        detail: s.ghost
          ? "Created when a customer is onboarded"
          : `${s.placement?.environment.toUpperCase()} · ${opts.peeredNote}`,
        icon: Boxes,
        color: "#0078d4",
        on: true,
        variant: s.ghost ? "ghost" : "spoke",
        sel: { kind: "spoke", id: s.id },
      },
    }));
    if (list.length > shown.length)
      items.push({
        id: `more:${group}`,
        data: {
          kind: "item",
          label: `+${list.length - shown.length} more installs`,
          detail: "Open the group to see them all",
          on: true,
          variant: "more",
          sel: { kind: "mg", id: group },
        },
      });
    for (const e of extras.filter((e) => e.x.group === group))
      items.push({
        id: `extra:${e.x.id}`,
        data: {
          kind: "item",
          label: e.x.name,
          detail: `${e.x.environment} · ${e.vnet ? `vnet ${e.cidr}` : "no network"}${e.peered ? (wan ? " · on the vWAN hub" : " · peered") : ""}`,
          icon: Boxes,
          color: "#e8a900",
          on: true,
          variant: "extra",
          sel: { kind: "mg", id: group },
          actions: set
            ? [
                ...(hub && e.vnet
                  ? [
                      {
                        label: e.peered ? "Unpeer" : "Peer",
                        title: e.peered ? "Disconnect from the hub" : "Connect to the hub",
                        onClick: () =>
                          set({
                            extraSubscriptions: a.extraSubscriptions.map((y) =>
                              y.id === e.x.id ? { ...y, peer: !e.peered } : y,
                            ),
                          }),
                      },
                    ]
                  : []),
                {
                  label: "Remove",
                  title: "Remove this subscription",
                  danger: true,
                  onClick: () =>
                    set({
                      extraSubscriptions: a.extraSubscriptions.filter((y) => y.id !== e.x.id),
                    }),
                },
              ]
            : undefined,
        },
      });
    // Workload landing zones (AKS, AVD, ...) chosen for this group: what each accelerator deploys into its installs.
    for (const w of a.workloads.filter((x) => x.group === group)) {
      const def = workloadById(w.id);
      if (!def) continue;
      items.push({
        id: `workload:${group}:${w.id}`,
        wide: true,
        data: {
          kind: "item",
          label: `${def.short} landing zone`,
          detail: def.deploys.join(", "),
          icon: Layers,
          color: "#5c2e91",
          on: true,
          variant: "res",
          sel: { kind: "mg", id: group },
          actions: set
            ? [
                {
                  label: "Remove",
                  title: `Stop using the ${def.short} landing zone accelerator here`,
                  danger: true,
                  onClick: () =>
                    set({
                      workloads: a.workloads.filter((x) => !(x.group === group && x.id === w.id)),
                    }),
                },
              ]
            : undefined,
        },
      });
    }
    if (edit)
      items.push(
        addItem(`add:${group}`, "Add a subscription", () =>
          onAdd({ kind: "subscription", parent: group }),
        ),
      );
    const z = b.zone(
      `sub:${group}`,
      C2,
      y2,
      TWO,
      {
        kind: "zone",
        title,
        subtitle: isOn
          ? `${subtitle}${live.length ? ` · ${live.length} install${live.length === 1 ? "" : "s"}` : ""}`
          : "Left out of this design",
        tone: "lz",
        on: isOn,
        toggle: set && opts.optional ? () => toggleLz(set, a, group as OptionalGroup) : undefined,
        sel: isOn ? { kind: "mg", id: group } : undefined,
      },
      (f) => f.items(items),
    );
    y2 += z.abs.h + 40;
    return z;
  };
  const peerNote = hub ? (wan ? "on the vWAN hub" : "peered to the hub") : "own network";
  const name = (id: string, fallback: string) => a.groupNames[id] || fallback;
  if (exists("online"))
    lzZone("online", `${name("online", "Online")} landing zones`, "Internet-facing, not peered", {
      optional: true,
      peeredNote: "public endpoints",
    });
  if (exists("corp"))
    lzZone("corp", `${name("corp", "Corp")} landing zones`, "Private, egress through the hub", {
      optional: true,
      peeredNote: peerNote,
    });
  if (exists("local"))
    lzZone(
      "local",
      `${name("local", "Local")} landing zones`,
      LANDING_ZONE_LABEL["local"]?.body.split(".")[0] ?? "Local",
      {
        optional: true,
        peeredNote: "own network",
      },
    );
  for (const g of a.customGroups)
    lzZone(
      g.id,
      `${a.groupNames[g.id] || g.name} landing zones`,
      `Your group · ${g.archetype} policies`,
      {
        optional: false,
        peeredNote: peerNote,
      },
    );
  if (exists("sandbox"))
    lzZone(
      "sandbox",
      `${name("sandbox", "Sandbox")} subscriptions`,
      "Experiments, isolated from production",
      {
        optional: true,
        peeredNote: "not connected",
      },
    );
  if (edit)
    b.item(
      addItem("add-lz-group", "Add a landing zone group (e.g. Regulated, AKS platform)", () =>
        onAdd({ kind: "group", parent: "landingzones" }),
      ),
      C2,
      y2,
      TWO,
    );

  /* Platform services */
  const mgmt = b.zone(
    "sub:management",
    C3,
    TOP,
    ONE,
    {
      kind: "zone",
      title: "Management subscription",
      subtitle: "Platform logs and monitoring",
      tone: "sub",
      on: true,
      sel: { kind: "sub", id: "management" },
    },
    (z) =>
      z.items([
        res$(
          "law",
          "Log Analytics workspace",
          res.has("law"),
          false,
          `${a.logRetentionDays} days retention`,
        ),
        res$("dcr", "Data collection rules", res.has("dcr"), false, "VM insights, change tracking"),
        res$("ama", "AMA managed identity", res.has("ama"), () =>
          set?.({ monitoring: a.monitoring === "azure_monitor" ? "third_party" : "azure_monitor" }),
        ),
        {
          id: "dashboards",
          data: {
            kind: "item",
            label: "Dashboards",
            detail: "Queries, alerts, inventory",
            icon: LayoutDashboard,
            color: "#0078d4",
            on: true,
            variant: "res",
            sel: { kind: "sub", id: "management" },
          },
        },
      ]),
    undefined,
    1,
  );
  b.zone(
    "sub:security",
    C3,
    TOP + mgmt.abs.h + 56,
    ONE,
    {
      kind: "zone",
      title: "Security subscription",
      subtitle: on(a.securitySubscription)
        ? "Security team tooling and logs"
        : "Left out of this design",
      tone: "sub",
      on: on(a.securitySubscription),
      toggle:
        set && (() => set({ securitySubscription: on(a.securitySubscription) ? "no" : "yes" })),
      sel: { kind: "sub", id: "security" },
    },
    (z) =>
      z.items([
        res$(
          "seclaw",
          "Security workspace",
          a.siem === "sentinel",
          false,
          "A subset of platform logs",
          {
            kind: "res",
            id: "law",
          },
        ),
        res$("sentinel", "Microsoft Sentinel", a.siem === "sentinel", () =>
          set?.({ siem: a.siem === "sentinel" ? "other" : "sentinel" }),
        ),
      ]),
    undefined,
    1,
  );

  /* Outside Azure, lined up with what each one talks to */
  const at = (id: string, fallback: number) => {
    const n = b.nodes.find((x) => x.id === id);
    return n ? n.abs.y + n.abs.h / 2 - EXT.h / 2 : fallback;
  };
  const gw = on(a.expressRoute) ? "ergw" : "vpngw";
  const wanted: [string, number, ExtData][] = [
    [
      "users",
      (b.nodes.find((n) => n.id === "sub:online")?.abs.y ?? 0) + 20,
      {
        kind: "ext",
        label: "Your customers' users",
        detail: "Reach Online installs",
        icon: Users,
        sel: { kind: "ext", id: "users" },
      },
    ],
    [
      "internet",
      at("firewall", 90) - 40,
      {
        kind: "ext",
        label: "Internet",
        detail: "Outbound via the firewall",
        icon: Globe,
        sel: { kind: "ext", id: "internet" },
      },
    ],
    [
      "onprem",
      at(gw, 200),
      {
        kind: "ext",
        label: "On-premises",
        detail: on(a.expressRoute)
          ? "Connected over ExpressRoute"
          : on(a.vpnGateway)
            ? "Site-to-site VPN"
            : "Not connected",
        icon: Network,
        sel: { kind: "ext", id: "onprem" },
      },
    ],
    [
      "operator",
      at("bastion", 300) + 20,
      {
        kind: "ext",
        label: "Operators",
        detail: "Sign in with Entra ID",
        icon: UserCog,
        sel: { kind: "ext", id: "operator" },
      },
    ],
  ];
  let floor = -Infinity;
  for (const [id, y, data] of wanted.sort((p, q) => p[1] - q[1])) {
    const top = Math.max(y, floor);
    b.ext(id, C0, top, data);
    floor = top + EXT.h + 16;
  }

  b.label("label:outside", C0, -44, EXT.w, "Outside Azure");
  b.label("label:connectivity", C1, -44, W1, "Connectivity & identity");
  b.label("label:landing", C2, -44, TWO, "Landing zones · your customers");
  b.label("label:platform", C3, -44, ONE, "Platform services");

  /* Only relationships that really exist */
  if (hub) {
    if (on(a.identity)) b.edge("sub:identity", "hub1", "peering", "Peering");
    if (has("corp")) b.edge("hub1", "sub:corp", "peering", wan ? "Hub connections" : "Peering");
    if (second) b.edge("hub1", "hub2", "peering", wan ? "Hub to hub" : "Global peering");
    for (const e of extras.filter((e) => e.peered && e.x.group !== "corp"))
      b.edge("hub1", `extra:${e.x.id}`, "peering", "Peering");
    if (on(a.vpnGateway) || on(a.expressRoute))
      b.edge("onprem", gw, "onprem", on(a.expressRoute) ? "ExpressRoute" : "VPN");
  }

  return {
    nodes: b.nodes,
    edges: b.edges,
    sections: [
      { label: "Outside Azure", ids: ["users", "internet", "onprem", "operator"] },
      { label: "Connectivity", ids: ["sub:connectivity", "sub:identity"] },
      {
        label: "Landing zones",
        ids: b.nodes
          .filter((n) => n.type === "zone" && n.abs.x === C2 && !n.parentId)
          .map((n) => n.id),
      },
      { label: "Platform services", ids: ["sub:management", "sub:security"] },
    ],
  };
}

/* -------------------------------------------------------------- hierarchy */

const MG = { w: 216, h: 74 };
const STEP_X = 270;
const STEP_Y = 90;

export function hierarchy({ lib, tree, answers: a, spokes, set, onAdd, asIs }: BuildInput): Graph {
  const b = new Builder();
  const root = tree.find((n) => !n.parentId);
  if (!root) return { nodes: [], edges: [], sections: [] };
  const exists = (id: string) => lib.managementGroups.some((m) => m.id === id);
  const installs = (g: string) =>
    new Set(spokes.filter((x) => x.group === g && !x.ghost).map((x) => x.id)).size;
  const underLz = (id: string) => {
    let x = tree.find((t) => t.libraryId === id);
    while (x) {
      if (x.libraryId === "landingzones") return true;
      x = tree.find((t) => t.id === x?.parentId);
    }
    return false;
  };
  const platformSubs: [string, string, boolean][] = [
    ["security", "Security", on(a.securitySubscription)],
    ["management", "Management", true],
    ["identity", "Identity", on(a.identity)],
    ["connectivity", "Connectivity", hasHub(a)],
  ];
  const tags = (id: string): MgData["tags"] => {
    const out: MgData["tags"] = [];
    for (const [g, label, isOn] of platformSubs)
      if (placementGroup(a, g) === id)
        out.push({ label: id === g ? "Subscription" : `${label} subscription`, on: isOn });
    if (id === "decommissioned") out.push({ label: "Cancelled subscriptions", on: true });
    const n = installs(id);
    if (n) out.push({ label: `${n} install${n === 1 ? "" : "s"}`, on: true });
    else if (underLz(id) && id !== "landingzones")
      out.push({ label: "1 per install × env", on: true, pending: true });
    else if (id === "sandbox")
      out.push({ label: "Sandbox subscriptions", on: true, pending: true });
    const extra = a.extraSubscriptions.filter((x) => x.group === id).length;
    if (extra) out.push({ label: `+${extra} added`, on: true });
    for (const w of a.workloads.filter((x) => x.group === id)) {
      const def = workloadById(w.id);
      if (def) out.push({ label: def.short, on: true });
    }
    return out;
  };
  const removable = (id: string) =>
    isCustomGroup(a, id) || (REMOVABLE_GROUPS as readonly string[]).includes(id);
  const optional = (id: string) => ["corp", "online", "local", "sandbox"].includes(id);

  type T = { id: string; data: MgData; kids: T[]; ghost?: boolean };
  const make = (n: MgNode): T => {
    const id = n.libraryId;
    const kids = tree.filter((k) => k.parentId === n.id).map(make);
    const leftOut =
      id === "landingzones"
        ? (["corp", "online", "local"] as const).filter(
            (g) => exists(g) && !tree.some((t) => t.libraryId === g),
          )
        : n.parentId === null
          ? (["sandbox"] as const).filter((g) => exists(g) && !tree.some((t) => t.libraryId === g))
          : [];
    const removedHere =
      id === "platform"
        ? a.removedGroups.filter((g) => g !== "decommissioned")
        : n.parentId === null
          ? a.removedGroups.filter((g) => g === "decommissioned")
          : [];
    const ghosts: T[] = [...leftOut, ...removedHere].map((g) => ({
      id: `mg:${g}`,
      ghost: true,
      kids: [],
      data: {
        kind: "mg",
        title: LANDING_ZONE_LABEL[g]?.title ?? g.charAt(0).toUpperCase() + g.slice(1),
        counts: set ? "Left out · click to add back" : "Left out",
        tags: [],
        included: false,
        custom: false,
        restore:
          set &&
          (() =>
            (REMOVABLE_GROUPS as readonly string[]).includes(g)
              ? set({ removedGroups: a.removedGroups.filter((x) => x !== g) })
              : toggleGroup(set, a, g as OptionalGroup)),
      },
    }));
    const included = !asIs || asIs.present.has(id);
    return {
      id: n.parentId ? `mg:${id}` : "mg-root",
      kids: [...kids, ...ghosts],
      data: {
        kind: "mg",
        title: n.displayName,
        counts: asIs
          ? included
            ? (asIs.counts[id] ?? "Found")
            : "Not in the tenant"
          : `${n.enforced} policies here · ${n.inherited} inherited`,
        tags: included ? tags(id) : [],
        included,
        custom: isCustomGroup(a, id),
        sel: { kind: "mg", id },
        toggle: set && optional(id) ? () => toggleGroup(set, a, id as OptionalGroup) : undefined,
        actions: set
          ? [
              ...(id !== "decommissioned"
                ? [
                    {
                      label: "+ group",
                      title: "Add a management group under this one",
                      onClick: () => onAdd({ kind: "group", parent: id }),
                    },
                  ]
                : []),
              {
                label: "+ subscription",
                title: "Add a subscription here",
                onClick: () => onAdd({ kind: "subscription", parent: id }),
              },
              ...(removable(id)
                ? [
                    {
                      label: "Remove",
                      title: isCustomGroup(a, id)
                        ? "Remove this group"
                        : "Remove — its subscription moves to Platform",
                      danger: true,
                      onClick: () => removeGroup(set, a, id),
                    },
                  ]
                : []),
            ]
          : undefined,
      },
    };
  };
  const top: T = {
    id: "tenant-root",
    kids: [make(root)],
    data: {
      kind: "mg",
      title: "Tenant root group",
      counts: "Created by Azure",
      tags: [],
      included: true,
      custom: false,
      root: true,
    },
  };

  // Left to right: depth across, leaves stacked down; a parent sits level with the middle of its children.
  let leaf = 0;
  const place = (t: T, depth: number, parent?: string): number => {
    let y: number;
    if (!t.kids.length) y = leaf++ * STEP_Y;
    else {
      const ys = t.kids.map((k) => place(k, depth + 1, t.id));
      y = (ys[0]! + ys[ys.length - 1]!) / 2;
    }
    b.nodes.push({
      id: t.id,
      type: "mg",
      rel: { x: depth * STEP_X, y },
      abs: { x: depth * STEP_X, y, ...MG },
      data: t.data,
    });
    if (parent)
      b.edges.push({
        id: `tree:${parent}->${t.id}`,
        source: parent,
        target: t.id,
        kind: t.ghost ? "ghost" : "tree",
      });
    return y;
  };
  place(top, 0);
  const subtree = (id: string) => {
    const ids = [id];
    for (let i = 0; i < ids.length; i++)
      for (const e of b.edges) if (e.source === ids[i]) ids.push(e.target);
    return ids;
  };
  return {
    nodes: b.nodes,
    edges: b.edges,
    sections: [
      { label: "Platform", ids: subtree("mg:platform") },
      { label: "Landing zones", ids: subtree("mg:landingzones") },
      ...(tree.some((t) => t.libraryId === "sandbox")
        ? [{ label: "Sandbox", ids: ["mg:sandbox"] }]
        : []),
    ].filter((s) => b.nodes.some((n) => n.id === s.ids[0])),
  };
}
