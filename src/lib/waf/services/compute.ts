import type { Pillar, WafCheck, WafFix, WafResult, WafServiceGuide } from "../types";

const WAF = {
  aks: "https://learn.microsoft.com/azure/well-architected/service-guides/azure-kubernetes-service",
  appService:
    "https://learn.microsoft.com/azure/well-architected/service-guides/app-service-web-apps",
  functions: "https://learn.microsoft.com/azure/well-architected/service-guides/azure-functions",
  containerApps:
    "https://learn.microsoft.com/azure/well-architected/service-guides/azure-container-apps",
  virtualMachines:
    "https://learn.microsoft.com/azure/well-architected/service-guides/virtual-machines",
  containerRegistry:
    "https://learn.microsoft.com/azure/container-registry/container-registry-best-practices",
  containerInstances:
    "https://learn.microsoft.com/azure/container-instances/container-instances-best-practices-and-considerations",
} as const;

type CheckReturn = ReturnType<WafCheck>;
type RecInput = {
  id: string;
  pillar: Pillar;
  title: string;
  why: string;
  learn: string;
  check?: WafCheck;
};

const rec = (r: RecInput) => r;
const outcome = (result: WafResult, detail: string, fix?: WafFix): CheckReturn =>
  fix ? { result, detail, fix } : { result, detail };
const selected = (ctx: Parameters<WafCheck>[0], service: string) =>
  ctx.svc?.id === service || ctx.has(service);
const serviceMissing =
  (service: string): WafCheck =>
  (ctx) =>
    selected(ctx, service)
      ? outcome("pass", `${service} is selected.`)
      : outcome("na", `${service} is not selected.`);
const setting = (ctx: Parameters<WafCheck>[0], key: string, fallback = "not set") =>
  ctx.svc?.settings[key] ?? fallback;
const numberIn = (value: string | undefined, fallback: number) =>
  Number(value?.match(/\d+/)?.[0] ?? fallback);
const numbersIn = (value: string | undefined, fallback: [number, number]) =>
  (value?.match(/\d+/g)?.map(Number) as [number, number] | undefined) ?? fallback;
const productionOffered = (ctx: Parameters<WafCheck>[0]) =>
  ctx.topology.environments.includes("production");
const critical = (ctx: Parameters<WafCheck>[0]) => ctx.workload.criticality !== "standard";
const sensitive = (ctx: Parameters<WafCheck>[0]) =>
  ctx.workload.data === "confidential" || ctx.workload.data === "regulated";
const ensureService =
  (id: string, label: string): WafCheck =>
  (ctx) =>
    ctx.has(id)
      ? outcome("pass", `${label} is selected.`)
      : outcome("warn", `${label} is not selected.`, { label: `Add ${label}`, add: [id] });
const ensureManagedIdentity: WafCheck = (ctx) =>
  ctx.has("managed-identity")
    ? outcome("pass", "Managed identity is selected for keyless access.")
    : outcome("fail", "Managed identity is missing.", {
        label: "Add managed identity",
        add: ["managed-identity"],
      });
const ensureMonitoring: WafCheck = (ctx) =>
  ctx.has("monitoring")
    ? outcome(
        "pass",
        "Monitoring is selected; generated services emit diagnostics where supported.",
      )
    : outcome("warn", "Monitoring is missing, so diagnostics have nowhere to land.", {
        label: "Add monitoring",
        add: ["monitoring"],
      });
const ensurePrivateAccess =
  (service: string): WafCheck =>
  (ctx) => {
    if (!selected(ctx, service)) return outcome("na", `${service} is not selected.`);
    if (ctx.topology.publicAccess)
      return outcome("warn", `publicAccess is ${String(ctx.topology.publicAccess)}.`, {
        label: "Turn off public access",
        topology: { publicAccess: false, privateEndpoints: true },
      });
    return outcome("pass", `publicAccess is ${String(ctx.topology.publicAccess)}.`);
  };
const ensureInternalTier =
  (service: string): WafCheck =>
  (ctx) =>
    selected(ctx, service)
      ? outcome(
          "pass",
          `${service} is deployed on private subnets with tier NSG rules; publicAccess=${String(ctx.topology.publicAccess)} does not expose this tier.`,
        )
      : outcome("na", `${service} is not selected.`);
const ensurePrivateEndpointAccess =
  (service: string): WafCheck =>
  (ctx) => {
    if (!selected(ctx, service)) return outcome("na", `${service} is not selected.`);
    const privateReady = !ctx.topology.publicAccess && ctx.topology.privateEndpoints;
    if ((sensitive(ctx) || !ctx.topology.publicAccess) && !privateReady)
      return outcome(
        "fail",
        `publicAccess=${String(ctx.topology.publicAccess)} and privateEndpoints=${String(ctx.topology.privateEndpoints)}.`,
        {
          label: "Use private endpoint access",
          topology: { publicAccess: false, privateEndpoints: true },
          add: ["private-endpoints"],
        },
      );
    return outcome(
      "pass",
      `publicAccess=${String(ctx.topology.publicAccess)} and privateEndpoints=${String(ctx.topology.privateEndpoints)}.`,
    );
  };

const aksNodes: WafCheck = (ctx) => {
  if (!selected(ctx, "aks")) return outcome("na", "AKS is not selected.");
  const nodes = setting(ctx, "nodes", "3 + 3 (zonal)");
  const [system, user] = numbersIn(nodes, [3, 3]);
  const zonal = nodes.includes("zonal");
  if (!productionOffered(ctx))
    return outcome("na", `production is not offered; nodes is ${nodes}.`);
  if (critical(ctx) && (!zonal || system < 3 || user < 3))
    return outcome(
      "fail",
      `nodes is ${nodes}; critical workloads need zonal pools with at least 3 + 3.`,
      {
        label: "Use zonal 3 + 3 nodes",
        settings: { nodes: "3 + 3 (zonal)" },
      },
    );
  return outcome(
    "pass",
    `nodes is ${nodes}; zonal=${String(zonal)}, system=${system}, user=${user}.`,
  );
};

const aksTier: WafCheck = (ctx) => {
  if (!selected(ctx, "aks")) return outcome("na", "AKS is not selected.");
  const tier = setting(ctx, "tier", "Standard");
  if (ctx.workload.criticality === "mission-critical" && tier !== "Premium")
    return outcome("warn", `tier is ${tier}; mission-critical clusters should use Premium.`, {
      label: "Use Premium AKS",
      settings: { tier: "Premium" },
    });
  if (critical(ctx) && tier === "Free")
    return outcome("fail", `tier is ${tier}; production critical clusters should not use Free.`, {
      label: "Use Standard AKS",
      settings: { tier: "Standard" },
    });
  return outcome("pass", `tier is ${tier}.`);
};

const aksPrivate: WafCheck = (ctx) => {
  if (!selected(ctx, "aks")) return outcome("na", "AKS is not selected.");
  const access = setting(ctx, "access", "Private cluster");
  if ((sensitive(ctx) || !ctx.topology.publicAccess) && access !== "Private cluster")
    return outcome("fail", `access is ${access}; data is ${ctx.workload.data}.`, {
      label: "Make the AKS API private",
      settings: { access: "Private cluster" },
    });
  return outcome("pass", `access is ${access}; data is ${ctx.workload.data}.`);
};

const vmssInstances =
  (service: "web-vmss" | "app-vmss"): WafCheck =>
  (ctx) => {
    if (!selected(ctx, service)) return outcome("na", `${service} is not selected.`);
    const instances = setting(ctx, "instances", "3");
    const n = numberIn(instances, 3);
    if (productionOffered(ctx) && critical(ctx) && n < 3)
      return outcome(
        "warn",
        `instances is ${instances}; critical workloads should spread at least 3 instances.`,
        {
          label: "Use 3 production instances",
          settings: { instances: "3" },
        },
      );
    if (n < 2)
      return outcome(
        "fail",
        `instances is ${instances}; a single production VMSS instance has no redundancy.`,
        {
          label: "Use 2 production instances",
          settings: { instances: "2" },
        },
      );
    return outcome(
      "pass",
      `instances is ${instances}; production VMSS uses zone balance in Terraform.`,
    );
  };

const vmssScaleOut =
  (service: "web-vmss" | "app-vmss"): WafCheck =>
  (ctx) => {
    if (!selected(ctx, service)) return outcome("na", `${service} is not selected.`);
    const instances = numberIn(setting(ctx, "instances", "3"), 3);
    const maxInstances = setting(ctx, "maxInstances", "10");
    const max = numberIn(maxInstances, 10);
    if (max <= instances)
      return outcome(
        "warn",
        `instances is ${instances} and maxInstances is ${maxInstances}; autoscale cannot grow.`,
        {
          label: "Allow scale out to 10",
          settings: { maxInstances: "10" },
        },
      );
    return outcome("pass", `instances is ${instances}; maxInstances is ${maxInstances}.`);
  };

const vmssDevCost =
  (service: "web-vmss" | "app-vmss"): WafCheck =>
  (ctx) => {
    if (!selected(ctx, service)) return outcome("na", `${service} is not selected.`);
    const dev = setting(ctx, "devInstances", "1");
    if (dev !== "1")
      return outcome("warn", `devInstances is ${dev}; dev/test can usually start with 1.`, {
        label: "Use 1 dev/test instance",
        settings: { devInstances: "1" },
      });
    return outcome("pass", `devInstances is ${dev}.`);
  };

const vmCount: WafCheck = (ctx) => {
  if (!selected(ctx, "vm")) return outcome("na", "vm is not selected.");
  const count = setting(ctx, "count", "2");
  const n = numberIn(count, 2);
  if (productionOffered(ctx) && critical(ctx) && n < 2)
    return outcome(
      "fail",
      `count is ${count}; critical VM tiers need at least 2 VMs across zones.`,
      {
        label: "Use 2 production VMs",
        settings: { count: "2" },
      },
    );
  return outcome(
    "pass",
    `count is ${count}; production VMs are assigned across zones by Terraform.`,
  );
};

const vmDevCost: WafCheck = (ctx) => {
  if (!selected(ctx, "vm")) return outcome("na", "vm is not selected.");
  const dev = setting(ctx, "devCount", "1");
  if (dev !== "1")
    return outcome("warn", `devCount is ${dev}; dev/test can usually start with 1.`, {
      label: "Use 1 dev/test VM",
      settings: { devCount: "1" },
    });
  return outcome("pass", `devCount is ${dev}.`);
};

const vmDisk: WafCheck = (ctx) => {
  if (!selected(ctx, "vm")) return outcome("na", "vm is not selected.");
  const disk = setting(ctx, "dataDisk", "256 GB");
  const gb = numberIn(disk, 256);
  if (ctx.workload.data === "regulated" && gb < 256)
    return outcome(
      "warn",
      `dataDisk is ${disk}; regulated data often needs room for retention and restore.`,
      {
        label: "Use a 256 GB data disk",
        settings: { dataDisk: "256 GB" },
      },
    );
  return outcome("pass", `dataDisk is ${disk}.`);
};

const containerAppsProfile: WafCheck = (ctx) => {
  if (!selected(ctx, "container-apps")) return outcome("na", "container-apps is not selected.");
  const profile = setting(ctx, "profile", "Consumption");
  if (ctx.workload.criticality === "mission-critical" && profile === "Consumption")
    return outcome(
      "warn",
      `profile is ${profile}; mission-critical apps should use a dedicated profile.`,
      {
        label: "Use Dedicated D4",
        settings: { profile: "Dedicated D4" },
      },
    );
  return outcome(
    "pass",
    `profile is ${profile}; production environments set zone redundancy in Terraform.`,
  );
};

const containerAppsCost: WafCheck = (ctx) => {
  if (!selected(ctx, "container-apps")) return outcome("na", "container-apps is not selected.");
  const profile = setting(ctx, "profile", "Consumption");
  if (ctx.workload.criticality === "standard" && profile !== "Consumption")
    return outcome(
      "warn",
      `profile is ${profile}; standard workloads can start with Consumption.`,
      {
        label: "Use Consumption",
        settings: { profile: "Consumption" },
      },
    );
  return outcome("pass", `profile is ${profile}.`);
};

const appServicePlan: WafCheck = (ctx) => {
  if (!selected(ctx, "app-service")) return outcome("na", "app-service is not selected.");
  const plan = setting(ctx, "plan", "P1v3");
  if (productionOffered(ctx) && critical(ctx) && !plan.startsWith("P"))
    return outcome("fail", `plan is ${plan}; critical production apps need a Premium plan.`, {
      label: "Use P1v3",
      settings: { plan: "P1v3" },
    });
  return outcome(
    "pass",
    `plan is ${plan}; Premium v3 choices enable zone balancing in production.`,
  );
};

const appServiceCost: WafCheck = (ctx) => {
  if (!selected(ctx, "app-service")) return outcome("na", "app-service is not selected.");
  const plan = setting(ctx, "plan", "P1v3");
  if (ctx.workload.criticality === "standard" && plan === "P2v3")
    return outcome("warn", `plan is ${plan}; standard workloads can usually start smaller.`, {
      label: "Use P1v3",
      settings: { plan: "P1v3" },
    });
  return outcome("pass", `plan is ${plan}.`);
};

const functionsPlan: WafCheck = (ctx) => {
  if (!selected(ctx, "functions")) return outcome("na", "functions is not selected.");
  const plan = setting(ctx, "plan", "Flex Consumption");
  const flex = plan === "Flex Consumption" || plan === "FC1";
  if (productionOffered(ctx) && ctx.workload.criticality === "mission-critical" && flex)
    return outcome(
      "warn",
      `plan is ${plan}; Premium is better for always-warm critical functions.`,
      {
        label: "Use Premium EP1",
        settings: { plan: "Premium EP1" },
      },
    );
  return outcome("pass", `plan is ${plan}; Terraform configures managed identity storage access.`);
};

const functionsCost: WafCheck = (ctx) => {
  if (!selected(ctx, "functions")) return outcome("na", "functions is not selected.");
  const plan = setting(ctx, "plan", "Flex Consumption");
  const premium = plan === "Premium EP1" || plan === "EP1";
  if (ctx.workload.criticality === "standard" && premium)
    return outcome(
      "warn",
      `plan is ${plan}; event-driven standard workloads can start on Flex Consumption.`,
      {
        label: "Use Flex Consumption",
        settings: { plan: "Flex Consumption" },
      },
    );
  return outcome("pass", `plan is ${plan}.`);
};

const acrSku: WafCheck = (ctx) => {
  if (!selected(ctx, "container-registry"))
    return outcome("na", "container-registry is not selected.");
  const sku = setting(ctx, "sku", "Premium");
  if (
    (ctx.topology.privateEndpoints || ctx.topology.regions.length > 1 || critical(ctx)) &&
    sku !== "Premium"
  )
    return outcome(
      "fail",
      `sku is ${sku}; Premium is required for private link and geo-replication scenarios.`,
      {
        label: "Use Premium ACR",
        settings: { sku: "Premium" },
      },
    );
  return outcome(
    "pass",
    `sku is ${sku}; privateEndpoints=${String(ctx.topology.privateEndpoints)}.`,
  );
};

const acrCost: WafCheck = (ctx) => {
  if (!selected(ctx, "container-registry"))
    return outcome("na", "container-registry is not selected.");
  const sku = setting(ctx, "sku", "Premium");
  if (
    !ctx.topology.privateEndpoints &&
    ctx.topology.regions.length === 1 &&
    ctx.workload.criticality === "standard" &&
    sku === "Premium"
  )
    return outcome(
      "warn",
      `sku is ${sku}; Standard is cheaper when private link and geo-replication are not needed.`,
      {
        label: "Use Standard ACR",
        settings: { sku: "Standard" },
      },
    );
  return outcome("pass", `sku is ${sku}; regions=${ctx.topology.regions.length}.`);
};

const containerInstancesSelected = serviceMissing("container-instances");

export const COMPUTE_GUIDES: WafServiceGuide[] = [
  {
    service: "aks",
    learn: WAF.aks,
    summary:
      "AKS hosts containerized application services. In this catalog, the meaningful controls are cluster tier, zonal node count, and private versus authorized-IP API access; managed identity, Azure Policy, workload identity, patch upgrades, and diagnostics are generated by Terraform.",
    recs: [
      rec({
        id: "aks.zonal-node-pools",
        pillar: "reliability",
        title: "Run production node pools across zones",
        why: "Zonal node pools reduce impact from a datacenter failure and keep enough system and user capacity online.",
        learn: WAF.aks,
        check: aksNodes,
      }),
      rec({
        id: "aks.private-api",
        pillar: "security",
        title: "Keep the AKS API private for sensitive workloads",
        why: "A private API server limits management-plane exposure for confidential and regulated data.",
        learn: WAF.aks,
        check: aksPrivate,
      }),
      rec({
        id: "aks.right-size-tier",
        pillar: "cost",
        title: "Match the AKS tier to criticality",
        why: "Premium adds capabilities that are most valuable for mission-critical clusters; Free should stay out of critical production.",
        learn: WAF.aks,
        check: aksTier,
      }),
      rec({
        id: "aks.collect-diagnostics",
        pillar: "operations",
        title: "Collect AKS control-plane diagnostics",
        why: "Audit and platform logs are needed to operate and investigate the cluster.",
        learn: WAF.aks,
        check: ensureMonitoring,
      }),
      rec({
        id: "aks.use-managed-identity",
        pillar: "security",
        title: "Use managed identity and workload identity",
        why: "Keyless access avoids long-lived cluster and workload credentials.",
        learn: WAF.aks,
        check: ensureManagedIdentity,
      }),
      rec({
        id: "aks.scale-node-capacity",
        pillar: "performance",
        title: "Choose enough user-node capacity",
        why: "The selected node count is the initial schedulable capacity for application pods.",
        learn: WAF.aks,
        check: aksNodes,
      }),
    ],
  },
  {
    service: "web-vmss",
    learn: WAF.virtualMachines,
    summary:
      "The web VM scale set is deployed with flexible orchestration, zone balance in production, automatic instance repair, health probes, Entra login, Azure Monitor Agent, and autoscale. Its catalog controls are OS, production/dev instance counts, and max scale-out.",
    recs: [
      rec({
        id: "web-vmss.instance-redundancy",
        pillar: "reliability",
        title: "Run multiple web instances",
        why: "Multiple instances keep the web tier available during host maintenance or failure.",
        learn: WAF.virtualMachines,
        check: vmssInstances("web-vmss"),
      }),
      rec({
        id: "web-vmss.front-with-waf",
        pillar: "security",
        title: "Put public web VMs behind Application Gateway WAF",
        why: "A WAF provides managed web attack protection before traffic reaches the VM scale set.",
        learn: WAF.virtualMachines,
        check: ensureService("app-gateway", "Application Gateway"),
      }),
      rec({
        id: "web-vmss.dev-cost",
        pillar: "cost",
        title: "Keep dev/test web capacity small",
        why: "Non-production environments usually do not need production web instance counts.",
        learn: WAF.virtualMachines,
        check: vmssDevCost("web-vmss"),
      }),
      rec({
        id: "web-vmss.monitoring",
        pillar: "operations",
        title: "Monitor web VM scale set health",
        why: "Health probes, boot diagnostics, and VM guest metrics are needed for operations.",
        learn: WAF.virtualMachines,
        check: ensureMonitoring,
      }),
      rec({
        id: "web-vmss.autoscale-headroom",
        pillar: "performance",
        title: "Allow web tier scale-out headroom",
        why: "Autoscale only absorbs load spikes when max capacity is above the steady-state instance count.",
        learn: WAF.virtualMachines,
        check: vmssScaleOut("web-vmss"),
      }),
      rec({
        id: "web-vmss.entra-login",
        pillar: "security",
        title: "Use Entra login instead of shared admin access",
        why: "The generated VMSS extensions enable identity-based operator sign-in.",
        learn: WAF.virtualMachines,
        check: ensureManagedIdentity,
      }),
    ],
  },
  {
    service: "app-vmss",
    learn: WAF.virtualMachines,
    summary:
      "The app VM scale set is private behind an internal load balancer and NSG tier rules. Terraform configures zone-balanced production instances, automatic repair, Entra login, Azure Monitor Agent, and CPU autoscale.",
    recs: [
      rec({
        id: "app-vmss.instance-redundancy",
        pillar: "reliability",
        title: "Run multiple app instances",
        why: "Redundant app instances reduce outage risk during host failures and updates.",
        learn: WAF.virtualMachines,
        check: vmssInstances("app-vmss"),
      }),
      rec({
        id: "app-vmss.private-tier",
        pillar: "security",
        title: "Keep the app tier private",
        why: "Application logic should only be reachable from approved upstream tiers.",
        learn: WAF.virtualMachines,
        check: ensureInternalTier("app-vmss"),
      }),
      rec({
        id: "app-vmss.dev-cost",
        pillar: "cost",
        title: "Keep dev/test app capacity small",
        why: "Dev/test tiers usually need lower capacity than production.",
        learn: WAF.virtualMachines,
        check: vmssDevCost("app-vmss"),
      }),
      rec({
        id: "app-vmss.monitoring",
        pillar: "operations",
        title: "Monitor app VM scale set health",
        why: "Guest metrics and diagnostics are needed to detect regressions and failed updates.",
        learn: WAF.virtualMachines,
        check: ensureMonitoring,
      }),
      rec({
        id: "app-vmss.autoscale-headroom",
        pillar: "performance",
        title: "Allow app tier scale-out headroom",
        why: "Autoscale needs headroom above the initial count to handle CPU-driven spikes.",
        learn: WAF.virtualMachines,
        check: vmssScaleOut("app-vmss"),
      }),
      rec({
        id: "app-vmss.managed-identity",
        pillar: "security",
        title: "Run the app tier with managed identity",
        why: "Managed identity avoids secrets on VMs and supports keyless access to Azure dependencies.",
        learn: WAF.virtualMachines,
        check: ensureManagedIdentity,
      }),
    ],
  },
  {
    service: "vm",
    learn: WAF.virtualMachines,
    summary:
      "Data-tier VMs are deployed as individual Linux or Windows VMs spread across zones in production, with secure boot, vTPM, Entra login, Azure Monitor Agent, managed identity, managed boot diagnostics, and ZRS data disks in production.",
    recs: [
      rec({
        id: "vm.multiple-data-vms",
        pillar: "reliability",
        title: "Use more than one production data VM for critical workloads",
        why: "Multiple data-tier VMs let the tier survive planned maintenance or host failure when the application supports it.",
        learn: WAF.virtualMachines,
        check: vmCount,
      }),
      rec({
        id: "vm.private-tier",
        pillar: "security",
        title: "Keep data VMs private",
        why: "Data-tier VMs should only accept traffic from the app tier and management paths.",
        learn: WAF.virtualMachines,
        check: ensureInternalTier("vm"),
      }),
      rec({
        id: "vm.dev-cost",
        pillar: "cost",
        title: "Keep dev/test data VM count low",
        why: "Dev/test data tiers usually do not need production VM counts.",
        learn: WAF.virtualMachines,
        check: vmDevCost,
      }),
      rec({
        id: "vm.monitoring",
        pillar: "operations",
        title: "Collect VM diagnostics and guest telemetry",
        why: "Boot diagnostics and guest telemetry are needed to troubleshoot OS and workload issues.",
        learn: WAF.virtualMachines,
        check: ensureMonitoring,
      }),
      rec({
        id: "vm.data-disk-headroom",
        pillar: "performance",
        title: "Size data disks with growth headroom",
        why: "Undersized disks constrain data retention and can affect throughput-sensitive workloads.",
        learn: WAF.virtualMachines,
        check: vmDisk,
      }),
      rec({
        id: "vm.identity-login",
        pillar: "security",
        title: "Use Entra login and managed identity",
        why: "Identity-based VM access and workload identity reduce credential exposure.",
        learn: WAF.virtualMachines,
        check: ensureManagedIdentity,
      }),
    ],
  },
  {
    service: "container-apps",
    learn: WAF.containerApps,
    summary:
      "Container Apps runs serverless containers in a managed environment integrated with the spoke VNet. Terraform enables production zone redundancy, internal environment load balancing when public access is off, managed identity, Log Analytics, and replica scaling limits.",
    recs: [
      rec({
        id: "container-apps.dedicated-critical",
        pillar: "reliability",
        title: "Use a dedicated profile for mission-critical apps",
        why: "Dedicated workload profiles give critical apps reserved environment capacity instead of relying only on consumption capacity.",
        learn: WAF.containerApps,
        check: containerAppsProfile,
      }),
      rec({
        id: "container-apps.private-ingress",
        pillar: "security",
        title: "Use private ingress when public access is disabled",
        why: "Internal ingress keeps container app traffic on the workload network.",
        learn: WAF.containerApps,
        check: ensurePrivateAccess("container-apps"),
      }),
      rec({
        id: "container-apps.consumption-cost",
        pillar: "cost",
        title: "Use Consumption for standard variable workloads",
        why: "Consumption can reduce idle cost for standard workloads that can scale down.",
        learn: WAF.containerApps,
        check: containerAppsCost,
      }),
      rec({
        id: "container-apps.logs",
        pillar: "operations",
        title: "Send environment logs to Log Analytics",
        why: "Container and revision logs are essential for rollout and runtime troubleshooting.",
        learn: WAF.containerApps,
        check: ensureMonitoring,
      }),
      rec({
        id: "container-apps.replica-scale",
        pillar: "performance",
        title: "Use configured replica scaling",
        why: "The generated app sets production min replicas and max replicas so load can increase without redeploying.",
        learn: WAF.containerApps,
        check: serviceMissing("container-apps"),
      }),
      rec({
        id: "container-apps.identity",
        pillar: "security",
        title: "Run apps with managed identity",
        why: "Managed identity avoids storing Azure credentials in container app secrets.",
        learn: WAF.containerApps,
        check: ensureManagedIdentity,
      }),
    ],
  },
  {
    service: "app-service",
    learn: WAF.appService,
    summary:
      "App Service is deployed on Linux with HTTPS only, basic publishing disabled, managed identity, VNet integration, Application Insights settings, private endpoints when enabled, and production zone balancing for supported Premium plans.",
    recs: [
      rec({
        id: "app-service.premium-zone-plan",
        pillar: "reliability",
        title: "Use a Premium plan for critical production apps",
        why: "Premium plans support the production zone-balancing pattern used by this Terraform.",
        learn: WAF.appService,
        check: appServicePlan,
      }),
      rec({
        id: "app-service.private-access",
        pillar: "security",
        title: "Disable public access when private endpoints are required",
        why: "Private access reduces the exposed surface for web apps and APIs.",
        learn: WAF.appService,
        check: ensurePrivateEndpointAccess("app-service"),
      }),
      rec({
        id: "app-service.right-size-plan",
        pillar: "cost",
        title: "Right-size the App Service plan",
        why: "Start with the smallest plan that meets performance and reliability needs, then scale as data proves demand.",
        learn: WAF.appService,
        check: appServiceCost,
      }),
      rec({
        id: "app-service.diagnostics",
        pillar: "operations",
        title: "Collect App Service diagnostics",
        why: "Diagnostics and Application Insights help detect failed deployments and runtime errors.",
        learn: WAF.appService,
        check: ensureMonitoring,
      }),
      rec({
        id: "app-service.http2-always-on",
        pillar: "performance",
        title: "Keep Always On and HTTP/2 enabled",
        why: "The generated web app keeps the worker warm and enables HTTP/2 for better web performance.",
        learn: WAF.appService,
        check: serviceMissing("app-service"),
      }),
      rec({
        id: "app-service.identity",
        pillar: "security",
        title: "Use managed identity for dependencies",
        why: "Managed identity keeps downstream access keyless and centrally governed.",
        learn: WAF.appService,
        check: ensureManagedIdentity,
      }),
    ],
  },
  {
    service: "functions",
    learn: WAF.functions,
    summary:
      "Functions can use Flex Consumption or Premium. Terraform creates managed-identity storage access, HTTPS-only apps, VNet integration, private endpoints for host storage when enabled, diagnostics, and bounded scale settings.",
    recs: [
      rec({
        id: "functions.plan-criticality",
        pillar: "reliability",
        title: "Use Premium for always-warm critical functions",
        why: "Premium is better suited to latency-sensitive or critical event processing that should avoid cold starts.",
        learn: WAF.functions,
        check: functionsPlan,
      }),
      rec({
        id: "functions.private-endpoints",
        pillar: "security",
        title: "Keep function endpoints and storage private when required",
        why: "Private endpoints limit inbound access to the app and to its host storage account.",
        learn: WAF.functions,
        check: ensurePrivateEndpointAccess("functions"),
      }),
      rec({
        id: "functions.flex-cost",
        pillar: "cost",
        title: "Use Flex Consumption for standard event workloads",
        why: "Flex Consumption can lower cost for event-driven workloads that do not need always-warm workers.",
        learn: WAF.functions,
        check: functionsCost,
      }),
      rec({
        id: "functions.diagnostics",
        pillar: "operations",
        title: "Collect Function App diagnostics",
        why: "Invocation, host, and platform logs are required for reliable operations.",
        learn: WAF.functions,
        check: ensureMonitoring,
      }),
      rec({
        id: "functions.scale-limits",
        pillar: "performance",
        title: "Use bounded scale settings",
        why: "Configured maximum instance counts protect dependencies while allowing burst processing.",
        learn: WAF.functions,
        check: serviceMissing("functions"),
      }),
      rec({
        id: "functions.managed-storage-access",
        pillar: "security",
        title: "Use managed identity for host storage",
        why: "Managed identity avoids storage account keys for deployment packages and host state.",
        learn: WAF.functions,
        check: ensureManagedIdentity,
      }),
    ],
  },
  {
    service: "container-registry",
    learn: WAF.containerRegistry,
    summary:
      "Container Registry stores private product images. The catalog exposes the tier; Premium is the meaningful choice for private link and geo-replication scenarios, while managed identity and security baseline services provide the surrounding platform controls.",
    recs: [
      rec({
        id: "container-registry.premium-critical",
        pillar: "reliability",
        title: "Use Premium for multi-region or critical registries",
        why: "Premium supports capabilities used for resilient image distribution, including geo-replication.",
        learn: WAF.containerRegistry,
        check: acrSku,
      }),
      rec({
        id: "container-registry.private-link",
        pillar: "security",
        title: "Use Premium with private endpoints",
        why: "Private link for registry access requires the Premium tier.",
        learn: WAF.containerRegistry,
        check: acrSku,
      }),
      rec({
        id: "container-registry.right-size-tier",
        pillar: "cost",
        title: "Avoid Premium when its features are not needed",
        why: "Standard can be cheaper for a single-region, non-private standard workload.",
        learn: WAF.containerRegistry,
        check: acrCost,
      }),
      rec({
        id: "container-registry.monitoring",
        pillar: "operations",
        title: "Monitor registry activity",
        why: "Pull, push, and authentication telemetry helps investigate delivery and supply-chain issues.",
        learn: WAF.containerRegistry,
        check: ensureMonitoring,
      }),
      rec({
        id: "container-registry.keep-close",
        pillar: "performance",
        title: "Place image pulls near compute",
        why: "Using offered workload regions and Premium replication where needed reduces image pull latency.",
        learn: WAF.containerRegistry,
        check: acrSku,
      }),
      rec({
        id: "container-registry.identity",
        pillar: "security",
        title: "Pull images with managed identities where possible",
        why: "Identity-based image pulls reduce use of admin credentials and shared secrets.",
        learn: WAF.containerRegistry,
        check: ensureManagedIdentity,
      }),
    ],
  },
  {
    service: "container-instances",
    learn: WAF.containerInstances,
    summary:
      "Container Instances is modeled for short-lived setup and data-load jobs. The catalog has no per-service settings, so checks focus on platform guardrails the design can express: private topology, identity, monitoring, and security baseline.",
    recs: [
      rec({
        id: "container-instances.short-lived-jobs",
        pillar: "reliability",
        title: "Use Container Instances for restartable jobs",
        why: "Short-lived containers should be safe to retry because the service is best suited to task-style execution.",
        learn: WAF.containerInstances,
        check: containerInstancesSelected,
      }),
      rec({
        id: "container-instances.private-network",
        pillar: "security",
        title: "Run jobs on private topology when handling sensitive data",
        why: "Private topology keeps data-load and setup traffic off public endpoints when the workload requires it.",
        learn: WAF.containerInstances,
        check: ensurePrivateAccess("container-instances"),
      }),
      rec({
        id: "container-instances.pay-per-use",
        pillar: "cost",
        title: "Use ACI for bursty one-off work",
        why: "Task containers avoid keeping dedicated compute online for occasional setup and load jobs.",
        learn: WAF.containerInstances,
        check: containerInstancesSelected,
      }),
      rec({
        id: "container-instances.logs",
        pillar: "operations",
        title: "Capture job logs centrally",
        why: "Setup and data-load failures need centralized logs for support and audit.",
        learn: WAF.containerInstances,
        check: ensureMonitoring,
      }),
      rec({
        id: "container-instances.fit-task-size",
        pillar: "performance",
        title: "Reserve ACI for right-sized jobs",
        why: "Long-running high-throughput services usually fit AKS, Container Apps, or App Service better.",
        learn: WAF.containerInstances,
      }),
      rec({
        id: "container-instances.identity",
        pillar: "security",
        title: "Use managed identity for job access",
        why: "Managed identity avoids embedding storage, registry, or data-service secrets in job definitions.",
        learn: WAF.containerInstances,
        check: ensureManagedIdentity,
      }),
    ],
  },
];
