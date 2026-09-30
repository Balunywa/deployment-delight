/*
 * The pieces of a landing zone design the architecture drawing needs that aren't platform resources: the
 * customer installs (spoke subscriptions) per landing zone group, and the traffic paths that are actually
 * possible with what was selected. Pure data; the diagram draws it.
 */
import {
  type AlzLibrary,
  type Answers,
  type MgNode,
  hasFirewall,
  hasHub,
  on,
  spokeOf,
} from "./engine";
import type { Placement } from "./placement";

export type Sel = { kind: "mg" | "sub" | "res" | "spoke" | "ext" | "tool"; id: string };

export type Spoke = {
  id: string;
  placement?: Placement | undefined;
  group: string;
  ghost: boolean;
};

/** Every customer install per landing zone group; an empty group gets a placeholder for the next install. */
export function spokesFor(groups: string[], placed: Placement[]): Spoke[] {
  return groups.flatMap((group): Spoke[] => {
    const list = placed.filter((p) => p.landingZone === group);
    if (!list.length) return [{ id: `${group}:next`, group, ghost: true }];
    return list.map((p) => ({
      id: `${p.customerId}:${p.environment}`,
      placement: p,
      group,
      ghost: false,
    }));
  });
}

/** Subscriptions added in the design (vended with their own spoke network by the generated Terraform). */
export type SceneExtra = { id: string; name: string; group: string; cidr: string; peered: boolean };
type Scene = { spokes: Spoke[]; extras?: SceneExtra[] | undefined };

/** Added subscriptions in the design's groups, numbered exactly as the generated Terraform numbers them. */
export function sceneExtras(answers: Answers, lib: AlzLibrary, tree: MgNode[]): SceneExtra[] {
  return answers.extraSubscriptions
    .filter((x) => tree.some((t) => t.libraryId === x.group))
    .map((x, i) => {
      const s = spokeOf(answers, lib, x, i);
      return { id: x.id, name: x.name, group: x.group, cidr: s.cidr, peered: s.peered };
    });
}

/* ------------------------------------------------------------------ traffic */

/** What decided where a packet goes next: the effective route (or DNS answer) at this hop. */
export type HopRoute = {
  kind: "UDR" | "System" | "BGP" | "Routing intent" | "Hub router" | "DNS" | "Public" | "Tunnel";
  /** e.g. "rt-acme-prod: 0.0.0.0/0 → VirtualAppliance (firewall private IP)". */
  text: string;
};
/** A security decision on the way: NSG, firewall rule, WAF, sign-in, policy. */
export type HopCheck = {
  kind: "NSG" | "Firewall" | "WAF" | "Sign-in" | "Policy";
  text: string;
  result: "allow" | "deny" | "inspect" | "needs-rule";
};
export type HopGap = {
  severity: "fail" | "warn";
  text: string;
  fix?: { label: string; patch: Partial<Answers> } | undefined;
};
export type FlowStep = {
  at: string;
  title: string;
  body: string;
  /** Label for the link into the next hop (e.g. "UDR 0.0.0.0/0", "IPsec", "Peering"). */
  via?: string | undefined;
  route?: HopRoute | undefined;
  checks?: HopCheck[] | undefined;
  gap?: HopGap | undefined;
  policy?: string | undefined;
};
/** The end-to-end result, like a reachability analysis. */
export type FlowOutcome = {
  status: "reaches" | "needs-rules" | "blocked" | "isolated" | "uninspected" | "broken";
  text: string;
};
export type Flow = {
  id: string;
  title: string;
  summary: string;
  color: string;
  available: boolean;
  reason?: string | undefined;
  steps: FlowStep[];
  outcome?: FlowOutcome | undefined;
  /** Returning traffic, when it matters (asymmetric routing is the usual failure). */
  returnPath?: string | undefined;
  fix?: { label: string; patch: Partial<Answers> } | undefined;
};

/*
 * Traffic, hop by hop, the way Azure actually routes it for this design and the Terraform it generates:
 * - Route selection is longest prefix first; for equal prefixes a UDR beats BGP beats a system route. VNet and
 *   peering system routes can't be overridden by a broader UDR (learn.microsoft.com/azure/virtual-network/
 *   virtual-networks-udr-overview).
 * - Vended spoke subnets are private (default outbound access off), so without a firewall or NAT gateway there
 *   is no internet egress (Azure/avm-ptn-alz-sub-vending; learn.microsoft.com/azure/virtual-network/ip-services/
 *   default-outbound-access).
 * - The firewall policy this design deploys has no rules, and Azure Firewall denies what no rule allows.
 * - Corp spokes get 0.0.0.0/0 → firewall with gateway route propagation off; the GatewaySubnet gets a route per
 *   added spoke's exact range → firewall, so on-premises traffic is inspected both ways.
 * - Virtual WAN without routing intent is any-to-any through the hub router
 *   (learn.microsoft.com/azure/virtual-wan/about-virtual-hub-routing).
 */
export function flowsFor(scene: Scene, answers: Answers): Flow[] {
  const wan = answers.connectivity === "virtual_wan";
  const hubNet = answers.connectivity === "hub_and_spoke";
  const hub = hasHub(answers);
  const fw = hasFirewall(answers);
  const fwName = `Azure Firewall ${answers.firewall}`;
  const er = on(answers.expressRoute);
  const vpn = on(answers.vpnGateway);
  const gw = er ? "ergw" : vpn ? "vpngw" : null;
  const addFirewall = {
    label: "Add Azure Firewall Standard",
    patch: { firewall: "Standard" as const },
  };

  // Where Corp traffic starts and ends: prefer a subscription added in this design (its routes are generated),
  // otherwise a customer install.
  type Target = { node: string; name: string; routed: boolean; cidr?: string; ghost?: boolean };
  const nameOf = (s: Spoke) =>
    s.placement
      ? `${s.placement.customerName} (${s.placement.environment})`
      : "the next Corp install";
  const corpTargets: Target[] = [
    ...(scene.extras ?? [])
      .filter((e) => e.group === "corp" && e.peered)
      .map((e) => ({ node: `extra:${e.id}`, name: e.name, routed: true, cidr: e.cidr })),
    ...scene.spokes
      .filter((s) => s.group === "corp")
      .map((s) => ({ node: `spoke:${s.id}`, name: nameOf(s), routed: false, ghost: s.ghost })),
  ];
  const A = corpTargets[0];
  const B = corpTargets[1];
  const onlineA = scene.spokes.find((s) => s.group === "online" && !s.ghost);
  const noCorp = "The Corp landing zone isn't in this design.";
  const flows: Flow[] = [];

  const denyByDefault: HopCheck = {
    kind: "Firewall",
    text: "The firewall policy this design deploys has no rules yet; Azure Firewall denies anything no rule allows",
    result: "needs-rule",
  };
  const fwRules = (what: string): HopGap => ({
    severity: "warn",
    text: `Add a firewall rule for ${what}. Rules are processed DNAT → network → application; the first match wins.`,
  });
  const spokeEgressRoute = (t: Target): HopRoute =>
    wan
      ? {
          kind: "Routing intent",
          text: "Internet and private traffic policies on the hub advertise 0.0.0.0/0 and the private ranges to the spoke with the hub firewall as next hop — no route table in the spoke",
        }
      : {
          kind: "UDR",
          text: `${t.routed ? `rt-${t.name}` : "The install's route table"}: 0.0.0.0/0 → VirtualAppliance (firewall private IP). Gateway route propagation is off, so on-premises routes can't bypass it`,
        };

  /* 1. Internet users → an Online install */
  flows.push({
    id: "ingress",
    title: "Users reach an Online install",
    summary:
      "Straight to the install's own entry point — the hub and firewall are never on this path.",
    color: "#2fb3e8",
    available: !!onlineA,
    reason: !scene.spokes.some((s) => s.group === "online")
      ? "The Online landing zone isn't in this design."
      : "No Online installs yet.",
    steps: onlineA
      ? [
          {
            at: "users",
            title: "A user opens the product's URL",
            body: "HTTPS 443 to the install's public frontend. With Azure Front Door in front, the request enters at the nearest Front Door edge and crosses the Microsoft backbone to the origin (over Private Link on Premium).",
            via: "HTTPS 443 · public IP",
            route: {
              kind: "Public",
              text: "Internet → the Application Gateway's public frontend IP in the install's network",
            },
          },
          {
            at: `spoke:${onlineA.id}`,
            title: "Application Gateway WAF v2 terminates it",
            body: "Online spokes aren't peered to the hub, so nothing here passes the platform firewall. The WAF is the only inspection point.",
            checks: [
              {
                kind: "NSG",
                text: "App Gateway subnet: allow 443 from Internet (or AzureFrontDoor.Backend) and GatewayManager 65200-65535",
                result: "allow",
              },
              { kind: "WAF", text: "OWASP rules on the listener", result: "inspect" },
            ],
            gap: {
              severity: "warn",
              text: "Audit-AppGW-WAF only audits: an install published without WAF is flagged, not blocked.",
            },
            policy: "Audit-AppGW-WAF (Landing zones)",
          },
          {
            at: `spoke:${onlineA.id}`,
            title: "Proxied to the app's backend",
            body: "The backend sees an Application Gateway instance IP as the source, not the user's.",
            checks: [
              {
                kind: "NSG",
                text: "Backend subnet: allow from the App Gateway subnet",
                result: "allow",
              },
            ],
            route: { kind: "System", text: "VNet-local route inside the install's network" },
          },
        ]
      : [],
    outcome: {
      status: "reaches",
      text: "Reaches the install, inspected by the install's own WAF only.",
    },
    returnPath:
      "Replies go back through the Application Gateway, which is a proxy, so the path is symmetric.",
  });

  /* 2. A Corp workload → the internet */
  const egress: Flow = {
    id: "egress",
    title: "A Corp workload calls the internet",
    summary: fw
      ? "Forced through the hub firewall, which decides."
      : "No path out: there's no firewall and the subnets are private.",
    color: "#f0605a",
    available: !!A,
    reason: noCorp,
    steps: [],
  };
  if (A && hub && fw) {
    egress.steps = [
      {
        at: A.node,
        title: `${A.name} sends a request out`,
        body: "The VM's NIC and subnet NSGs are checked outbound first.",
        via: wan ? "Routing intent 0.0.0.0/0" : "UDR 0.0.0.0/0",
        route: spokeEgressRoute(A),
        checks: [{ kind: "NSG", text: "Outbound: NIC NSG, then subnet NSG", result: "allow" }],
      },
      {
        at: "firewall",
        title: `${fwName} decides`,
        body: `Allowed traffic is source-NATed to the firewall's public IP. ${answers.firewall === "Premium" ? "Premium adds TLS inspection and IDPS." : ""}`.trim(),
        via: "SNAT → firewall public IP",
        route: {
          kind: "System",
          text: wan
            ? "Secured hub: the firewall sends internet-bound traffic out directly"
            : "AzureFirewallSubnet: 0.0.0.0/0 → Internet",
        },
        checks: [denyByDefault],
        gap: fwRules("the destinations your product calls (application rules by FQDN)"),
      },
      {
        at: "internet",
        title: "Out to the internet",
        body: "From the firewall's public IP. Replies return to that IP and the firewall hands them back.",
      },
    ];
    egress.outcome = {
      status: "needs-rules",
      text: "Routed through the firewall; it gets out once a rule allows the destination.",
    };
    egress.returnPath =
      "Replies come back to the firewall's public IP and follow the session back to the VM — symmetric.";
  } else if (A) {
    egress.steps = [
      {
        at: A.node,
        title: `${A.name} tries to reach the internet`,
        body: "No route table: the system route 0.0.0.0/0 → Internet applies, but vended subnets are private (default outbound access off), and there's no NAT gateway.",
        route: {
          kind: "System",
          text: "0.0.0.0/0 → Internet (system route) — no outbound method on a private subnet",
        },
        gap: {
          severity: "fail",
          text: "No internet egress. Add Azure Firewall (inspected egress) or give the subnet a NAT gateway (uninspected).",
          fix: hub
            ? addFirewall
            : {
                label: "Add a hub with Azure Firewall",
                patch: { connectivity: "hub_and_spoke", firewall: "Standard" },
              },
        },
        policy: "Enforce-Subnet-Private (Landing zones) audits that subnets stay private",
      },
    ];
    egress.outcome = {
      status: "broken",
      text: "Can't get out: no firewall, no NAT gateway, private subnets.",
    };
    egress.fix = hub ? addFirewall : undefined;
  }
  flows.push(egress);

  /* 3. One Corp install → another */
  const ew: Flow = {
    id: "eastwest",
    title: "One Corp install talks to another",
    summary: "Customer installs should be isolated from each other — here's what enforces it.",
    color: "#f2a33a",
    available: !!A,
    reason: noCorp,
    steps: [],
  };
  const bName = B?.name ?? "another Corp install";
  if (A && hubNet && fw) {
    ew.steps = [
      {
        at: A.node,
        title: `${A.name} sends to ${bName}`,
        body: "There's no route to the other spoke — peering isn't transitive — so the default route takes it to the firewall.",
        via: "UDR 0.0.0.0/0",
        route: spokeEgressRoute(A),
      },
      {
        at: "firewall",
        title: "The firewall has no rule between installs",
        body: "Network rules decide spoke-to-spoke traffic (private ranges aren't source-NATed). With no rule, it's denied.",
        checks: [
          {
            kind: "Firewall",
            text: "No network rule from this install to the other: denied",
            result: "deny",
          },
        ],
      },
    ];
    ew.outcome = {
      status: "isolated",
      text: "Stopped at the firewall: customers are isolated unless you add a rule.",
    };
    ew.returnPath = `If you add a rule, the hub reaches ${bName} over its peering, the destination's subnet NSG checks it inbound, and the reply returns via that spoke's 0.0.0.0/0 route to the firewall — symmetric.`;
  } else if (A && wan && fw) {
    ew.steps = [
      {
        at: A.node,
        title: `${A.name} sends to ${bName}`,
        body: "The private traffic policy covers 10/8, 172.16/12 and 192.168/16, so it goes to the hub firewall.",
        via: "Routing intent (private)",
        route: spokeEgressRoute(A),
      },
      {
        at: "firewall",
        title: "The hub firewall has no rule between installs",
        body: "Denied by default.",
        checks: [
          { kind: "Firewall", text: "No network rule between installs: denied", result: "deny" },
        ],
      },
    ];
    ew.outcome = {
      status: "isolated",
      text: "Stopped at the hub firewall: customers are isolated unless you add a rule.",
    };
  } else if (A && wan) {
    ew.steps = [
      {
        at: A.node,
        title: `${A.name} sends to ${bName}`,
        body: "Every VNet connection associates with and propagates to the hub's Default route table.",
        via: "Hub connection",
        route: {
          kind: "Hub router",
          text: "Default route table: every connected spoke's range → that spoke's connection",
        },
      },
      {
        at: "hub1",
        title: "The hub router forwards it directly",
        body: "Without routing intent there is no inspection point in a Virtual WAN hub.",
        gap: {
          severity: "fail",
          text: "Any-to-any: every customer install can reach every other one. Add Azure Firewall so routing intent sends private traffic through it.",
          fix: addFirewall,
        },
      },
      ...(B
        ? [
            {
              at: B.node,
              title: `Arrives at ${bName}`,
              body: "Only the destination's NSGs stand in the way.",
            },
          ]
        : []),
    ];
    ew.outcome = {
      status: "uninspected",
      text: "Reaches the other install, uninspected — customers aren't isolated.",
    };
    ew.fix = addFirewall;
  } else if (A) {
    ew.steps = [
      {
        at: A.node,
        title: `${A.name} sends to ${bName}`,
        body: hubNet
          ? "The spokes are only peered with the hub, and peering isn't transitive, so there's no route to the other spoke."
          : "Each install has its own unconnected network.",
        route: { kind: "System", text: "No route to the other install's range" },
      },
    ];
    ew.outcome = {
      status: "isolated",
      text: "Unreachable — isolated by design, though nothing inspects or logs the attempt.",
    };
  }
  flows.push(ew);

  /* 4. On-premises → a Corp install (site-to-site VPN or ExpressRoute) */
  const hybrid: Flow = {
    id: "hybrid",
    title: "The office reaches a Corp workload",
    summary: er
      ? "Over ExpressRoute private peering into the hub, then the spoke."
      : "Over a site-to-site VPN into the hub, then the spoke.",
    color: "#9d7ff7",
    available: hub && !!gw && !!A,
    reason: !hub
      ? "No central network."
      : !gw
        ? "Add a VPN or ExpressRoute gateway to connect on-premises networks."
        : noCorp,
    fix: hub && !gw ? { label: "Add a VPN gateway", patch: { vpnGateway: "yes" } } : undefined,
    steps: [],
  };
  if (hub && gw && A) {
    const entry: FlowStep = {
      at: "onprem",
      title: "From the office or data center",
      body: er
        ? "Over the ExpressRoute circuit's private peering: customer edge → Microsoft edge (MSEE) → the ExpressRoute gateway. Never crosses the internet."
        : "An IPsec tunnel over the internet to the VPN gateway.",
      via: er ? "ExpressRoute private peering" : "IPsec S2S",
      route: {
        kind: "BGP",
        text: `On-premises learns the hub and spoke ranges from the gateway (gateway transit on the hub peering).${er && vpn ? " For identical prefixes ExpressRoute is preferred over the VPN." : ""}`,
      },
    };
    const gwStep = (route: HopRoute, via: string, gap?: HopGap): FlowStep => ({
      at: gw,
      title: er ? "ExpressRoute gateway in the hub" : "VPN gateway in the hub",
      body: "The GatewaySubnet's route table decides where spoke-bound traffic goes next.",
      via,
      route,
      gap,
    });
    const land: FlowStep = {
      at: A.node,
      title: `Delivered to ${A.name}`,
      body: "The destination subnet's NSG checks it inbound; the source is the on-premises address.",
      checks: [{ kind: "NSG", text: "Inbound: allow from the on-premises range", result: "allow" }],
      policy:
        "Deny-HybridNetworking (Corp) stops workloads building their own gateways — this is the only way in",
    };
    if (hubNet && fw && A.routed) {
      hybrid.steps = [
        entry,
        gwStep(
          {
            kind: "UDR",
            text: `rt-hub-gateway (GatewaySubnet): ${A.cidr} → VirtualAppliance (firewall). Same prefix as the peering route, so the UDR wins`,
          },
          `UDR ${A.cidr}`,
        ),
        {
          at: "firewall",
          title: `${fwName} decides`,
          body: "Private-to-private traffic is not source-NATed.",
          via: "Peering",
          checks: [denyByDefault],
          gap: fwRules("on-premises ranges to this install (network rule)"),
        },
        land,
      ];
      hybrid.outcome = {
        status: "needs-rules",
        text: "Inspected both ways; reaches the workload once a firewall rule allows it.",
      };
      hybrid.returnPath =
        "The spoke's 0.0.0.0/0 → firewall route (propagation off) sends the reply back through the firewall to the gateway — symmetric.";
    } else if (hubNet && fw) {
      hybrid.steps = [
        entry,
        gwStep(
          {
            kind: "System",
            text: "No GatewaySubnet route for this install's range, so the more specific VNet-peering route sends it straight to the spoke",
          },
          "Peering (bypasses firewall)",
          {
            severity: "fail",
            text: "Asymmetric: the request skips the firewall, but the spoke's 0.0.0.0/0 route sends the reply to the firewall, which never saw the session and drops it. Add this install's exact range to the GatewaySubnet route table (next hop: firewall).",
          },
        ),
        land,
      ];
      hybrid.outcome = {
        status: "broken",
        text: "Connections fail: the reply is dropped by the firewall (asymmetric routing).",
      };
      hybrid.returnPath =
        "Reply: spoke 0.0.0.0/0 → firewall → dropped (no session). Subscriptions added in this design get the gateway route automatically; customer installs need theirs added at onboarding.";
    } else if (wan && fw) {
      hybrid.steps = [
        entry,
        gwStep(
          {
            kind: "Routing intent",
            text: "Private traffic policy: branch → VNet goes to the hub firewall",
          },
          "Routing intent (private)",
        ),
        {
          at: "firewall",
          title: `${fwName} decides`,
          body: "Not source-NATed.",
          via: "Hub connection",
          checks: [denyByDefault],
          gap: fwRules("on-premises ranges to this install"),
        },
        land,
      ];
      hybrid.outcome = {
        status: "needs-rules",
        text: "Inspected; reaches the workload once a firewall rule allows it.",
      };
      hybrid.returnPath =
        "Routing intent sends the reply through the same hub firewall — symmetric.";
    } else {
      hybrid.steps = [
        entry,
        gwStep(
          {
            kind: wan ? "Hub router" : "System",
            text: wan
              ? "Default route table: branch ↔ VNet any-to-any"
              : "VNet-peering route; the spoke uses the hub's gateway (gateway transit) and learns on-premises routes by BGP",
          },
          wan ? "Hub connection" : "Peering",
          {
            severity: "warn",
            text: "Uninspected: nothing between the office and the workload but NSGs.",
            fix: addFirewall,
          },
        ),
        land,
      ];
      hybrid.outcome = {
        status: "uninspected",
        text: "Reaches the workload directly — no firewall on the path.",
      };
    }
  }
  flows.push(hybrid);

  /* 5. Remote engineers over point-to-site VPN */
  if (hub && vpn)
    flows.push({
      id: "p2s",
      title: "A remote engineer connects over VPN",
      summary: "Point-to-site from a laptop, signed in with Microsoft Entra ID.",
      color: "#6d8bf7",
      available: true,
      steps: [
        {
          at: "remote",
          title: "Azure VPN Client connects",
          body: "OpenVPN over TLS 443, Microsoft Entra ID sign-in. The laptop gets an address from the P2S pool and routes to the hub and directly peered spokes.",
          via: "OpenVPN (TLS 443)",
          checks: [
            {
              kind: "Sign-in",
              text: "Microsoft Entra ID with Conditional Access",
              result: "inspect",
            },
          ],
        },
        {
          at: "vpngw",
          title: "Point-to-site isn't configured on the gateway",
          body: "The VPN gateway in this design only has site-to-site. P2S needs an address pool and Entra ID authentication; after that the path matches the office path (GatewaySubnet route → firewall → spoke).",
          gap: {
            severity: "fail",
            text: "Configure point-to-site on the VPN gateway: a non-overlapping address pool, OpenVPN, Microsoft Entra ID authentication.",
          },
        },
      ],
      outcome: { status: "broken", text: "Not available yet: point-to-site isn't configured." },
    });

  /* 6. Private endpoint + DNS */
  const dns = hub && answers.privateDns === "platform";
  const proxy = hubNet && fw && answers.firewall !== "Basic" && dns;
  const pe: Flow = {
    id: "private-endpoint",
    title: "A workload reaches its database privately",
    summary: "DNS first, then the private endpoint — PaaS traffic never leaves the network.",
    color: "#37b6df",
    available: dns && !!A,
    reason: !hub
      ? "No central network, so there are no central private DNS zones."
      : answers.privateDns !== "platform"
        ? "Turn on central private DNS so private endpoints resolve."
        : noCorp,
    fix:
      hub && answers.privateDns !== "platform"
        ? { label: "Turn on central private DNS", patch: { privateDns: "platform" } }
        : undefined,
    steps: [],
  };
  if (dns && A && proxy) {
    pe.steps = [
      {
        at: A.node,
        title: "Looks up mydb.database.windows.net",
        body: "The spoke's DNS server is the firewall's private IP. The hub range is reached over the peering route, which is more specific than 0.0.0.0/0.",
        via: "DNS 53",
        route: {
          kind: "System",
          text: "VNet peering route to the hub range → firewall private IP",
        },
      },
      {
        at: "firewall",
        title: "Firewall DNS proxy forwards the query",
        body: "Proxying DNS is also what lets network rules filter by FQDN.",
        via: "DNS 53",
        route: {
          kind: "DNS",
          text: "Firewall policy DNS proxy → DNS Private Resolver inbound endpoint",
        },
      },
      {
        at: "dnsresolver",
        title: "DNS Private Resolver asks Azure DNS",
        body: "The inbound endpoint resolves through 168.63.129.16 in the hub network's context. On-premises DNS servers forward privatelink queries here too.",
        route: { kind: "DNS", text: "168.63.129.16 → private DNS zones linked to the hub" },
      },
      {
        at: "dnszones",
        title: "The privatelink zone answers with a private IP",
        body: "privatelink.database.windows.net holds the private endpoint's A record.",
        route: { kind: "DNS", text: "A record → the private endpoint's IP in the spoke" },
        policy: "Deploy-Private-DNS-Zones (Corp) registers the record when the endpoint is created",
      },
      {
        at: A.node,
        title: "Connects to the private endpoint",
        body: "Inside the spoke's own network. The private endpoint's /32 route can't be overridden by 0.0.0.0/0, so this never touches the firewall; NSGs apply to the endpoint only if its subnet has network policies enabled.",
        route: { kind: "System", text: "/32 → InterfaceEndpoint (private endpoint)" },
        policy: "Deny-Public-Endpoints (Corp) keeps PaaS public network access off",
      },
    ];
    pe.outcome = {
      status: "reaches",
      text: "Resolves privately and connects without leaving the network.",
    };
  } else if (dns && A) {
    const why = wan
      ? "Spokes on the Virtual WAN hub use Azure-provided DNS unless their DNS servers are set, and this design doesn't set them."
      : fw
        ? "Azure Firewall Basic has no DNS proxy, so this design leaves spokes on Azure-provided DNS."
        : "Without the firewall's DNS proxy, this design leaves spokes on Azure-provided DNS.";
    pe.steps = [
      {
        at: A.node,
        title: "Looks up mydb.database.windows.net",
        body: `${why} 168.63.129.16 only sees private DNS zones linked to the spoke's own network, and the privatelink zones are linked to the hub.`,
        route: { kind: "DNS", text: "168.63.129.16 in the spoke's context → public answer" },
        gap: {
          severity: "fail",
          text: "Resolves to the public endpoint, which Deny-Public-Endpoints keeps closed — the connection fails. Point spoke DNS at the resolver (or the firewall's DNS proxy).",
          fix: hubNet
            ? { label: "Use Azure Firewall Standard (DNS proxy)", patch: { firewall: "Standard" } }
            : undefined,
        },
      },
    ];
    pe.outcome = {
      status: "broken",
      text: "Name resolves to the public endpoint; the connection fails.",
    };
    pe.fix = hubNet
      ? { label: "Use Azure Firewall Standard (DNS proxy)", patch: { firewall: "Standard" } }
      : undefined;
  }
  flows.push(pe);

  /* 7. Operators → a VM through Bastion */
  const bastion = on(answers.bastion);
  const ops: Flow = {
    id: "bastion",
    title: "An operator signs in to a VM",
    summary: "No public IPs on VMs; admin sessions go through Azure Bastion.",
    color: "#27c1ad",
    available: hub && bastion && !!A,
    reason: !hub ? "No central network." : !bastion ? "Add Azure Bastion." : noCorp,
    fix: hub && !bastion ? { label: "Add Azure Bastion", patch: { bastion: "yes" } } : undefined,
    steps: [],
  };
  if (hub && bastion && A) {
    const start: FlowStep = {
      at: "operator",
      title: "Operator opens the Azure portal",
      body: "Signs in with Microsoft Entra ID, then connects to Bastion's public IP over HTTPS 443.",
      via: "HTTPS 443",
      checks: [
        {
          kind: "Sign-in",
          text: "Microsoft Entra ID; PIM activation for privileged roles",
          result: "inspect",
        },
      ],
    };
    const nsgBastion: HopCheck = {
      kind: "NSG",
      text: "AzureBastionSubnet: inbound 443 from Internet and GatewayManager; outbound 22/3389 to VirtualNetwork",
      result: "allow",
    };
    const vmNsg: HopCheck = {
      kind: "NSG",
      text: "VM subnet: allow 22/3389 from the Bastion subnet only",
      result: "needs-rule",
    };
    if (wan) {
      ops.steps = [
        start,
        {
          at: "bastion",
          title: "Bastion in the sidecar network",
          body: "Bastion can't live in a Virtual WAN hub, so it sits in a sidecar VNet connected to the hub and uses IP-based connection (Standard SKU).",
          via: fw ? "Routing intent (private)" : "Hub connection",
          checks: [nsgBastion],
        },
        ...(fw
          ? [
              {
                at: "firewall",
                title: "The hub firewall must allow the session",
                body: "The private traffic policy sends Bastion → spoke through the firewall.",
                checks: [denyByDefault],
                gap: fwRules("22/3389 from the Bastion subnet to the spokes"),
              } satisfies FlowStep,
            ]
          : []),
        {
          at: A.node,
          title: `Reaches the VM in ${A.name}`,
          body: "Over its private IP; the VM has no public IP.",
          checks: [vmNsg],
          policy: "Deny-MgmtPorts-Internet (Landing zones) blocks RDP/SSH from the internet",
        },
      ];
      ops.outcome = {
        status: "needs-rules",
        text: fw
          ? "Reaches the VM once the firewall and the VM's NSG allow it."
          : "Reaches the VM once its NSG allows the Bastion subnet.",
      };
    } else {
      ops.steps = [
        start,
        {
          at: "bastion",
          title: "Azure Bastion runs the RDP/SSH session",
          body: "From inside the hub, straight across the peering. Route tables aren't supported on the Bastion subnet, so this never passes the firewall.",
          via: "Peering · RDP/SSH",
          route: { kind: "System", text: "VNet peering route → the spoke's range" },
          checks: [nsgBastion],
        },
        {
          at: A.node,
          title: `Reaches the VM in ${A.name}`,
          body: "Over its private IP; the VM has no public IP.",
          checks: [vmNsg],
          policy: "Deny-MgmtPorts-Internet (Landing zones) blocks RDP/SSH from the internet",
        },
      ];
      ops.outcome = {
        status: "needs-rules",
        text: "Reaches the VM once its NSG allows 22/3389 from the Bastion subnet.",
      };
      ops.returnPath =
        "The reply uses the spoke's peering route to the hub range, which is more specific than 0.0.0.0/0, so it goes straight back to Bastion — symmetric, not through the firewall.";
    }
  }
  flows.push(ops);

  /* 8. Monitoring data */
  const monitored = scene.spokes.find((s) => !s.ghost && s.placement) ?? scene.spokes[0];
  const target =
    A ??
    (monitored
      ? { node: `spoke:${monitored.id}`, name: nameOf(monitored), routed: false }
      : undefined);
  const tele: Flow = {
    id: "telemetry",
    title: "Logs and security signals",
    summary: "Every VM reports to one workspace, set up by policy.",
    color: "#b36cf0",
    available: answers.monitoring === "azure_monitor" && !!target,
    reason: "A third-party tool collects telemetry; the Azure Monitor Agent policies are removed.",
    fix:
      answers.monitoring !== "azure_monitor"
        ? { label: "Use Azure Monitor", patch: { monitoring: "azure_monitor" } }
        : undefined,
    steps: [],
  };
  if (answers.monitoring === "azure_monitor" && target) {
    tele.steps = [
      {
        at: target.node,
        title: "Azure Monitor Agent sends data",
        body: "Installed by policy with the AMA managed identity. It fetches its data collection rules from *.handler.control.monitor.azure.com and sends to *.ods.opinsights.azure.com (or a data collection endpoint).",
        via: hub && fw ? "0.0.0.0/0 → firewall" : "HTTPS 443",
        route:
          hub && fw ? spokeEgressRoute(target) : { kind: "System", text: "0.0.0.0/0 → Internet" },
        policy: "Deploy-VM-Monitoring (Landing zones)",
      },
      ...(hub && fw
        ? [
            {
              at: "firewall",
              title: "Firewall must allow Azure Monitor",
              body: "Allow the AzureMonitor service tag on 443 (or the FQDNs as application rules). Or keep it off the internet entirely with Azure Monitor Private Link Scope.",
              via: "SNAT · Microsoft backbone",
              checks: [denyByDefault],
              gap: fwRules("AzureMonitor (443)"),
            } satisfies FlowStep,
          ]
        : []),
      {
        at: "dcr",
        title: "Ingested under the data collection rules",
        body: "VM insights, change tracking and Defender for SQL decide what's kept.",
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
              title: "Microsoft Sentinel reads the workspace",
              body: "Analytics and incidents — no extra network hop.",
            },
          ]
        : []),
    ];
    if (!(hub && fw))
      tele.steps[0]!.gap = {
        severity: "warn",
        text: "Needs a way out: vended subnets are private, so without a firewall use a NAT gateway or Azure Monitor Private Link Scope.",
      };
    tele.outcome =
      hub && fw
        ? { status: "needs-rules", text: "Arrives once the firewall allows Azure Monitor." }
        : {
            status: "uninspected",
            text: "Arrives only if the install's subnets have an outbound method.",
          };
  }
  flows.push(tele);

  return flows;
}
