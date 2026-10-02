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
  Laptop,
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
import { type Check, issuesAt } from "@/lib/alz/access-checks";
import { PERSONAS, POLICY_OPTIONS } from "@/lib/alz/governance";
import type { Sel, Spoke } from "@/lib/alz/scene";
import { workloadById } from "@/lib/alz/workloads";
import { AZURE_REGIONS } from "@/lib/regions";

import { ICON, TONE, removeGroup, toggleGroup } from "./parts";
import type { Adding } from "../HierarchyEditor";
import type { LaneEdgeData } from "../diagram/Kit";

type Patch = (p: Partial<Answers>) => void;

export type Rect = { x: number; y: number; w: number; h: number };
export type Action = { label: string; title: string; onClick: () => void; danger?: boolean };

export type ZoneData = {
  kind: "zone";
  title: string;
  subtitle?: string | undefined;
  tone: "sub" | "vnet" | "lz" | "quiet";
  zoneKind?: "azure" | "subscription" | "vnet" | "zone" | "onprem" | "band" | undefined;
  iconId?: string | undefined;
  on: boolean;
  toggle?: (() => void) | undefined;
  sel?: Sel | undefined;
};
export type ItemData = {
  kind: "item";
  label: string;
  detail?: string | undefined;
  icon?: LucideIcon | undefined;
  iconId?: string | undefined;
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
  iconId?: string | undefined;
  sel: Sel;
};
export type LabelData = { kind: "label"; text: string };
export type MgData = {
  kind: "mg";
  title: string;
  counts: string;
  policyCount?: number | undefined;
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
export type GovData = {
  kind: "gov";
  variant: "mg" | "root" | "entra";
  title: string;
  policies?: string | undefined;
  added?: string[] | undefined;
  weakened?: number | undefined;
  access?: { label: string; role: string; flag: boolean }[] | undefined;
  /** Checks shown as lines (tenant root, Entra ID). */
  lines?: Check[] | undefined;
  issues: Check[];
  sel?: Sel | undefined;
  actions?: Action[] | undefined;
};
export type NodeData = ZoneData | ItemData | ExtData | LabelData | MgData | GovData;

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
  kind: "peering" | "onprem" | "public" | "tree" | "ghost" | "identity";
  label?: string | undefined;
  data?: LaneEdgeData | undefined;
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

  edge(source: string, target: string, kind: MapEdge["kind"], label?: string, data?: LaneEdgeData) {
    if (!this.nodes.some((n) => n.id === source) || !this.nodes.some((n) => n.id === target))
      return;
    this.edges.push({ id: `${kind}:${source}->${target}`, source, target, kind, label, data });
  }
}

export type BuildInput = {
  lib: AlzLibrary;
  tree: MgNode[];
  answers: Answers;
  spokes: Spoke[];
  set?: Patch | undefined;
  onAdd: (a: Adding) => void;
  /** Best-practice checks, for the access and policy view. */
  checks?: Check[] | undefined;
  /** Open the access or policy dialog for a management group. */
  onGovern?: ((g: { kind: "access" | "policy"; scope: string }) => void) | undefined;
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
  const extras = a.extraSubscriptions
    .filter((x) => tree.some((t) => t.libraryId === x.group))
    .map((x, i) => ({ x, ...spokeOf(a, lib, x, i) }));

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
    const base = id.replace(/2$/, "");
    const isOn = found(id, designed);
    return {
      id,
      data: {
        kind: "item",
        label,
        detail: asIs && !isOn ? "Not found" : detail,
        icon: ICON[base] ?? Boxes,
        iconId: base,
        color: TONE[base] ?? "#0078d4",
        on: isOn,
        variant: "res",
        toggle: set && toggle ? toggle : undefined,
        sel: sel ?? { kind: "res", id: base },
      },
    };
  };
  const addItem = (id: string, label: string, onClick: () => void): ItemSpec => ({
    id,
    wide: true,
    data: { kind: "item", label, on: true, variant: "add", onClick, iconId: "subscription" },
  });
  const fixedZone = (
    id: string,
    x: number,
    y: number,
    w: number,
    h: number,
    data: ZoneData,
    parent?: MapNode,
  ) => {
    const z = b.zone(id, x, y, w, data, undefined, parent);
    z.abs.h = h;
    return z;
  };
  const placeItems = (
    parent: MapNode,
    list: ItemSpec[],
    opts?: { cols?: 1 | 2 | 3 | 4; top?: number; gap?: number },
  ) => {
    const cols = opts?.cols ?? (parent.abs.w >= 360 ? 2 : 1);
    const gap = opts?.gap ?? GAP;
    const top = opts?.top ?? 56;
    const iw = (parent.abs.w - PAD * 2 - (cols - 1) * gap) / cols;
    list.forEach((it, i) => {
      const wide = it.wide || cols === 1;
      const col = wide ? 0 : i % cols;
      const row = wide ? i : Math.floor(i / cols);
      b.item(
        it,
        parent.abs.x + PAD + col * (iw + gap),
        parent.abs.y + top + row * (IH + gap),
        wide ? parent.abs.w - PAD * 2 : iw,
        parent,
      );
    });
  };

  const AZ = { x: 40, y: 118, w: 1360 };
  const ROW = {
    actors: 24,
    platform: 184,
    connectivity: 398,
    landing: second ? 840 : 660,
  };
  const INNER_X = AZ.x + 26;
  const INNER_W = AZ.w - 52;
  const lane = {
    peering: { color: "#4da3ff", label: "Peering" },
    public: { color: "#38bdf8", dashed: true },
    onprem: { color: "#a78bfa", dashed: true },
    identity: { color: "#c084fc", dashed: true },
  } satisfies Record<string, LaneEdgeData>;

  const groupSpecs: {
    group: string;
    title: string;
    subtitle: string;
    optional: boolean;
    peeredNote: string;
    slot: number;
  }[] = [];
  const name = (id: string, fallback: string) => a.groupNames[id] || fallback;
  const peerNote = hub ? (wan ? "on the vWAN hub" : "peered to the hub") : "own network";
  if (exists("corp"))
    groupSpecs.push({
      group: "corp",
      title: `${name("corp", "Corp")} landing zones`,
      subtitle: "Private, egress through the hub",
      optional: true,
      peeredNote: peerNote,
      slot: 0,
    });
  if (exists("online"))
    groupSpecs.push({
      group: "online",
      title: `${name("online", "Online")} landing zones`,
      subtitle: "Internet-facing subscriptions",
      optional: true,
      peeredNote: "public endpoints",
      slot: 1,
    });
  if (exists("local"))
    groupSpecs.push({
      group: "local",
      title: `${name("local", "Local")} landing zones`,
      subtitle: LANDING_ZONE_LABEL["local"]?.body.split(".")[0] ?? "Local workloads",
      optional: true,
      peeredNote: "own network",
      slot: 2,
    });
  for (const [i, g] of a.customGroups.entries())
    groupSpecs.push({
      group: g.id,
      title: `${a.groupNames[g.id] || g.name} landing zones`,
      subtitle: `Your group · ${g.archetype} policies`,
      optional: false,
      peeredNote: peerNote,
      slot: 3 + i,
    });
  if (exists("sandbox"))
    groupSpecs.push({
      group: "sandbox",
      title: `${name("sandbox", "Sandbox")} subscriptions`,
      subtitle: "Experiments, isolated from production",
      optional: true,
      peeredNote: "not connected",
      slot: 99,
    });

  const lzCount = groupSpecs.length + (edit ? 1 : 0);
  const lzGap = 18;
  const lzCols = Math.max(1, Math.min(lzCount || 1, Math.floor((INNER_W + lzGap) / 220)));
  const lzW = (INNER_W - lzGap * (lzCols - 1)) / lzCols;
  const lzH = 250;
  const lzRows = Math.max(1, Math.ceil((lzCount || 1) / lzCols));
  const azureH = ROW.landing - AZ.y + lzRows * lzH + (lzRows - 1) * 20 + 52;
  const hybridY = AZ.y + azureH + 22;
  const onPremY = hybridY + 58;

  const azure = fixedZone("zone:azure", AZ.x, AZ.y, AZ.w, azureH, {
    kind: "zone",
    title: "Microsoft Azure",
    subtitle: `${a.primaryRegion}${second ? ` + ${a.secondaryRegion}` : ""} · landing zone platform`,
    tone: "quiet",
    zoneKind: "azure",
    iconId: "subscription",
    on: true,
  });

  b.label("label:outside", INNER_X, 0, INNER_W, "Outside Azure");
  b.label("label:platform", INNER_X, AZ.y + 48, 380, "Platform services");
  b.label("label:connectivity", INNER_X, ROW.connectivity - 30, 420, "Connectivity & identity");
  b.label("label:landing", INNER_X, ROW.landing - 30, 520, "Landing zones · your customers");

  const actors = [
    {
      id: "internet",
      x: INNER_X,
      label: "Internet",
      detail: "Public endpoints and APIs",
      icon: Globe,
      iconId: "internet",
      sel: { kind: "ext", id: "internet" } as Sel,
    },
    {
      id: "users",
      x: INNER_X + 240,
      label: "Internet users",
      detail: "Browsers, partners, customers",
      icon: Users,
      iconId: "users",
      sel: { kind: "ext", id: "users" } as Sel,
    },
    {
      id: "operator",
      x: INNER_X + 480,
      label: "Operators",
      detail: "Azure portal and runbooks",
      icon: UserCog,
      iconId: "operators",
      sel: { kind: "ext", id: "operator" } as Sel,
    },
    {
      id: "remote",
      x: INNER_X + 720,
      label: "Remote engineers",
      detail: "Point-to-site VPN users",
      icon: Laptop,
      iconId: "remote",
      sel: { kind: "ext", id: "remote" } as Sel,
    },
  ];
  actors.forEach((n) =>
    b.ext(n.id, n.x, ROW.actors, {
      kind: "ext",
      label: n.label,
      detail: n.detail,
      icon: n.icon,
      iconId: n.iconId,
      sel: n.sel,
    }),
  );

  const mgmt = fixedZone(
    "sub:management",
    INNER_X,
    ROW.platform,
    390,
    168,
    {
      kind: "zone",
      title: "Management subscription",
      subtitle: "Platform logs, collection and dashboards",
      tone: "sub",
      zoneKind: "subscription",
      iconId: "subscription",
      on: true,
      sel: { kind: "sub", id: "management" },
    },
    azure,
  );
  placeItems(
    mgmt,
    [
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
          iconId: "dashboards",
          color: "#0078d4",
          on: true,
          variant: "res",
          sel: { kind: "sub", id: "management" },
        },
      },
    ],
    { cols: 2, top: 58 },
  );

  const security = fixedZone(
    "sub:security",
    INNER_X + 414,
    ROW.platform,
    330,
    168,
    {
      kind: "zone",
      title: "Security subscription",
      subtitle: on(a.securitySubscription)
        ? "Sentinel and security workspace"
        : "Left out of this design",
      tone: "sub",
      zoneKind: "subscription",
      iconId: "defender",
      on: on(a.securitySubscription),
      toggle:
        set && (() => set({ securitySubscription: on(a.securitySubscription) ? "no" : "yes" })),
      sel: { kind: "sub", id: "security" },
    },
    azure,
  );
  placeItems(
    security,
    [
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
    ],
    { cols: 1, top: 58 },
  );

  const identity = fixedZone(
    "sub:identity",
    INNER_X + 768,
    ROW.platform,
    330,
    168,
    {
      kind: "zone",
      title: "Identity subscription",
      subtitle: on(a.identity) ? "Identity services peered to the hub" : "Left out of this design",
      tone: "sub",
      zoneKind: "subscription",
      iconId: "subscription",
      on: on(a.identity),
      toggle: set && (() => set({ identity: on(a.identity) ? "no" : "yes" })),
      sel: { kind: "sub", id: "identity" },
    },
    azure,
  );
  placeItems(
    identity,
    [
      {
        id: "identityvnet",
        wide: true,
        data: {
          kind: "item",
          label: `Virtual network · ${a.primaryRegion}`,
          detail: "Domain controllers, DNS, backup vault",
          icon: Network,
          iconId: "vnet",
          color: "#0078d4",
          on: on(a.identity),
          variant: "res",
          sel: { kind: "sub", id: "identity" },
        },
      },
    ],
    { cols: 1, top: 58 },
  );

  const conn = fixedZone(
    "sub:connectivity",
    INNER_X,
    ROW.connectivity,
    INNER_W,
    230,
    {
      kind: "zone",
      title: "Connectivity subscription",
      subtitle: hub
        ? wan
          ? "Virtual WAN secured hub"
          : "Hub-and-spoke network"
        : "No central network",
      tone: "sub",
      zoneKind: "subscription",
      iconId: wan ? "vwan" : "hubvnet",
      on: hub,
      toggle: set && (() => set({ connectivity: hub ? "none" : "hub_and_spoke" })),
      sel: { kind: "sub", id: "connectivity" },
    },
    azure,
  );
  const nextRegion =
    AZURE_REGIONS.find(
      (r) =>
        r.name !== a.primaryRegion &&
        r.geo === AZURE_REGIONS.find((x) => x.name === a.primaryRegion)?.geo,
    )?.name ?? "centralus";
  const hubBand = fixedZone(
    "hub1",
    conn.abs.x + 20,
    conn.abs.y + 56,
    conn.abs.w - 40,
    154,
    {
      kind: "zone",
      title: `${wan ? "Virtual hub" : "Hub virtual network"} · ${a.primaryRegion}`,
      subtitle: wan
        ? fw
          ? "Secured hub · routing intent to the firewall"
          : "Hub router · any-to-any routing"
        : `${a.hubAddressSpace} · gateway, firewall and shared DNS subnets`,
      tone: "vnet",
      zoneKind: "vnet",
      iconId: wan ? "vhub" : "hubvnet",
      on: hub,
      sel: { kind: "res", id: wan ? "vhub" : "hubvnet" },
    },
    conn,
  );
  const hubItems = (n: 1 | 2): ItemSpec[] => {
    const s = n === 2 ? "2" : "";
    return [
      ...(wan
        ? [
            res$(
              `vwan${s}`,
              n === 2 ? "Virtual WAN" : "Virtual WAN",
              hub,
              false,
              "Microsoft-managed backbone",
              {
                kind: "res",
                id: "vwan",
              },
            ),
          ]
        : []),
      res$(
        `firewall${s}`,
        "Azure Firewall",
        fw,
        () => set?.({ firewall: fw ? "none" : "Standard" }),
        fw ? `${a.firewall} · central inspection` : undefined,
      ),
      res$(`vpngw${s}`, "VPN gateway", on(a.vpnGateway), () =>
        set?.({ vpnGateway: on(a.vpnGateway) ? "no" : "yes" }),
      ),
      res$(`ergw${s}`, "ExpressRoute gateway", on(a.expressRoute), () =>
        set?.({ expressRoute: on(a.expressRoute) ? "no" : "yes" }),
      ),
      res$(
        `bastion${s}`,
        "Azure Bastion",
        on(a.bastion),
        () => set?.({ bastion: on(a.bastion) ? "no" : "yes" }),
        wan ? "Sidecar virtual network" : undefined,
      ),
      res$(`dnsresolver${s}`, "DNS Private Resolver", a.privateDns === "platform", () =>
        set?.({ privateDns: a.privateDns === "platform" ? "none" : "platform" }),
      ),
      res$(`dnszones${s}`, "Private DNS zones", a.privateDns === "platform", () =>
        set?.({ privateDns: a.privateDns === "platform" ? "none" : "platform" }),
      ),
      res$(`ddos${s}`, "DDoS Protection", on(a.ddosPlan), () =>
        set?.({ ddosPlan: on(a.ddosPlan) ? "no" : "yes" }),
      ),
    ];
  };
  if (hub) placeItems(hubBand, hubItems(1), { cols: 4, top: 42, gap: 10 });
  else if (edit)
    placeItems(
      conn,
      [
        addItem("add-hub", "Add a hub-and-spoke network", () =>
          set?.({ connectivity: "hub_and_spoke" }),
        ),
      ],
      { cols: 1, top: 70 },
    );

  if (second) {
    const hub2 = fixedZone(
      "hub2",
      conn.abs.x + 20,
      conn.abs.y + 226,
      conn.abs.w - 40,
      154,
      {
        kind: "zone",
        title: `${wan ? "Virtual hub" : "Hub virtual network"} · ${a.secondaryRegion}`,
        subtitle: "Second region · paired for resilience",
        tone: "vnet",
        zoneKind: "vnet",
        iconId: wan ? "vhub2" : "hubvnet2",
        on: true,
        sel: { kind: "res", id: wan ? "vhub2" : "hubvnet2" },
      },
      conn,
    );
    conn.abs.h = 400;
    placeItems(
      hub2,
      [
        ...hubItems(2).slice(0, 6),
        ...(edit
          ? [
              addItem("remove-hub2", "Remove the second region", () =>
                set?.({ secondaryRegion: "" }),
              ),
            ]
          : []),
      ],
      { cols: 4, top: 42, gap: 10 },
    );
  } else if (edit && hub) {
    b.item(
      addItem("add-hub2", "Add a hub in a second region", () =>
        set?.({ secondaryRegion: nextRegion }),
      ),
      conn.abs.x + conn.abs.w - 250,
      conn.abs.y + 10,
      230,
      conn,
    );
  }

  const buildLzItems = (group: string, peeredNote: string) => {
    const list = [
      ...new Map(
        spokes
          .filter((s) => s.group === group && !(s.placement && vended.has(s.placement.customerId)))
          .map((s) => [s.id, s]),
      ).values(),
    ];
    const shown = list.slice(0, 3);
    const items: ItemSpec[] = shown.map((s) => ({
      id: `spoke:${s.id}`,
      // The placeholder for the next install reads as a sentence, so it gets the full width.
      ...(s.ghost ? { wide: true } : {}),
      data: {
        kind: "item",
        label: s.placement ? s.placement.customerName : "Next customer install",
        detail: s.ghost
          ? "Created when a customer is onboarded"
          : `${s.placement?.environment.toUpperCase()} · ${peeredNote}`,
        icon: Boxes,
        iconId: s.ghost ? "subscription" : group === "online" ? "appgw" : "vm",
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
          iconId: "subscription",
          on: true,
          variant: "more",
          sel: { kind: "mg", id: group },
        },
      });
    for (const e of extras.filter((e) => e.x.group === group).slice(0, 2))
      items.push({
        id: `extra:${e.x.id}`,
        data: {
          kind: "item",
          label: e.x.name,
          detail: `${e.x.environment} · ${e.vnet ? `vnet ${e.cidr}` : "no network"}${e.peered ? (wan ? " · on the vWAN hub" : " · peered") : ""}`,
          icon: Boxes,
          iconId: "subscription",
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
    for (const w of a.workloads.filter((x) => x.group === group).slice(0, 1)) {
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
          iconId: "vnet",
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
    return items.slice(0, 5);
  };

  const visualOrder = [...groupSpecs].sort((a, b) => a.slot - b.slot);
  const posOf = new Map(
    visualOrder.map((g, i) => [
      g.group,
      {
        x: INNER_X + (i % lzCols) * (lzW + lzGap),
        y: ROW.landing + Math.floor(i / lzCols) * (lzH + 20),
      },
    ]),
  );
  const pushOrder = [...groupSpecs].sort((a, b) => {
    const rank = (g: string) =>
      g === "online" ? 0 : g === "corp" ? 1 : g === "local" ? 2 : g === "sandbox" ? 99 : 50;
    return rank(a.group) - rank(b.group);
  });
  for (const spec of pushOrder) {
    const isOn = has(spec.group);
    const p = posOf.get(spec.group)!;
    const live = spokes.filter((s) => s.group === spec.group && !s.ghost).length;
    const z = fixedZone(
      `sub:${spec.group}`,
      p.x,
      p.y,
      lzW,
      lzH,
      {
        kind: "zone",
        title: spec.title,
        subtitle: isOn
          ? `${spec.subtitle}${live ? ` · ${live} install${live === 1 ? "" : "s"}` : ""}`
          : "Left out of this design",
        tone: "lz",
        zoneKind: "zone",
        iconId:
          spec.group === "online" ? "appgw" : spec.group === "sandbox" ? "subscription" : "vnet",
        on: isOn,
        toggle:
          set && spec.optional ? () => toggleLz(set, a, spec.group as OptionalGroup) : undefined,
        sel: isOn ? { kind: "mg", id: spec.group } : undefined,
      },
      azure,
    );
    if (isOn)
      placeItems(z, buildLzItems(spec.group, spec.peeredNote), {
        cols: lzW > 255 ? 2 : 1,
        top: 58,
      });
  }
  if (edit) {
    const i = visualOrder.length;
    const x = INNER_X + (i % lzCols) * (lzW + lzGap);
    const y = ROW.landing + Math.floor(i / lzCols) * (lzH + 20);
    b.item(
      addItem("add-lz-group", "Add a landing zone group (e.g. Regulated, AKS platform)", () =>
        onAdd({ kind: "group", parent: "landingzones" }),
      ),
      x,
      y + 80,
      lzW,
      azure,
    );
  }

  fixedZone("hybrid", INNER_X, hybridY, INNER_W, 42, {
    kind: "zone",
    title: on(a.expressRoute)
      ? "ExpressRoute private circuit"
      : on(a.vpnGateway)
        ? "Site-to-site VPN (IPsec over the internet)"
        : "Hybrid connectivity not enabled",
    subtitle: a.onPremRanges.join(", ") || "No on-premises ranges listed",
    tone: "quiet",
    zoneKind: "band",
    iconId: on(a.expressRoute) ? "ergw" : "vpngw",
    on: on(a.expressRoute) || on(a.vpnGateway),
  });
  const onpremZone = fixedZone("zone:onprem", INNER_X, onPremY, INNER_W, 104, {
    kind: "zone",
    title: "On-premises",
    subtitle: "Customer offices and data centers",
    tone: "quiet",
    zoneKind: "onprem",
    iconId: "onprem",
    on: true,
  });
  b.item(
    {
      id: "onprem",
      data: {
        kind: "item",
        label: "Office / data center",
        detail: a.onPremRanges.join(", ") || "No ranges listed",
        icon: Network,
        iconId: "onprem",
        color: "#3b82f6",
        on: true,
        variant: "res",
        sel: { kind: "ext", id: "onprem" },
      },
    },
    onpremZone.abs.x + 24,
    onpremZone.abs.y + 44,
    300,
    onpremZone,
  );

  if (hub) {
    if (on(a.identity)) b.edge("sub:identity", "hub1", "identity", "Identity DNS", lane.identity);
    if (has("corp"))
      b.edge("hub1", "sub:corp", "peering", wan ? "Hub connection" : "Peering", lane.peering);
    if (second)
      b.edge("hub1", "hub2", "peering", wan ? "Hub-to-hub" : "Global peering", lane.peering);
    for (const e of extras.filter((e) => e.peered && e.x.group !== "corp"))
      b.edge("hub1", `extra:${e.x.id}`, "peering", "Peering", lane.peering);
    const gw = on(a.expressRoute) ? "ergw" : "vpngw";
    if (on(a.vpnGateway) || on(a.expressRoute)) {
      b.edge(
        "onprem",
        "hybrid",
        "onprem",
        on(a.expressRoute) ? "ExpressRoute" : "VPN",
        lane.onprem,
      );
      b.edge("hybrid", gw, "onprem", on(a.expressRoute) ? "ExpressRoute" : "VPN", lane.onprem);
    }
    if (on(a.vpnGateway))
      b.edge("remote", "vpngw", "onprem", "P2S VPN", { ...lane.onprem, live: false });
    if (fw) b.edge("internet", "firewall", "public", "Egress", lane.public);
    if (on(a.bastion)) b.edge("operator", "bastion", "identity", "RDP/SSH", lane.identity);
  }
  if (has("online"))
    b.edge("users", "sub:online", "public", "HTTPS", { ...lane.public, dashed: true });

  return {
    nodes: b.nodes,
    edges: b.edges,
    sections: [
      { label: "Outside Azure", ids: ["internet", "users", "operator", "remote"] },
      { label: "Platform services", ids: ["sub:management", "sub:security", "sub:identity"] },
      { label: "Connectivity & identity", ids: ["sub:connectivity", "sub:identity"] },
      { label: "Landing zones", ids: visualOrder.map((g) => `sub:${g.group}`) },
      { label: "On-premises", ids: ["hybrid", "zone:onprem", "onprem"] },
    ],
  };
}
/* -------------------------------------------------------------- hierarchy */

const MG = { w: 224, h: 92 };
const MG_ROOT = { w: 256, h: 88 };
const GOV = { w: 258, h: 154 };
const GAP_X = 28;
const GAP_Y = 36;
const LANE = { color: "#4da3ff", width: 2.2 } satisfies LaneEdgeData;
const GHOST_LANE = { color: "#64748b", width: 2, dashed: true, dim: true } satisfies LaneEdgeData;
const IDENTITY_LANE = {
  color: "#38bdf8",
  width: 2,
  dashed: true,
  label: "Groups sign in",
} satisfies LaneEdgeData;

type PlacedTree<T extends MgData | GovData> = {
  id: string;
  libraryId: string;
  data: T;
  kids: PlacedTree<T>[];
  ghost?: boolean;
};

const cardId = (n: MgNode) => (n.parentId ? `mg:${n.libraryId}` : "mg-root");

function subtreeIds(edges: MapEdge[], id: string) {
  const ids = [id];
  for (let i = 0; i < ids.length; i++)
    for (const e of edges) if (e.source === ids[i]) ids.push(e.target);
  return ids;
}

function boundary(nodes: MapNode[], id: string, ids: string[], label: string, sub: string) {
  const hits = nodes.filter((n) => ids.includes(n.id));
  if (!hits.length) return [];
  const x0 = Math.min(...hits.map((n) => n.abs.x)) - 28;
  const y0 = Math.min(...hits.map((n) => n.abs.y)) - 46;
  const x1 = Math.max(...hits.map((n) => n.abs.x + n.abs.w)) + 28;
  const y1 = Math.max(...hits.map((n) => n.abs.y + n.abs.h)) + 34;
  return [
    {
      id,
      type: "zone" as const,
      rel: { x: x0, y: y0 },
      abs: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 },
      data: {
        kind: "zone" as const,
        title: label,
        subtitle: sub,
        tone: "quiet" as const,
        zoneKind: "zone" as const,
        iconId: "subscription",
        on: true,
      },
    },
  ];
}

function addTreeNode<T extends MgData | GovData>(
  nodes: MapNode[],
  t: PlacedTree<T>,
  x: number,
  y: number,
  size: Rect,
  type: "mg" | "gov",
) {
  nodes.push({ id: t.id, type, rel: { x, y }, abs: { x, y, w: size.w, h: size.h }, data: t.data });
}

function connectTree<T extends MgData | GovData>(
  edges: MapEdge[],
  parent: string,
  child: PlacedTree<T>,
) {
  edges.push({
    id: `${child.ghost ? "ghost" : "tree"}:${parent}->${child.id}`,
    source: parent,
    target: child.id,
    kind: child.ghost ? "ghost" : "tree",
    data: child.ghost ? GHOST_LANE : LANE,
  });
}

function placeGrid<T extends MgData | GovData>(
  nodes: MapNode[],
  edges: MapEdge[],
  parent: string,
  kids: PlacedTree<T>[],
  x: number,
  y: number,
  width: number,
  cols: number,
  size: Rect,
  type: "mg" | "gov",
) {
  const colW = (width - GAP_X * (cols - 1)) / cols;
  const w = Math.min(size.w, colW);
  kids.forEach((kid, i) => {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const cx = x + col * (colW + GAP_X) + (colW - w) / 2;
    const cy = y + row * (size.h + GAP_Y);
    addTreeNode(nodes, kid, cx, cy, { ...size, w }, type);
    connectTree(edges, parent, kid);
    kid.kids.forEach((grand, j) => {
      const gy = cy + size.h + 30 + j * (size.h + 24);
      addTreeNode(nodes, grand, cx + 18, gy, { ...size, w: Math.max(188, w - 36) }, type);
      connectTree(edges, kid.id, grand);
    });
  });
}

export function hierarchy({ lib, tree, answers: a, spokes, set, onAdd, asIs }: BuildInput): Graph {
  const nodes: MapNode[] = [];
  const edges: MapEdge[] = [];
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

  const make = (n: MgNode): PlacedTree<MgData> => {
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
    const ghosts: PlacedTree<MgData>[] = [...leftOut, ...removedHere].map((g) => ({
      id: `mg:${g}`,
      libraryId: g,
      ghost: true,
      kids: [],
      data: {
        kind: "mg",
        title: LANDING_ZONE_LABEL[g]?.title ?? g.charAt(0).toUpperCase() + g.slice(1),
        counts: set ? "Left out · click to add back" : "Left out",
        policyCount: 0,
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
      id: cardId(n),
      libraryId: id,
      kids: [...kids, ...ghosts],
      data: {
        kind: "mg",
        title: n.displayName,
        counts: asIs
          ? included
            ? (asIs.counts[id] ?? "Found")
            : "Not in the tenant"
          : `${n.enforced} policies here · ${n.inherited} inherited`,
        policyCount: n.enforced,
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

  const intermediate = make(root);
  const tenant: PlacedTree<MgData> = {
    id: "tenant-root",
    libraryId: "tenant-root",
    kids: [intermediate],
    data: {
      kind: "mg",
      title: "Tenant root group",
      counts: "Tenant-wide shell · keep empty",
      tags: [],
      included: true,
      custom: false,
      root: true,
    },
  };

  const diagramW = 1460;
  const center = diagramW / 2;
  addTreeNode(nodes, tenant, center - MG_ROOT.w / 2, 0, { x: 0, y: 0, ...MG_ROOT }, "mg");
  addTreeNode(nodes, intermediate, center - MG_ROOT.w / 2, 136, { x: 0, y: 0, ...MG_ROOT }, "mg");
  connectTree(edges, tenant.id, intermediate);

  const rootKids = intermediate.kids;
  const platform = rootKids.find((k) => k.libraryId === "platform");
  const landing = rootKids.find((k) => k.libraryId === "landingzones");
  const misc = rootKids.filter((k) => k !== platform && k !== landing);
  const platformIds: string[] = [];
  const landingIds: string[] = [];

  if (platform) {
    addTreeNode(nodes, platform, 226, 326, { x: 0, y: 0, ...MG }, "mg");
    connectTree(edges, intermediate.id, platform);
    placeGrid(
      nodes,
      edges,
      platform.id,
      platform.kids,
      78,
      462,
      520,
      2,
      { x: 0, y: 0, ...MG },
      "mg",
    );
    platformIds.push(...subtreeIds(edges, platform.id));
  }
  if (landing) {
    addTreeNode(nodes, landing, 958, 326, { x: 0, y: 0, ...MG }, "mg");
    connectTree(edges, intermediate.id, landing);
    placeGrid(
      nodes,
      edges,
      landing.id,
      landing.kids,
      710,
      462,
      730,
      3,
      { x: 0, y: 0, ...MG },
      "mg",
    );
    landingIds.push(...subtreeIds(edges, landing.id));
  }
  if (misc.length) {
    const start = center - (misc.length * MG.w + (misc.length - 1) * GAP_X) / 2;
    misc.forEach((m, i) => {
      addTreeNode(nodes, m, start + i * (MG.w + GAP_X), 760, { x: 0, y: 0, ...MG }, "mg");
      connectTree(edges, intermediate.id, m);
      if (m.kids.length)
        placeGrid(
          nodes,
          edges,
          m.id,
          m.kids,
          start + i * (MG.w + GAP_X),
          890,
          MG.w,
          1,
          { x: 0, y: 0, ...MG },
          "mg",
        );
    });
  }

  nodes.push(
    ...boundary(
      nodes,
      "zone:platform",
      platformIds,
      "Platform",
      "Management, connectivity, identity and security",
    ),
    ...boundary(
      nodes,
      "zone:landingzones",
      landingIds,
      "Landing zones",
      "Corp, Online, Local and custom landing zones",
    ),
  );

  return {
    nodes,
    edges,
    sections: [
      { label: "Platform", ids: ["zone:platform", ...platformIds] },
      { label: "Landing zones", ids: ["zone:landingzones", ...landingIds] },
      ...(nodes.some((n) => n.id === "mg:sandbox")
        ? [{ label: "Sandbox", ids: ["mg:sandbox"] }]
        : []),
    ].filter((s) => nodes.some((n) => n.id === s.ids[0])),
  };
}

/* ---------------------------------------------------------- access & policy */

/** Who has what, and which policies apply, on each management group — from Entra ID down. */
export function governance({ tree, answers: a, set, checks = [], onGovern }: BuildInput): Graph {
  const nodes: MapNode[] = [];
  const edges: MapEdge[] = [];
  const root = tree.find((n) => !n.parentId);
  if (!root) return { nodes: [], edges: [], sections: [] };
  const flagged = new Set(
    checks
      .filter((c) => c.id.startsWith("least:") && c.status !== "pass")
      .map((c) => c.id.slice(6)),
  );
  const make = (n: MgNode): PlacedTree<GovData> => {
    const id = n.libraryId;
    return {
      id: cardId(n),
      libraryId: id,
      kids: tree.filter((k) => k.parentId === n.id).map(make),
      data: {
        kind: "gov",
        variant: "mg",
        title: n.displayName,
        policies: `${n.enforced} policies here · ${n.inherited} inherited`,
        added: a.policyAdds
          .filter((p) => p.scope === id)
          .map((p) => POLICY_OPTIONS.find((o) => o.id === p.id)?.name ?? p.id),
        weakened: Object.keys(a.policyOverrides).filter((k) => k.startsWith(`${id}/`)).length,
        access: a.rbac
          .filter((r) => r.scope === id)
          .map((r) => ({
            label: PERSONAS.find((p) => p.id === r.persona)?.label ?? r.persona,
            role: r.role,
            flag: flagged.has(r.persona),
          })),
        issues: issuesAt(checks, id),
        sel: { kind: "mg", id },
        actions:
          set && onGovern
            ? [
                {
                  label: "+ access",
                  title: "Give a team a role here",
                  onClick: () => onGovern({ kind: "access", scope: id }),
                },
                {
                  label: "+ policy",
                  title: "Assign a policy here",
                  onClick: () => onGovern({ kind: "policy", scope: id }),
                },
              ]
            : undefined,
      },
    };
  };

  const intermediate = make(root);
  const tenant: PlacedTree<GovData> = {
    id: "tenant-root",
    libraryId: "tenant-root",
    kids: [intermediate],
    data: {
      kind: "gov",
      variant: "root",
      title: "Tenant root group",
      lines: checks.filter((c) => c.scope === "tenant-root"),
      issues: issuesAt(checks, "tenant-root"),
    },
  };
  const entra: PlacedTree<GovData> = {
    id: "entra",
    libraryId: "entra",
    kids: [],
    data: {
      kind: "gov",
      variant: "entra",
      title: "Microsoft Entra ID",
      lines: checks.filter((c) => c.scope === "entra"),
      issues: issuesAt(checks, "entra"),
    },
  };

  const diagramW = 1480;
  const center = diagramW / 2;
  addTreeNode(nodes, entra, center - GOV.w / 2, 0, { x: 0, y: 0, ...GOV }, "gov");
  addTreeNode(nodes, tenant, center - GOV.w / 2, 190, { x: 0, y: 0, ...GOV }, "gov");
  addTreeNode(nodes, intermediate, center - GOV.w / 2, 380, { x: 0, y: 0, ...GOV }, "gov");
  edges.push({
    id: "identity:entra->tenant-root",
    source: "entra",
    target: "tenant-root",
    kind: "identity",
    label: "Groups sign in",
    data: IDENTITY_LANE,
  });
  connectTree(edges, tenant.id, intermediate);

  const rootKids = intermediate.kids;
  const platform = rootKids.find((k) => k.libraryId === "platform");
  const landing = rootKids.find((k) => k.libraryId === "landingzones");
  const misc = rootKids.filter((k) => k !== platform && k !== landing);
  const platformIds: string[] = [];
  const landingIds: string[] = [];

  if (platform) {
    addTreeNode(nodes, platform, 208, 610, { x: 0, y: 0, ...GOV }, "gov");
    connectTree(edges, intermediate.id, platform);
    placeGrid(
      nodes,
      edges,
      platform.id,
      platform.kids,
      58,
      812,
      560,
      2,
      { x: 0, y: 0, ...GOV },
      "gov",
    );
    platformIds.push(...subtreeIds(edges, platform.id));
  }
  if (landing) {
    addTreeNode(nodes, landing, 948, 610, { x: 0, y: 0, ...GOV }, "gov");
    connectTree(edges, intermediate.id, landing);
    placeGrid(
      nodes,
      edges,
      landing.id,
      landing.kids,
      700,
      812,
      760,
      3,
      { x: 0, y: 0, ...GOV },
      "gov",
    );
    landingIds.push(...subtreeIds(edges, landing.id));
  }
  if (misc.length) {
    const start = center - (misc.length * GOV.w + (misc.length - 1) * GAP_X) / 2;
    misc.forEach((m, i) => {
      addTreeNode(nodes, m, start + i * (GOV.w + GAP_X), 1220, { x: 0, y: 0, ...GOV }, "gov");
      connectTree(edges, intermediate.id, m);
      if (m.kids.length)
        placeGrid(
          nodes,
          edges,
          m.id,
          m.kids,
          start + i * (GOV.w + GAP_X),
          1410,
          GOV.w,
          1,
          { x: 0, y: 0, ...GOV },
          "gov",
        );
    });
  }

  nodes.push(
    ...boundary(
      nodes,
      "zone:platform",
      platformIds,
      "Platform",
      "Access and policy on shared services",
    ),
    ...boundary(
      nodes,
      "zone:landingzones",
      landingIds,
      "Landing zones",
      "Access and policy inherited by customer installs",
    ),
  );

  return {
    nodes,
    edges,
    sections: [
      { label: "Identity & root", ids: ["entra", "tenant-root", "mg-root"] },
      { label: "Platform", ids: ["zone:platform", ...platformIds] },
      { label: "Landing zones", ids: ["zone:landingzones", ...landingIds] },
      ...(nodes.some((n) => n.id === "mg:sandbox")
        ? [{ label: "Sandbox", ids: ["mg:sandbox"] }]
        : []),
    ].filter((s) => nodes.some((n) => n.id === s.ids[0])),
  };
}
