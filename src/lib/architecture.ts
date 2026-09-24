/*
 * Bridges the stored blueprint manifest (offering_versions.manifest_json) and the designer's
 * working model: which services are selected with which settings, and the landing topology.
 */
import {
  type Selected,
  type Topology,
  SERVICE_BY_ID,
  inputsFor,
  normalise,
  withDefaults,
} from "@/lib/catalog";

type OfferingLike = {
  name?: string | null;
  offering_type?: string | null;
  deployment_boundary?: string | null;
  network_profile?: string | null;
  supported_regions?: string[] | null;
};

export type Architecture = { selected: Selected[]; topology: Topology };

const rec = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

export function landingOf(networkProfile: string | null | undefined): Topology["landing"] {
  if (networkProfile === "customer-hub") return "existing-customer-hub";
  if (networkProfile === "isv-hosted") return "isv-hosted";
  return "dedicated-spoke";
}

export function fromManifest(offering: OfferingLike, manifestInput: unknown): Architecture {
  const m = rec(manifestInput);
  const network = rec(m["network"]);
  const options = rec(m["deploymentOptions"]);
  const modes = Array.isArray(network["modes"]) ? (network["modes"] as string[]) : [];
  const alias: Record<string, Topology["landing"]> = {
    "customer-hub": "existing-customer-hub",
    "existing-customer-hub": "existing-customer-hub",
    "dedicated-spoke": "dedicated-spoke",
    "isv-hosted": "isv-hosted",
  };
  const knownMode = modes.map((x) => alias[x]).find(Boolean);
  const topology: Topology = {
    landing: knownMode ?? landingOf(offering.network_profile),
    publicAccess: network["publicAccess"] === true,
    privateEndpoints: network["privateEndpoints"] !== false,
    regions: (Array.isArray(m["regions"])
      ? m["regions"]
      : (offering.supported_regions ?? ["eastus2"])) as string[],
    environments: (Array.isArray(options["environments"])
      ? options["environments"]
      : ["development", "test", "production"]) as string[],
  };
  const modules = (Array.isArray(m["modules"]) ? m["modules"] : []) as {
    name: string;
    settings?: Record<string, unknown>;
  }[];
  const selected = modules
    .filter((x) => SERVICE_BY_ID.has(x.name))
    .map((x) => withDefaults(x.name, x.settings));
  return { selected: normalise(selected, topology), topology };
}

export function toManifest(
  slug: string,
  version: string,
  arch: Architecture,
  source: Record<string, string>,
) {
  const { selected, topology } = arch;
  return {
    name: slug,
    version,
    boundary: { allowed: ["subscription", "resource-group"] },
    network: {
      publicAccess: topology.publicAccess,
      privateEndpoints: topology.privateEndpoints,
      modes: [topology.landing],
    },
    identity: { managedIdentity: true },
    observability: {
      diagnosticsRequired: true,
      customerWorkspaceSupported: topology.landing === "existing-customer-hub",
    },
    regions: topology.regions,
    modules: selected.map((s) => ({
      name: s.id,
      version: SERVICE_BY_ID.get(s.id)?.version ?? "0.0.0",
      settings: s.settings,
    })),
    deploymentOptions: {
      azureModels:
        topology.landing === "existing-customer-hub"
          ? ["existing_enterprise_alz"]
          : ["existing_enterprise_alz", "greenfield"],
      connectionModes: [
        "federated_identity",
        "lighthouse",
        "managed_application",
        "existing_subscription",
      ],
      environments: topology.environments,
    },
    customerInputs: inputsFor(selected, topology).map((i) => ({
      key: i.key,
      label: i.label,
      help: i.help,
      type:
        i.key === "addressSpace"
          ? "cidr"
          : i.key.endsWith("Id") || i.key.endsWith("Rg")
            ? "resource-id"
            : "text",
      required: i.key !== "firewallPrivateIp",
      source: i.source,
      discoverable: i.from === "Customer platform" || i.key === "subscriptionId",
    })),
    source,
  };
}

export const semverBump = (v: string) => {
  const [a, b] = v.split(".").map(Number);
  return `${a || 0}.${(b || 0) + 1}.0`;
};

export const slugOf = (name: string) =>
  `grid-analytics-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

export const LANDING_LABEL: Record<Topology["landing"], { title: string; body: string }> = {
  "existing-customer-hub": {
    title: "Customer landing zone",
    body: "Peer into the customer's hub. Their firewall, DNS, logging and policy are consumed, never replaced.",
  },
  "dedicated-spoke": {
    title: "Dedicated network",
    body: "The product brings its own spoke network into an approved subscription.",
  },
  "isv-hosted": {
    title: "Connected to your SaaS",
    body: "Only a connector lands in the customer's Azure; the data plane stays in your tenant.",
  },
};

export const CONNECTION_LABEL: Record<string, string> = {
  federated_identity: "Customer-authorized identity (OIDC)",
  lighthouse: "Azure Lighthouse delegation",
  managed_application: "Azure Managed Application",
  existing_subscription: "Existing subscription",
  existing_resource_group: "Existing resource group",
  new_subscription: "New subscription (vending)",
};
