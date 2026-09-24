import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";

import { PageHeader, Panel, Pill, ResultPill } from "@/components/Primitives";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { PreflightResult } from "@/lib/engine/types";
import { createDeployment, onboardCustomer, runPreflight } from "@/lib/factory.functions";
import { currency, titleize } from "@/lib/format";
import { offeringsQuery } from "@/lib/queries";

export const Route = createFileRoute("/onboard")({
  head: () => ({
    meta: [
      { title: "Onboard customer · Azure ISV Deployment Factory" },
      {
        name: "description",
        content: "Guided onboarding: customer, Azure deployment model, connection, network integration, environments, cost preview, preflight, plan and approval.",
      },
      { property: "og:title", content: "Onboard customer · Azure ISV Deployment Factory" },
      { property: "og:description", content: "Guided customer onboarding into an existing or greenfield Azure estate." },
    ],
  }),
  component: Onboard,
});

const STEPS = ["Customer", "Azure model", "Offering", "Networking", "Environments", "Preflight & plan"];
const ENV_TYPES = ["development", "test", "qa", "staging", "production"] as const;

function Onboard() {
  const offerings = useQuery(offeringsQuery);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);

  const [form, setForm] = useState({
    name: "Metro Energy",
    customerCode: "metro-energy-2",
    tenantId: "8f1c2b64-9a71-4c2e-9d55-7c3e1a0b4d21",
    industry: "Electric utility",
    azureModel: "existing_enterprise_alz" as "existing_enterprise_alz" | "greenfield",
    connectionType: "existing_subscription" as
      | "existing_subscription"
      | "new_subscription"
      | "existing_resource_group"
      | "managed_application"
      | "lighthouse"
      | "federated_identity",
    subscriptionId: "2f8a7d11-4c39-4f85-b1de-93c7f6a52e10",
    managementGroupId: "mg-metro-landingzones-corp",
    offeringId: "",
    region: "eastus2",
    secondaryRegion: "centralus",
    environments: ["production"] as (typeof ENV_TYPES)[number][],
    networkMode: "existing-customer-hub" as "existing-customer-hub" | "dedicated-spoke",
    vnetId: "/subscriptions/2f8a7d11/resourceGroups/rg-metro-network/providers/Microsoft.Network/virtualNetworks/vnet-metro-hub",
    privateEndpoints: true,
    publicAccess: false,
    useCustomerWorkspace: true,
    logAnalyticsWorkspaceId: "/subscriptions/2f8a7d11/resourceGroups/rg-metro-mgmt/providers/Microsoft.OperationalInsights/workspaces/law-metro-prod",
  });

  const [created, setCreated] = useState<{ customerId: string; environments: { id: string; name: string }[]; version: string } | null>(null);
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [deployment, setDeployment] = useState<{ id: string; status: string } | null>(null);

  const offeringList = (offerings.data ?? []).filter((o) =>
    ((o.offering_versions ?? []) as { status: string }[]).some((v) => v.status === "published"),
  );
  const offering = offeringList.find((o) => o.id === form.offeringId);
  const publishedVersion = ((offering?.offering_versions ?? []) as { version: string; status: string }[])
    .filter((v) => v.status === "published")
    .sort((a, b) => b.version.localeCompare(a.version))[0];

  const onboard = useMutation({
    mutationFn: useServerFn(onboardCustomer),
    onSuccess: (r) => {
      setCreated(r as typeof created);
      toast.success(`Customer created with ${(r as { environments: unknown[] }).environments.length} environment(s).`);
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      queryClient.invalidateQueries({ queryKey: ["estate"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const preflightRun = useMutation({
    mutationFn: useServerFn(runPreflight),
    onSuccess: (r) => {
      setPreflight(r as PreflightResult);
      const res = r as PreflightResult;
      toast[res.blocking ? "error" : "success"](`${res.pass} PASS · ${res.warning} WARNING · ${res.blocking} BLOCKING`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const createPlan = useMutation({
    mutationFn: useServerFn(createDeployment),
    onSuccess: (r) => {
      const d = r as { deploymentId: string; status: string };
      setDeployment({ id: d.deploymentId, status: d.status });
      toast.success(`Deployment created in state ${d.status.replace(/_/g, " ")}. Approve it on the run page.`);
      queryClient.invalidateQueries({ queryKey: ["deployments"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });


  const firstEnv = created?.environments?.[0];
  const perEnvCost = Number(offering?.estimated_monthly_cost_low ?? 0);
  const costPreview = form.environments.reduce((s, t) => s + (t === "production" ? perEnvCost : perEnvCost * 0.25), 0);

  return (
    <>
      <PageHeader
        title="Onboard customer"
        description="The customer's Azure platform is authoritative. Existing management groups, landing zones, hub networking, DNS, firewall and policy are consumed, never replaced."
        meta={<Pill tone="warning">Demo mode — deployment execution is simulated</Pill>}
      />

      <ol className="mb-4 flex flex-wrap gap-1.5">
        {STEPS.map((label, index) => (
          <li key={label}>
            <button
              onClick={() => setStep(index)}
              className={`rounded-sm border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                index === step
                  ? "border-primary bg-primary/10 text-primary"
                  : index < step
                    ? "border-success/40 text-success"
                    : "border-border text-muted-foreground"
              }`}
            >
              {index + 1}. {label}
            </button>
          </li>
        ))}
      </ol>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          {step === 0 && (
            <Panel title="Customer" description="Identity of the customer tenant you are deploying into.">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Customer name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
                <Field label="Customer code" value={form.customerCode} onChange={(v) => setForm({ ...form, customerCode: v })} hint="lowercase, hyphens" />
                <Field label="Entra tenant ID" value={form.tenantId} onChange={(v) => setForm({ ...form, tenantId: v })} />
                <Field label="Industry" value={form.industry} onChange={(v) => setForm({ ...form, industry: v })} />
              </div>
            </Panel>
          )}

          {step === 1 && (
            <Panel title="Azure deployment model" description="Mode A is the default. Mode B requires explicit authorization and sufficient permissions on the connected identity.">
              <div className="space-y-2">
                {[
                  {
                    id: "existing_enterprise_alz",
                    title: "Existing enterprise Azure (default)",
                    body: "Deploy into the customer's existing landing zone. Their management groups, hub network, DNS, firewall, policy and security tooling remain untouched and authoritative.",
                  },
                  {
                    id: "greenfield",
                    title: "Greenfield baseline (authorized only)",
                    body: "Create a minimal baseline. Only valid when the customer has explicitly authorized it and the connected identity holds the required scope. No tenant-level control is assumed.",
                  },
                ].map((option) => (
                  <button
                    key={option.id}
                    onClick={() => setForm({ ...form, azureModel: option.id as typeof form.azureModel })}
                    className={`w-full rounded-md border p-3 text-left transition-colors ${
                      form.azureModel === option.id ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
                    }`}
                  >
                    <p className="text-[13px] font-semibold">{option.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{option.body}</p>
                  </button>
                ))}
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div>
                  <Label className="text-xs">Connection mode</Label>
                  <Select value={form.connectionType} onValueChange={(v) => setForm({ ...form, connectionType: v as typeof form.connectionType })}>
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {["existing_subscription", "existing_resource_group", "new_subscription", "lighthouse", "managed_application", "federated_identity"].map((t) => (
                        <SelectItem key={t} value={t}>
                          {titleize(t)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Field label="Subscription ID" value={form.subscriptionId} onChange={(v) => setForm({ ...form, subscriptionId: v })} />
                <Field
                  label="Management group (optional)"
                  value={form.managementGroupId}
                  onChange={(v) => setForm({ ...form, managementGroupId: v })}
                  hint="Leave blank if no management group scope was granted"
                />
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                No Azure secret is stored. Onboarding records a federated identity reference to the customer's Key Vault
                secret only.
              </p>
            </Panel>
          )}

          {step === 2 && (
            <Panel title="Offering" description="Only offerings with a published version can be deployed.">
              <div className="space-y-2">
                {offeringList.map((o) => {
                  const version = ((o.offering_versions ?? []) as { version: string; status: string }[])
                    .filter((v) => v.status === "published")
                    .sort((a, b) => b.version.localeCompare(a.version))[0];
                  return (
                    <button
                      key={o.id}
                      onClick={() => setForm({ ...form, offeringId: o.id })}
                      className={`w-full rounded-md border p-3 text-left transition-colors ${
                        form.offeringId === o.id ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[13px] font-semibold">{o.name}</p>
                        <Pill tone="primary">v{version?.version}</Pill>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{o.description}</p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {titleize(o.offering_type)} · {o.deployment_boundary} · {currency(o.estimated_monthly_cost_low)}–
                        {currency(o.estimated_monthly_cost_high)} / month
                      </p>
                    </button>
                  );
                })}
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                  <Label className="text-xs">Primary region</Label>
                  <Select value={form.region} onValueChange={(v) => setForm({ ...form, region: v })}>
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(offering?.supported_regions ?? ["eastus2", "centralus"]).map((r: string) => (
                        <SelectItem key={r} value={r}>
                          {r}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Field label="Secondary region (optional)" value={form.secondaryRegion} onChange={(v) => setForm({ ...form, secondaryRegion: v })} />
              </div>
            </Panel>
          )}

          {step === 3 && (
            <Panel title="Network integration" description="Consume the customer's existing connectivity wherever they provide it.">
              <div className="space-y-3">
                <div>
                  <Label className="text-xs">Connectivity model</Label>
                  <Select value={form.networkMode} onValueChange={(v) => setForm({ ...form, networkMode: v as typeof form.networkMode })}>
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="existing-customer-hub">Existing customer hub / VNet</SelectItem>
                      <SelectItem value="dedicated-spoke">Dedicated spoke created by the offering</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Field label="Existing VNet resource ID" value={form.vnetId} onChange={(v) => setForm({ ...form, vnetId: v })} />
                <Toggle
                  label="Private endpoints for all platform services"
                  checked={form.privateEndpoints}
                  onChange={(v) => setForm({ ...form, privateEndpoints: v })}
                />
                <Toggle label="Allow public network access" checked={form.publicAccess} onChange={(v) => setForm({ ...form, publicAccess: v })} />
                <Toggle
                  label="Send diagnostics to the customer's Log Analytics workspace"
                  checked={form.useCustomerWorkspace}
                  onChange={(v) => setForm({ ...form, useCustomerWorkspace: v })}
                />
                {form.useCustomerWorkspace && (
                  <Field
                    label="Log Analytics workspace resource ID"
                    value={form.logAnalyticsWorkspaceId}
                    onChange={(v) => setForm({ ...form, logAnalyticsWorkspaceId: v })}
                  />
                )}
              </div>
            </Panel>
          )}

          {step === 4 && (
            <Panel title="Environments" description="Each environment gets its own declarative manifest — no per-customer IaC repository is created.">
              <div className="grid gap-2 sm:grid-cols-2">
                {ENV_TYPES.map((type) => (
                  <label key={type} className="flex items-center gap-2 rounded-md border border-border p-2.5 text-[13px]">
                    <Checkbox
                      checked={form.environments.includes(type)}
                      onCheckedChange={(v) =>
                        setForm({
                          ...form,
                          environments: v ? [...form.environments, type] : form.environments.filter((t) => t !== type),
                        })
                      }
                    />
                    {titleize(type)}
                  </label>
                ))}
              </div>

              <div className="mt-4 rounded-md border border-border p-3 text-sm">
                <p className="font-semibold">Cost preview (ESTIMATE)</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {currency(costPreview)} / month · {currency(costPreview * 12)} / year across {form.environments.length}{" "}
                  environment(s), based on the offering cost model.
                </p>
              </div>

              <Button
                className="mt-4"
                disabled={onboard.isPending || !form.offeringId || !form.environments.length}
                onClick={() =>
                  onboard.mutate({
                    data: {
                      name: form.name,
                      customerCode: form.customerCode,
                      tenantId: form.tenantId,
                      industry: form.industry,
                      azureModel: form.azureModel,
                      connectionType: form.connectionType,
                      subscriptionId: form.subscriptionId || undefined,
                      managementGroupId: form.managementGroupId || undefined,
                      offeringId: form.offeringId,
                      region: form.region,
                      secondaryRegion: form.secondaryRegion || undefined,
                      environments: form.environments,
                      network: {
                        mode: form.networkMode,
                        vnetId: form.vnetId || undefined,
                        privateEndpoints: form.privateEndpoints,
                        publicAccess: form.publicAccess,
                      },
                      observability: {
                        useCustomerWorkspace: form.useCustomerWorkspace,
                        logAnalyticsWorkspaceId: form.logAnalyticsWorkspaceId || undefined,
                      },
                    },
                  })
                }
              >
                {onboard.isPending ? "Creating…" : created ? "Customer created" : "Create customer & environments"}
              </Button>
            </Panel>
          )}

          {step === 5 && (
            <Panel
              title="Preflight, plan and approval"
              description="Validation runs first; blocking results forbid deployment. Production plans require explicit approval."
            >
              {!created && <p className="text-sm text-muted-foreground">Complete step 5 to create the customer first.</p>}

              {created && firstEnv && (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" disabled={preflightRun.isPending} onClick={() => preflightRun.mutate({ data: { environmentId: firstEnv.id } })}>
                      Run preflight on {firstEnv.name}
                    </Button>
                    <Button
                      size="sm"
                      disabled={createPlan.isPending || !preflight || preflight.blocking > 0}
                      onClick={() => createPlan.mutate({ data: { environmentId: firstEnv.id, deploymentType: "initial", requestedBy: "Sarah Chen" } })}
                    >
                      Generate plan
                    </Button>
                    {deployment && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => navigate({ to: "/deployments/$deploymentId", params: { deploymentId: deployment.id } })}
                      >
                        Open deployment run
                      </Button>
                    )}
                  </div>

                  {preflight && (
                    <div className="rounded-md border border-border">
                      <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs">
                        <ResultPill result="PASS" />
                        <span className="mono-num">{preflight.pass}</span>
                        <ResultPill result="WARNING" />
                        <span className="mono-num">{preflight.warning}</span>
                        <ResultPill result="BLOCKING" />
                        <span className="mono-num">{preflight.blocking}</span>
                      </div>
                      <ul className="max-h-72 divide-y divide-border overflow-auto">
                        {preflight.checks.map((c) => (
                          <li key={c.key} className="flex items-start justify-between gap-3 px-3 py-2">
                            <div className="min-w-0">
                              <p className="text-[13px] font-medium">{c.name}</p>
                              <p className="text-xs text-muted-foreground">{c.detail}</p>
                            </div>
                            <ResultPill result={c.level} />
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </Panel>
          )}

          <div className="flex justify-between">
            <Button variant="outline" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
              Back
            </Button>
            <Button disabled={step === STEPS.length - 1} onClick={() => setStep((s) => s + 1)}>
              Continue
            </Button>
          </div>
        </div>

        <Panel title="Summary" description="What will be created">
          <dl className="space-y-1.5 text-xs">
            <Row label="Customer" value={form.name} />
            <Row label="Tenant" value={form.tenantId.slice(0, 13) + "…"} />
            <Row label="Azure model" value={form.azureModel === "greenfield" ? "Greenfield baseline" : "Existing enterprise ALZ"} />
            <Row label="Connection" value={titleize(form.connectionType)} />
            <Row label="Offering" value={offering?.name ?? "not selected"} />
            <Row label="Version" value={publishedVersion ? `v${publishedVersion.version}` : "—"} />
            <Row label="Region" value={form.region} />
            <Row label="Environments" value={form.environments.map(titleize).join(", ") || "none"} />
            <Row label="Networking" value={form.networkMode === "existing-customer-hub" ? "Customer hub" : "Dedicated spoke"} />
            <Row label="Private endpoints" value={form.privateEndpoints ? "required" : "disabled"} />
            <Row label="Estimated monthly" value={currency(costPreview)} />
          </dl>
          {created && (
            <div className="mt-3 rounded-md border border-success/40 bg-success/5 p-2.5 text-xs">
              <p className="font-semibold text-success">Customer created on v{created.version}</p>
              <button
                className="mt-1 font-medium text-primary hover:underline"
                onClick={() => navigate({ to: "/customers/$customerId", params: { customerId: created.customerId } })}
              >
                Open customer page
              </button>
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}

function Field({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} className="mt-1" />
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-[13px]">
      {label}
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate text-right font-medium text-foreground">{value}</dd>
    </div>
  );
}
