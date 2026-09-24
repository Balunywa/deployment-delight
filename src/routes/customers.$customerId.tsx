import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { Dot, EmptyState, Metric, PageHeader, Panel, Pill, ResultPill, deploymentTone, severityTone } from "@/components/Primitives";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { createDeployment, detectDrift, resolveDrift, runPreflight, validateConnection } from "@/lib/factory.functions";
import { currency, dateTime, relative, titleize } from "@/lib/format";
import { auditQuery, customerQuery } from "@/lib/queries";

export const Route = createFileRoute("/customers/$customerId")({
  head: () => ({
    meta: [
      { title: "Customer · Azure ISV Deployment Factory" },
      {
        name: "description",
        content: "One customer tenant: environments, architecture, deployments, compliance evidence, drift, costs, audit trail and Azure connection.",
      },
      { property: "og:title", content: "Customer · Azure ISV Deployment Factory" },
      { property: "og:description", content: "Environments, architecture, compliance, drift and connection for one customer." },
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
  offerings: { name: string; offering_type: string; network_profile: string; security_profile: string } | null;
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
  compliance_checks: { id: string; control_key: string; control_name: string; result: string; evidence_json: unknown }[];
  deployments: { id: string; status: string; deployment_type: string; desired_version: string | null; requested_at: string; correlation_id: string }[];
};

function CustomerDetail() {
  const { customerId } = Route.useParams();
  const customer = useQuery(customerQuery(customerId));
  const audit = useQuery(auditQuery);
  const queryClient = useQueryClient();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["customer", customerId] });
    queryClient.invalidateQueries({ queryKey: ["deployments"] });
    queryClient.invalidateQueries({ queryKey: ["estate"] });
    queryClient.invalidateQueries({ queryKey: ["drift"] });
    queryClient.invalidateQueries({ queryKey: ["audit"] });
  };

  const preflight = useMutation({
    mutationFn: useServerFn(runPreflight),
    onSuccess: (r: { pass: number; warning: number; blocking: number }) =>
      toast.success(`Preflight: ${r.pass} PASS · ${r.warning} WARNING · ${r.blocking} BLOCKING`),
    onError: (e: Error) => toast.error(e.message),
  });
  const deploy = useMutation({
    mutationFn: useServerFn(createDeployment),
    onSuccess: (r: { deploymentId: string; status: string }) => {
      toast.success(`Deployment created in state ${r.status.replace(/_/g, " ")}.`);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const drift = useMutation({
    mutationFn: useServerFn(detectDrift),
    onSuccess: (r: { newFindings: number }) => {
      toast.success(r.newFindings ? `${r.newFindings} new drift finding(s) recorded.` : "No new drift detected.");
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

  if (customer.isLoading) return <EmptyState title="Loading customer…" />;
  if (!customer.data) return <EmptyState title="Customer not found." />;

  const c = customer.data;
  const envs = ((c.environments ?? []) as unknown as Env[]).sort((a, b) => a.environment_type.localeCompare(b.environment_type));
  const prod = envs.find((e) => e.environment_type === "production") ?? envs[0];
  const connections = (c.customer_connections ?? []) as {
    id: string;
    connection_type: string;
    tenant_id: string | null;
    subscription_id: string | null;
    resource_group_id: string | null;
    management_group_id: string | null;
    credential_reference: string | null;
    status: string;
    last_validated_at: string | null;
  }[];
  const allDrift = envs.flatMap((e) => e.drift_findings.map((f) => ({ ...f, env: e })));
  const openDrift = allDrift.filter((f) => f.status === "open");
  const allDeployments = envs.flatMap((e) => e.deployments.map((d) => ({ ...d, env: e }))).sort((a, b) => b.requested_at.localeCompare(a.requested_at));
  const cost = envs.reduce((s, e) => s + Number(e.monthly_cost_estimate ?? 0), 0);
  const events = (audit.data ?? []).filter((e) => e.customer_id === customerId);
  const manifest = prod?.desired?.manifest_json ?? {};

  return (
    <>
      <PageHeader
        title={c.name}
        description={`${titleize(c.industry ?? "Utility")} · tenant ${c.tenant_id} · code ${c.customer_code}`}
        meta={
          <>
            <Pill tone={c.azure_model === "greenfield" ? "warning" : "neutral"}>
              {c.azure_model === "greenfield" ? "Greenfield baseline (authorized)" : "Existing enterprise landing zone"}
            </Pill>
            <Pill tone="primary">v{prod?.actual?.version ?? "not deployed"}</Pill>
            {openDrift.length > 0 && <Pill tone="warning">{openDrift.length} open drift</Pill>}
          </>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Environments" value={envs.length} hint={envs.map((e) => e.name).join(" · ")} />
        <Metric
          label="Compliance (prod)"
          value={`${prod?.compliance_score ?? 0}%`}
          tone={Number(prod?.compliance_score ?? 0) === 100 ? "success" : "warning"}
        />
        <Metric label="Open drift" value={openDrift.length} tone={openDrift.length ? "warning" : "success"} />
        <Metric label="Estimated monthly" value={currency(cost, { compact: true })} hint="ESTIMATE from offering cost model" />
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="environments">Environments</TabsTrigger>
          <TabsTrigger value="architecture">Architecture</TabsTrigger>
          <TabsTrigger value="deployments">Deployments</TabsTrigger>
          <TabsTrigger value="compliance">Compliance</TabsTrigger>
          <TabsTrigger value="costs">Costs</TabsTrigger>
          <TabsTrigger value="audit">Audit</TabsTrigger>
          <TabsTrigger value="connection">Connection</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4 grid gap-4 lg:grid-cols-2">
          <Panel title="Platform posture">
            <dl className="space-y-1.5 text-xs">
              <KV label="Offering" value={prod?.offerings?.name ?? "—"} />
              <KV label="Deployment model" value={c.azure_model === "greenfield" ? "Greenfield baseline" : "Existing enterprise ALZ"} />
              <KV label="Deployment boundary" value={prod?.deployment_boundary ?? "—"} />
              <KV label="Desired version" value={`v${prod?.desired?.version ?? "—"}`} />
              <KV label="Actual version" value={`v${prod?.actual?.version ?? "not deployed"}`} />
              <KV label="Primary region" value={prod?.region ?? "—"} />
              <KV label="Status" value={titleize(prod?.status ?? "—")} />
            </dl>
          </Panel>
          <Panel title="Open drift findings" bodyClassName="p-0">
            <ul className="divide-y divide-border">
              {openDrift.map((f) => (
                <li key={f.id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[13px] font-medium">{titleize(f.category)}</p>
                    <Pill tone={severityTone(f.severity)}>{f.severity}</Pill>
                  </div>
                  <p className="font-mono text-[11px] break-all text-muted-foreground">{f.resource_id}</p>
                  <div className="mt-1.5 grid gap-1 text-[11px] sm:grid-cols-2">
                    <span className="rounded-sm bg-muted px-2 py-1 text-muted-foreground">
                      expected {JSON.stringify(f.expected_json)}
                    </span>
                    <span className="rounded-sm bg-warning/10 px-2 py-1 text-warning">
                      actual {JSON.stringify(f.actual_json)}
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs text-muted-foreground">{f.recommended_remediation}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {(["remediate", "accept", "ignore", "escalate"] as const).map((action) => (
                      <Button
                        key={action}
                        size="sm"
                        variant={action === "remediate" ? "default" : "outline"}
                        disabled={resolve.isPending}
                        onClick={() => resolve.mutate({ data: { findingId: f.id, action, actor: "Sarah Chen" } })}
                      >
                        {action === "accept" ? "Accept into desired state" : titleize(action)}
                      </Button>
                    ))}
                  </div>
                </li>
              ))}
              {!openDrift.length && <li className="px-4 py-6 text-sm text-muted-foreground">No open drift findings.</li>}
            </ul>
          </Panel>
        </TabsContent>

        <TabsContent value="environments" className="mt-4 space-y-3">
          {envs.map((e) => (
            <Panel
              key={e.id}
              title={`${e.name} · ${titleize(e.environment_type)}`}
              description={`${e.region} · ${e.offerings?.name ?? ""} · boundary ${e.deployment_boundary ?? "—"}`}
              actions={
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" disabled={preflight.isPending} onClick={() => preflight.mutate({ data: { environmentId: e.id } })}>
                    Run preflight
                  </Button>
                  <Button size="sm" variant="outline" disabled={drift.isPending} onClick={() => drift.mutate({ data: { environmentId: e.id } })}>
                    Detect drift
                  </Button>
                  <Button
                    size="sm"
                    disabled={deploy.isPending}
                    onClick={() =>
                      deploy.mutate({
                        data: {
                          environmentId: e.id,
                          deploymentType: e.actual ? "upgrade" : "initial",
                          requestedBy: "Sarah Chen",
                        },
                      })
                    }
                  >
                    {e.actual?.version === e.desired?.version ? "Redeploy" : "Plan deployment"}
                  </Button>
                </div>
              }
            >
              <dl className="grid gap-1.5 text-xs sm:grid-cols-2">
                <KV label="Desired" value={`v${e.desired?.version ?? "—"}`} />
                <KV label="Actual" value={`v${e.actual?.version ?? "not deployed"}`} />
                <KV label="Status" value={titleize(e.status)} />
                <KV label="Compliance" value={`${e.compliance_score}%`} />
                <KV label="Estimated monthly" value={currency(e.monthly_cost_estimate)} />
                <KV label="Open drift" value={String(e.drift_findings.filter((f) => f.status === "open").length)} />
              </dl>
              <pre className="mt-3 overflow-x-auto rounded-sm bg-muted p-2 font-mono text-[11px] text-muted-foreground">
                {JSON.stringify(e.configuration_json ?? {}, null, 2)}
              </pre>
            </Panel>
          ))}
        </TabsContent>

        <TabsContent value="architecture" className="mt-4">
          <Panel
            title={`Blueprint manifest · v${prod?.desired?.version ?? "—"}`}
            description="The declarative manifest for this environment. No per-customer IaC repository exists."
          >
            <pre className="max-h-[560px] overflow-auto rounded-sm bg-muted p-3 font-mono text-[11px] text-muted-foreground">
              {JSON.stringify(manifest, null, 2)}
            </pre>
          </Panel>
        </TabsContent>

        <TabsContent value="deployments" className="mt-4">
          <Panel bodyClassName="p-0" title="Deployment history">
            <ul className="divide-y divide-border">
              {allDeployments.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <Link to="/deployments/$deploymentId" params={{ deploymentId: d.id }} className="text-[13px] font-medium hover:underline">
                      {d.env.name} · {d.deployment_type.replace(/_/g, " ")} → v{d.desired_version ?? "—"}
                    </Link>
                    <p className="font-mono text-[11px] text-muted-foreground">{d.correlation_id}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-xs text-muted-foreground">{relative(d.requested_at)}</span>
                    <Pill tone={deploymentTone(d.status)}>
                      <Dot tone={deploymentTone(d.status)} />
                      {d.status.replace(/_/g, " ")}
                    </Pill>
                  </div>
                </li>
              ))}
              {!allDeployments.length && <li className="px-4 py-6 text-sm text-muted-foreground">No deployments yet.</li>}
            </ul>
          </Panel>
        </TabsContent>

        <TabsContent value="compliance" className="mt-4 space-y-3">
          {envs.map((e) => (
            <Panel key={e.id} title={`${e.name} · ${e.compliance_score}%`} bodyClassName="p-0">
              <ul className="divide-y divide-border">
                {e.compliance_checks.map((check) => (
                  <li key={check.id} className="flex items-start justify-between gap-3 px-4 py-2.5">
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium">
                        <span className="mono-num mr-2 text-muted-foreground">{check.control_key}</span>
                        {check.control_name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {check.evidence_json ? JSON.stringify(check.evidence_json) : "No evidence recorded"}
                      </p>
                    </div>
                    <ResultPill result={check.result} />
                  </li>
                ))}
                {!e.compliance_checks.length && (
                  <li className="px-4 py-5 text-xs text-muted-foreground">No evidence collected yet.</li>
                )}
              </ul>
            </Panel>
          ))}
        </TabsContent>

        <TabsContent value="costs" className="mt-4">
          <Panel title="Estimated consumption" description="ESTIMATE from the offering cost model. Actuals require Azure Cost Management ingestion.">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Environment</th>
                  <th>Type</th>
                  <th className="text-right">Monthly (est.)</th>
                  <th className="text-right">Annual (est.)</th>
                </tr>
              </thead>
              <tbody>
                {envs.map((e) => (
                  <tr key={e.id}>
                    <td className="font-medium">{e.name}</td>
                    <td className="text-muted-foreground">{titleize(e.environment_type)}</td>
                    <td className="mono-num text-right">{currency(e.monthly_cost_estimate)}</td>
                    <td className="mono-num text-right">{currency(Number(e.monthly_cost_estimate ?? 0) * 12)}</td>
                  </tr>
                ))}
                <tr>
                  <td className="font-semibold" colSpan={2}>
                    Total
                  </td>
                  <td className="mono-num text-right font-semibold">{currency(cost)}</td>
                  <td className="mono-num text-right font-semibold">{currency(cost * 12)}</td>
                </tr>
              </tbody>
            </table>
          </Panel>
        </TabsContent>

        <TabsContent value="audit" className="mt-4">
          <Panel bodyClassName="p-0" title="Audit trail" description="Immutable — records cannot be edited or deleted from this portal.">
            <ul className="divide-y divide-border">
              {events.map((e) => (
                <li key={e.id} className="px-4 py-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-mono text-[12px] font-medium">{e.event_type}</p>
                    <span className="text-[11px] text-muted-foreground">{dateTime(e.timestamp)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {e.actor_name ?? "system"} · {e.resource_type ?? ""} {e.resource_id ?? ""} · {e.result ?? "success"}
                  </p>
                </li>
              ))}
              {!events.length && <li className="px-4 py-6 text-sm text-muted-foreground">No audit events for this customer.</li>}
            </ul>
          </Panel>
        </TabsContent>

        <TabsContent value="connection" className="mt-4 space-y-3">
          {connections.map((conn) => (
            <Panel
              key={conn.id}
              title={titleize(conn.connection_type)}
              description="No Azure secrets are stored — only a reference to the customer's Key Vault secret or federated identity."
              actions={
                <div className="flex items-center gap-2">
                  <Pill tone={conn.status === "validated" ? "success" : "warning"}>
                    <Dot tone={conn.status === "validated" ? "success" : "warning"} />
                    {conn.status}
                  </Pill>
                  <Button size="sm" variant="outline" disabled={validate.isPending} onClick={() => validate.mutate({ data: { connectionId: conn.id } })}>
                    Validate connection
                  </Button>
                </div>
              }
            >
              <dl className="grid gap-1.5 text-xs sm:grid-cols-2">
                <KV label="Tenant" value={conn.tenant_id ?? "—"} />
                <KV label="Subscription" value={conn.subscription_id ?? "—"} />
                <KV label="Resource group" value={conn.resource_group_id ?? "—"} />
                <KV label="Management group" value={conn.management_group_id ?? "not supplied"} />
                <KV label="Credential reference" value={conn.credential_reference ?? "—"} />
                <KV label="Last validated" value={conn.last_validated_at ? dateTime(conn.last_validated_at) : "never"} />
              </dl>
            </Panel>
          ))}
          {!connections.length && <EmptyState title="No Azure connection configured for this customer." />}
        </TabsContent>
      </Tabs>
    </>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate text-right font-medium text-foreground">{value}</dd>
    </div>
  );
}
