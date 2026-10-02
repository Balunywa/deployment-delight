export type KnowledgeTopicId =
  | "outbound-internet"
  | "hub-and-spoke-vs-virtual-wan"
  | "management-groups"
  | "dns-private-link"
  | "ip-planning"
  | "hybrid-connectivity";

export type ComparisonCell = string | { text: string; recommended?: boolean };

export type Block =
  | { type: "paragraph"; text: string }
  | { type: "bullets"; items: string[] }
  | { type: "comparison"; columns: string[]; rows: { cells: ComparisonCell[] }[] }
  | { type: "when-to-use"; items: { choice: string; when: string }[] }
  | { type: "callout"; tone: "info" | "warning" | "recommendation"; title: string; body: string }
  | { type: "steps"; steps: { from: string; to: string; what: string }[] }
  | { type: "learn-links"; links: { title: string; url: string }[] }
  | { type: "in-this-app"; title?: string; items: string[] };

export type KnowledgeTopic = {
  id: KnowledgeTopicId;
  title: string;
  summary: string;
  decision: string;
  sections: { id: string; title: string; blocks: Block[] }[];
};

export const KNOWLEDGE_TOPICS = [
  {
    id: "outbound-internet",
    title: "Outbound internet for landing zones",
    summary:
      "Choose how workloads reach public endpoints: inspected egress through Azure Firewall, subnet NAT, explicit public IPs, load balancer outbound rules, or forced tunnelling.",
    decision:
      "Which outbound path should Corp and Online landing zones use, and what must be explicit now that default outbound access is being retired?",
    sections: [
      {
        id: "patterns",
        title: "Egress patterns",
        blocks: [
          {
            type: "paragraph",
            text: "Azure recommends explicit outbound connectivity instead of relying on implicit platform default outbound access. Explicit options include a NAT gateway on a subnet, outbound rules on a Standard Load Balancer, an instance-level public IP, or routing to a firewall or NVA.",
          },
          {
            type: "comparison",
            columns: ["Pattern", "Best fit", "Trade-off"],
            rows: [
              {
                cells: [
                  { text: "Central Azure Firewall", recommended: true },
                  "Corp landing zones that need FQDN rules, logging, threat intelligence, and a single inspected egress point.",
                  "Requires firewall policy rules and symmetric routing. SNAT scale can be increased by associating NAT Gateway with AzureFirewallSubnet.",
                ],
              },
              {
                cells: [
                  "NAT Gateway on workload subnet",
                  "Outbound-only internet for a subnet when inspection is not required.",
                  "No inbound path and no firewall inspection; governance must decide where it is acceptable.",
                ],
              },
              {
                cells: [
                  "Load Balancer outbound rules",
                  "Backend pools that already use a Standard Load Balancer frontend for outbound SNAT.",
                  "Explicit and production-grade, but Microsoft rates it below NAT Gateway for scale.",
                ],
              },
              {
                cells: [
                  "Workload public IP",
                  "A VM or gateway-like appliance that must have its own public address.",
                  "Easy to reason about but expands the public attack surface.",
                ],
              },
              {
                cells: [
                  "Forced tunnelling to on-premises",
                  "Organizations that require internet egress through on-premises security stacks.",
                  "Needs route design, return-path symmetry, and enough on-premises capacity.",
                ],
              },
            ],
          },
          {
            type: "callout",
            tone: "warning",
            title: "Default outbound access changes",
            body: "For APIs released after March 31, 2026, new virtual networks default to private subnets. VMs in those subnets need an explicit outbound method to reach internet and Microsoft public endpoints. Existing virtual networks are not changed by that default behavior change.",
          },
        ],
      },
      {
        id: "when-to-use",
        title: "When to use each choice",
        blocks: [
          {
            type: "when-to-use",
            items: [
              {
                choice: "Corp + Azure Firewall",
                when: "Use when workloads are internal, need hybrid routing, or must be inspected before reaching the internet or another spoke.",
              },
              {
                choice: "Online + direct ingress",
                when: "Use when workloads serve public users directly. Keep ingress at the workload edge and use central egress only when the platform requires it.",
              },
              {
                choice: "NAT Gateway",
                when: "Use for high-scale, outbound-only SNAT from a subnet, including Azure Firewall SNAT scale by attaching NAT Gateway to AzureFirewallSubnet.",
              },
              {
                choice: "Forced tunnelling",
                when: "Use when policy says all internet-bound traffic must exit through on-premises controls rather than Azure-native egress.",
              },
            ],
          },
        ],
      },
      {
        id: "traffic-flow",
        title: "Traffic flow",
        blocks: [
          {
            type: "steps",
            steps: [
              {
                from: "Corp workload subnet",
                to: "Route table",
                what: "0.0.0.0/0 is selected when the destination is public.",
              },
              {
                from: "Route table",
                to: "Azure Firewall private IP",
                what: "The UDR next hop is VirtualAppliance, so the packet enters the hub.",
              },
              {
                from: "Azure Firewall",
                to: "Internet",
                what: "A matching network or application rule allows traffic; the firewall source-NATs public destinations.",
              },
              {
                from: "Internet reply",
                to: "Azure Firewall",
                what: "The reply returns to the firewall public IP and follows the stateful session back to the workload.",
              },
            ],
          },
        ],
      },
      {
        id: "in-this-app",
        title: "In this app",
        blocks: [
          {
            type: "in-this-app",
            items: [
              "Cloud Delivery vendors added subscriptions with Azure/avm-ptn-alz-sub-vending/azure. Each vended spoke has snet-workload and snet-private-endpoints subnets.",
              'When a subscription is Corp-like, has a hub, and Azure Firewall is enabled, the generated route table has 0.0.0.0/0 -> VirtualAppliance using module.connectivity.firewall_private_ip_addresses["primary"]. BGP propagation is disabled on that spoke route table.',
              "The simulator treats vended spoke subnets as private: if no firewall, NAT gateway, or public IP exists, the system 0.0.0.0/0 route cannot provide internet egress.",
              "The generated design does not attach NAT Gateway to workload subnets or AzureFirewallSubnet today. NAT Gateway is explained here as an option, not something this app currently emits.",
              "Online installs are modelled with their own public Application Gateway path; hub and firewall are not on that inbound path in the traffic guide.",
            ],
          },
        ],
      },
      {
        id: "learn",
        title: "Verified sources",
        blocks: [
          {
            type: "learn-links",
            links: [
              {
                title: "Default outbound access in Azure",
                url: "https://learn.microsoft.com/en-us/azure/virtual-network/ip-services/default-outbound-access",
              },
              {
                title: "Azure Load Balancer outbound connectivity methods",
                url: "https://learn.microsoft.com/en-us/azure/load-balancer/load-balancer-outbound-connections",
              },
              {
                title: "Scale Azure Firewall SNAT ports with NAT Gateway",
                url: "https://learn.microsoft.com/en-us/azure/firewall/integrate-with-nat-gateway",
              },
              {
                title: "Azure Firewall in a hybrid network",
                url: "https://learn.microsoft.com/en-us/azure/firewall/tutorial-hybrid-portal",
              },
            ],
          },
        ],
      },
    ],
  },
  {
    id: "hub-and-spoke-vs-virtual-wan",
    title: "Hub-and-spoke vs. Virtual WAN",
    summary:
      "Pick customer-managed hub VNets or Azure Virtual WAN for transit, routing automation, branch connectivity, and secured hub operations.",
    decision:
      "Should the connectivity subscription deploy a hub virtual network that you route yourself, or a Microsoft-managed Virtual WAN hub with routing intent?",
    sections: [
      {
        id: "comparison",
        title: "Architecture comparison",
        blocks: [
          {
            type: "comparison",
            columns: ["Capability", "Hub-and-spoke VNet", "Azure Virtual WAN"],
            rows: [
              {
                cells: [
                  "Transit model",
                  "You own hub VNets, peering, UDRs, gateways, and firewall placement.",
                  {
                    text: "Microsoft-managed virtual hub router provides VNet, VPN, ExpressRoute, and inter-hub transit.",
                    recommended: true,
                  },
                ],
              },
              {
                cells: [
                  "Routing control",
                  {
                    text: "Best when you need explicit route tables and appliance-specific routing.",
                    recommended: true,
                  },
                  "Best when routing intent and hub route tables can express the design at scale.",
                ],
              },
              {
                cells: [
                  "Branch scale",
                  "Works well for smaller numbers of sites or when you already manage gateway topology.",
                  {
                    text: "Built for large branch, SD-WAN/VPN, ExpressRoute, and global transit scenarios.",
                    recommended: true,
                  },
                ],
              },
              {
                cells: [
                  "Operations",
                  "More Azure primitives to own and troubleshoot.",
                  "Single Virtual WAN interface for hubs, connections, routing, and secured hub settings.",
                ],
              },
            ],
          },
          {
            type: "callout",
            tone: "info",
            title: "Peering is not transitive by itself",
            body: "Traditional hub-and-spoke uses peering to connect spokes to the hub. VNet peering and global VNet peering are not transitive, so transit needs UDRs and an NVA/firewall or gateways.",
          },
        ],
      },
      {
        id: "when-to-use",
        title: "When to use",
        blocks: [
          {
            type: "when-to-use",
            items: [
              {
                choice: "Hub-and-spoke VNet",
                when: "Use when the platform team wants direct control of hub subnets, route tables, firewall routing, DNS resolver placement, and gateway subnet routes.",
              },
              {
                choice: "Azure Virtual WAN",
                when: "Use when branch connectivity, automated VNet connection, full-mesh hubs, and routing intent reduce operational work.",
              },
              {
                choice: "No central network",
                when: "Use only when workloads do not need shared egress, private DNS, hybrid connectivity, or shared operations paths.",
              },
            ],
          },
        ],
      },
      {
        id: "secured-routing",
        title: "Secured routing",
        blocks: [
          {
            type: "paragraph",
            text: "Virtual WAN routing intent can forward internet-bound and private traffic to Azure Firewall or another next-hop security solution in the virtual hub. Internet routing policies advertise 0.0.0.0/0 to connections on that hub; private routing policies forward branch and virtual network traffic through the selected next hop.",
          },
          {
            type: "steps",
            steps: [
              {
                from: "Spoke VNet connection",
                to: "Virtual hub router",
                what: "The spoke receives routes from the virtual hub instead of a spoke route table.",
              },
              {
                from: "Virtual hub router",
                to: "Hub firewall",
                what: "Routing intent sends internet or private traffic to the configured security next hop.",
              },
              {
                from: "Hub firewall",
                to: "Destination",
                what: "Firewall policy must allow the flow before the hub forwards it.",
              },
            ],
          },
        ],
      },
      {
        id: "in-this-app",
        title: "In this app",
        blocks: [
          {
            type: "in-this-app",
            items: [
              "Hub-and-spoke mode emits Azure/avm-ptn-alz-connectivity-hub-and-spoke-vnet/azurerm with default_hub_address_space 10.0.0.0/16 and an optional second hub at 10.1.0.0/16.",
              "Virtual WAN mode emits Azure/avm-ptn-alz-connectivity-virtual-wan/azurerm. If Azure Firewall is selected, vended spokes get vwan_security_configuration with secure_internet_traffic, secure_private_traffic, and routing_intent_enabled set true.",
              "The scene model allocates a hub VNet as 10.0.0.0/22 for the drawn AVM hub subnets, while the Terraform module input remains 10.0.0.0/16.",
              "In hub-and-spoke mode, Corp-like added subscriptions are peered to the hub. In Virtual WAN mode, they are connected to the virtual hub.",
            ],
          },
        ],
      },
      {
        id: "learn",
        title: "Verified sources",
        blocks: [
          {
            type: "learn-links",
            links: [
              {
                title: "Traditional Azure networking topology",
                url: "https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/traditional-azure-networking-topology",
              },
              {
                title: "Hub-spoke network topology in Azure",
                url: "https://learn.microsoft.com/en-us/azure/architecture/networking/architecture/hub-spoke",
              },
              {
                title: "Azure Virtual WAN overview",
                url: "https://learn.microsoft.com/en-us/azure/virtual-wan/virtual-wan-about",
              },
              {
                title: "Virtual WAN hub routing and routing intent",
                url: "https://learn.microsoft.com/en-us/azure/virtual-wan/about-virtual-hub-routing",
              },
            ],
          },
        ],
      },
    ],
  },
  {
    id: "management-groups",
    title: "Management groups and archetypes",
    summary:
      "Understand the ALZ hierarchy, archetypes, policy inheritance, and why application environments should be subscriptions rather than management groups.",
    decision:
      "Where should platform subscriptions, workload subscriptions, sandbox subscriptions, and retired subscriptions sit so policy inheritance is predictable?",
    sections: [
      {
        id: "hierarchy",
        title: "ALZ hierarchy",
        blocks: [
          {
            type: "paragraph",
            text: "Management groups organize and govern subscriptions. Azure Landing Zones place an intermediate root below the tenant root, then use Platform, Landing zones, Sandbox, and Decommissioned branches so policies can be assigned by responsibility and workload type.",
          },
          {
            type: "comparison",
            columns: ["Management group", "Purpose"],
            rows: [
              {
                cells: [
                  "Platform",
                  "Parent for shared platform subscriptions and platform-team policy/RBAC.",
                ],
              },
              {
                cells: [
                  "Management",
                  "Central monitoring and operations resources such as the Log Analytics workspace.",
                ],
              },
              {
                cells: [
                  "Connectivity",
                  "Hub or Virtual WAN, Azure Firewall, gateways, Azure DNS private zones, and connectivity resources.",
                ],
              },
              { cells: ["Identity", "Identity infrastructure when workloads require it."] },
              {
                cells: [
                  "Landing zones",
                  "Parent for workload subscriptions that inherit workload guardrails.",
                ],
              },
              {
                cells: [
                  "Corp",
                  "Internal workloads that need traditional IP routing or hybrid connectivity through the hub.",
                ],
              },
              {
                cells: [
                  "Online",
                  "Public-facing workloads that are intentionally isolated from internal resources unless routed securely.",
                ],
              },
              { cells: ["Sandbox", "Experimentation isolated from production environments."] },
              {
                cells: [
                  "Decommissioned",
                  "Cancelled or retired subscriptions waiting for final removal under restrictive policy.",
                ],
              },
            ],
          },
        ],
      },
      {
        id: "policy-inheritance",
        title: "Archetypes and inheritance",
        blocks: [
          {
            type: "paragraph",
            text: "ALZ archetypes are sets of policy assignments, definitions, policy sets, and role definitions applied to management groups. Subscriptions inherit assignments from every parent management group, so a subscription under Corp receives Corp, Landing zones, intermediate root, and any other parent controls.",
          },
          {
            type: "callout",
            tone: "recommendation",
            title: "Keep the tree policy-oriented",
            body: "Microsoft recommends a reasonably flat hierarchy and warns against copying a deep organizational chart into management groups. Use management groups for policy assignment; use subscriptions and resource groups for workload access and lifecycle boundaries.",
          },
        ],
      },
      {
        id: "environments",
        title: "Environments are subscriptions",
        blocks: [
          {
            type: "paragraph",
            text: "ALZ guidance says not to create management groups for production, testing, and development environments. If separation is needed, place those environments in different subscriptions under the same workload-type management group.",
          },
          {
            type: "paragraph",
            text: "Subscription vending standardizes creation and governance of workload landing zone subscriptions. It uses subscriptions as the primary unit for workload management and scale.",
          },
        ],
      },
      {
        id: "in-this-app",
        title: "In this app",
        blocks: [
          {
            type: "in-this-app",
            items: [
              "Cloud Delivery loads pinned ALZ Library snapshots and renders the management group architecture, archetype assignments, policy assignment counts, and inherited control counts from those snapshots.",
              "Optional landing zone groups are Corp, Online, Local, and Sandbox. Decommissioned is always kept unless the platform branch itself is removed.",
              "The default answer sends new subscriptions to Sandbox, matching Microsoft guidance to configure a default dedicated management group for new subscriptions rather than leaving them at tenant root.",
              "The app models customer install environments as subscriptions. The default environments are dev, test, and prod; generated subscription vending sets subscription_workload to Production only for prod and DevTest otherwise.",
              "Custom groups can inherit only or build on Corp, Online, Local, or Sandbox archetypes. Removing a platform child places that platform subscription under Platform instead.",
            ],
          },
        ],
      },
      {
        id: "learn",
        title: "Verified sources",
        blocks: [
          {
            type: "learn-links",
            links: [
              {
                title: "Management groups for Azure landing zones",
                url: "https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/landing-zone/design-area/resource-org-management-groups",
              },
              {
                title: "Subscription vending overview",
                url: "https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/landing-zone/design-area/subscription-vending",
              },
              {
                title: "Subscription vending implementation guidance",
                url: "https://learn.microsoft.com/en-us/azure/architecture/landing-zones/subscription-vending",
              },
              {
                title: "Azure landing zone documentation",
                url: "https://azure.github.io/Azure-Landing-Zones/",
              },
            ],
          },
        ],
      },
    ],
  },
  {
    id: "dns-private-link",
    title: "Private Link and DNS",
    summary:
      "Design central private DNS zones, DNS Private Resolver, firewall DNS proxy, and automated private endpoint record registration.",
    decision:
      "Who owns private endpoint DNS, and how do spokes and on-premises clients resolve privatelink names to private IPs?",
    sections: [
      {
        id: "resolution-model",
        title: "Resolution model",
        blocks: [
          {
            type: "paragraph",
            text: "Private endpoints require matching private DNS records so service FQDNs resolve to private endpoint IP addresses. Microsoft documents private DNS zones as the recommended way to override public endpoint resolution for Private Link services.",
          },
          {
            type: "steps",
            steps: [
              {
                from: "Workload or on-premises client",
                to: "DNS resolver path",
                what: "The client asks for the normal service FQDN, such as a database or storage endpoint.",
              },
              {
                from: "DNS resolver path",
                to: "Private DNS zone",
                what: "A linked privatelink zone answers with the private endpoint A record.",
              },
              {
                from: "Client",
                to: "Private endpoint IP",
                what: "The application connects without changing its service URL.",
              },
            ],
          },
          {
            type: "callout",
            tone: "warning",
            title: "DNS and access control are separate",
            body: "A DNS answer does not grant access. Service firewalls and public network access settings still decide whether the data plane accepts the connection.",
          },
        ],
      },
      {
        id: "hub-and-spoke-dns",
        title: "Hub-and-spoke DNS",
        blocks: [
          {
            type: "paragraph",
            text: "In hub-and-spoke networks, Microsoft describes central private DNS zones in the hub or connectivity subscription. On-premises DNS servers can use conditional forwarders to a DNS Private Resolver inbound endpoint in the hub; the resolver forwards to Azure-provided DNS and private DNS zones linked to the hub.",
          },
          {
            type: "paragraph",
            text: "Azure DNS Private Resolver provides managed inbound and outbound endpoints for DNS resolution between Azure VNets and on-premises networks, without custom DNS server VMs.",
          },
        ],
      },
      {
        id: "automation",
        title: "Private endpoint records",
        blocks: [
          {
            type: "paragraph",
            text: "At scale, workload teams often cannot write DNS records in the central connectivity subscription. Microsoft recommends automation so private endpoint records are created in the matching centralized private DNS zone and removed when the private endpoint is deleted.",
          },
          {
            type: "callout",
            tone: "recommendation",
            title: "Use ALZ private DNS policy",
            body: "The ALZ Deploy-Private-DNS-Zones assignment is intended to automate Private Link DNS integration. Keep it when the platform owns private DNS; remove it only when another platform owns registration.",
          },
        ],
      },
      {
        id: "in-this-app",
        title: "In this app",
        blocks: [
          {
            type: "in-this-app",
            items: [
              "When privateDns is platform and a hub exists, platformResources lists Private DNS zones and DNS Private Resolver in the Connectivity subscription.",
              "Hub-and-spoke Terraform enables dns_resolver_policy on the hub module. Virtual WAN mode enables a sidecar virtual network when Bastion or DNS is selected.",
              'For peered hub-and-spoke spokes, the generated sub-vending VNet sets dns_servers to module.connectivity.dns_server_ip_addresses["primary"] only when private DNS is platform, Azure Firewall exists, and the firewall SKU is not Basic. The code avoids pointing spokes at a firewall DNS proxy that is unavailable.',
              "The traffic simulator shows Private Link resolution through Azure Firewall DNS proxy -> DNS Private Resolver inbound endpoint -> hub-linked privatelink zones. It labels Deploy-Private-DNS-Zones as the policy that registers private endpoint records.",
              "The simulator also shows a broken path when central zones exist but the spoke still uses Azure-provided DNS in its own VNet context: the public answer is returned and Deny-Public-Endpoints keeps the public endpoint closed.",
            ],
          },
        ],
      },
      {
        id: "learn",
        title: "Verified sources",
        blocks: [
          {
            type: "learn-links",
            links: [
              {
                title: "Private endpoint DNS zone values",
                url: "https://learn.microsoft.com/en-us/azure/private-link/private-endpoint-dns",
              },
              {
                title: "Private Link and DNS integration at scale",
                url: "https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/private-link-and-dns-integration-at-scale",
              },
              {
                title: "Azure DNS Private Resolver overview",
                url: "https://learn.microsoft.com/en-us/azure/dns/dns-private-resolver-overview",
              },
            ],
          },
        ],
      },
    ],
  },
  {
    id: "ip-planning",
    title: "IP planning for landing zones",
    summary:
      "Plan non-overlapping address spaces, reserved Azure subnet names, subnet sizes, and future hybrid or peering growth before vending subscriptions.",
    decision:
      "What address ranges and subnet boundaries should the platform reserve so hub services, spokes, Private Link, and hybrid routes can coexist?",
    sections: [
      {
        id: "address-space",
        title: "Address space strategy",
        blocks: [
          {
            type: "paragraph",
            text: "Hub, spoke, on-premises, and partner networks need non-overlapping address spaces. Azure system routes include private ranges with next hop None until those ranges are part of the VNet, learned by a gateway, or reached through peering or custom routes.",
          },
          {
            type: "bullets",
            items: [
              "Reserve room for one hub per region if workloads are regional.",
              "Keep spoke ranges summarizable where possible so gateway advertisements and route tables stay manageable.",
              "Reserve separate subnets for workload compute, private endpoints, firewall, gateways, Bastion, and resolver endpoints.",
              "Check on-premises and partner ranges before vending subscriptions; overlapping ranges break peering and hybrid routing plans.",
            ],
          },
        ],
      },
      {
        id: "required-subnets",
        title: "Required subnet names and sizes",
        blocks: [
          {
            type: "comparison",
            columns: ["Subnet", "Requirement or recommendation", "Why it matters"],
            rows: [
              {
                cells: [
                  "AzureFirewallSubnet",
                  "Must be named AzureFirewallSubnet; minimum size is /26.",
                  "Azure Firewall needs a dedicated subnet for scale and managed instances.",
                ],
              },
              {
                cells: [
                  "GatewaySubnet",
                  "Must be named GatewaySubnet. Microsoft recommends /27 or larger for most VPN gateway configurations.",
                  "Gateway instances, active-active, coexistence, and future changes need enough addresses.",
                ],
              },
              {
                cells: [
                  "AzureBastionSubnet",
                  "Must be named AzureBastionSubnet; for deployments on or after November 2, 2021, minimum size is /26 or larger.",
                  "A dedicated subnet is required for Azure Bastion SKUs other than Developer.",
                ],
              },
              {
                cells: [
                  "Private endpoint subnet",
                  "Use a dedicated subnet sized for the number of private endpoints.",
                  "Private endpoints create network interfaces and service-specific DNS records.",
                ],
              },
            ],
          },
          {
            type: "callout",
            tone: "info",
            title: "Azure reserves five IPs per subnet",
            body: "Azure reserves the first four addresses and the last address in every subnet. For example, 10.0.0.0-10.0.0.3 and 10.0.255.255 are reserved in 10.0.0.0/16.",
          },
        ],
      },
      {
        id: "routing-impact",
        title: "Routing impact",
        blocks: [
          {
            type: "paragraph",
            text: "A VNet gets system routes for its own address space, 0.0.0.0/0 to Internet, and private ranges to None. Peering, virtual network gateways, and UDRs add routes that can change the selected path. Azure uses longest prefix match, then route source precedence.",
          },
          {
            type: "steps",
            steps: [
              {
                from: "Address plan",
                to: "Peering",
                what: "Non-overlapping VNet ranges allow hub and spoke peering.",
              },
              {
                from: "Peering",
                to: "Gateway route propagation",
                what: "Spokes can learn on-premises routes when remote gateways are used and propagation is not disabled.",
              },
              {
                from: "UDRs",
                to: "Firewall",
                what: "A default route can force egress to the firewall, but more specific routes still win.",
              },
            ],
          },
        ],
      },
      {
        id: "in-this-app",
        title: "In this app",
        blocks: [
          {
            type: "in-this-app",
            items: [
              "The generated hub-and-spoke connectivity module uses default_hub_address_space 10.0.0.0/16 for the primary hub and 10.1.0.0/16 for the secondary hub.",
              "The routing scene draws the primary hub service subnets from the first /22: AzureBastionSubnet 10.0.0.0/26, AzureFirewallSubnet 10.0.0.64/26, GatewaySubnet 10.0.0.192/27, and DNS resolver inbound 10.0.0.224/28.",
              "Added subscriptions default to the next free 10.100.0.0/24 through 10.249.0.0/24 range unless a CIDR is supplied. The generated VNet splits a /24 into snet-workload /25 and snet-private-endpoints /26.",
              "Customer install spokes in the scene default to 10.60.0.0/19 overall, with one /22 per install for the diagram and simulator.",
              "If a second hub region is selected, hub networks are mesh-peered in hub-and-spoke mode; Virtual WAN hubs are modelled as Microsoft-managed full mesh.",
            ],
          },
        ],
      },
      {
        id: "learn",
        title: "Verified sources",
        blocks: [
          {
            type: "learn-links",
            links: [
              {
                title: "Private IP addresses in Azure",
                url: "https://learn.microsoft.com/en-us/azure/virtual-network/ip-services/private-ip-addresses",
              },
              {
                title: "Azure virtual network traffic routing",
                url: "https://learn.microsoft.com/en-us/azure/virtual-network/virtual-networks-udr-overview",
              },
              {
                title: "Azure Firewall deployment subnet sizing",
                url: "https://learn.microsoft.com/en-us/azure/firewall/tutorial-firewall-deploy-portal",
              },
              {
                title: "Azure VPN Gateway FAQ",
                url: "https://learn.microsoft.com/en-us/azure/vpn-gateway/vpn-gateway-vpn-faq",
              },
              {
                title: "Azure Bastion configuration settings",
                url: "https://learn.microsoft.com/en-us/azure/bastion/configuration-settings",
              },
            ],
          },
        ],
      },
    ],
  },
  {
    id: "hybrid-connectivity",
    title: "Hybrid connectivity",
    summary:
      "Choose VPN, ExpressRoute, or Virtual WAN connectivity, then make gateway propagation and firewall routing symmetric.",
    decision:
      "How should on-premises networks reach landing zone spokes, and how do replies avoid bypassing the firewall?",
    sections: [
      {
        id: "vpn-vs-expressroute",
        title: "VPN vs. ExpressRoute",
        blocks: [
          {
            type: "comparison",
            columns: ["Option", "Use when", "Notes"],
            rows: [
              {
                cells: [
                  "VPN Gateway",
                  "You need encrypted site-to-site, point-to-site, or VNet-to-VNet connectivity over the public internet or Microsoft network.",
                  "Multiple connections share gateway bandwidth. Site-to-site uses IPsec/IKE.",
                ],
              },
              {
                cells: [
                  { text: "ExpressRoute", recommended: true },
                  "You need private connectivity through a provider, predictable latency, BGP routing, and higher reliability than internet paths.",
                  "ExpressRoute does not traverse the public internet and includes redundancy in each peering location.",
                ],
              },
              {
                cells: [
                  "ExpressRoute + VPN",
                  "You want VPN as a failover path or need sites that are not on ExpressRoute.",
                  "Plan route preference and failover testing explicitly.",
                ],
              },
              {
                cells: [
                  "Virtual WAN",
                  "You need branch, VPN, ExpressRoute, user VPN, and VNet transit through managed hubs.",
                  "Standard Virtual WAN hubs are connected in full mesh.",
                ],
              },
            ],
          },
        ],
      },
      {
        id: "route-propagation",
        title: "Route propagation and inspection",
        blocks: [
          {
            type: "paragraph",
            text: "Gateway routes learned by BGP can propagate to spoke subnets. To inspect spoke traffic through a firewall, Microsoft documents using a UDR to the firewall and disabling virtual network gateway route propagation on the spoke subnet route table, or using more specific routes that keep the firewall on path.",
          },
          {
            type: "steps",
            steps: [
              {
                from: "On-premises",
                to: "Hub gateway",
                what: "BGP advertises on-premises prefixes to the Azure virtual network gateway or virtual hub.",
              },
              {
                from: "Hub gateway",
                to: "GatewaySubnet route table",
                what: "Routes to spoke CIDRs can point at Azure Firewall so inbound hybrid traffic is inspected.",
              },
              {
                from: "Azure Firewall",
                to: "Spoke subnet",
                what: "Firewall forwards allowed traffic over peering or hub routing.",
              },
              {
                from: "Spoke subnet",
                to: "Azure Firewall",
                what: "The spoke default route sends replies back through the same firewall session.",
              },
            ],
          },
          {
            type: "callout",
            tone: "warning",
            title: "Asymmetry breaks stateful inspection",
            body: "If the request bypasses the firewall but the reply follows a default route to the firewall, Azure Firewall drops the reply because it did not see the original session.",
          },
        ],
      },
      {
        id: "transit",
        title: "Transitive routing",
        blocks: [
          {
            type: "paragraph",
            text: "Hub-and-spoke VNet peering is not transitive. Use firewall/NVA routing, gateways, Route Server, or Virtual WAN hub routing when one spoke or branch must reach another through a hub.",
          },
          {
            type: "paragraph",
            text: "Virtual WAN virtual hubs provide BGP-based routing between gateways and connected VNets. Routing intent can force both internet-bound and private traffic through a hub firewall or other supported security next hop.",
          },
        ],
      },
      {
        id: "in-this-app",
        title: "In this app",
        blocks: [
          {
            type: "in-this-app",
            items: [
              "The answers model VPN Gateway and ExpressRoute Gateway independently; the generated connectivity module enables virtual_network_gateway_vpn and/or virtual_network_gateway_express_route in the hub.",
              "For hub-and-spoke with a gateway and firewall, the generated GatewaySubnet route table adds one custom route per peered added subscription CIDR pointing to the firewall. BGP route propagation stays enabled on GatewaySubnet because Microsoft advises not disabling propagation there.",
              "The generated Corp spoke route table disables BGP propagation and sends 0.0.0.0/0 to the firewall so on-premises routes cannot bypass the firewall on the spoke side.",
              "The traffic simulator marks added Corp subscriptions as gateway-routed only when their exact CIDR route is generated on GatewaySubnet; customer install ghost spokes are shown but not claimed as generated routes.",
              "Virtual WAN mode represents private and internet routing through routing intent when Azure Firewall is enabled, instead of emitting spoke route tables.",
            ],
          },
        ],
      },
      {
        id: "learn",
        title: "Verified sources",
        blocks: [
          {
            type: "learn-links",
            links: [
              {
                title: "Azure VPN Gateway overview",
                url: "https://learn.microsoft.com/en-us/azure/vpn-gateway/vpn-gateway-about-vpngateways",
              },
              {
                title: "Azure ExpressRoute overview",
                url: "https://learn.microsoft.com/en-us/azure/expressroute/expressroute-introduction",
              },
              {
                title: "Azure Firewall in a hybrid network",
                url: "https://learn.microsoft.com/en-us/azure/firewall/tutorial-hybrid-portal",
              },
              {
                title: "Azure virtual network traffic routing",
                url: "https://learn.microsoft.com/en-us/azure/virtual-network/virtual-networks-udr-overview",
              },
              {
                title: "Virtual WAN routing policies",
                url: "https://learn.microsoft.com/en-us/azure/virtual-wan/how-to-routing-policies",
              },
            ],
          },
        ],
      },
    ],
  },
] satisfies KnowledgeTopic[];

export const knowledgeTopicById = Object.fromEntries(
  KNOWLEDGE_TOPICS.map((topic) => [topic.id, topic]),
) as Record<KnowledgeTopicId, KnowledgeTopic>;

export function getKnowledgeTopic(id: string): KnowledgeTopic | undefined {
  return KNOWLEDGE_TOPICS.find((topic) => topic.id === id);
}
