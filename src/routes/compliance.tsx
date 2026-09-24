import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { EmptyState, Metric, PageHeader, Panel, Pill, ResultPill, severityTone } from "@/components/Primitives";
import { relative, titleize } from "@/lib/format";
import { complianceQuery, driftQuery, policyPacksQuery } from "@/lib/queries";

export const Route = createFileRoute("/compliance")({
  head: () => ({
    meta: [
      { title: "Compliance · Azure ISV Deployment Factory" },
      {
        name: "description",
        content: "Versioned policy packs, per-control evidence from deployments, and drift findings across every customer environment.",
      },
      { property: "og:title", content: "Compliance · Azure ISV Deployment Factory" },
      { property: "og:description", content: "Policy packs, control evidence and drift across the customer estate." },
    ],
  }),
  component: Compliance,
});

function Compliance() {
  const checks = useQuery(complianceQuery);
  const packs = useQuery(policyPacksQuery);
  const drift = useQuery(driftQuery);
  const [failsOnly, setFailsOnly] = useState(true);

  const rows = (checks.data ?? []).filter((c) => !failsOnly || c.result !== "PASS");
  const total = (checks.data ?? []).length;
  const fails = (checks.data ?? []).filter((c) => c.result === "FAIL").length;
  const openDrift = (drift.data ?? []).filter((d) => d.status === "open");

  return (
    <>
      <PageHeader
        title="Compliance"
        description="Evidence-driven: every control result comes from a recorded deployment or drift scan against a versioned policy pack. No unverifiable certification claims are made."
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Controls evaluated" value={total} />
        <Metric label="Failing controls" value={fails} tone={fails ? "danger" : "success"} />
        <Metric label="Open drift findings" value={openDrift.length} tone={openDrift.length ? "warning" : "success"} />
        <Metric label="Policy packs" value={(packs.data ?? []).length} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Policy packs" description="Versioned and immutable once applied" bodyClassName="p-0">
          <ul className="divide-y divide-border">
            {(packs.data ?? []).map((p) => (
              <li key={p.id} className="px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[13px] font-medium">{p.name}</p>
                  <Pill tone="primary">v{p.version}</Pill>
                </div>
                <p className="text-xs text-muted-foreground">{p.description}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {((p.policy_manifest_json as { controls?: unknown[] } | null)?.controls ?? []).length} controls
                </p>
              </li>
            ))}
            {packs.isLoading && <li className="px-4 py-6 text-sm text-muted-foreground">Loading…</li>}
          </ul>
        </Panel>

        <div className="space-y-4 lg:col-span-2">
          <Panel
            title="Control evidence"
            description={failsOnly ? "Showing failing and warning controls" : "Showing all evaluated controls"}
            actions={
              <button onClick={() => setFailsOnly((v) => !v)} className="text-xs font-medium text-primary hover:underline">
                {failsOnly ? "Show all" : "Show issues only"}
              </button>
            }
            bodyClassName="p-0"
          >
            <div className="max-h-[420px] overflow-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th>Environment</th>
                    <th>Control</th>
                    <th>Evidence</th>
                    <th>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 400).map((c) => {
                    const env = c.environments as { id: string; name: string; customers: { id: string; name: string } } | null;
                    return (
                      <tr key={c.id}>
                        <td>
                          {env?.customers ? (
                            <Link to="/customers/$customerId" params={{ customerId: env.customers.id }} className="font-medium hover:underline">
                              {env.customers.name}
                            </Link>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="text-muted-foreground">{env?.name}</td>
                        <td>
                          <span className="mono-num mr-2 text-muted-foreground">{c.control_key}</span>
                          {c.control_name}
                        </td>
                        <td className="max-w-[320px] truncate text-muted-foreground" title={evidenceText(c.evidence_json)}>
                          {evidenceText(c.evidence_json)}
                        </td>
                        <td>
                          <ResultPill result={c.result} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!rows.length && !checks.isLoading && <EmptyState title="No control issues — the estate is fully compliant." />}
            </div>
          </Panel>

          <Panel title="Drift findings" description="Desired state versus observed state" bodyClassName="p-0">
            <ul className="divide-y divide-border">
              {(drift.data ?? []).map((f) => {
                const env = f.environments as { name: string; customers: { id: string; name: string } } | null;
                return (
                  <li key={f.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[13px] font-medium">
                        {env?.customers?.name} · {env?.name} · {titleize(f.category)}
                      </p>
                      <div className="flex items-center gap-2">
                        <Pill tone={severityTone(f.severity)}>{f.severity}</Pill>
                        <Pill tone={f.status === "open" ? "warning" : "neutral"}>{titleize(f.status)}</Pill>
                      </div>
                    </div>
                    <p className="font-mono text-[11px] break-all text-muted-foreground">{f.resource_id}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      detected {relative(f.detected_at)} · {f.recommended_remediation}
                    </p>
                    {env?.customers && (
                      <Link
                        to="/customers/$customerId"
                        params={{ customerId: env.customers.id }}
                        className="mt-1 inline-block text-xs font-medium text-primary hover:underline"
                      >
                        Resolve on the customer page
                      </Link>
                    )}
                  </li>
                );
              })}
              {!(drift.data ?? []).length && <li className="px-4 py-6 text-sm text-muted-foreground">No drift recorded.</li>}
            </ul>
          </Panel>
        </div>
      </div>
    </>
  );
}

function evidenceText(evidence: unknown): string {
  if (!evidence) return "—";
  if (typeof evidence === "string") return evidence;
  const record = evidence as Record<string, unknown>;
  const note = record["evidence"] ?? record["detail"] ?? record["note"];
  return typeof note === "string" ? note : JSON.stringify(evidence);
}
