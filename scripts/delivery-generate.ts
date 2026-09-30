/*
 * Writes the delivery platform Cloud Delivery generates — cd-delivery-templates, cd-vending with sample requests,
 * and a sample lz-, sol- and cust- repository — so CI can lint every workflow (actionlint), validate the vending
 * Terraform, and check every unit spec against the isolation rules.
 * Usage: bun scripts/delivery-generate.ts <outDir>
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { DEFAULT_ANSWERS, LATEST_REF, terraformFor } from "../src/lib/alz/engine";
import { toManifest } from "../src/lib/architecture";
import {
  DEFAULT_PLATFORM,
  type UnitInput,
  type UnitSpec,
  isolationFindings,
  resolveUnit,
} from "../src/lib/delivery/model";
import {
  customerRepo,
  installStem,
  landingZoneRepo,
  solutionRepo,
} from "../src/lib/delivery/scaffold";
import { deliveryTemplates } from "../src/lib/delivery/templates";
import { requestFile, vendingRepo } from "../src/lib/delivery/vending";
import { offeringTerraform } from "../src/lib/offering/terraform";
import { STARTERS } from "../src/lib/starters";

const out = process.argv[2] ?? "delivery-out";
const p = DEFAULT_PLATFORM;
const write = (repo: string, files: { path: string; content: string }[]) => {
  for (const f of files) {
    const full = path.join(out, repo, f.path);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, f.content);
  }
  console.log(`${repo}: ${files.length} files`);
};

const starter = STARTERS[0]!;
const inputs: UnitInput[] = [
  {
    kind: "landing-zone",
    slug: "gridworks-hosting",
    name: "GridWorks hosting",
    tenantId: "11111111-2222-3333-4444-555555555555",
    managementGroupId: "gridworks",
    isv: true,
  },
  {
    kind: "landing-zone",
    slug: "contoso",
    name: "Contoso",
    tenantId: "99999999-8888-7777-6666-555555555555",
    managementGroupId: "contoso",
    isv: false,
    criticality: "regulated",
  },
  { kind: "solution", slug: "grid-analytics", name: "Grid analytics", offerings: ["hosted"] },
  {
    kind: "customer",
    slug: "northgrid",
    name: "NorthGrid",
    tenantId: "12121212-3434-5656-7878-909090909090",
    hosted: false,
    environments: [
      { env: "test", subscriptionId: "0a0a0a0a-1111-2222-3333-444444444444", subscriptionName: "" },
      {
        env: "production",
        subscriptionId: "0b0b0b0b-1111-2222-3333-444444444444",
        subscriptionName: "",
      },
    ],
    offerings: ["grid-analytics-hosted"],
  },
  {
    kind: "customer",
    slug: "metro-energy",
    name: "Metro Energy",
    tenantId: null,
    hosted: true,
    environments: [
      { env: "development", subscriptionId: null, subscriptionName: "sub-metro-energy-dev" },
      { env: "production", subscriptionId: null, subscriptionName: "sub-metro-energy-prod" },
    ],
    offerings: ["grid-analytics-hosted"],
    criticality: "regulated",
  },
];
const specs: UnitSpec[] = inputs.map((i) => resolveUnit(i, p));
for (const kind of ["control-plane", "templates", "modules", "vending"] as const)
  specs.push(resolveUnit({ kind }, p));

let failed = 0;
for (const s of specs) {
  const findings = isolationFindings(s);
  if (findings.length) {
    failed++;
    console.error(`${s.repository.name}:\n  ${findings.join("\n  ")}`);
  }
}

write(p.templatesRepo, deliveryTemplates(p));
write(
  "cd-vending",
  vendingRepo(
    p,
    specs
      .filter((s) => ["landing-zone", "solution", "customer"].includes(s.kind))
      .map((s) =>
        requestFile(s, {
          requestedBy: "delivery-generate",
          reason: "CI sample",
          links: {},
        }),
      ),
  ),
);

const lz = specs[0]!;
write(
  lz.repository.name,
  landingZoneRepo(lz, p, {
    tenantId: "11111111-2222-3333-4444-555555555555",
    managementGroupId: "gridworks",
    libraryRef: LATEST_REF,
    answers: { intermediateRootId: "gridworks" },
    terraform: terraformFor(LATEST_REF, { ...DEFAULT_ANSWERS, intermediateRootId: "gridworks" }),
  }),
);

const sol = specs[2]!;
const arch = { selected: starter.selected, topology: starter.topology };
write(
  sol.repository.name,
  solutionRepo(sol, p, {
    owners: [{ name: "Cloud Delivery samples", email: "", role: "Sample" }],
    industry: "Power & Renewables",
    tags: ["sample"],
    source: null,
    offerings: [
      {
        slug: "hosted",
        name: "Hosted",
        version: "1.0.0",
        manifest: toManifest("grid-analytics-hosted", "1.0.0", arch, {
          repository: `github.com/${p.org}/${sol.repository.name}`,
          path: "offerings/hosted",
          iac: "terraform",
          pipeline: "github-actions",
        }),
        terraform: offeringTerraform({ product: "Grid analytics", ...arch }),
        sandbox: {
          location: "eastus2",
          install_name: "sol-grid-analytics-sbx",
          environment: "dev",
        },
      },
    ],
  }),
);

for (const cust of specs.filter((s) => s.kind === "customer")) {
  const hosted = cust.slug === "metro-energy";
  write(
    cust.repository.name,
    customerRepo(cust, p, {
      code: cust.slug,
      tenantId: hosted ? null : "12121212-3434-5656-7878-909090909090",
      hosted,
      connection: hosted ? "isv_hosted" : "federated_identity",
      environments: cust.environments
        .filter((e) => !e.name.endsWith("-plan"))
        .map((e) => {
          const env = { dev: "development", prod: "production" }[e.name] ?? e.name;
          const pin = { solution: "grid-analytics", offering: "hosted" };
          return {
            env,
            ...pin,
            version: "1.0.0",
            digest: null,
            region: "eastus2",
            target: hosted ? "new_subscription" : "existing_subscription",
            subscriptionId: null,
            subscriptionName: `sub-${cust.slug}-${e.name}`,
            resourceGroup: `rg-${cust.slug}-${e.name}`,
            managementGroup: null,
            variables: { install_name: `${cust.slug}-${e.name}`, environment: e.name },
            install: installStem(pin),
          };
        }),
    }),
  );
}

writeFileSync(path.join(out, "specs.json"), JSON.stringify(specs, null, 2));
if (failed) {
  console.error(`${failed} unit spec(s) break the isolation rules.`);
  process.exit(1);
}
console.log(`${specs.length} unit specs pass the isolation rules.`);
