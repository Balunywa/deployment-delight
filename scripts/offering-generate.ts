/*
 * Writes the Terraform Cloud Delivery generates for offerings — every service, every option that changes
 * the generated code, and each way an offering can land — so CI can `terraform validate` all of it.
 * Usage: bun scripts/offering-generate.ts <outDir>
 */
import {
  SERVICES,
  type Selected,
  type Topology,
  normalise,
  withDefaults,
} from "../src/lib/catalog";
import { offeringTerraform } from "../src/lib/offering/terraform";

const out = process.argv[2] ?? "offering-out";

const base: Topology = {
  landing: "existing-customer-hub",
  publicAccess: false,
  privateEndpoints: true,
  regions: ["eastus2", "centralus"],
  environments: ["development", "test", "production"],
  landingZone: "corp",
};

const all = (overrides: Record<string, Record<string, string>> = {}): Selected[] =>
  SERVICES.map((s) => withDefaults(s.id, overrides[s.id] ?? {}));
const pick = (ids: string[], overrides: Record<string, Record<string, string>> = {}) =>
  ids.map((id) => withDefaults(id, overrides[id] ?? {}));

const cases: { name: string; selected: Selected[]; topology: Topology }[] = [
  { name: "everything-private", selected: all(), topology: base },
  {
    name: "everything-alternates",
    selected: all({
      functions: { plan: "EP1", devPlan: "FC1" },
      "service-bus": { tier: "Premium", devTier: "Basic" },
      cosmos: { mode: "Serverless" },
      aks: { access: "Authorized IPs", nodes: "1 + 2" },
      "container-apps": { profile: "Dedicated D4" },
      postgres: { ha: "Disabled" },
      redis: { sku: "Standard C2" },
      "front-door": { tier: "Standard" },
      "key-vault": { keys: "Customer-managed (HSM)" },
      "security-baseline": { profile: "utility-critical" },
      "ai-foundry": {
        chatModel: "gpt-4o-mini",
        embeddingModel: "text-embedding-3-small",
        deployment: "Provisioned (PTU)",
      },
    }),
    topology: { ...base, landing: "dedicated-spoke", landingZone: "online" },
  },
  {
    name: "public-hosted",
    selected: pick([
      "container-apps",
      "postgres",
      "storage",
      "key-vault",
      "app-insights",
      "front-door",
      "budget",
    ]),
    topology: { ...base, landing: "isv-hosted", publicAccess: true, privateEndpoints: false },
  },
  {
    name: "web-and-data",
    selected: pick(["app-service", "sql", "storage", "key-vault", "app-gateway", "app-insights"]),
    topology: base,
  },
];

// Every SKU of every service, production and dev/test set to the same value so the generated code holds
// literals the azurerm provider's validation checks: case N uses the Nth SKU of each option.
import { SKU_OPTIONS } from "../src/lib/skus";
const depth = Math.max(...Object.values(SKU_OPTIONS).flatMap((os) => os.map((o) => o.skus.length)));
const extraOptions: Record<string, string[]> = {
  postgres: ["version"],
  "ai-foundry": ["chatModel", "embeddingModel", "deployment"],
};
for (let n = 0; n < depth; n++) {
  const overrides: Record<string, Record<string, string>> = {};
  for (const [svc, opts] of Object.entries(SKU_OPTIONS))
    for (const o of opts) {
      const v = o.skus[n % o.skus.length]!.value;
      overrides[svc] = { ...overrides[svc], [o.key]: v, [o.devKey]: v };
    }
  for (const [svc, keys] of Object.entries(extraOptions))
    for (const k of keys) {
      const def = SERVICES.find((x) => x.id === svc)!.options.find((o) => o.key === k)!;
      overrides[svc] = { ...overrides[svc], [k]: def.choices[n % def.choices.length]! };
    }
  cases.push({
    name: `skus-${String(n).padStart(2, "0")}`,
    selected: all(overrides),
    topology: base,
  });
}

for (const c of cases) {
  const files = offeringTerraform({
    product: c.name,
    selected: normalise(c.selected, c.topology),
    topology: c.topology,
  });
  for (const f of files) await Bun.write(`${out}/${c.name}/${f.path}`, f.content);
  await Bun.write(
    `${out}/${c.name}/terraform.tfvars.json`,
    JSON.stringify(
      {
        subscription_id: "00000000-0000-0000-0000-000000000000",
        location: "eastus2",
        install_name: "contoso-dev",
        environment: "dev",
      },
      null,
      2,
    ),
  );
}
console.log(`wrote ${cases.length} offering configurations to ${out}`);
