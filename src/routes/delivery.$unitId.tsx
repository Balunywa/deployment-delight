import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  ArrowLeft,
  ExternalLink,
  FileText,
  GitPullRequest,
  Lock,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { CodeBlock } from "@/components/CodeBlock";
import { UnitStatus } from "@/components/delivery/UnitCard";
import { EmptyState, Pill } from "@/components/Primitives";
import { Button } from "@/components/ui/button";
import { requestUnitVending } from "@/lib/delivery.functions";
import { UNIT_META, isPlatformKind } from "@/lib/delivery/model";
import { relative } from "@/lib/format";
import { deliveryUnitQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/delivery/$unitId")({
  head: () => ({ meta: [{ title: "Delivery unit · Cloud Delivery" }] }),
  component: UnitPage,
});

function UnitPage() {
  const { unitId } = Route.useParams();
  const queryClient = useQueryClient();
  const q = useQuery(deliveryUnitQuery({ unitId }));
  const [file, setFile] = useState<string | null>(null);
  const request = useMutation({
    mutationFn: useServerFn(requestUnitVending),
    onSuccess: (r: { status: string; url: string | null }) => {
      toast.success(
        r.url
          ? "Vending pull request opened on cd-vending."
          : "Vending request recorded. Configure CD_GITHUB_TOKEN to open it as a pull request.",
      );
      void queryClient.invalidateQueries({ queryKey: ["delivery-unit"] });
      void queryClient.invalidateQueries({ queryKey: ["delivery-units"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (q.isLoading) return <EmptyState title="Loading delivery unit…" />;
  if (!q.data) return <EmptyState title="Delivery unit not found" />;
  const { unit: u, findings, files, request: req, org, vendingConfigured } = q.data;
  const spec = u.spec;
  const meta = UNIT_META[u.kind];
  const all = [{ path: `cd-vending/${req.path}`, content: req.content }, ...files];
  const shown = all.find((f) => f.path === file) ?? all[0]!;
  const platform = isPlatformKind(u.kind);

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <Link
        to="/delivery"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" /> Delivery units
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold tracking-[0.16em] text-primary uppercase">
            {meta.label}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h1 className="font-mono text-[22px] font-bold">
              {org}/{u.repository}
            </h1>
            <UnitStatus status={u.status} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {spec.name} · {meta.purpose}
          </p>
          <p className="mt-1 text-xs">
            {u.product_id && (
              <Link
                to="/products/$productId"
                params={{ productId: u.product_id }}
                className="text-primary hover:underline"
              >
                Open the solution
              </Link>
            )}
            {u.customer_id && (
              <Link
                to="/customers/$customerId"
                params={{ customerId: u.customer_id }}
                className="text-primary hover:underline"
              >
                Open the customer
              </Link>
            )}
            {u.foundation_id && (
              <Link
                to="/foundations/$foundationId"
                params={{ foundationId: u.foundation_id }}
                className="text-primary hover:underline"
              >
                Open the landing zone
              </Link>
            )}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          {u.request_url ? (
            <Button asChild variant="outline">
              <a href={u.request_url} target="_blank" rel="noreferrer">
                <GitPullRequest className="size-4" /> Vending pull request
                <ExternalLink className="size-3" />
              </a>
            </Button>
          ) : null}
          {!platform && (
            <Button
              disabled={findings.length > 0 || request.isPending}
              title={findings.length ? "Fix the isolation findings first" : undefined}
              onClick={() => request.mutate({ data: { unitId: u.id } })}
            >
              <GitPullRequest className="size-4" />
              {u.status === "planned" ? "Request vending" : "Update vending request"}
            </Button>
          )}
          <p className="max-w-xs text-right text-[11px] text-muted-foreground">
            {platform
              ? "Platform repositories are bootstrapped once by an org admin."
              : vendingConfigured
                ? `Opens a pull request on ${org}/cd-vending; two approvals apply it.`
                : "Records the request here. With CD_GITHUB_TOKEN set, it opens a pull request on cd-vending."}
            {u.requested_at && ` Last requested ${relative(u.requested_at)} by ${u.requested_by}.`}
          </p>
        </div>
      </header>

      {findings.length > 0 && (
        <div className="rounded-md border border-warning/40 bg-warning/5 p-3 text-xs">
          <p className="flex items-center gap-1.5 font-semibold">
            <AlertTriangle className="size-3.5 text-warning" /> Isolation findings
          </p>
          <ul className="mt-1 list-disc pl-5 text-muted-foreground">
            {findings.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Repository">
          <dl className="space-y-1.5 text-xs">
            <Row k="Visibility">{spec.repository.visibility}</Row>
            <Row k="Branching">{spec.branching}</Row>
            <Row k="Promotion">{spec.promotion}</Row>
            <Row k="Pipeline">
              {spec.pipeline.template ? (
                <span className="font-mono break-all">
                  {org}/cd-delivery-templates/.github/workflows/{spec.pipeline.template}@
                  {spec.pipeline.ref}
                </span>
              ) : (
                "—"
              )}
            </Row>
          </dl>
        </Card>
        <Card title="Custom properties">
          <dl className="space-y-1.5 text-xs">
            {Object.entries(spec.repository.customProperties).map(([k, v]) => (
              <Row key={k} k={k}>
                <span className="font-mono break-all">{v}</span>
              </Row>
            ))}
          </dl>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Org rulesets target repositories by these properties.
          </p>
        </Card>
        <Card title="Team access">
          <ul className="space-y-1.5 text-xs">
            {spec.repository.teams.map((t) => (
              <li key={t.team} className="flex justify-between gap-2">
                <span className="font-mono">@{t.team}</span>
                <span className="text-muted-foreground">{t.permission}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Section
        title="Environments"
        sub="Approvals attach here, not to branches. Plan environments hold a read-only identity and accept any branch; the others deploy from the refs listed."
      >
        <Table
          head={[
            "Environment",
            "Purpose",
            "Required reviewers",
            "Wait",
            "Deploys from",
            "Variables",
          ]}
          rows={spec.environments.map((e) => [
            <span key="n" className="font-mono font-medium">
              {e.name}
            </span>,
            e.purpose,
            e.reviewers.length ? (
              <span key="r" className="inline-flex items-center gap-1">
                <Lock className="size-3 text-warning" />
                {e.reviewers.map((r) => `@${r}`).join(", ")}
                {e.preventSelfReview && (
                  <span className="text-muted-foreground"> · no self-review</span>
                )}
              </span>
            ) : (
              "—"
            ),
            e.waitMinutes ? `${e.waitMinutes} min` : "—",
            <span key="d" className="font-mono">
              {e.deploymentRefs.join(", ")}
            </span>,
            <span
              key="v"
              className="font-mono text-[10.5px]"
              title={JSON.stringify(e.variables, null, 2)}
            >
              {Object.keys(e.variables).join(", ") || "—"}
            </span>,
          ])}
        />
      </Section>

      <Section
        title="Cloud identities"
        sub="One per environment. Each federated credential trusts this repository, that environment and the pinned template — nothing broader."
      >
        <Table
          head={["Identity", "Role", "Lives in", "Scope", "Azure roles", "Federated subject"]}
          rows={spec.identities.map((i) => [
            <span key="n" className="font-mono">
              {i.name}
            </span>,
            <Pill key="r" tone={i.role === "plan" ? "neutral" : "warning"}>
              {i.role === "plan" ? "read-only" : "write"}
            </Pill>,
            i.home === "isv" ? (
              "ISV tenant (vending)"
            ) : (
              <span key="h">
                Customer's tenant
                <span className="block text-[10.5px] text-muted-foreground">
                  created when their admin approves
                </span>
              </span>
            ),
            <span key="s" className="font-mono text-[10.5px] break-all">
              {i.scope}
            </span>,
            i.roles.join(", "),
            <span key="sub" className="font-mono text-[10px] break-all text-muted-foreground">
              {i.subject}
            </span>,
          ])}
        />
      </Section>

      <Section
        title="Terraform state"
        sub="Separate state per environment (and per install for customers), readable only by that environment's identities."
      >
        {spec.state.length ? (
          <Table
            head={["Environment", "Where", "Account / container / key", "Readers"]}
            rows={spec.state.map((s) => [
              <span key="e" className="font-mono">
                {s.environment}
              </span>,
              s.location === "customer"
                ? "Customer's subscription"
                : s.location === "tenant"
                  ? "Tenant's management subscription"
                  : "ISV state account",
              <span key="k" className="font-mono text-[10.5px]">
                {s.storageAccount}/{s.container}/{s.key}
              </span>,
              <span key="r" className="font-mono text-[10.5px]">
                {s.readers.join(", ")}
              </span>,
            ])}
          />
        ) : (
          <p className="text-xs text-muted-foreground">This unit keeps no Terraform state.</p>
        )}
      </Section>

      <Section
        title="Repository content"
        sub="What vending creates and the first pull request adds. The request file is exactly what vending applies — reviewers approve it."
      >
        <div className="grid gap-3 lg:grid-cols-[280px_1fr]">
          <ul className="max-h-[560px] space-y-0.5 overflow-y-auto rounded-md border p-1.5 text-[11.5px]">
            {all.map((f) => (
              <li key={f.path}>
                <button
                  onClick={() => setFile(f.path)}
                  className={cn(
                    "flex w-full items-center gap-1.5 rounded-sm px-1.5 py-1 text-left font-mono",
                    f.path === shown.path ? "bg-primary/10 text-foreground" : "hover:bg-muted",
                  )}
                >
                  {f.path.startsWith("cd-vending/") ? (
                    <ShieldCheck className="size-3.5 shrink-0 text-primary" />
                  ) : (
                    <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <span className="truncate">{f.path}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="min-w-0">
            <CodeBlock title={shown.path} code={shown.content} />
          </div>
        </div>
      </Section>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md border bg-card p-4">
      <h2 className="mb-3 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Section({
  title,
  sub,
  children,
}: {
  title: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-md border bg-card p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[92px_1fr] gap-2">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead className="text-[11px] text-muted-foreground">
          <tr>
            {head.map((h) => (
              <th key={h} className="py-1.5 pr-3 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r, i) => (
            <tr key={i} className="align-top">
              {r.map((c, j) => (
                <td key={j} className="py-2 pr-3">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
