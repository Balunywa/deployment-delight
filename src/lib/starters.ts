/*
 * Starter architectures for new offerings: the classic shapes most ISV products ship as, ready to deploy.
 */
import { type Selected, type Topology, normalise, withDefaults } from "./catalog";

export type Starter = {
  id: string;
  name: string;
  body: string;
  selected: Selected[];
  topology: Topology;
};

const pick = (items: [string, Record<string, string>?][]) =>
  items.map(([id, s]) => withDefaults(id, s ?? {}));

const base: Topology = {
  landing: "dedicated-spoke",
  publicAccess: true,
  privateEndpoints: true,
  regions: ["eastus2", "centralus"],
  environments: ["development", "test", "production"],
  landingZone: "online",
};

const make = (s: Omit<Starter, "selected"> & { selected: Selected[] }): Starter => ({
  ...s,
  selected: normalise(s.selected, s.topology),
});

export const STARTERS: Starter[] = [
  make({
    id: "two-tier",
    name: "2-tier · web servers + managed database",
    body: "Application Gateway (WAF) → web tier on a VM scale set → PostgreSQL behind a private endpoint.",
    topology: base,
    selected: pick([
      ["app-gateway"],
      ["web-vmss"],
      ["postgres"],
      ["key-vault"],
      ["storage"],
      ["budget"],
    ]),
  }),
  make({
    id: "three-tier-vmss",
    name: "3-tier · web and app scale sets + Azure SQL",
    body: "Application Gateway → web VMSS → internal load balancer → app VMSS → Azure SQL. Each tier only accepts the one above it.",
    topology: base,
    selected: pick([
      ["app-gateway"],
      ["web-vmss"],
      ["app-vmss"],
      ["sql"],
      ["key-vault"],
      ["storage"],
      ["budget"],
    ]),
  }),
  make({
    id: "three-tier-windows",
    name: "3-tier on Windows · lift and shift with SQL Server VMs",
    body: "Application Gateway → Windows web VMSS → Windows app VMSS → SQL Server 2022 on VMs with data disks.",
    topology: base,
    selected: pick([
      ["app-gateway"],
      ["web-vmss", { os: "Windows Server 2022" }],
      ["app-vmss", { os: "Windows Server 2022" }],
      [
        "vm",
        {
          os: "SQL Server 2022 Standard on Windows Server 2022",
          dataDisk: "512 GB",
        },
      ],
      ["key-vault"],
      ["storage"],
      ["budget"],
    ]),
  }),
  make({
    id: "internal-lob",
    name: "Internal line-of-business app · Corp, no public endpoints",
    body: "Web and app tiers behind internal load balancers, peered to the customer's hub; PostgreSQL private.",
    topology: {
      ...base,
      landing: "existing-customer-hub",
      publicAccess: false,
      landingZone: "corp",
    },
    selected: pick([["web-vmss"], ["app-vmss"], ["postgres"], ["key-vault"], ["budget"]]),
  }),
];
