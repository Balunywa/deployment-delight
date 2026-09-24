/*
 * Writes the platform landing zone configuration Cloud Delivery generates for a matrix of answers, so CI can
 * run `terraform validate` and Microsoft's `alzlibtool` against it. Usage: bun scripts/alz-generate.ts <outDir>
 */
import {
  DEFAULT_ANSWERS,
  LIBRARIES,
  type Answers,
  changesFor,
  hierarchy,
  libraryFor,
  shortRef,
  terraformFor,
} from "../src/lib/alz/engine";

const out = process.argv[2] ?? "alz-out";

const cases: { name: string; answers: Partial<Answers> }[] = [
  {
    name: "reference",
    answers: {
      ddosPlan: "yes",
      vpnGateway: "yes",
      expressRoute: "yes",
      identity: "yes",
      secondaryRegion: "westus2",
    },
  },
  {
    name: "no-ddos-prefixed",
    answers: { intermediateRootId: "gridworks", intermediateRootName: "GridWorks" },
  },
  {
    name: "third-party-monitoring",
    answers: {
      monitoring: "third_party",
      privateDns: "none",
      firewall: "Premium",
      bastion: "no",
      defender: "no",
      updateManager: "no",
      serviceHealth: "no",
      vmBackup: "no",
    },
  },
  {
    name: "virtual-wan",
    answers: {
      connectivity: "virtual_wan",
      ddosPlan: "yes",
      vpnGateway: "yes",
      secondaryRegion: "westeurope",
    },
  },
  {
    name: "cloud-only",
    answers: { connectivity: "none", siem: "other", landingZones: ["online", "sandbox"] },
  },
  {
    name: "isv-hosted-overrides",
    answers: {
      intermediateRootId: "isv",
      intermediateRootName: "ISV hosting",
      firewall: "Basic",
      landingZones: ["online", "corp"],
      policyOverrides: {
        "corp/Deny-Public-Endpoints": "audit",
        "landingzones/Deny-Subnet-Without-Nsg": "audit",
        "alz/Deploy-ASC-Monitoring": "remove",
      },
    },
  },
];

const summary: Record<string, unknown> = {};
for (const lib of LIBRARIES) {
  for (const c of cases) {
    const answers: Answers = {
      ...DEFAULT_ANSWERS,
      securityContactEmail: "secops@example.com",
      ...c.answers,
    };
    const dir = `${out}/${shortRef(lib.ref)}/${c.name}`;
    for (const f of terraformFor(lib.ref, answers)) await Bun.write(`${dir}/${f.path}`, f.content);
    await Bun.write(
      `${dir}/versions.tf`,
      [
        `terraform {`,
        `  required_version = ">= 1.9"`,
        `  required_providers {`,
        `    alz     = { source = "Azure/alz", version = "~> 0.20" }`,
        `    azapi   = { source = "Azure/azapi", version = "~> 2.4" }`,
        `    azurerm = { source = "hashicorp/azurerm", version = "~> 4.0" }`,
        `  }`,
        `}`,
        ``,
      ].join("\n"),
    );
    // Metadata so alzlibtool can resolve the custom library on its own (the provider uses library_references).
    if (changesFor(libraryFor(lib.ref), answers).length || answers.intermediateRootId !== "alz")
      await Bun.write(
        `${dir}/lib/alz_library_metadata.json.check`,
        JSON.stringify({
          name: "custom",
          display_name: "Custom",
          description: "Generated",
          dependencies: [{ path: "platform/alz", ref: shortRef(lib.ref) }],
        }),
      );
    // Expected assignment counts per management group, compared with alzlibtool's composed output in CI.
    summary[`${shortRef(lib.ref)}/${c.name}`] = Object.fromEntries(
      hierarchy(libraryFor(lib.ref), answers).map((n) => [n.id, n.enforced]),
    );
  }
}
await Bun.write(`${out}/expected.json`, JSON.stringify(summary, null, 2));
console.log(`wrote ${Object.keys(summary).length} configurations to ${out}`);
