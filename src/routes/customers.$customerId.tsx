import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Copy, ExternalLink } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { ArchitectureCanvas } from "@/components/architecture/ArchitectureCanvas";
import { StageBadge, VersionCell } from "@/components/Fleet";
import {
  Dot,
  EmptyState,
  Metric,
  Panel,
  Pill,
  ResultPill,
  deploymentTone,
  severityTone,
  statusLabel,
} from "@/components/Primitives";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CONNECTION_LABEL, LANDING_LABEL, RUNS_IN, fromManifest } from "@/lib/architecture";
import { inputsFor } from "@/lib/catalog";
import { discoverPlatform } from "@/lib/discovery";
import {
  createDeployment,
  detectDrift,
  resolveDrift,
  runPreflight,
  validateConnection,
} from "@/lib/factory.functions";
import { currency, dateTime, describe, relative, titleize } from "@/lib/format";
import { auditQuery, customerQuery } from "@/lib/queries";
import { useFleet } from "@/lib/use-fleet";
import { CustomerDelivery } from "@/components/onboarding/CustomerDelivery";

export const Route = createFileRoute("/customers/$customerId")({
  head: () => ({
    meta: [
      { title: "Customer · Cloud Delivery" },
      {
        name: "description",
        content:
          "One customer's installs of your product: architecture as bound to their Azure, runs, compliance, drift and access.",
      },
      { property: "og:title", content: "Customer · Cloud Delivery" },
      { property: "og:description", content: "Customer installs, runs, compliance and access." },
    ],
  }),
  component: CustomerDetail,
});

type Env = {
  id: string;
  name: string;
  environment_type: string;
  region: string;
  status: string;
  compliance_score: number;
  monthly_cost_estimate: number | null;
  configuration_json: Record<string, unknown> | null;
  deployment_boundary: string | null;
  offerings: {
    id: string;
    name: string;
    offering_type: string;
    network_profile: string | null;
    security_profile: string;
  } | null;
  desired: { id: string; version: string; manifest_json: Record<string, unknown> } | null;
  actual: { id: string; version: string } | null;
  drift_findings: {
    id: string;
    category: string;
    resource_id: string;
    severity: string;
    status: string;
    expected_json: unknown;
    actual_json: unknown;
    detected_at: string;
    recommended_remediation: string | null;
  }[];
  compliance_checks: {
    id: string;
    control_key: string;
    control_name: string;
    result: string;
    evidence_json: unknown;
  }[];
  deployments: {
    id: string;
    status: string;
    deployment_type: string;
    desired_version: string | null;
    requested_at: string;
    correlation_id: string;
  }[];
};

const ENV_ORDER = ["production", "staging", "uat", "qa", "test", "development"];

function CustomerDetail() {
  const { customerId } = Route.useParams();
  const customer = useQuery(customerQuery(customerId));
  const audit = useQuery(auditQuery);
  const { fleet } = useFleet();
  const queryClient = useQueryClient();
  const [envId, setEnvId] = useState<string | null>(null);

  const invalidate = () => {
    for (const key of [
      ["customer", customerId],
      ["customers"],
      ["deployments"],
      ["estate"],
      ["drift"],
      ["audit"],
    ])
      void queryClient.invalidateQueries({ queryKey: key });
  };

  const preflight = useMutation({
    mutationFn: useServerFn(runPreflight),
    onSuccess: (r: { pass: number; warning: number; blocking: number }) =>
      toast[r.blocking ? "error" : "success"](
        `Landing-zone check: ${r.pass} pass · ${r.warning} warning · ${r.blocking} blocking`,
      ),
    onError: (e: Error) => toast.error(e.message),
  });
  const deploy = useMutation({
    mutationFn: useServerFn(createDeployment),
    onSuccess: (r: { deploymentId: string; status: string }) => {
      toast.success(`Pipeline run created · ${statusLabel(r.status)}`);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const drift = useMutation({
    mutationFn: useServerFn(detectDrift),
    onSuccess: (r: { newFindings: number }) => {
      toast.success(
        r.newFindings
          ? `${r.newFindings} new drift finding(s) recorded.`
          : "No new drift detected.",
      );
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const resolve = useMutation({
    mutationFn: useServerFn(resolveDrift),
    onSuccess: () => {
      toast.success("Drift decision recorded and audited.");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const validate = useMutation({
    mutationFn: useServerFn(validateConnection),
    onSuccess: () => {
      toast.success("Azure connection validated.");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const c = customer.data;
  const envs = useMemo(
    () =>
      ((c?.environments ?? []) as unknown as Env[])
        .slice()
        .sort(
          (a, b) => ENV_ORDER.indexOf(a.environment_type) - ENV_ORDER.indexOf(b.environment_type),
        ),
    [c],
  );
  const env = envs.find((e) => e.id === envId) ?? envs[0];
  const arch = useMemo(() => {
    if (!env?.offerings) return null;
    const a = fromManifest(env.offerings, env.desired?.manifest_json);
    const mode = (env.configuration_json?.["network"] as { mode?: string } | undefined)?.mode;
    if (mode === "existing-customer-hub" || mode === "dedicated-spoke" || mode === "isv-hosted")
      a.topology.landing = mode;
    a.topology.regions = [env.region];
    return a;
  }, [env]);

  if (customer.isLoading) return <EmptyState title="Loading customer…" />;
  if (!c) return <EmptyState title="Customer not found." />;

  const fc = fleet.find((f) => f.id === customerId);
  const connections = (c.customer_connections ?? []) as {
    id: string;
    connection_type: string;
    tenant_id: string | null;
    subscription_id: string | null;
    resource_group_id: string | null;
    credential_reference: string | null;
    status: string;
    last_validated_at: string | null;
  }[];
  const conn = connections[0];
  const allDrift = envs.flatMap((e) => e.drift_findings.map((f) => ({ ...f, env: e })));
  const openDrift = allDrift.filter((f) => f.status === "open");
  const runs = envs
    .flatMap((e) => e.deployments.map((d) => ({ ...d, env: e })))
    .sort((a, b) => b.requested_at.localeCompare(a.requested_at));
  const cost = envs.reduce((s, e) => s + Number(e.monthly_cost_estimate ?? 0), 0);
  const events = (audit.data ?? []).filter((e) => e.customer_id === customerId);
  const bindings: Record<string, string> = {
    ...((env?.configuration_json?.["inputs"] ?? {}) as Record<string, string>),
    ...(conn?.subscription_id ? { subscriptionId: conn.subscription_id } : {}),
  };
  const network = (env?.configuration_json?.["network"] ?? {}) as Record<string, unknown>;
  const observability = (env?.configuration_json?.["observability"] ?? {}) as Record<
    string,
    unknown
  >;
  if (network["vnetId"] && !bindings["vnetId"]) bindings["vnetId"] = String(network["vnetId"]);
  if (observability["logAnalyticsWorkspaceId"] && !bindings["logAnalyticsWorkspaceId"])
    bindings["logAnalyticsWorkspaceId"] = String(observability["logAnalyticsWorkspaceId"]);
  const required = arch ? inputsFor(arch.selected, arch.topology) : [];
  // Seeded installs predate binding capture; show what discovery resolves for installs already live.
  if (env?.actual) {
    const found = discoverPlatform(c.customer_code, conn?.subscription_id ?? "");
    for (const i of required)
      if (!bindings[i.key] && found[i.key]?.[0]) bindings[i.key] = found[i.key]?.[0] as string;
  }
  const deviations = fc?.installs.find((i) => i.id === env?.id)?.deviations ?? [];
  const link =
    typeof window !== "undefined"
      ? `${window.location.origin}/connect/${customerId}`
      : `/connect/${customerId}`;

  return (
    <>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs text-muted-foreground">
            <Link to="/customers" className="hover:underline">
              Customers
            </Link>{" "}
            / {c.customer_code}
          </p>
          <h1 className="mt-0.5 text-[22px] font-semibold">{c.name}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            {fc && <StageBadge stage={fc.stage} />}
            <span>{titleize(c.industry ?? "Utility")}</span>
            <span>{RUNS_IN[c.azure_model] ?? c.azure_model}</span>
            <span className="font-mono">
              {c.azure_model === "isv_hosted"
                ? "no customer Azure needed"
                : `tenant ${c.tenant_id ? `${c.tenant_id.slice(0, 8)}…` : "not connected"}`}
            </span>
          </div>
        </div>
        <div className="flex gap-2">
          {envs.map((e) => (
            <button
              key={e.id}
              onClick={() => setEnvId(e.id)}
              className={`w-24 rounded-md border p-1.5 text-left transition-colors ${e.id === env?.id ? "border-primary ring-1 ring-primary/30" : "border-border hover:border-border-strong"}`}
            >
              <p className="mb-1 text-[11px] font-medium">{e.name}</p>
              <VersionCell install={fc?.installs.find((i) => i.id === e.id)} />
            </button>
          ))}
        </div>
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label={`${env?.name ?? "Install"} release`}
          value={env?.actual ? `v${env.actual.version}` : "—"}
          hint={
            env?.desired && env.desired.version !== env.actual?.version
              ? `Target v${env.desired.version}`
              : "On target release"
          }
        />
        <Metric
          label="Compliance"
          value={`${env?.compliance_score ?? 0}%`}
          tone={Number(env?.compliance_score ?? 0) === 100 ? "success" : "warning"}
          hint="Evidence from the last run and scans"
        />
        <Metric
          label="Open drift"
          value={openDrift.length}
          tone={openDrift.length ? "warning" : "success"}
          hint={openDrift.length ? "Decide on the Drift tab" : "Matches desired state"}
        />
        <Metric
          label="Customer's Azure bill (est.)"
          value={currency(cost, { compact: true })}
          hint="All environments · list-price estimate"
        />
      </div>

      <Tabs defaultValue="architecture">
        <TabsList className="flex-wrap">
          <TabsTrigger value="architecture">Architecture</TabsTrigger>
          <TabsTrigger value="delivery">Delivery</TabsTrigger>
          <TabsTrigger value="runs">Runs · {runs.length}</TabsTrigger>
          <TabsTrigger value="drift">
            Drift & compliance{openDrift.length ? ` · ${openDrift.length}` : ""}
          </TabsTrigger>
          <TabsTrigger value="access">Access</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="architecture" className="mt-4">
          {env && arch ? (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
              <div>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">
                    {env.offerings?.name} v{env.desired?.version} as bound to {c.name} ·{" "}
                    {LANDING_LABEL[arch.topology.landing].title}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={preflight.isPending}
                      onClick={() => preflight.mutate({ data: { environmentId: env.id } })}
                    >
                      Check landing zone
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={drift.isPending}
                      onClick={() => drift.mutate({ data: { environmentId: env.id } })}
                    >
                      Detect drift
                    </Button>
                    <Button
                      size="sm"
                      disabled={deploy.isPending}
                      onClick={() =>
                        deploy.mutate({
                          data: {
                            environmentId: env.id,
                            deploymentType: env.actual ? "upgrade" : "initial",
                            requestedBy: "Sarah Chen",
                          },
                        })
                      }
                    >
                      {env.actual?.version === env.desired?.version
                        ? "Re-run pipeline"
                        : env.actual
                          ? `Plan upgrade to v${env.desired?.version}`
                          : "Plan initial deploy"}
                    </Button>
                  </div>
                </div>
                <ArchitectureCanvas
                  selected={arch.selected}
                  topology={arch.topology}
                  bindings={bindings}
                  installName={`${c.customer_code}-${env.name.toLowerCase()}`}
                />
              </div>
              <div className="space-y-4">
                <Panel
                  title="Bindings"
                  description="Everything that is specific to this customer"
                  bodyClassName="p-0"
                >
                  <ul className="divide-y divide-border">
                    {required.map((i) => (
                      <li key={i.key} className="px-4 py-2">
                        <p className="text-xs text-muted-foreground">{i.label}</p>
                        <p
                          className="truncate font-mono text-[11.5px]"
                          title={bindings[i.key] ?? ""}
                        >
                          {bindings[i.key] ? (
                            String(bindings[i.key]).split("/").slice(-1)[0]
                          ) : (
                            <span className="text-warning">not bound yet</span>
                          )}
                        </p>
                      </li>
                    ))}
                  </ul>
                </Panel>
                <Panel
                  title="Customizations"
                  description="How this install differs from the standard product"
                >
                  {deviations.length ? (
                    <ul className="space-y-2 text-xs">
                      {deviations.map((d) => (
                        <li key={d.key} className="flex items-start justify-between gap-2">
                          <span>{d.label}</span>
                          <Pill
                            tone={
                              d.kind === "exception"
                                ? "danger"
                                : d.kind === "drift"
                                  ? "warning"
                                  : "info"
                            }
                          >
                            {d.actual}
                          </Pill>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      None — a pure product install. Upgrades apply without customer-specific
                      review.
                    </p>
                  )}
                </Panel>
              </div>
            </div>
          ) : (
            <EmptyState title="No installs yet." />
          )}
        </TabsContent>

        <TabsContent value="runs" className="mt-4">
          <Panel bodyClassName="p-0">
            <ul className="divide-y divide-border">
              {runs.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <Link
                      to="/deployments/$deploymentId"
                      params={{ deploymentId: d.id }}
                      className="text-[13px] font-medium hover:underline"
                    >
                      {statusLabel(d.deployment_type)} · {d.env.name} → v{d.desired_version ?? "—"}
                    </Link>
                    <p className="font-mono text-[11px] text-muted-foreground">
                      {d.correlation_id.slice(0, 8)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="text-xs text-muted-foreground">
                      {relative(d.requested_at)}
                    </span>
                    <Pill tone={deploymentTone(d.status)}>
                      <Dot tone={deploymentTone(d.status)} />
                      {statusLabel(d.status)}
                    </Pill>
                  </div>
                </li>
              ))}
              {!runs.length && (
                <li className="px-4 py-6 text-sm text-muted-foreground">No pipeline runs yet.</li>
              )}
            </ul>
          </Panel>
        </TabsContent>

        <TabsContent value="drift" className="mt-4 grid gap-4 lg:grid-cols-2">
          <Panel
            title="Open drift"
            description="Differences between desired state and what is running"
            bodyClassName="p-0"
          >
            <ul className="divide-y divide-border">
              {openDrift.map((f) => (
                <li key={f.id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[13px] font-medium">
                      {titleize(f.category)} · {f.env.name}
                    </p>
                    <Pill tone={severityTone(f.severity)}>{titleize(f.severity)}</Pill>
                  </div>
                  <p
                    className="truncate font-mono text-[11px] text-muted-foreground"
                    title={f.resource_id}
                  >
                    {f.resource_id.split("/").slice(-1)[0]}
                  </p>
                  <div className="mt-1.5 grid gap-1 text-[11px] sm:grid-cols-2">
                    <span className="rounded-sm bg-muted px-2 py-1 text-muted-foreground">
                      Desired · {describe(f.expected_json)}
                    </span>
                    <span className="rounded-sm bg-warning/10 px-2 py-1 text-warning">
                      Running · {describe(f.actual_json)}
                    </span>
                  </div>
                  {f.recommended_remediation && (
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      {f.recommended_remediation}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {(["remediate", "accept", "ignore", "escalate"] as const).map((action) => (
                      <Button
                        key={action}
                        size="sm"
                        variant={action === "remediate" ? "default" : "outline"}
                        disabled={resolve.isPending}
                        onClick={() =>
                          resolve.mutate({ data: { findingId: f.id, action, actor: "Sarah Chen" } })
                        }
                      >
                        {action === "accept" ? "Accept as customization" : titleize(action)}
                      </Button>
                    ))}
                  </div>
                </li>
              ))}
              {!openDrift.length && (
                <li className="px-4 py-6 text-sm text-muted-foreground">No open drift.</li>
              )}
            </ul>
          </Panel>
          <Panel
            title={`Compliance · ${env?.name ?? ""}`}
            description="Evidence-backed controls from the policy pack"
            bodyClassName="p-0"
          >
            <ul className="divide-y divide-border">
              {(env?.compliance_checks ?? []).map((check) => (
                <li key={check.id} className="flex items-start justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium">
                      <span className="mr-2 font-mono text-[11px] text-muted-foreground">
                        {check.control_key}
                      </span>
                      {check.control_name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {check.evidence_json ? describe(check.evidence_json) : "No evidence recorded"}
                    </p>
                  </div>
                  <ResultPill result={check.result} />
                </li>
              ))}
              {!(env?.compliance_checks ?? []).length && (
                <li className="px-4 py-6 text-sm text-muted-foreground">
                  No checks recorded for this install.
                </li>
              )}
            </ul>
          </Panel>
        </TabsContent>

        <TabsContent value="delivery" className="mt-4">
          <CustomerDelivery
            code={c.customer_code}
            envs={envs}
            subscriptionId={conn?.subscription_id ?? null}
            hosted={c.azure_model === "isv_hosted"}
          />
        </TabsContent>

        <TabsContent value="access" className="mt-4 grid gap-4 lg:grid-cols-2">
          <Panel
            title="Azure access"
            description="How your pipeline reaches this customer's Azure. No secrets are stored."
          >
            {conn ? (
              <>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[13px] font-semibold">
                    {CONNECTION_LABEL[conn.connection_type] ?? titleize(conn.connection_type)}
                  </p>
                  <Pill tone={conn.status === "validated" ? "success" : "warning"}>
                    {conn.status === "validated" ? "Validated" : "Waiting on customer"}
                  </Pill>
                </div>
                <dl className="mt-3 space-y-1.5 text-xs">
                  <KV label="Tenant" value={conn.tenant_id ?? "—"} />
                  <KV label="Subscription" value={conn.subscription_id ?? "—"} />
                  <KV label="Credential" value={conn.credential_reference ?? "managed identity"} />
                  <KV
                    label="Last validated"
                    value={conn.last_validated_at ? relative(conn.last_validated_at) : "never"}
                  />
                </dl>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3"
                  disabled={validate.isPending}
                  onClick={() => validate.mutate({ data: { connectionId: conn.id } })}
                >
                  Test connection
                </Button>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No connection recorded.</p>
            )}
          </Panel>
          {c.azure_model === "isv_hosted" ? (
            <Panel
              title="Hosted in your Azure"
              description="This customer doesn't need Azure of their own"
            >
              <p className="text-[13px] text-muted-foreground">
                Every install for {c.name} runs in a dedicated subscription in your Azure. Their
                users only need to sign in with their work accounts — there is no install link and
                no access for their IT team to grant.
              </p>
            </Panel>
          ) : (
            <Panel
              title="Customer install link"
              description="What the customer's Azure admin opens to review the architecture and grant access"
            >
              <div className="flex items-center gap-2 rounded-sm border border-border bg-muted/50 px-3 py-2">
                <code className="min-w-0 flex-1 truncate font-mono text-xs">{link}</code>
                <button
                  onClick={() => {
                    void navigator.clipboard.writeText(link);
                    toast.success("Install link copied");
                  }}
                  aria-label="Copy install link"
                  className="text-muted-foreground hover:text-foreground"
                >
                  <Copy className="size-3.5" />
                </button>
              </div>
              <a
                href={`/connect/${customerId}?preview=1`}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
              >
                <ExternalLink className="size-3" /> Preview what the customer sees
              </a>
            </Panel>
          )}
        </TabsContent>

        <TabsContent value="activity" className="mt-4">
          <Panel bodyClassName="p-0">
            <ul className="divide-y divide-border">
              {events.map((e) => (
                <li key={e.id} className="flex items-baseline justify-between gap-3 px-4 py-2.5">
                  <p className="text-[13px]">
                    <span className="font-medium">{e.actor_name ?? "system"}</span>{" "}
                    <span className="text-muted-foreground">
                      {e.event_type.replace(/[._]/g, " ")}
                    </span>
                  </p>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {dateTime(e.timestamp)}
                  </span>
                </li>
              ))}
              {!events.length && (
                <li className="px-4 py-6 text-sm text-muted-foreground">No activity yet.</li>
              )}
            </ul>
          </Panel>
        </TabsContent>
      </Tabs>
    </>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate text-right font-mono text-[11.5px]">{value}</dd>
    </div>
  );
}
