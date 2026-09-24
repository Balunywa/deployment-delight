import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Circle,
  Copy,
  ExternalLink,
  GitMerge,
  Github,
  Lightbulb,
  Loader2,
  Lock,
  Mail,
  UserCog,
  Workflow,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { ArchitectureCanvas } from "@/components/architecture/ArchitectureCanvas";
import { ServiceIcon } from "@/components/architecture/ServiceIcon";
import { CodeBlock } from "@/components/CodeBlock";
import {
  ChecksBox,
  PipelineGraph,
  PlacementTree,
  type RunState,
  TriggerTable,
} from "@/components/onboarding/Delivery";
import { Pill } from "@/components/Primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { CONNECTION_LABEL, LANDING_LABEL, fromManifest } from "@/lib/architecture";
import { SERVICE_BY_ID, inputsFor, monthlyEstimate } from "@/lib/catalog";
import { discoverPlatform } from "@/lib/discovery";
import { getDeployment } from "@/lib/data.functions";
import {
  createDeployment,
  decideApproval,
  executeDeployment,
  onboardCustomer,
} from "@/lib/factory.functions";
import { semverCompare } from "@/lib/fleet";
import { currency } from "@/lib/format";
import {
  DEFAULT_DELIVERY,
  type Delivery,
  ENV_KEYS,
  ENV_META,
  type EnvKey,
  type EnvPlan,
  TARGET_META,
  TOOL_META,
  type TargetMode,
  deliveryWorkflow,
  installFile,
  namesFor,
  onboardingChecks,
  placementFor,
  regionLabel,
  reviewOffering,
  ringsFor,
  sortEnvs,
  triggersFor,
  unsupportedIn,
  verdict,
} from "@/lib/onboarding";
import { foundationsQuery, offeringsQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/onboard")({
  head: () => ({
    meta: [
      { title: "Onboard customer · Cloud Delivery" },
      {
        name: "description",
        content:
          "Onboard a customer onto a published offering: environments and targets, placement in the landing zone, and a GitHub Actions or Azure Pipelines run.",
      },
      { property: "og:title", content: "Onboard customer · Cloud Delivery" },
      {
        property: "og:description",
        content: "Customer onboarding is a pull request, not a project.",
      },
    ],
  }),
  component: Onboard,
});

const STEPS = ["Customer & offering", "Access", "Environments", "Delivery", "Review & launch"];
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
const sampleSub = (i: number) => `2f8a7d11-4c39-4f85-b1de-93c7f6a52e1${i}`;

type Launch = {
  customerId: string;
  steps: { id: string; label: string; detail: string; state: RunState }[];
  runs: { env: EnvKey; id: string; status: string }[];
  graph: Record<string, RunState>;
  done: boolean;
  merged: boolean;
};

function Onboard() {
  const offerings = useQuery(offeringsQuery);
  const foundations = useQuery(foundationsQuery);
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);
  const [customer, setCustomer] = useState({ name: "Metro Energy", industry: "Electric utility" });
  const [code, setCode] = useState<string | null>(null);
  const customerCode = code ?? slug(customer.name);
  const [offeringId, setOfferingId] = useState<string>("");
  const [access, setAccess] = useState<"customer_link" | "engineer">("customer_link");
  const [connection, setConnection] = useState("federated_identity");
  const [tenantId, setTenantId] = useState("8f1c2b64-9a71-4c2e-9d55-7c3e1a0b4d21");
  const [grantedInput, setGrantedGroup] = useState<string | null>(null);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [plans, setPlans] = useState<Partial<Record<EnvKey, EnvPlan>>>({});
  const [delivery, setDelivery] = useState<Delivery>(DEFAULT_DELIVERY);
  const [showFiles, setShowFiles] = useState<"install" | "workflow" | null>(null);
  const [launch, setLaunch] = useState<Launch | null>(null);

  const hostingAnswers = (foundations.data ?? []).find((f) => !f.customer_id)?.answers ?? {};
  const published = useMemo(
    () =>
      (offerings.data ?? [])
        .map((o) => {
          const v = (
            (o.offering_versions ?? []) as {
              id: string;
              version: string;
              status: string;
              manifest_json: unknown;
            }[]
          )
            .filter((x) => x.status === "published")
            .sort((a, b) => semverCompare(b.version, a.version))[0];
          if (!v) return null;
          const arch = fromManifest(o, v.manifest_json);
          return {
            offering: o,
            version: v,
            arch,
            review: reviewOffering({ ...arch, hostingAnswers }),
          };
        })
        .filter((x): x is NonNullable<typeof x> => !!x),
    [offerings.data, hostingAnswers],
  );
  const pick =
    published.find((p) => p.offering.id === offeringId) ??
    published.find((p) => p.offering.offering_type === "enterprise_private") ??
    published[0];
  const arch = pick?.arch;
  const offeredEnvs = useMemo(
    () =>
      sortEnvs(
        (arch?.topology.environments ?? []).filter((e): e is EnvKey =>
          (ENV_KEYS as readonly string[]).includes(e),
        ),
      ),
    [arch],
  );

  // A new offering resets the environments to everything it offers, in its first region.
  useEffect(() => {
    if (!arch) return;
    const region = arch.topology.regions[0] ?? "eastus2";
    setPlans(
      Object.fromEntries(
        offeredEnvs.map((e) => [
          e,
          {
            env: e,
            region,
            // Customers with their own landing zone usually hand over subscriptions; everyone else gets new ones.
            target:
              arch.topology.landing === "existing-customer-hub"
                ? "existing_subscription"
                : "new_subscription",
            subscriptionId:
              arch.topology.landing === "existing-customer-hub"
                ? sampleSub(offeredEnvs.indexOf(e))
                : "",
            resourceGroup: "",
          },
        ]),
      ),
    );
  }, [arch, offeredEnvs]);

  const onboard = useMutation({ mutationFn: useServerFn(onboardCustomer) });
  const plan = useMutation({ mutationFn: useServerFn(createDeployment) });
  const fetchRun = useServerFn(getDeployment);
  const approve = useServerFn(decideApproval);
  const execute = useServerFn(executeDeployment);
  const [merging, setMerging] = useState(false);

  if (!pick || !arch) return <p className="text-sm text-muted-foreground">Loading offerings…</p>;

  const hosted = arch.topology.landing === "isv-hosted";
  const hub = arch.topology.landing === "existing-customer-hub";
  const viaLink = !hosted && access === "customer_link";
  const grantedGroup = viaLink
    ? "Granted on the install link"
    : (grantedInput ?? `${customerCode}-landingzones-${arch.topology.landingZone}`);
  const envPlans = sortEnvs(Object.keys(plans) as EnvKey[]).map((e) => plans[e]!);
  // With an install link the customer's admin picks subscriptions, so none are sent from here.
  const submitPlans = envPlans.map((p) =>
    !hosted && access === "customer_link" ? { ...p, subscriptionId: "" } : p,
  );
  const required = inputsFor(arch.selected, arch.topology).filter(
    (i) => i.key !== "subscriptionId",
  );
  const discovered = discoverPlatform(customerCode, "2f8a7d11");
  const value = (k: string) =>
    inputs[k] ??
    (k === "customerSignInDomain" ? `${customerCode}.example` : (discovered[k]?.[0] ?? ""));
  const placement = placementFor({
    landing: arch.topology.landing,
    landingZone: arch.topology.landingZone,
    hostingAnswers,
    customerName: customer.name,
    customerCode,
    grantedGroup,
  });
  const checks = onboardingChecks({
    selected: arch.selected,
    topology: arch.topology,
    plans: envPlans,
    delivery,
    placementExists: placement.exists,
    hostingAnswers,
    viaLink,
    customerTenant: !hosted,
  });
  const rings = ringsFor(envPlans, delivery);
  const triggers = triggersFor(delivery, customerCode);
  const monthly = monthlyEstimate(arch.selected);
  const quote = envPlans.reduce((s, p) => s + (ENV_META[p.env].prod ? monthly : monthly * 0.3), 0);
  const codeOk = /^[a-z0-9-]{2,40}$/.test(customerCode);
  const canContinue = [
    customer.name.trim().length >= 2 && codeOk,
    true,
    envPlans.length > 0 && !checks.some((c) => c.area === "Targets" && c.level === "fail"),
    delivery.repo.includes("/"),
    verdict(checks) !== "fail",
  ];
  const setPlan = (e: EnvKey, patch: Partial<EnvPlan>) =>
    setPlans((p) => ({ ...p, [e]: { ...p[e]!, ...patch } }));
  const toggleEnv = (e: EnvKey) =>
    setPlans((p) => {
      if (p[e]) {
        const next = { ...p };
        delete next[e];
        return next;
      }
      const first = Object.values(p)[0];
      return {
        ...p,
        [e]: {
          env: e,
          region: first?.region ?? arch.topology.regions[0] ?? "eastus2",
          target: first?.target ?? "new_subscription",
          subscriptionId: "",
          resourceGroup: "",
        },
      };
    });
  const tool = TOOL_META[delivery.tool];
  const gh = delivery.tool === "github-actions";

  const bound = Object.fromEntries(required.map((i) => [i.key, value(i.key)]));
  const fileText = installFile({
    code: customerCode,
    name: customer.name,
    offering: slug(pick.offering.name),
    version: pick.version.version,
    landingZone: arch.topology.landingZone,
    placement: placement.path.filter((p) => p.id !== "root"),
    plans: submitPlans,
    delivery,
    inputs: viaLink ? {} : bound,
    tenantId: hosted || viaLink ? "" : tenantId,
  });

  const start = async () => {
    const primary = submitPlans[0]!;
    const steps: Launch["steps"] = [
      {
        id: "record",
        label: "Customer and install file",
        detail: `installs/${customerCode}.yaml`,
        state: "running",
      },
      {
        id: "pr",
        label: gh
          ? `Pull request on ${delivery.repo}`
          : `Pull request in Azure Repos (${delivery.repo})`,
        detail: `onboard/${customerCode} → main`,
        state: "queued",
      },
      {
        id: "envs",
        label: gh ? "GitHub environments" : "Azure Pipelines environments",
        detail: envPlans
          .map(
            (p) =>
              `${namesFor(customerCode, p, delivery).environment}${ENV_META[p.env].prod && delivery.prodApprovers ? " (required reviewers)" : ""}`,
          )
          .join(" · "),
        state: "queued",
      },
      {
        id: "oidc",
        label: gh ? "Federated credentials (OIDC)" : "Workload identity federation",
        detail: `${envPlans.length} subject${envPlans.length === 1 ? "" : "s"}, no secrets stored`,
        state: "queued",
      },
      ...(envPlans.some((p) => p.target === "new_subscription")
        ? [
            {
              id: "subs",
              label: "Subscriptions requested",
              detail: envPlans
                .filter((p) => p.target === "new_subscription")
                .map((p) => namesFor(customerCode, p, delivery).subscription)
                .join(" · "),
              state: "queued" as RunState,
            },
          ]
        : []),
      viaLink
        ? {
            id: "wait",
            label: `Waiting for ${customer.name}'s Azure admin`,
            detail: "The run starts when they approve access through the install link",
            state: "queued",
          }
        : {
            id: "runs",
            label: "Validate & plan",
            detail: `${envPlans.length} what-if run${envPlans.length === 1 ? "" : "s"} on the pull request`,
            state: "queued",
          },
    ];
    const state: Launch = {
      customerId: "",
      steps,
      runs: [],
      graph: { pr: "running" },
      done: false,
      merged: false,
    };
    const push = () => setLaunch({ ...state, steps: state.steps.map((s) => ({ ...s })) });
    const mark = (id: string, s: RunState) => {
      const x = state.steps.find((y) => y.id === id);
      if (x) x.state = s;
      push();
    };
    push();
    try {
      const r = (await onboard.mutateAsync({
        data: {
          name: customer.name,
          customerCode,
          industry: customer.industry,
          accessMethod: hosted ? "engineer" : access,
          ...(hosted
            ? { managementGroupId: placement.path.at(-1)?.id }
            : access === "engineer"
              ? {
                  tenantId,
                  ...(primary.subscriptionId ? { subscriptionId: primary.subscriptionId } : {}),
                  ...(hub && grantedGroup ? { managementGroupId: grantedGroup } : {}),
                }
              : {}),
          azureModel: hosted ? "isv_hosted" : hub ? "existing_enterprise_alz" : "greenfield",
          connectionType: hosted ? "new_subscription" : (connection as "federated_identity"),
          offeringId: pick.offering.id,
          region: primary.region,
          environments: envPlans.map((p) => p.env),
          plans: submitPlans,
          delivery,
          placement: placement.path,
          inputs: viaLink ? {} : bound,
          network: {
            mode: arch.topology.landing,
            ...(!viaLink && hub ? { vnetId: value("vnetId") } : {}),
            privateEndpoints: arch.topology.privateEndpoints,
            publicAccess: arch.topology.publicAccess,
          },
          observability: {
            useCustomerWorkspace: hub,
            ...(!viaLink && hub
              ? { logAnalyticsWorkspaceId: value("logAnalyticsWorkspaceId") }
              : {}),
          },
        },
      })) as { customerId: string; environments: { id: string; environment_type: string }[] };
      state.customerId = r.customerId;
      void queryClient.invalidateQueries({ queryKey: ["customers"] });
      void queryClient.invalidateQueries({ queryKey: ["estate"] });
      mark("record", "success");
      for (const id of ["pr", "envs", "oidc", "subs"]) {
        if (!state.steps.some((s) => s.id === id)) continue;
        mark(id, "running");
        await new Promise((res) => setTimeout(res, 380));
        mark(id, "success");
      }
      state.graph = { pr: "success" };
      if (viaLink) {
        mark("wait", "waiting");
      } else {
        mark("runs", "running");
        state.graph = { pr: "success", validate: "running" };
        push();
        for (const env of r.environments) {
          const d = (await plan.mutateAsync({
            data: { environmentId: env.id, deploymentType: "initial", requestedBy: "Sarah Chen" },
          })) as { deploymentId: string; status: string };
          state.runs.push({
            env: env.environment_type as EnvKey,
            id: d.deploymentId,
            status: d.status,
          });
          push();
        }
        const failed = state.runs.some((x) => x.status === "VALIDATION_FAILED");
        mark("runs", failed ? "failed" : "success");
        const first = rings[0];
        state.graph = {
          pr: "success",
          validate: failed ? "failed" : "success",
          plan: failed ? "failed" : "success",
          ...(first?.gate ? { [`gate-${first.id}`]: "waiting" as RunState } : {}),
        };
        void queryClient.invalidateQueries({ queryKey: ["deployments"] });
      }
      state.done = true;
      push();
    } catch (e) {
      const running = state.steps.find((s) => s.state === "running");
      if (running) running.state = "failed";
      state.done = true;
      push();
      toast.error((e as Error).message);
    }
  };

  // Merging the onboarding pull request: non-production rings deploy in order, production waits for reviewers.
  const merge = async () => {
    if (!launch) return;
    setMerging(true);
    const next: Launch = { ...launch, merged: true, graph: { ...launch.graph } };
    const show = () => setLaunch({ ...next, graph: { ...next.graph }, runs: [...next.runs] });
    try {
      for (const r of rings) {
        const run = next.runs.find((x) => x.env === r.id);
        if (!run) continue;
        if (r.gate) {
          next.graph[`gate-${r.id}`] = "waiting";
          show();
          break;
        }
        next.graph[`deploy-${r.id}`] = "running";
        show();
        const d = (await fetchRun({ data: { deploymentId: run.id } })) as {
          approvals: { id: string; status: string }[];
        };
        const pending = d.approvals.find((a) => a.status === "pending");
        if (pending)
          await approve({
            data: {
              approvalId: pending.id,
              decision: "approved",
              decidedBy:
                delivery.tool === "github-actions"
                  ? "GitHub Actions (auto-deploy)"
                  : "Azure Pipelines (auto-deploy)",
              comments:
                "Plan clean on the onboarding pull request; non-production deploys on merge.",
            },
          });
        const out = (await execute({ data: { deploymentId: run.id } })) as { status: string };
        run.status = out.status;
        next.graph[`deploy-${r.id}`] = out.status === "SUCCEEDED" ? "success" : "failed";
        show();
        if (out.status !== "SUCCEEDED") break;
      }
      void queryClient.invalidateQueries({ queryKey: ["deployments"] });
      void queryClient.invalidateQueries({ queryKey: ["estate"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setMerging(false);
    }
  };

  const link =
    launch?.customerId && typeof window !== "undefined"
      ? `${window.location.origin}/connect/${launch.customerId}`
      : "";

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-5">
        <p className="text-xs text-muted-foreground">Customers / Onboard</p>
        <h1 className="text-[22px] font-semibold">Onboard a customer</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Pick a published offering, choose where each environment lands, and launch. Onboarding
          adds one install file to your delivery repository — {tool.title} validates, plans and
          deploys it ring by ring, the same way for every customer.
        </p>
      </div>

      <ol className="mb-5 flex flex-wrap items-center gap-2 text-[13px]">
        {STEPS.map((label, i) => (
          <li key={label} className="flex items-center gap-2">
            <button
              disabled={!!launch || i > step || (i > 0 && !canContinue.slice(0, i).every(Boolean))}
              onClick={() => setStep(i)}
              className={cn(
                "flex items-center gap-2",
                i === step
                  ? "font-medium text-foreground"
                  : i < step
                    ? "text-foreground"
                    : "text-muted-foreground",
              )}
            >
              <span
                className={cn(
                  "grid size-5 place-items-center rounded-full border text-[11px]",
                  i < step || launch
                    ? "border-success bg-success text-white"
                    : i === step
                      ? "border-primary text-primary"
                      : "border-border",
                )}
              >
                {i < step || launch ? <Check className="size-3" /> : i + 1}
              </span>
              {label}
            </button>
            {i < STEPS.length - 1 && <span className="h-px w-6 bg-border" />}
          </li>
        ))}
      </ol>

      {launch ? (
        <LaunchView
          launch={launch}
          name={customer.name}
          code={customerCode}
          link={link}
          viaLink={viaLink}
          delivery={delivery}
          rings={rings}
          canMerge={
            !viaLink &&
            launch.done &&
            !launch.merged &&
            delivery.autoDeployNonProd &&
            launch.runs.length > 0 &&
            !launch.runs.some((r) => r.status === "VALIDATION_FAILED")
          }
          merging={merging}
          onMerge={() => void merge()}
        />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0 space-y-4">
            {step === 0 && (
              <>
                <Card title="Customer">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field
                      label="Name"
                      value={customer.name}
                      onChange={(v) => setCustomer({ ...customer, name: v })}
                    />
                    <Field
                      label="Customer code"
                      value={customerCode}
                      onChange={(v) => setCode(v)}
                      hint={
                        codeOk
                          ? "Used in every resource, environment and file name"
                          : "Lowercase letters, numbers and hyphens"
                      }
                      mono
                      invalid={!codeOk}
                    />
                    <Field
                      label="Industry"
                      value={customer.industry}
                      onChange={(v) => setCustomer({ ...customer, industry: v })}
                    />
                  </div>
                </Card>
                <Card
                  title="Offering"
                  subtitle="Published versions only — each one passed architecture review and is immutable."
                >
                  <div className="grid gap-2 sm:grid-cols-2">
                    {published.map((p) => {
                      const v = verdict(p.review);
                      return (
                        <button
                          key={p.offering.id}
                          onClick={() => setOfferingId(p.offering.id)}
                          className={cn(
                            "rounded-md border p-3 text-left transition-colors",
                            p.offering.id === pick.offering.id
                              ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                              : "border-border hover:border-border-strong",
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-[13px] font-semibold">{p.offering.name}</p>
                            <span className="font-mono text-[11px] text-muted-foreground">
                              v{p.version.version}
                            </span>
                          </div>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {LANDING_LABEL[p.arch.topology.landing].title} ·{" "}
                            {p.arch.topology.landingZone} landing zone
                          </p>
                          <div className="mt-2 flex flex-wrap items-center gap-1">
                            {p.arch.selected
                              .filter(
                                (s) =>
                                  !SERVICE_BY_ID.get(s.id)?.locked &&
                                  s.id !== "private-endpoints" &&
                                  s.id !== "network-spoke",
                              )
                              .map((s) => (
                                <span key={s.id} title={SERVICE_BY_ID.get(s.id)?.name}>
                                  <ServiceIcon id={s.id} size="sm" />
                                </span>
                              ))}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
                            <span>{p.arch.topology.regions.length} regions</span>·
                            <span>
                              {sortEnvs(p.arch.topology.environments)
                                .map((e) => ENV_META[e as EnvKey]?.short ?? e)
                                .join(" · ")}
                            </span>
                            ·
                            <span
                              className={cn(
                                v === "pass"
                                  ? "text-success"
                                  : v === "warn"
                                    ? "text-warning"
                                    : "text-danger",
                              )}
                            >
                              {v === "pass"
                                ? "Review passed"
                                : v === "warn"
                                  ? "Review: warnings"
                                  : "Review failing"}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">
                    Need a different architecture?{" "}
                    <Link
                      to="/offerings"
                      search={{ new: true }}
                      className="text-primary hover:underline"
                    >
                      Create a new offering
                    </Link>{" "}
                    — it goes through architecture review before customers can be onboarded to it.
                  </p>
                </Card>
              </>
            )}

            {step === 1 && hosted && (
              <Card
                title={`Runs in your Azure — nothing needed from ${customer.name}'s IT`}
                subtitle="Each environment gets its own subscription in your hosting tenant. The customer needs no Azure, and no access is granted."
              >
                <Field
                  label="Customer sign-in domain"
                  value={value("customerSignInDomain")}
                  onChange={(v) => setInputs({ ...inputs, customerSignInDomain: v })}
                  hint="Their users sign in to your product with their own work accounts (Microsoft Entra B2B)."
                />
              </Card>
            )}

            {step === 1 && !hosted && (
              <>
                <Card title={`How will ${customer.name} grant access to their Azure?`}>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Choice
                      on={access === "customer_link"}
                      onClick={() => setAccess("customer_link")}
                      icon={<Mail className="size-4" />}
                      title="Send an install link"
                      badge="Recommended"
                      body="Their Azure admin signs in, picks subscriptions and approves access. Hub, DNS and workspace are discovered — you never handle their IDs."
                    />
                    <Choice
                      on={access === "engineer"}
                      onClick={() => setAccess("engineer")}
                      icon={<UserCog className="size-4" />}
                      title="I have the details"
                      body="Enter the tenant, subscriptions and platform resources yourself, e.g. from a completed intake form."
                    />
                  </div>
                  <div className="mt-3 max-w-sm">
                    <Label className="text-xs">Access model</Label>
                    <Select value={connection} onValueChange={setConnection}>
                      <SelectTrigger className="mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {["federated_identity", "lighthouse", "managed_application"].map((c) => (
                          <SelectItem key={c} value={c}>
                            {CONNECTION_LABEL[c]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </Card>
                <Card
                  title="What the architecture needs from their platform"
                  subtitle={`${required.length} value${required.length === 1 ? "" : "s"}, derived from the offering. Subscriptions are chosen per environment in the next step.`}
                >
                  <div className="space-y-2.5">
                    {access === "engineer" && (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field
                          label="Microsoft Entra tenant ID"
                          value={tenantId}
                          onChange={setTenantId}
                          mono
                        />
                        {hub && (
                          <Field
                            label="Management group granted"
                            value={grantedGroup}
                            onChange={setGrantedGroup}
                            hint="Where the customer's admin lets you place subscriptions."
                            mono
                          />
                        )}
                      </div>
                    )}
                    {required.map((i) =>
                      access === "engineer" ? (
                        <Field
                          key={i.key}
                          label={i.label}
                          value={value(i.key)}
                          onChange={(v) => setInputs({ ...inputs, [i.key]: v })}
                          hint={i.help}
                          mono
                        />
                      ) : (
                        <div
                          key={i.key}
                          className="flex items-center justify-between gap-3 rounded-sm border border-border px-3 py-2"
                        >
                          <div>
                            <p className="text-[13px] font-medium">{i.label}</p>
                            <p className="text-[11px] text-muted-foreground">{i.help}</p>
                          </div>
                          <Pill tone={i.from === "Customer platform" ? "success" : "info"}>
                            {i.from === "Customer platform"
                              ? "Discovered via link"
                              : "Customer enters"}
                          </Pill>
                        </div>
                      ),
                    )}
                  </div>
                </Card>
              </>
            )}

            {step === 2 && (
              <>
                <Card
                  title="Environments"
                  subtitle={`${pick.offering.name} offers ${offeredEnvs.map((e) => ENV_META[e].label).join(", ")}. Each environment is its own install with its own subscription.`}
                >
                  <div className="flex flex-wrap gap-2">
                    {offeredEnvs.map((e) => {
                      const on = !!plans[e];
                      return (
                        <button
                          key={e}
                          onClick={() => toggleEnv(e)}
                          className={cn(
                            "flex items-center gap-2 rounded-md border px-3 py-1.5 text-[13px]",
                            on
                              ? "border-primary bg-primary/5 font-medium"
                              : "border-border text-muted-foreground",
                          )}
                        >
                          <span
                            className={cn(
                              "grid size-4 place-items-center rounded-[3px] border",
                              on ? "border-primary bg-primary text-white" : "border-border-strong",
                            )}
                          >
                            {on && <Check className="size-3" />}
                          </span>
                          {ENV_META[e].label}
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-4 space-y-2">
                    {envPlans.map((p, i) => (
                      <EnvRow
                        key={p.env}
                        plan={p}
                        index={i}
                        regions={arch.topology.regions}
                        selected={arch.selected}
                        hosted={hosted}
                        viaLink={viaLink}
                        names={namesFor(customerCode, p, delivery)}
                        onChange={(patch) => setPlan(p.env, patch)}
                      />
                    ))}
                  </div>
                  {envPlans.length > 1 && (
                    <button
                      className="mt-2 text-xs text-primary hover:underline"
                      onClick={() => {
                        const f = envPlans[0]!;
                        for (const p of envPlans.slice(1))
                          setPlan(p.env, { region: f.region, target: f.target });
                      }}
                    >
                      Use {ENV_META[envPlans[0]!.env].label}'s region and target for all
                    </button>
                  )}
                </Card>
                <Card
                  title="Where they land"
                  subtitle="Placement comes from the landing zone design — nobody picks management groups by hand."
                >
                  <PlacementTree
                    path={placement.path}
                    source={placement.source}
                    subs={envPlans.map((p) => {
                      const n = namesFor(customerCode, p, delivery);
                      return {
                        label: ENV_META[p.env].label,
                        sub:
                          p.target === "new_subscription"
                            ? n.subscription
                            : p.target === "existing_resource_group"
                              ? `${ENV_META[p.env].short}: ${n.resourceGroup}`
                              : `${ENV_META[p.env].short}: existing`,
                        pending: viaLink || p.target !== "new_subscription",
                      };
                    })}
                  />
                  <p className="mt-2 flex items-start gap-1.5 text-[11.5px] text-muted-foreground">
                    <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-warning" />
                    Microsoft's Cloud Adoption Framework: keep dev, test and prod as separate
                    subscriptions in the same management group, not separate groups — they get the
                    same guardrails as production.
                  </p>
                </Card>
              </>
            )}

            {step === 3 && (
              <>
                <Card
                  title="Delivery tool"
                  subtitle="Where the pipeline for this customer runs. Every customer uses the same workflow."
                >
                  <div className="grid gap-2 sm:grid-cols-2">
                    {(["github-actions", "azure-devops"] as const).map((t) => (
                      <Choice
                        key={t}
                        on={delivery.tool === t}
                        onClick={() => setDelivery({ ...delivery, tool: t })}
                        icon={
                          t === "github-actions" ? (
                            <Github className="size-4" />
                          ) : (
                            <Workflow className="size-4" />
                          )
                        }
                        title={TOOL_META[t].title}
                        {...(t === "github-actions" ? { badge: "Default" } : {})}
                        body={TOOL_META[t].body}
                      />
                    ))}
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <Field
                      label={gh ? "Delivery repository" : "Project / repository"}
                      value={delivery.repo}
                      onChange={(v) => setDelivery({ ...delivery, repo: v })}
                      hint={
                        gh
                          ? "The repository you deployed Cloud Delivery from."
                          : "Azure DevOps project and Azure Repos repository."
                      }
                      mono
                    />
                    <Field
                      label="Production reviewers"
                      value={delivery.prodApprovers}
                      onChange={(v) => setDelivery({ ...delivery, prodApprovers: v })}
                      hint={
                        gh
                          ? "Team or users — GitHub environment required reviewers."
                          : "Group — Azure Pipelines environment approval check."
                      }
                      mono
                    />
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    <Toggle
                      label="Deploy non-production automatically"
                      hint="When the plan is clean"
                      checked={delivery.autoDeployNonProd}
                      onChange={(v) => setDelivery({ ...delivery, autoDeployNonProd: v })}
                    />
                    <Toggle
                      label="Nightly drift check"
                      hint="What-if on every install"
                      checked={delivery.driftSchedule}
                      onChange={(v) => setDelivery({ ...delivery, driftSchedule: v })}
                    />
                    <div className="rounded-sm border border-border px-2.5 py-1.5">
                      <Label className="text-xs">Production wait timer</Label>
                      <Select
                        value={String(delivery.prodWaitMinutes)}
                        onValueChange={(v) =>
                          setDelivery({ ...delivery, prodWaitMinutes: Number(v) })
                        }
                      >
                        <SelectTrigger className="mt-1 h-7 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {[0, 30, 240, 1440].map((m) => (
                            <SelectItem key={m} value={String(m)}>
                              {m === 0 ? "None" : m < 60 ? `${m} minutes` : `${m / 60} hours`}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </Card>
                <Card
                  title="The run"
                  subtitle="What happens after you launch, and after every change to this customer."
                >
                  <PipelineGraph code={customerCode} rings={rings} delivery={delivery} />
                </Card>
                <Card
                  title="Triggers"
                  subtitle="Everything that starts the workflow for this customer."
                >
                  <TriggerTable triggers={triggers} />
                </Card>
                <Card
                  title={gh ? "GitHub environments" : "Azure Pipelines environments"}
                  subtitle="Created on launch. Each has its own federated credential scoped to its subscription — no secrets anywhere."
                >
                  <div className="overflow-hidden rounded-md border border-border">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-muted/60 text-[11px] text-muted-foreground">
                        <tr>
                          <th className="px-3 py-1.5 font-medium">Environment</th>
                          <th className="px-3 py-1.5 font-medium">Protection</th>
                          <th className="px-3 py-1.5 font-medium">Federated credential subject</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {envPlans.map((p) => {
                          const n = namesFor(customerCode, p, delivery);
                          const prod = ENV_META[p.env].prod;
                          return (
                            <tr key={p.env}>
                              <td className="px-3 py-1.5 font-mono text-[11px]">{n.environment}</td>
                              <td className="px-3 py-1.5">
                                {prod ? (
                                  <span className="flex items-center gap-1">
                                    <Lock className="size-3 text-warning" />
                                    {delivery.prodApprovers || "No reviewers"}
                                    {delivery.prodWaitMinutes
                                      ? ` · wait ${delivery.prodWaitMinutes} min`
                                      : ""}{" "}
                                    · main only
                                  </span>
                                ) : delivery.autoDeployNonProd ? (
                                  "Deploys when the plan is clean"
                                ) : (
                                  "Plan approval"
                                )}
                              </td>
                              <td className="px-3 py-1.5 font-mono text-[10.5px] text-muted-foreground">
                                {n.oidcSubject}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </Card>
              </>
            )}

            {step === 4 && (
              <>
                <ChecksBox checks={checks} />
                <Card
                  title={`What lands for ${customer.name}`}
                  subtitle={`${pick.offering.name} v${pick.version.version} · ${envPlans.map((p) => `${ENV_META[p.env].short} in ${regionLabel(p.region)}`).join(" · ")}`}
                >
                  <PlacementTree
                    path={placement.path}
                    source={placement.source}
                    subs={envPlans.map((p) => ({
                      label: ENV_META[p.env].label,
                      sub: namesFor(customerCode, p, delivery)[
                        p.target === "new_subscription" ? "subscription" : "resourceGroup"
                      ],
                      pending: viaLink || p.target !== "new_subscription",
                    }))}
                  />
                  <div className="mt-3">
                    <ArchitectureCanvas
                      selected={arch.selected}
                      topology={{
                        ...arch.topology,
                        regions: [envPlans[0]?.region ?? arch.topology.regions[0]!],
                      }}
                      bindings={viaLink ? {} : bound}
                      installName={`${customerCode}-${ENV_META[envPlans.at(-1)?.env ?? "production"].short}`}
                      compact
                    />
                  </div>
                </Card>
                <Card title="The run" subtitle={`${tool.title} · ${delivery.repo}`}>
                  <PipelineGraph code={customerCode} rings={rings} delivery={delivery} />
                  <div className="mt-3 flex gap-2">
                    <Button
                      size="sm"
                      variant={showFiles === "install" ? "default" : "outline"}
                      onClick={() => setShowFiles(showFiles === "install" ? null : "install")}
                    >
                      installs/{customerCode}.yaml
                    </Button>
                    <Button
                      size="sm"
                      variant={showFiles === "workflow" ? "default" : "outline"}
                      onClick={() => setShowFiles(showFiles === "workflow" ? null : "workflow")}
                    >
                      {gh ? ".github/workflows/deliver.yml" : "azure-pipelines/deliver.yml"}
                    </Button>
                  </div>
                  {showFiles && (
                    <div className="mt-3">
                      <CodeBlock
                        title={
                          showFiles === "install"
                            ? `installs/${customerCode}.yaml · the only file this onboarding adds`
                            : gh
                              ? ".github/workflows/deliver.yml · shared by every customer"
                              : "azure-pipelines/deliver.yml · shared by every customer"
                        }
                        code={
                          showFiles === "install"
                            ? fileText
                            : deliveryWorkflow(slug(pick.offering.name), delivery)
                        }
                      />
                    </div>
                  )}
                </Card>
              </>
            )}

            <div className="flex justify-between">
              <Button variant="outline" disabled={step === 0} onClick={() => setStep(step - 1)}>
                Back
              </Button>
              {step < STEPS.length - 1 ? (
                <Button disabled={!canContinue[step]} onClick={() => setStep(step + 1)}>
                  Continue <ArrowRight className="size-3.5" />
                </Button>
              ) : (
                <Button
                  disabled={!canContinue[4] || onboard.isPending}
                  onClick={() => void start()}
                >
                  {gh ? <Github className="size-3.5" /> : <Workflow className="size-3.5" />}
                  {viaLink
                    ? "Open pull request & send install link"
                    : "Open pull request & start the run"}
                </Button>
              )}
            </div>
          </div>

          <aside className="h-fit space-y-3 lg:sticky lg:top-16">
            <div className="rounded-md border border-border bg-card p-4">
              <p className="text-[13px] font-semibold">{customer.name || "New customer"}</p>
              <dl className="mt-3 space-y-1.5 text-xs">
                <Row k="Offering" v={`${pick.offering.name} v${pick.version.version}`} />
                <Row k="Runs in" v={LANDING_LABEL[arch.topology.landing].title} />
                <Row k="Lands in" v={placement.path.at(-1)?.name ?? "—"} />
                <Row
                  k="Environments"
                  v={envPlans.map((p) => ENV_META[p.env].short).join(" → ") || "—"}
                />
                <Row
                  k="Regions"
                  v={[...new Set(envPlans.map((p) => p.region))].join(", ") || "—"}
                />
                <Row
                  k="Access"
                  v={
                    hosted
                      ? "None needed"
                      : viaLink
                        ? "Install link"
                        : (CONNECTION_LABEL[connection] ?? connection)
                  }
                />
                <Row k="Delivery" v={tool.title} />
              </dl>
              <div className="mt-3 border-t border-border pt-3">
                <p className="text-xs text-muted-foreground">
                  {hosted ? "Your Azure cost for this customer" : "Customer's Azure bill"}{" "}
                  (estimate)
                </p>
                <p className="mt-0.5 font-mono text-lg font-semibold">
                  {currency(quote)}
                  <span className="text-xs font-normal text-muted-foreground"> / month</span>
                </p>
                <p className="text-[11px] text-muted-foreground">
                  List price of the offering's services; non-production at ~30%.
                </p>
              </div>
            </div>
            <ChecksBox
              checks={checks}
              compact
              title={verdict(checks) === "pass" ? "Ready to launch" : undefined}
            />
          </aside>
        </div>
      )}
    </div>
  );
}

function EnvRow({
  plan,
  index,
  regions,
  selected,
  hosted,
  viaLink,
  names,
  onChange,
}: {
  plan: EnvPlan;
  index: number;
  regions: string[];
  selected: Parameters<typeof unsupportedIn>[0];
  hosted: boolean;
  viaLink: boolean;
  names: ReturnType<typeof namesFor>;
  onChange: (p: Partial<EnvPlan>) => void;
}) {
  const meta = ENV_META[plan.env];
  const missing = unsupportedIn(selected, plan.region);
  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-28">
          <p className="text-[13px] font-semibold">{meta.label}</p>
          <p className="text-[11px] text-muted-foreground">
            {meta.prod ? "Gated by reviewers" : "Ring " + (index + 1)}
          </p>
        </div>
        <div className="w-52">
          <Select value={plan.region} onValueChange={(region) => onChange({ region })}>
            <SelectTrigger className={cn("h-8 text-xs", missing.length && "border-danger")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {regions.map((r) => {
                const m = unsupportedIn(selected, r);
                return (
                  <SelectItem key={r} value={r} disabled={m.length > 0}>
                    {regionLabel(r)}
                    {m.length ? ` — no ${m.join(", ")}` : ""}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-1 flex-wrap gap-1">
          {(Object.keys(TARGET_META) as TargetMode[]).map((t) => {
            const disabled = hosted && t !== "new_subscription";
            return (
              <button
                key={t}
                disabled={disabled}
                title={
                  disabled
                    ? "Hosted installs always get a new subscription in your tenant"
                    : TARGET_META[t].body
                }
                onClick={() =>
                  onChange({
                    target: t,
                    ...(t !== "new_subscription" && !plan.subscriptionId && !viaLink
                      ? { subscriptionId: sampleSub(index) }
                      : {}),
                  })
                }
                className={cn(
                  "rounded-sm border px-2 py-1 text-[12px] transition-colors",
                  plan.target === t
                    ? "border-primary bg-primary/5 font-medium text-primary"
                    : "border-border text-muted-foreground hover:text-foreground",
                  disabled && "cursor-not-allowed opacity-40",
                )}
              >
                {TARGET_META[t].title}
              </button>
            );
          })}
        </div>
      </div>
      {plan.target !== "new_subscription" && (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {viaLink ? (
            <p className="text-xs text-muted-foreground sm:col-span-2">
              {plan.target === "existing_resource_group"
                ? "Subscription and resource group"
                : "Subscription"}{" "}
              picked by the customer's admin on the install link.
            </p>
          ) : (
            <>
              <Field
                label="Subscription ID"
                value={plan.subscriptionId}
                onChange={(subscriptionId) => onChange({ subscriptionId })}
                mono
              />
              {plan.target === "existing_resource_group" && (
                <Field
                  label="Resource group"
                  value={plan.resourceGroup}
                  onChange={(resourceGroup) => onChange({ resourceGroup })}
                  hint="Created by the customer; the install gets Contributor on it only."
                  mono
                />
              )}
            </>
          )}
        </div>
      )}
      <p className="mt-2 font-mono text-[10.5px] text-muted-foreground">
        {plan.target === "new_subscription" ? `${names.subscription} · ` : ""}
        {names.resourceGroup} · {names.environment}
        {missing.length ? (
          <span className="ml-2 text-danger">not available: {missing.join(", ")}</span>
        ) : null}
      </p>
    </div>
  );
}

function LaunchView({
  launch,
  name,
  code,
  link,
  viaLink,
  delivery,
  rings,
  canMerge,
  merging,
  onMerge,
}: {
  canMerge: boolean;
  merging: boolean;
  onMerge: () => void;
  launch: Launch;
  name: string;
  code: string;
  link: string;
  viaLink: boolean;
  delivery: Delivery;
  rings: ReturnType<typeof ringsFor>;
}) {
  const failed = launch.steps.some((s) => s.state === "failed");
  return (
    <div className="max-w-4xl space-y-4">
      <div className="rounded-md border border-border bg-card p-5">
        <p className="flex items-center gap-2 text-[15px] font-semibold">
          {!launch.done ? (
            <Loader2 className="size-4 animate-spin text-warning" />
          ) : failed ? (
            <span className="text-danger">●</span>
          ) : (
            <CheckCircle2 className="size-4 text-success" />
          )}
          {!launch.done
            ? `Onboarding ${name}…`
            : failed
              ? `Onboarding ${name} stopped`
              : viaLink
                ? `${name} is ready — waiting for their admin`
                : launch.merged
                  ? launch.runs.some((r) => r.status === "SUCCEEDED")
                    ? `${name} is live in ${launch.runs
                        .filter((r) => r.status === "SUCCEEDED")
                        .map((r) => ENV_META[r.env]?.short)
                        .join(
                          " and ",
                        )}${rings.some((r) => r.gate) ? ` — production is waiting for ${delivery.prodApprovers || "approval"}` : ""}`
                    : `Deploying ${name}…`
                  : `${name} is onboarded — the pull request is ready to merge`}
        </p>
        <ol className="mt-4 space-y-2.5">
          {launch.steps.map((s) => (
            <li key={s.id} className="flex items-start gap-2.5">
              <span className="mt-0.5">
                {s.state === "success" ? (
                  <CheckCircle2 className="size-4 text-success" />
                ) : s.state === "running" ? (
                  <Loader2 className="size-4 animate-spin text-warning" />
                ) : s.state === "failed" ? (
                  <span className="text-danger">✕</span>
                ) : s.state === "waiting" ? (
                  <Lock className="size-4 text-warning" />
                ) : (
                  <Circle className="size-4 text-muted-foreground/50" />
                )}
              </span>
              <div className="min-w-0">
                <p
                  className={cn(
                    "text-[13px] font-medium",
                    s.state === "queued" && "text-muted-foreground",
                  )}
                >
                  {s.label}
                </p>
                <p className="truncate font-mono text-[11px] text-muted-foreground">{s.detail}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-4 border-t border-border pt-3 text-[11px] text-muted-foreground">
          Demo engine: the pull request, environments and credentials are simulated here. Connected
          to a repository, these are the{" "}
          {delivery.tool === "github-actions" ? "GitHub" : "Azure DevOps"} API calls the platform
          makes.
        </p>
      </div>

      <PipelineGraph code={code} rings={rings} delivery={delivery} states={launch.graph} />

      {(canMerge || merging) && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-success/40 bg-success/5 px-4 py-3">
          <div>
            <p className="text-[13px] font-semibold">Checks passed on the pull request</p>
            <p className="text-xs text-muted-foreground">
              Merging deploys{" "}
              {rings
                .filter((r) => !r.gate)
                .map((r) => r.name.toLowerCase())
                .join(", then ")}
              {rings.some((r) => r.gate) ? "; production waits for its reviewers." : "."}
            </p>
          </div>
          <Button disabled={merging} onClick={onMerge}>
            {merging ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <GitMerge className="size-3.5" />
            )}
            {merging ? "Deploying…" : "Merge pull request"}
          </Button>
        </div>
      )}

      {launch.runs.length > 0 && (
        <div className="rounded-md border border-border bg-card">
          <p className="border-b border-border px-4 py-2.5 text-[13px] font-semibold">Runs</p>
          <ul className="divide-y divide-border">
            {launch.runs.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span className="text-[13px]">
                  <b>{ENV_META[r.env]?.label ?? r.env}</b>
                  <span className="ml-2 font-mono text-[11px] text-muted-foreground">
                    {code}-{ENV_META[r.env]?.short}
                  </span>
                </span>
                <span className="flex items-center gap-3">
                  <Pill
                    tone={
                      r.status === "VALIDATION_FAILED" || r.status === "FAILED"
                        ? "danger"
                        : r.status === "SUCCEEDED"
                          ? "success"
                          : "warning"
                    }
                  >
                    {r.status === "SUCCEEDED"
                      ? "Deployed"
                      : r.status === "AWAITING_APPROVAL"
                        ? "Waiting for reviewers"
                        : r.status === "AWAITING_PLAN_APPROVAL"
                          ? "Plan ready"
                          : r.status === "VALIDATION_FAILED"
                            ? "Validation failed"
                            : r.status}
                  </Pill>
                  <Link
                    to="/deployments/$deploymentId"
                    params={{ deploymentId: r.id }}
                    className="text-[12px] font-medium text-primary hover:underline"
                  >
                    Open run →
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {launch.done && viaLink && link && (
        <div className="rounded-md border border-border bg-card p-4">
          <p className="text-[13px] font-semibold">Install link for {name}'s Azure admin</p>
          <p className="mt-1 text-xs text-muted-foreground">
            They sign in, pick the subscriptions for each environment and approve access. The run
            starts automatically when they do.
          </p>
          <div className="mt-3 flex items-center gap-2 rounded-sm border border-border bg-muted/50 px-3 py-2">
            <code className="min-w-0 flex-1 truncate font-mono text-xs">{link}</code>
            <button
              onClick={() => {
                void navigator.clipboard.writeText(link);
                toast.success("Install link copied");
              }}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Copy link"
            >
              <Copy className="size-3.5" />
            </button>
            <a
              href={link}
              target="_blank"
              rel="noreferrer"
              className="text-muted-foreground hover:text-foreground"
              aria-label="Open as customer"
            >
              <ExternalLink className="size-3.5" />
            </a>
          </div>
        </div>
      )}

      {launch.done && launch.customerId && (
        <Link
          to="/customers/$customerId"
          params={{ customerId: launch.customerId }}
          className="inline-flex rounded-sm border border-border px-3 py-1.5 text-[13px] font-medium hover:bg-muted"
        >
          Go to {name}
        </Link>
      )}
    </div>
  );
}

function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-md border border-border bg-card p-4">
      <h2 className="text-[13px] font-semibold">{title}</h2>
      {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Choice({
  on,
  onClick,
  icon,
  title,
  body,
  badge,
}: {
  on: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  body: string;
  badge?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-md border p-3 text-left transition-colors",
        on
          ? "border-primary bg-primary/5 ring-1 ring-primary/30"
          : "border-border hover:border-border-strong",
      )}
    >
      <p className="flex items-center gap-2 text-[13px] font-semibold">
        {icon}
        {title}
        {badge && <Pill tone="primary">{badge}</Pill>}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{body}</p>
    </button>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-2 rounded-sm border border-border px-2.5 py-1.5">
      <span>
        <span className="block text-xs font-medium">{label}</span>
        <span className="block text-[11px] text-muted-foreground">{hint}</span>
      </span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

function Field({
  label,
  value,
  onChange,
  hint,
  mono,
  invalid,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  mono?: boolean;
  invalid?: boolean;
}) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn("mt-1", mono && "font-mono text-xs", invalid && "border-danger")}
      />
      {hint && (
        <p className={cn("mt-1 text-[11px] text-muted-foreground", invalid && "text-danger")}>
          {hint}
        </p>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="truncate text-right font-medium">{v}</dd>
    </div>
  );
}
