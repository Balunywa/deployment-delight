/*
 * Verified AVM addressing behavior, pinned to the module versions emitted by engine.ts:
 * - Hub-and-spoke module:
 *   https://github.com/Azure/terraform-azurerm-avm-ptn-alz-connectivity-hub-and-spoke-vnet/blob/v0.17.5/main.ip_ranges.tf
 *   asks Azure/avm-utl-network-ip-addresses 0.1.0 for a /22 "hub" block from
 *   default_hub_address_space, then asks the same utility for subnet defaults inside that /22.
 *   The subnet sizes are bastion /26, firewall /26, firewall_management /26, gateway /27 and
 *   dns_resolver /28. The utility's efficient mode sorts by prefix size and then key, so the
 *   default 10.0.0.0/16 yields bastion 10.0.0.0/26, firewall 10.0.0.64/26,
 *   firewall_management 10.0.0.128/26, gateway 10.0.0.192/27 and dns_resolver 10.0.0.224/28.
 *   Minimum default_hub_address_space size: /22.
 * - Virtual WAN module:
 *   https://github.com/Azure/terraform-azurerm-avm-ptn-alz-connectivity-virtual-wan/blob/v0.17.2/main.ip_ranges.tf
 *   asks for two /22 blocks, sidecar and virtual_hub, from default_hub_address_space. Efficient
 *   ordering puts sidecar first and virtual_hub second. The Virtual Hub submodule recommends /23
 *   or larger, but this pattern allocates /22. Minimum default_hub_address_space size: /21.
 * - The utility ordering is from:
 *   https://github.com/Azure/terraform-azurerm-avm-utl-network-ip-addresses/blob/0.1.0/locals.tf
 */
import type { AlzLibrary, Answers, ExtraSubscription } from "./engine";

export const DEFAULT_HUB_ADDRESS_SPACE = "10.0.0.0/16";
export const DEFAULT_SECONDARY_HUB_ADDRESS_SPACE = "10.1.0.0/16";
export const DEFAULT_ON_PREM_RANGES = ["192.168.0.0/16"] as const;

export type CidrBlock = {
  cidr: string;
  address: string;
  prefix: number;
  start: number;
  end: number;
  addresses: number;
};

export type CidrParseResult =
  { ok: true; block: CidrBlock } | { ok: false; error: string; aligned?: string | undefined };

const RFC1918_AND_CGNAT = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "100.64.0.0/10"];

const octets = (ip: string) => ip.split(".").map((x) => Number(x));

export function ipv4ToInt(ip: string): number | null {
  const parts = octets(ip);
  if (
    parts.length !== 4 ||
    parts.some((x) => !Number.isInteger(x) || x < 0 || x > 255) ||
    ip.split(".").some((x) => x.trim() === "" || !/^\d+$/.test(x))
  )
    return null;
  return (
    (((parts[0]! << 24) >>> 0) +
      ((parts[1]! << 16) >>> 0) +
      ((parts[2]! << 8) >>> 0) +
      parts[3]!) >>>
    0
  );
}

export function intToIpv4(value: number) {
  const v = value >>> 0;
  return [v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255].join(".");
}

const maskFor = (prefix: number) => (prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0);
const sizeFor = (prefix: number) => 2 ** (32 - prefix);

export function formatCidr(block: Pick<CidrBlock, "start" | "prefix">) {
  return `${intToIpv4(block.start)}/${block.prefix}`;
}

export function alignCidr(cidr: string): string | null {
  const [ip, bits, ...rest] = cidr.trim().split("/");
  if (!ip || !bits || rest.length) return null;
  const prefix = Number(bits);
  const start = ipv4ToInt(ip);
  if (start == null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null;
  return `${intToIpv4((start & maskFor(prefix)) >>> 0)}/${prefix}`;
}

export function parseCidr(cidr: string): CidrParseResult {
  const value = cidr.trim();
  const [ip, bits, ...rest] = value.split("/");
  if (!ip || !bits || rest.length)
    return { ok: false, error: "Use IPv4 CIDR notation, for example 10.0.0.0/16." };
  const prefix = Number(bits);
  const raw = ipv4ToInt(ip);
  if (raw == null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32)
    return { ok: false, error: "Use a valid IPv4 CIDR with a prefix from /0 to /32." };
  const start = (raw & maskFor(prefix)) >>> 0;
  const addresses = sizeFor(prefix);
  const block: CidrBlock = {
    cidr: `${intToIpv4(start)}/${prefix}`,
    address: intToIpv4(start),
    prefix,
    start,
    end: start + addresses - 1,
    addresses,
  };
  if (raw !== start)
    return {
      ok: false,
      error: `${value} is not aligned on a /${prefix} network boundary.`,
      aligned: block.cidr,
    };
  return { ok: true, block };
}

export function cidrContains(parent: string | CidrBlock, child: string | CidrBlock) {
  const p = typeof parent === "string" ? parseCidr(parent) : { ok: true as const, block: parent };
  const c = typeof child === "string" ? parseCidr(child) : { ok: true as const, block: child };
  return p.ok && c.ok && c.block.start >= p.block.start && c.block.end <= p.block.end;
}

export function cidrOverlaps(a: string | CidrBlock, b: string | CidrBlock) {
  const ca = typeof a === "string" ? parseCidr(a) : { ok: true as const, block: a };
  const cb = typeof b === "string" ? parseCidr(b) : { ok: true as const, block: b };
  return ca.ok && cb.ok && ca.block.start <= cb.block.end && cb.block.start <= ca.block.end;
}

export function cidrHost(cidr: string, offset: number) {
  const parsed = parseCidr(cidr);
  if (!parsed.ok) return "";
  return intToIpv4(parsed.block.start + offset);
}

function allocateCidrs(space: CidrBlock, requests: Record<string, number>) {
  const out = new Map<string, CidrBlock>();
  let cursor = space.start;
  const ordered = Object.entries(requests).sort(
    ([ak, ap], [bk, bp]) => ap - bp || ak.localeCompare(bk),
  );
  for (const [key, prefix] of ordered) {
    if (prefix < space.prefix) return null;
    const size = sizeFor(prefix);
    const start = Math.ceil(cursor / size) * size;
    const block: CidrBlock = {
      cidr: `${intToIpv4(start)}/${prefix}`,
      address: intToIpv4(start),
      prefix,
      start,
      end: start + size - 1,
      addresses: size,
    };
    if (!cidrContains(space, block)) return null;
    out.set(key, block);
    cursor = block.end + 1;
  }
  return out;
}

export function isPrivateOrCarrierGrade(cidr: string) {
  const parsed = parseCidr(cidr);
  return parsed.ok && RFC1918_AND_CGNAT.some((p) => cidrContains(p, parsed.block));
}

export type HubSubnetKey =
  "bastion" | "firewall" | "firewall_management" | "gateway" | "dns_resolver";

export type HubSubnet = {
  key: HubSubnetKey;
  name: string;
  cidr: string;
  purpose: string;
  addresses: number;
  usable: number;
};

const HUB_SUBNET_SIZES: Record<HubSubnetKey, number> = {
  bastion: 26,
  firewall: 26,
  firewall_management: 26,
  gateway: 27,
  dns_resolver: 28,
};

const HUB_SUBNET_META: Record<HubSubnetKey, { name: string; purpose: string }> = {
  bastion: {
    name: "AzureBastionSubnet",
    purpose: "Browser-based RDP and SSH without VM public IPs.",
  },
  firewall: { name: "AzureFirewallSubnet", purpose: "Azure Firewall data-plane subnet." },
  firewall_management: {
    name: "AzureFirewallManagementSubnet",
    purpose: "Azure Firewall management subnet allocated by the AVM module.",
  },
  gateway: { name: "GatewaySubnet", purpose: "VPN and ExpressRoute virtual network gateways." },
  dns_resolver: {
    name: "snet-dns-resolver",
    purpose: "Azure DNS Private Resolver inbound endpoint.",
  },
};

const enabledHubSubnetKeys = (answers: Answers): HubSubnetKey[] => [
  ...(answers.bastion === "yes" ? (["bastion"] as const) : []),
  ...(answers.firewall !== "none" ? (["firewall", "firewall_management"] as const) : []),
  ...(answers.vpnGateway === "yes" || answers.expressRoute === "yes" ? (["gateway"] as const) : []),
  ...(answers.privateDns === "platform" ? (["dns_resolver"] as const) : []),
];

export function hubAllocation(space: string): CidrBlock | null {
  const parsed = parseCidr(space);
  if (!parsed.ok) return null;
  return allocateCidrs(parsed.block, { hub: 22 })?.get("hub") ?? null;
}

/** Hub-and-spoke subnet defaults: all defaults are allocated first, then only enabled resources are returned. */
export function hubSubnets(space: string, answers: Answers): HubSubnet[] {
  const hub = hubAllocation(space);
  if (!hub) return [];
  const allocated = allocateCidrs(hub, HUB_SUBNET_SIZES);
  if (!allocated) return [];
  return enabledHubSubnetKeys(answers)
    .map((key) => {
      const block = allocated.get(key);
      if (!block) return null;
      const meta = HUB_SUBNET_META[key];
      return {
        key,
        name: meta.name,
        cidr: block.cidr,
        purpose: meta.purpose,
        addresses: block.addresses,
        usable: Math.max(block.addresses - 5, 0),
      };
    })
    .filter((x): x is HubSubnet => !!x);
}

export type VirtualWanAllocation = {
  virtualHub: CidrBlock | null;
  sidecar: CidrBlock | null;
  sidecarSubnets: HubSubnet[];
};

export function virtualWanAllocation(space: string, answers: Answers): VirtualWanAllocation {
  const parsed = parseCidr(space);
  const empty = { virtualHub: null, sidecar: null, sidecarSubnets: [] };
  if (!parsed.ok) return empty;
  const allocated = allocateCidrs(parsed.block, { sidecar: 22, virtual_hub: 22 });
  const sidecar = allocated?.get("sidecar") ?? null;
  const virtualHub = allocated?.get("virtual_hub") ?? null;
  if (!sidecar) return { ...empty, virtualHub };
  const sidecarSubnetSizes: Partial<Record<HubSubnetKey, number>> = {
    bastion: 26,
    dns_resolver: 28,
  };
  const subnetAllocated = allocateCidrs(sidecar, sidecarSubnetSizes as Record<string, number>);
  const keys: HubSubnetKey[] = [
    ...(answers.bastion === "yes" ? (["bastion"] as const) : []),
    ...(answers.privateDns === "platform" ? (["dns_resolver"] as const) : []),
  ];
  return {
    virtualHub,
    sidecar,
    sidecarSubnets: keys
      .map((key) => {
        const block = subnetAllocated?.get(key);
        if (!block) return null;
        const meta = HUB_SUBNET_META[key];
        return {
          key,
          name: meta.name,
          cidr: block.cidr,
          purpose:
            key === "dns_resolver" ? "DNS Private Resolver in the sidecar VNet." : meta.purpose,
          addresses: block.addresses,
          usable: Math.max(block.addresses - 5, 0),
        };
      })
      .filter((x): x is HubSubnet => !!x),
  };
}

export type IpBlockKind = "hub" | "hub-subnet" | "spoke" | "on-prem" | "reserved";

export type IpBlock = {
  id: string;
  label: string;
  cidr: string;
  kind: IpBlockKind;
  parentId?: string | undefined;
  purpose: string;
  addresses: number;
  usable: number;
};

export type HubUtilization = {
  id: string;
  label: string;
  region: string;
  cidr: string;
  allocationCidr: string;
  used: number;
  free: number;
  addresses: number;
  poolFree: number;
  percentUsed: number;
  subnets: HubSubnet[];
};

export type IpPlan = {
  blocks: IpBlock[];
  hubs: HubUtilization[];
};

export type IpPlanIssue = {
  level: "error" | "warning" | "info";
  text: string;
  field?: string | undefined;
  fix?: Partial<Answers> | undefined;
};

const blockFromCidr = (
  block: Omit<IpBlock, "addresses" | "usable"> & { cidr: string },
  subnet = false,
): IpBlock | null => {
  const parsed = parseCidr(block.cidr);
  if (!parsed.ok) return null;
  return {
    ...block,
    addresses: parsed.block.addresses,
    usable: subnet ? Math.max(parsed.block.addresses - 5, 0) : parsed.block.addresses,
  };
};

const includedGroupIds = (lib: AlzLibrary, answers: Answers) => {
  const off = new Set<string>([
    ...(["corp", "online", "local", "sandbox"] as const).filter(
      (g) => !answers.landingZones.includes(g),
    ),
    ...answers.removedGroups,
  ]);
  const ids = new Set(lib.managementGroups.filter((g) => !off.has(g.id)).map((g) => g.id));
  for (let pass = 0; pass < 8; pass++)
    for (const g of answers.customGroups) if (!ids.has(g.id) && ids.has(g.parent)) ids.add(g.id);
  return ids;
};

const effectiveSpokeCidr = (x: ExtraSubscription, index: number) =>
  x.cidr || `10.${100 + index}.0.0/24`;

function addHub(
  out: IpPlan,
  answers: Answers,
  id: "primary" | "secondary",
  region: string,
  space: string,
) {
  const pool = parseCidr(space);
  if (!pool.ok) return;
  if (answers.connectivity === "virtual_wan") {
    const alloc = virtualWanAllocation(space, answers);
    if (!alloc.virtualHub) return;
    const hubId = `hub-${id}`;
    const hubBlock = blockFromCidr({
      id: hubId,
      label: `${id === "primary" ? "Primary" : "Secondary"} Virtual WAN hub`,
      cidr: alloc.virtualHub.cidr,
      kind: "hub",
      purpose: `Secured virtual hub in ${region}, allocated from ${space}.`,
    });
    if (hubBlock) out.blocks.push(hubBlock);
    if (alloc.sidecar) {
      const sidecarId = `hub-${id}-sidecar`;
      const sidecarBlock = blockFromCidr({
        id: sidecarId,
        label: `${id === "primary" ? "Primary" : "Secondary"} sidecar VNet`,
        cidr: alloc.sidecar.cidr,
        kind: "reserved",
        parentId: hubId,
        purpose:
          "Sidecar /22 reserved by the Virtual WAN AVM address calculation; deployed when sidecar resources are enabled.",
      });
      if (sidecarBlock) out.blocks.push(sidecarBlock);
      for (const s of alloc.sidecarSubnets) {
        const child = blockFromCidr(
          {
            id: `hub-${id}-${s.key}`,
            label: s.name,
            cidr: s.cidr,
            kind: "hub-subnet",
            parentId: sidecarId,
            purpose: s.purpose,
          },
          true,
        );
        if (child) out.blocks.push(child);
      }
    }
    const used = alloc.sidecarSubnets.reduce((n, s) => n + s.addresses, 0);
    out.hubs.push({
      id: hubId,
      label: `${id === "primary" ? "Primary" : "Secondary"} Virtual WAN hub`,
      region,
      cidr: space,
      allocationCidr: alloc.virtualHub.cidr,
      used,
      free: Math.max(alloc.virtualHub.addresses - used, 0),
      addresses: alloc.virtualHub.addresses,
      poolFree: Math.max(
        pool.block.addresses - alloc.virtualHub.addresses - (alloc.sidecar?.addresses ?? 0),
        0,
      ),
      percentUsed: alloc.virtualHub.addresses ? (used / alloc.virtualHub.addresses) * 100 : 0,
      subnets: alloc.sidecarSubnets,
    });
    return;
  }

  const allocation = hubAllocation(space);
  if (!allocation) return;
  const hubId = `hub-${id}`;
  const hubBlock = blockFromCidr({
    id: hubId,
    label: `${id === "primary" ? "Primary" : "Secondary"} hub virtual network`,
    cidr: allocation.cidr,
    kind: "hub",
    purpose: `Hub virtual network in ${region}, allocated from ${space}.`,
  });
  if (hubBlock) out.blocks.push(hubBlock);
  const subnets = hubSubnets(space, answers);
  for (const s of subnets) {
    const child = blockFromCidr(
      {
        id: `hub-${id}-${s.key}`,
        label: s.name,
        cidr: s.cidr,
        kind: "hub-subnet",
        parentId: hubId,
        purpose: s.purpose,
      },
      true,
    );
    if (child) out.blocks.push(child);
  }
  const used = subnets.reduce((n, s) => n + s.addresses, 0);
  out.hubs.push({
    id: hubId,
    label: `${id === "primary" ? "Primary" : "Secondary"} hub virtual network`,
    region,
    cidr: space,
    allocationCidr: allocation.cidr,
    used,
    free: Math.max(allocation.addresses - used, 0),
    addresses: allocation.addresses,
    poolFree: Math.max(pool.block.addresses - allocation.addresses, 0),
    percentUsed: allocation.addresses ? (used / allocation.addresses) * 100 : 0,
    subnets,
  });
}

/** The first 10.x.0.0/16 (below the 10.100+ spoke range) that overlaps none of the given ranges. */
function freeSlash16(taken: string[]) {
  for (let k = 0; k < 100; k++) {
    const c = `10.${k}.0.0/16`;
    if (!taken.some((t) => parseCidr(t).ok && cidrOverlaps(t, c))) return c;
  }
  return null;
}

export function ipPlan(answers: Answers, lib: AlzLibrary): IpPlan {
  const out: IpPlan = { blocks: [], hubs: [] };
  if (answers.connectivity !== "none") {
    addHub(out, answers, "primary", answers.primaryRegion, answers.hubAddressSpace);
    if (answers.secondaryRegion && answers.secondaryRegion !== answers.primaryRegion)
      addHub(out, answers, "secondary", answers.secondaryRegion, answers.secondaryHubAddressSpace);
  }
  const included = includedGroupIds(lib, answers);
  answers.extraSubscriptions
    .filter((x) => included.has(x.group) && x.vnet !== false)
    .forEach((x, i) => {
      const cidr = effectiveSpokeCidr(x, i);
      const block = blockFromCidr({
        id: `spoke-${x.id}`,
        label: x.name,
        cidr,
        kind: "spoke",
        purpose: `${x.environment || "Workload"} spoke virtual network in ${x.group}.`,
      });
      if (block) out.blocks.push(block);
    });
  answers.onPremRanges.forEach((cidr, i) => {
    const block = blockFromCidr({
      id: `onprem-${i}`,
      label: i ? `On-premises range ${i + 1}` : "On-premises",
      cidr,
      kind: "on-prem",
      purpose: "Customer or corporate network reachable through VPN or ExpressRoute.",
    });
    if (block) out.blocks.push(block);
  });
  return out;
}

function validateRange(
  issues: IpPlanIssue[],
  label: string,
  cidr: string,
  field: string,
  fix?: (aligned: string) => Partial<Answers>,
) {
  const parsed = parseCidr(cidr);
  if (!parsed.ok) {
    issues.push({
      level: "error",
      text: parsed.aligned
        ? `${label} ${cidr} is not network-aligned. Use ${parsed.aligned}.`
        : `${label} ${cidr} is not a valid IPv4 CIDR.`,
      field,
      fix: parsed.aligned && fix ? fix(parsed.aligned) : undefined,
    });
    return null;
  }
  if (!isPrivateOrCarrierGrade(cidr))
    issues.push({
      level: "warning",
      text: `${label} ${cidr} is outside RFC1918 and 100.64.0.0/10. Use public space only if it is intentionally routed in your estate.`,
      field,
    });
  return parsed.block;
}

export function checkIpPlan(answers: Answers, lib: AlzLibrary): IpPlanIssue[] {
  const issues: IpPlanIssue[] = [
    {
      level: "info",
      text: "Azure reserves 5 addresses in every subnet, so usable host counts are smaller than the CIDR size.",
    },
  ];
  const ranges: {
    label: string;
    cidr: string;
    field: string;
    kind: "hub" | "spoke" | "on-prem";
  }[] = [];
  if (answers.connectivity !== "none") {
    ranges.push({
      label: "Primary hub address space",
      cidr: answers.hubAddressSpace,
      field: "hubAddressSpace",
      kind: "hub",
    });
    const minPrefix = answers.connectivity === "virtual_wan" ? 21 : 22;
    const primary = validateRange(
      issues,
      "Primary hub address space",
      answers.hubAddressSpace,
      "hubAddressSpace",
      (aligned) => ({
        hubAddressSpace: aligned,
      }),
    );
    if (primary && primary.prefix > minPrefix)
      issues.push({
        level: "error",
        text:
          answers.connectivity === "virtual_wan"
            ? `Primary hub address space ${answers.hubAddressSpace} is too small. The pinned Virtual WAN pattern allocates sidecar and virtual_hub /22 blocks, so use /21 or larger.`
            : `Primary hub address space ${answers.hubAddressSpace} is too small. The pinned hub-and-spoke pattern first allocates a /22 hub VNet, so use /22 or larger.`,
        field: "hubAddressSpace",
      });
    if (answers.secondaryRegion && answers.secondaryRegion !== answers.primaryRegion) {
      ranges.push({
        label: "Secondary hub address space",
        cidr: answers.secondaryHubAddressSpace,
        field: "secondaryHubAddressSpace",
        kind: "hub",
      });
      const secondary = validateRange(
        issues,
        "Secondary hub address space",
        answers.secondaryHubAddressSpace,
        "secondaryHubAddressSpace",
        (aligned) => ({ secondaryHubAddressSpace: aligned }),
      );
      if (secondary && secondary.prefix > minPrefix)
        issues.push({
          level: "error",
          text:
            answers.connectivity === "virtual_wan"
              ? `Secondary hub address space ${answers.secondaryHubAddressSpace} is too small. The pinned Virtual WAN pattern allocates sidecar and virtual_hub /22 blocks, so use /21 or larger.`
              : `Secondary hub address space ${answers.secondaryHubAddressSpace} is too small. The pinned hub-and-spoke pattern first allocates a /22 hub VNet, so use /22 or larger.`,
          field: "secondaryHubAddressSpace",
        });
    }
  }
  const included = includedGroupIds(lib, answers);
  answers.extraSubscriptions
    .filter((x) => included.has(x.group) && x.vnet !== false)
    .forEach((x, i) => {
      const cidr = effectiveSpokeCidr(x, i);
      ranges.push({
        label: `Spoke "${x.name}"`,
        cidr,
        field: `extraSubscriptions.${x.id}.cidr`,
        kind: "spoke",
      });
      validateRange(
        issues,
        `Spoke "${x.name}"`,
        cidr,
        `extraSubscriptions.${x.id}.cidr`,
        (aligned) => ({
          extraSubscriptions: answers.extraSubscriptions.map((sub) =>
            sub.id === x.id ? { ...sub, cidr: aligned } : sub,
          ),
        }),
      );
    });
  answers.onPremRanges.forEach((cidr, i) => {
    const field = `onPremRanges.${i}`;
    ranges.push({
      label: i ? `On-premises range ${i + 1}` : "On-premises range",
      cidr,
      field,
      kind: "on-prem",
    });
    validateRange(
      issues,
      i ? `On-premises range ${i + 1}` : "On-premises range",
      cidr,
      field,
      (aligned) => ({
        onPremRanges: answers.onPremRanges.map((r, n) => (n === i ? aligned : r)),
      }),
    );
  });

  for (let i = 0; i < ranges.length; i++) {
    for (let j = i + 1; j < ranges.length; j++) {
      const a = ranges[i]!;
      const b = ranges[j]!;
      if (!cidrOverlaps(a.cidr, b.cidr)) continue;
      // Move whichever side is a hub to a free /16 that clears every other range.
      const hubField =
        b.field === "secondaryHubAddressSpace" || b.field === "hubAddressSpace"
          ? b.field
          : a.field === "hubAddressSpace" || a.field === "secondaryHubAddressSpace"
            ? a.field
            : undefined;
      const free = hubField
        ? freeSlash16([
            ...ranges.filter((r) => r.field !== hubField).map((r) => r.cidr),
            "10.60.0.0/19",
          ])
        : null;
      issues.push({
        level: "error",
        text: `${a.label} (${a.cidr}) overlaps ${b.label} (${b.cidr}).${free && hubField ? ` ${free} is free.` : ""}`,
        field: a.kind === "hub" && b.kind === "hub" ? "secondaryHubAddressSpace" : b.field,
        fix: free && hubField ? { [hubField]: free } : undefined,
      });
      if (
        (a.kind === "spoke" && b.kind === "on-prem") ||
        (a.kind === "on-prem" && b.kind === "spoke")
      )
        issues.push({
          level: "warning",
          text: `Spoke/on-prem overlap will make routes ambiguous for ${a.label} and ${b.label}.`,
          field: a.kind === "spoke" ? a.field : b.field,
        });
      if (a.kind === "hub" && b.kind === "hub")
        issues.push({
          level: "error",
          text: "The second hub overlaps the first hub. Give each region a distinct address space.",
          field: "secondaryHubAddressSpace",
          fix: { secondaryHubAddressSpace: DEFAULT_SECONDARY_HUB_ADDRESS_SPACE },
        });
    }
  }

  return issues;
}
