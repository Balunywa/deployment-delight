/*
 * The pieces of a landing zone design the architecture drawing needs that aren't platform resources: the
 * customer installs (spoke subscriptions) per landing zone group, and the traffic paths that are actually
 * possible with what was selected. Pure data; the diagram draws it.
 */
import { type Answers, hasFirewall, hasHub, on } from "./engine";
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

type Scene = { spokes: Spoke[] };

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
