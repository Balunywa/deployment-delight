/*
 * Turns a landing zone design into an isometric scene: management groups as nested plates, subscriptions as
 * slabs, platform resources as blocks, customer installs as spoke subscriptions — plus the traffic paths that
 * are actually possible with what was selected. Pure data; the designer draws it.
 */
import {
  type Answers,
  type MgNode,
  type PlatformResource,
  hasFirewall,
  hasHub,
  on,
  platformResources,
} from "./engine";
import type { Placement } from "./placement";

export type Sel = { kind: "mg" | "sub" | "res" | "spoke" | "ext"; id: string };

export type Prism = {
  key: string;
  sel?: Sel | undefined;
  x: number;
  y: number;
  z: number;
  w: number;
  d: number;
  h: number;
  color: string;
  ghost?: boolean | undefined;
  /** Plates are containers; blocks are things. Only blocks get icons. */
  shape: "plate" | "slab" | "block" | "disc";
  icon?: IconKey | undefined;
  label?: string | undefined;
  sublabel?: string | undefined;
  labelLevel?: "mg" | "sub" | "res" | "spoke" | "ext" | undefined;
  /** Library management group the prism belongs to, for the policy lens. */
  mg?: string | undefined;
};

export type IconKey =
  | "firewall"
  | "vpn"
  | "er"
  | "bastion"
  | "dnsresolver"
  | "dnszones"
  | "ddos"
  | "law"
  | "dcr"
  | "ama"
  | "sentinel"
  | "vwan"
  | "app"
  | "appPublic"
  | "internet"
  | "onprem"
  | "operator"
  | "users"
  | "more";

export type Link = { from: string; to: string; kind: "peering" | "hubconnection" };

export type Scene = {
  prisms: Prism[];
  anchors: Record<string, [number, number, number]>;
  links: Link[];
  /** Plate per library management group id. */
  plates: Record<string, Prism>;
  spokes: { id: string; placement?: Placement | undefined; group: string; ghost: boolean }[];
};

const PAD = 14;
const GAP = 16;
const LABEL = 22;
const B = 46;
const BH = 26;
const BG = 10;
const SW = 100;
const SD = 62;

export const COLORS = {
  root: "#172238",
  platform: "#223257",
  platformChild: "#2c3f6b",
  lz: "#1f3f4a",
  lzChild: "#285462",
  sandbox: "#39304f",
  decommissioned: "#2b2f3b",
  slab: "#e6ecf6",
  spoke: "#e2f3ea",
  hubvnet: "#b9d0f7",
  vhub: "#cdc6f7",
  sidecar: "#c3dbf3",
  firewall: "#f0605a",
  vpngw: "#9d7ff7",
  ergw: "#7a62ee",
  bastion: "#27c1ad",
  dnsresolver: "#37b6df",
  dnszones: "#5aa8f4",
  ddos: "#f2a33a",
  law: "#b36cf0",
  dcr: "#cb95f4",
  ama: "#8d7cf2",
  sentinel: "#5470f0",
  vwan: "#6b8cf4",
  app: "#33c286",
  appPublic: "#2fb3e8",
  internet: "#8fb2ff",
  onprem: "#9aa5bb",
  operator: "#f1c45c",
  users: "#8fe3c0",
} as const;

const ICON_FOR: Record<string, IconKey> = {
  firewall: "firewall",
  vpngw: "vpn",
  ergw: "er",
  bastion: "bastion",
  dnsresolver: "dnsresolver",
  dnszones: "dnszones",
  ddos: "ddos",
  law: "law",
  dcr: "dcr",
  ama: "ama",
  sentinel: "sentinel",
  vwan: "vwan",
};

const SHORT: Record<string, string> = {
  firewall: "Firewall",
  vpngw: "VPN gateway",
  ergw: "ExpressRoute gw",
  bastion: "Bastion",
  dnsresolver: "DNS resolver",
  dnszones: "Private DNS",
  ddos: "DDoS plan",
  law: "Log Analytics",
  dcr: "Collection rules",
  ama: "AMA identity",
  sentinel: "Sentinel",
  vwan: "Virtual WAN",
};

export const shortName = (id: string) => SHORT[id] ?? id;

export function buildScene(tree: MgNode[], answers: Answers, placed: Placement[]): Scene {
  const prisms: Prism[] = [];
  const anchors: Scene["anchors"] = {};
  const links: Link[] = [];
  const plates: Scene["plates"] = {};
  const spokes: Scene["spokes"] = [];
  const has = (id: string) => tree.some((n) => n.libraryId === id);
  const node = (id: string) => tree.find((n) => n.libraryId === id);
  const res = platformResources(answers);
  const resIn = (s: PlatformResource["subscription"]) => res.filter((r) => r.subscription === s);

  const block = (id: string, x: number, y: number, z: number) => {
    const p: Prism = {
      key: `res:${id}`,
      sel: { kind: "res", id },
      x,
      y,
      z,
      w: B,
      d: B,
      h: BH,
      color: COLORS[id as keyof typeof COLORS] ?? "#8aa",
      shape: "block",
      icon: ICON_FOR[id],
      label: shortName(id),
      labelLevel: "res",
    };
    prisms.push(p);
    anchors[id] = [x + B / 2, y + B / 2, z + BH];
    return p;
  };
  const grid = (ids: string[], x0: number, y0: number, z: number, cols: number) =>
    ids.forEach((id, i) =>
      block(id, x0 + (i % cols) * (B + BG), y0 + Math.floor(i / cols) * (B + BG), z),
    );

  /* ---- platform children: sized first, then laid out along x */
  type Child = {
    id: string;
    w: number;
    d: number;
    draw: (x: number, y: number, z: number) => void;
  };
  const slab = (
    id: string,
    x: number,
    y: number,
    z: number,
    w: number,
    d: number,
    label: string,
    created: boolean,
    sublabel?: string,
  ) => {
    const p: Prism = {
      key: `sub:${id}`,
      sel: { kind: "sub", id },
      x,
      y,
      z,
      w,
      d,
      h: 14,
      color: COLORS.slab,
      shape: "slab",
      ghost: !created,
      label,
      sublabel,
      labelLevel: "sub",
    };
    prisms.push(p);
    anchors[`sub:${id}`] = [x + w / 2, y + d / 2, z + 14];
    return p;
  };

  const mgmtIds = resIn("management").map((r) => r.id);
  const connIds = resIn("connectivity").map((r) => r.id);
  const wan = answers.connectivity === "virtual_wan";
  const inHub = connIds.filter((i) =>
    wan
      ? ["firewall", "vpngw", "ergw"].includes(i)
      : ["firewall", "vpngw", "ergw", "bastion", "dnsresolver"].includes(i),
  );
  const inSidecar = wan ? connIds.filter((i) => ["bastion", "dnsresolver"].includes(i)) : [];
  const outside = connIds.filter(
    (i) => !inHub.includes(i) && !inSidecar.includes(i) && i !== "hubvnet" && i !== "vhub",
  );

  const children: Child[] = [];
  if (has("management")) {
    const cols = 2;
    const rows = Math.max(1, Math.ceil(mgmtIds.length / cols));
    const sw = PAD * 2 + cols * B + (cols - 1) * BG;
    const sd = PAD * 2 + rows * B + (rows - 1) * BG;
    children.push({
      id: "management",
      w: sw + PAD * 2,
      d: sd + PAD * 2 + LABEL,
      draw: (x, y, z) => {
        slab("management", x + PAD, y + PAD, z, sw, sd, "Management", true);
        grid(mgmtIds, x + PAD * 2, y + PAD * 2, z + 14, cols);
      },
    });
  }
  if (has("connectivity")) {
    const hubW = PAD * 2 + 3 * B + 2 * BG;
    const hubRows = wan ? 1 : Math.max(1, Math.ceil(inHub.length / 3));
    const hubD = PAD * 2 + hubRows * B + (hubRows - 1) * BG;
    const sideD = inSidecar.length ? PAD * 2 + B : 0;
    const innerD = Math.max(
      hubD + (sideD ? BG + sideD : 0),
      outside.length * B + Math.max(0, outside.length - 1) * BG,
      PAD * 2 + 2 * B + BG,
    );
    const sw = PAD + hubW + PAD + B + PAD;
    const sd = PAD * 2 + innerD;
    children.push({
      id: "connectivity",
      w: sw + PAD * 2,
      d: sd + PAD * 2 + LABEL,
      draw: (x, y, z) => {
        const sx = x + PAD;
        const sy = y + PAD;
        slab(
          "connectivity",
          sx,
          sy,
          z,
          sw,
          sd,
          "Connectivity",
          hasHub(answers),
          hasHub(answers) ? undefined : "No central network",
        );
        if (!hasHub(answers)) return;
        const vz = z + 14;
        const hubId = wan ? "vhub" : "hubvnet";
        prisms.push({
          key: `res:${hubId}`,
          sel: { kind: "res", id: hubId },
          x: sx + PAD,
          y: sy + PAD,
          z: vz,
          w: hubW,
          d: hubD,
          h: 4,
          color: wan ? COLORS.vhub : COLORS.hubvnet,
          shape: "plate",
          label: wan ? "Virtual hub" : "Hub virtual network",
          labelLevel: "res",
        });
        anchors[hubId] = [sx + PAD + hubW / 2, sy + PAD + hubD / 2, vz + 4];
        grid(inHub, sx + PAD * 2, sy + PAD * 2, vz + 4, 3);
        if (inSidecar.length) {
          const cy = sy + PAD + hubD + BG;
          prisms.push({
            key: "res:sidecar",
            sel: { kind: "res", id: "sidecar" },
            x: sx + PAD,
            y: cy,
            z: vz,
            w: hubW,
            d: sideD,
            h: 4,
            color: COLORS.sidecar,
            shape: "plate",
            label: "Sidecar network",
            labelLevel: "res",
          });
          anchors["sidecar"] = [sx + PAD + hubW / 2, cy + sideD / 2, vz + 4];
          grid(inSidecar, sx + PAD * 2, cy + PAD, vz + 4, 3);
        }
        outside.forEach((id, i) => block(id, sx + PAD + hubW + PAD, sy + PAD + i * (B + BG), vz));
      },
    });
  }
  for (const id of ["identity", "security"] as const) {
    if (!has(id)) continue;
    const created = id === "identity" ? on(answers.identity) : answers.siem === "sentinel";
    const sw = 92;
    const sd = PAD * 2 + 2 * B + BG;
    children.push({
      id,
      w: sw + PAD * 2,
      d: sd + PAD * 2 + LABEL,
      draw: (x, y, z) =>
        void slab(
          id,
          x + PAD,
          y + PAD,
          z,
          sw,
          sd,
          id === "identity" ? "Identity" : "Security",
          created,
          created ? undefined : "Not created",
        ),
    });
  }

  const plate = (
    libraryId: string,
    x: number,
    y: number,
    z: number,
    w: number,
    d: number,
    color: string,
  ) => {
    const n = node(libraryId);
    const p: Prism = {
      key: `mg:${libraryId}`,
      sel: { kind: "mg", id: libraryId },
      x,
      y,
      z,
      w,
      d,
      h: 8,
      color,
      shape: "plate",
      label: n?.displayName ?? libraryId,
      labelLevel: "mg",
      mg: libraryId,
    };
    prisms.push(p);
    plates[libraryId] = p;
    anchors[`mg:${libraryId}`] = [x + PAD + 40, y + d - LABEL / 2, z + 8];
    return p;
  };

  /* ---- landing zone children */
  const lzGroups = (["corp", "online", "local"] as const).filter(has);
  const spokeGroup = (group: string, cols: number, rows: number) => {
    const list = placed.filter((p) => p.landingZone === group);
    const slots = cols * rows;
    const shown = list.length > slots ? list.slice(0, slots - 1) : list;
    const items: {
      id: string;
      placement?: Placement | undefined;
      ghost: boolean;
      more?: number;
    }[] = shown.map((p) => ({
      id: `${p.customerId}:${p.environment}`,
      placement: p,
      ghost: false,
    }));
    if (list.length > slots)
      items.push({ id: `${group}:more`, ghost: false, more: list.length - shown.length });
    if (!list.length) items.push({ id: `${group}:next`, ghost: true });
    return items;
  };
  const drawSpokes = (
    group: string,
    x0: number,
    y0: number,
    z: number,
    cols: number,
    rows: number,
  ) => {
    spokeGroup(group, cols, rows).forEach((s, i) => {
      const x = x0 + (i % cols) * (SW + BG);
      const y = y0 + Math.floor(i / cols) * (SD + BG);
      const label = s.more
        ? `+${s.more} more installs`
        : s.placement
          ? s.placement.customerName
          : "Next install lands here";
      prisms.push({
        key: `spoke:${s.id}`,
        sel: { kind: "spoke", id: s.id },
        x,
        y,
        z,
        w: SW,
        d: SD,
        h: 12,
        color: COLORS.spoke,
        shape: "slab",
        ghost: s.ghost,
        label,
        sublabel: s.placement?.environment,
        labelLevel: "spoke",
        mg: group,
      });
      if (!s.ghost && !s.more)
        prisms.push({
          key: `app:${s.id}`,
          sel: { kind: "spoke", id: s.id },
          x: x + SW / 2 - 15,
          y: y + SD / 2 - 15,
          z: z + 12,
          w: 30,
          d: 30,
          h: 16,
          color: group === "online" ? COLORS.appPublic : COLORS.app,
          shape: "block",
          icon: group === "online" ? "appPublic" : "app",
          mg: group,
        });
      if (s.more)
        for (let k = 1; k <= 2; k++)
          prisms.push({
            key: `more:${s.id}:${k}`,
            x,
            y,
            z: z + 12 + k * 6,
            w: SW,
            d: SD,
            h: 4,
            color: COLORS.spoke,
            shape: "slab",
            sel: { kind: "spoke", id: s.id },
          });
      anchors[`spoke:${s.id}`] = [x + SW / 2, y + SD / 2, z + (s.ghost || s.more ? 12 : 28)];
      spokes.push({ id: s.id, placement: s.placement, group, ghost: s.ghost });
      if (group === "corp" && hasHub(answers) && !s.more)
        links.push({
          from: `spoke:${s.id}`,
          to: wan ? "vhub" : "hubvnet",
          kind: wan ? "hubconnection" : "peering",
        });
    });
  };

  /* ---- layout */
  const z1 = 8;
  const z2 = 16;
  const childD = Math.max(0, ...children.map((c) => c.d));
  const platformW =
    PAD + children.reduce((a, c) => a + c.w, 0) + GAP * Math.max(0, children.length - 1) + PAD;
  const platformD = PAD + childD + PAD + LABEL;
  const lzChildW = PAD * 2 + 2 * SW + BG;
  const lzChildD = PAD * 2 + 2 * SD + BG + LABEL;
  const lzW = PAD + lzGroups.length * lzChildW + GAP * Math.max(0, lzGroups.length - 1) + PAD;
  const lzD = PAD + lzChildD + PAD + LABEL;
  const lzY = platformD + 36;
  const mainW = Math.max(platformW, lzW);
  const sideX = mainW + 36;
  const sideW = PAD * 2 + SW + PAD;

  if (has("platform")) {
    plate("platform", 0, 0, z1, mainW, platformD, COLORS.platform);
    let x = PAD;
    for (const c of children) {
      plate(c.id, x, PAD, z2, c.w, childD, COLORS.platformChild);
      c.draw(x, PAD, z2 + 8);
      x += c.w + GAP;
    }
  }
  if (has("landingzones")) {
    plate("landingzones", 0, lzY, z1, mainW, lzD, COLORS.lz);
    let x = PAD;
    for (const g of lzGroups) {
      plate(g, x, lzY + PAD, z2, lzChildW, lzChildD, COLORS.lzChild);
      drawSpokes(g, x + PAD, lzY + PAD * 2, z2 + 8, 2, 2);
      x += lzChildW + GAP;
    }
  }
  if (has("decommissioned")) {
    plate("decommissioned", sideX, 0, z1, sideW, platformD, COLORS.decommissioned);
    slab(
      "decommissioned",
      sideX + PAD,
      PAD,
      z1 + 8,
      sideW - PAD * 2,
      2 * SD,
      "Cancelled subscriptions",
      false,
      "Held 30–60 days",
    );
  }
  if (has("sandbox")) {
    plate("sandbox", sideX, lzY, z1, sideW, lzD, COLORS.sandbox);
    drawSpokes("sandbox", sideX + PAD, lzY + PAD, z1 + 8, 1, 2);
  }
  const rootW = sideX + sideW + PAD * 2;
  const rootD = lzY + lzD + PAD * 2 + LABEL;
  plate("alz", -PAD * 2, -PAD * 2, 0, rootW + PAD * 2, rootD + PAD * 2, COLORS.root);

  if (on(answers.identity) && hasHub(answers))
    links.push({
      from: "sub:identity",
      to: wan ? "vhub" : "hubvnet",
      kind: wan ? "hubconnection" : "peering",
    });

  /* ---- outside the tenant */
  const ext = (
    id: string,
    x: number,
    y: number,
    z: number,
    icon: IconKey,
    label: string,
    size = 54,
  ) => {
    prisms.push({
      key: `ext:${id}`,
      sel: { kind: "ext", id },
      x,
      y,
      z,
      w: size,
      d: size,
      h: id === "onprem" ? 40 : 10,
      color: COLORS[id as keyof typeof COLORS] ?? "#999",
      shape: id === "onprem" ? "block" : "disc",
      icon,
      label,
      labelLevel: "ext",
    });
    anchors[id] = [x + size / 2, y + size / 2, z + (id === "onprem" ? 40 : 10)];
  };
  const connX = children
    .slice(
      0,
      children.findIndex((c) => c.id === "connectivity"),
    )
    .reduce((a, c) => a + c.w + GAP, PAD);
  ext("internet", connX + 120, -190, 70, "internet", "Internet", 70);
  ext("users", mainW - 30, -170, 40, "users", "Your customers' users");
  ext("operator", connX - 170, -150, 40, "operator", "Operators");
  ext("onprem", -190, 120, 0, "onprem", "Head office / data center", 60);

  return { prisms, anchors, links, plates, spokes };
}

/* ------------------------------------------------------------------ traffic */

export type FlowStep = { at: string; title: string; body: string; policy?: string };
export type Flow = {
  id: string;
  title: string;
  summary: string;
  color: string;
  available: boolean;
  reason?: string | undefined;
  steps: FlowStep[];
};

/** Traffic paths that exist in this design, narrated hop by hop. Unavailable ones say what's missing. */
export function flowsFor(scene: Scene, answers: Answers): Flow[] {
  const wan = answers.connectivity === "virtual_wan";
  const hub = hasHub(answers);
  const fw = hasFirewall(answers);
  const corp = scene.spokes.filter((s) => s.group === "corp");
  const online = scene.spokes.filter((s) => s.group === "online");
  const name = (s?: Scene["spokes"][number]) =>
    s?.placement ? `${s.placement.customerName} (${s.placement.environment})` : "a Corp install";
  const Name = (s?: Scene["spokes"][number]) => {
    const n = name(s);
    return n.charAt(0).toUpperCase() + n.slice(1);
  };
  const corpA = corp[0];
  const corpB = corp[1];
  const onlineA = online[0];
  const route = wan
    ? "Routing intent on the secured virtual hub sends it to the hub's Azure Firewall"
    : "The route table on the spoke's subnets sends it to the firewall's private IP";
  const fwName = `Azure Firewall ${answers.firewall}`;
  const gw = on(answers.expressRoute) ? "ergw" : on(answers.vpnGateway) ? "vpngw" : null;
  const flows: Flow[] = [];

  flows.push({
    id: "ingress",
    title: "Users reach an Online install",
    summary: "Internet-facing traffic goes straight to the install — it never touches the hub.",
    color: "#2fb3e8",
    available: !!onlineA && !onlineA.ghost,
    reason: !online.length
      ? "The Online landing zone isn't in this design."
      : "No Online installs yet.",
    steps: onlineA
      ? [
          {
            at: "users",
            title: "Request from the internet",
            body: "A user opens the product's URL.",
          },
          {
            at: `spoke:${onlineA.id}`,
            title: `Arrives at ${name(onlineA)}`,
            body: "The install's own Application Gateway (WAF) or Front Door receives it. Online landing zones allow public endpoints, and each install is isolated in its own subscription and network.",
            policy: "Audit-AppGW-WAF (Landing zones) checks the WAF is on",
          },
        ]
      : [],
  });

  flows.push({
    id: "egress",
    title: "A Corp workload calls the internet",
    summary: "All outbound traffic from Corp is inspected centrally.",
    color: "#f0605a",
    available: hub && fw && !!corpA,
    reason: !hub
      ? "No central network — there is no hub to route through."
      : !fw
        ? "Add Azure Firewall. Without it there's no central egress control; VMs use Azure's default outbound access."
        : "The Corp landing zone isn't in this design.",
    steps: corpA
      ? [
          {
            at: `spoke:${corpA.id}`,
            title: `${Name(corpA)} sends a request out`,
            body: `${route}.`,
          },
          {
            at: "firewall",
            title: `${fwName} inspects it`,
            body:
              answers.firewall === "Premium"
                ? "Firewall policy rules, TLS inspection and intrusion detection (IDPS) are applied; allowed traffic leaves through the firewall's public IP."
                : "Firewall policy network and application rules are applied; allowed traffic leaves through the firewall's public IP.",
          },
          { at: "internet", title: "Out to the internet", body: "Replies come back the same way." },
        ]
      : [],
  });

  flows.push({
    id: "hybrid",
    title: "The office reaches a Corp workload",
    summary: "Private connectivity from on-premises lands in the hub, then the spoke.",
    color: "#9d7ff7",
    available: hub && !!gw && !!corpA,
    reason: !hub
      ? "No central network."
      : !gw
        ? "Add a VPN or ExpressRoute gateway to connect on-premises networks."
        : "The Corp landing zone isn't in this design.",
    steps:
      gw && corpA
        ? [
            {
              at: "onprem",
              title: "From the office or data center",
              body: "A user or system on the corporate network.",
            },
            {
              at: gw,
              title: gw === "ergw" ? "Over ExpressRoute" : "Over a site-to-site VPN",
              body:
                gw === "ergw"
                  ? "A private circuit — traffic never crosses the public internet."
                  : "An encrypted IPsec tunnel over the internet.",
            },
            ...(fw
              ? [
                  {
                    at: "firewall",
                    title: "Inspected by the firewall",
                    body: wan
                      ? "Routing intent sends private traffic through the hub firewall."
                      : "The gateway subnet's route table forwards spoke-bound traffic to the firewall.",
                  },
                ]
              : []),
            {
              at: `spoke:${corpA.id}`,
              title: `Delivered to ${name(corpA)}`,
              body: wan
                ? "Through the spoke's virtual hub connection."
                : "Through the spoke's peering with the hub.",
              policy:
                "Deny-HybridNetworking (Corp) stops workloads building their own gateways — this is the only way in",
            },
          ]
        : [],
  });

  flows.push({
    id: "eastwest",
    title: "One Corp install talks to another",
    summary: "Spokes can't reach each other directly — the firewall decides.",
    color: "#f2a33a",
    available: hub && fw && !!corpA,
    reason: !hub
      ? "No central network."
      : !fw
        ? "Add Azure Firewall. Peering isn't transitive, so without it spokes can't reach each other at all."
        : "The Corp landing zone isn't in this design.",
    steps: corpA
      ? [
          {
            at: `spoke:${corpA.id}`,
            title: `From ${name(corpA)}`,
            body: `Traffic to another spoke's address range. ${route}.`,
          },
          {
            at: "firewall",
            title: "The firewall allows or denies it",
            body: "Network rules decide which installs may talk. By default, nothing is allowed.",
          },
          {
            at: `spoke:${(corpB ?? corpA).id}`,
            title: corpB ? `To ${name(corpB)}` : "To the next Corp install",
            body: "Each install stays isolated unless a rule says otherwise.",
          },
        ]
      : [],
  });

  const dns = hub && answers.privateDns === "platform";
  flows.push({
    id: "private-endpoint",
    title: "A workload reaches its database privately",
    summary: "Private endpoints plus central private DNS keep PaaS traffic off the internet.",
    color: "#37b6df",
    available: dns && !!corpA,
    reason: !hub
      ? "No central network, so there are no central private DNS zones."
      : answers.privateDns !== "platform"
        ? "Turn on central private DNS so private endpoints resolve."
        : "The Corp landing zone isn't in this design.",
    steps: corpA
      ? [
          {
            at: `spoke:${corpA.id}`,
            title: "Looks up the database name",
            body: "e.g. mydb.database.windows.net, from an app in the spoke.",
          },
          {
            at: "dnszones",
            title: "Private DNS answers with a private IP",
            body: "The privatelink.database.windows.net zone in Connectivity holds the private endpoint's record. On-premises servers get the same answer through the DNS Private Resolver.",
            policy:
              "Deploy-Private-DNS-Zones (Corp) registers the record automatically when the endpoint is created",
          },
          {
            at: `spoke:${corpA.id}`,
            title: "Connects over the private endpoint",
            body: "The connection stays inside the spoke's network; the database's public access stays off.",
            policy: "Deny-Public-Endpoints (Corp) keeps PaaS public network access disabled",
          },
        ]
      : [],
  });

  flows.push({
    id: "bastion",
    title: "An operator signs in to a VM",
    summary: "No public IPs on VMs; admin access goes through Bastion.",
    color: "#27c1ad",
    available: hub && on(answers.bastion) && !!corpA,
    reason: !hub
      ? "No central network."
      : !on(answers.bastion)
        ? "Add Azure Bastion."
        : "The Corp landing zone isn't in this design.",
    steps: corpA
      ? [
          {
            at: "operator",
            title: "Operator opens the Azure portal",
            body: "Signs in with Microsoft Entra ID and connects over HTTPS (443).",
          },
          {
            at: "bastion",
            title: "Azure Bastion brokers the session",
            body: "RDP or SSH runs from Bastion, inside Azure.",
          },
          {
            at: `spoke:${corpA.id}`,
            title: `Reaches the VM in ${name(corpA)}`,
            body: "Over the VM's private IP. The VM has no public IP.",
            policy: "Deny-MgmtPorts-Internet (Landing zones) blocks RDP/SSH from the internet",
          },
        ]
      : [],
  });

  const monitored = scene.spokes.find((s) => !s.ghost && s.placement) ?? scene.spokes[0];
  flows.push({
    id: "telemetry",
    title: "Logs and security signals",
    summary: "Every subscription reports to one workspace, set up by policy.",
    color: "#b36cf0",
    available: answers.monitoring === "azure_monitor" && !!monitored,
    reason: "A third-party tool collects telemetry; the Azure Monitor Agent policies are removed.",
    steps: monitored
      ? [
          {
            at: `spoke:${monitored.id}`,
            title: "Agent installed by policy",
            body: "Every VM gets the Azure Monitor Agent, using the AMA managed identity. Nobody installs it by hand.",
            policy: "Deploy-VM-Monitoring (Landing zones)",
          },
          {
            at: "dcr",
            title: "Data collection rules pick the data",
            body: "VM insights, change tracking and Defender for SQL.",
          },
          {
            at: "law",
            title: "Lands in the central workspace",
            body: `Kept for ${answers.logRetentionDays} days. Activity logs from every subscription arrive here too.`,
            policy: "Deploy-AzActivity-Log (root)",
          },
          ...(answers.siem === "sentinel"
            ? [
                {
                  at: "sentinel",
                  title: "Microsoft Sentinel analyzes it",
                  body: "Detections and incidents for the security team.",
                },
              ]
            : []),
        ]
      : [],
  });

  return flows;
}
