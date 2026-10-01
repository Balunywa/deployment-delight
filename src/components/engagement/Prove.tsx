/* Prove: deploy the chosen accelerators as a proof, measure against the baseline, and record the decision. */
import { Link } from "@tanstack/react-router";
import { Rocket, ScrollText } from "lucide-react";
import { type ReactNode, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Engagement, Result } from "@/lib/engagements";
import type { EngagementInstall } from "@/lib/engagements.functions";
import { cn } from "@/lib/utils";

export type CatalogProduct = {
  id: string;
  name: string;
  description: string | null;
  outcome: string | null;
};
export type Save = (patch: Record<string, unknown>) => void;

export function Card({
  title,
  sub,
  children,
  className,
  actions,
}: {
  title?: ReactNode;
  sub?: ReactNode;
  children: ReactNode;
  className?: string;
  actions?: ReactNode;
}) {
  return (
    <section
      className={cn(
        "rounded-xl border border-border bg-card p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]",
        className,
      )}
    >
      {(title || actions) && (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title && <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>}
            {sub && <p className="mt-0.5 text-[12.5px] text-muted-foreground">{sub}</p>}
          </div>
          {actions}
        </div>
      )}
      <div className={title || sub ? "mt-4" : ""}>{children}</div>
    </section>
  );
}

/* ---------------------------------------------------------------------------------------------- prove */

export function ProveView({
  e,
  save,
  saving,
  products,
  installs,
}: {
  e: Engagement;
  save: Save;
  saving: boolean;
  products: CatalogProduct[];
  installs: EngagementInstall[];
}) {
  const mapped = [...new Set(e.solution_map.flatMap((m) => m.products))]
    .map((id) => products.find((p) => p.id === id))
    .filter(Boolean) as CatalogProduct[];
  const [results, setResults] = useState<Result[]>(() =>
    e.results.length
      ? e.results
      : (e.brief.baseline ?? [])
          .filter((m) => m.metric.trim())
          .map((m) => ({
            metric: m.metric,
            baseline: m.value,
            target: "",
            measured: "",
            unit: m.unit,
          })),
  );
  const [note, setNote] = useState(e.decision?.note ?? "");
  const setR = (i: number, k: keyof Result, v: string) =>
    setResults((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <div className="space-y-5">
      <Card
        title="Prove it with a PoC"
        sub="Deploy the accelerators chosen in Fit &amp; gap from their pinned releases, into a sandbox or the customer's subscription."
      >
        {mapped.length ? (
          <ul className="grid gap-3 md:grid-cols-2">
            {mapped.map((p) => {
              const running = installs.filter((i) => i.product_id === p.id);
              return (
                <li key={p.id} className="rounded-lg border border-border p-4">
                  <div className="flex items-start justify-between gap-2">
                    <Link
                      to="/products/$productId"
                      params={{ productId: p.id }}
                      className="text-[13.5px] font-semibold hover:text-primary"
                    >
                      {p.name}
                    </Link>
                    <Button asChild size="sm">
                      <Link to="/onboard" search={{ product: p.id }}>
                        <Rocket className="size-3.5" /> Deploy a PoC
                      </Link>
                    </Button>
                  </div>
                  <p className="mt-2 text-[12px] text-muted-foreground">
                    {running.length
                      ? running
                          .map(
                            (r) => `${r.name} · ${r.status}${r.version ? ` · v${r.version}` : ""}`,
                          )
                          .join(" — ")
                      : e.customer_name
                        ? `Not deployed for ${e.customer_name} yet.`
                        : "Not deployed yet."}
                  </p>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-[12.5px] text-muted-foreground">
            Choose an accelerator in Fit &amp; gap first.
          </p>
        )}
      </Card>

      <Card
        title="Measure it"
        sub="Against the baseline captured in the conversation. Targets are agreed with the customer; nothing is filled in for them."
      >
        {results.length ? (
          <table className="w-full text-left text-[12.5px]">
            <thead className="text-[11px] text-muted-foreground uppercase">
              <tr>
                <th className="py-1.5 font-medium">Metric</th>
                <th className="font-medium">Baseline</th>
                <th className="font-medium">Target</th>
                <th className="font-medium">Measured</th>
                <th className="font-medium">Unit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {results.map((r, i) => (
                <tr key={i}>
                  <td className="py-2 pr-2 font-medium">{r.metric}</td>
                  <td className="pr-2">
                    <Input
                      aria-label={`${r.metric} baseline`}
                      className="h-8"
                      placeholder="to measure"
                      value={r.baseline}
                      onChange={(ev) => setR(i, "baseline", ev.target.value)}
                    />
                  </td>
                  <td className="pr-2">
                    <Input
                      aria-label={`${r.metric} target`}
                      className="h-8"
                      placeholder="agree with customer"
                      value={r.target}
                      onChange={(ev) => setR(i, "target", ev.target.value)}
                    />
                  </td>
                  <td className="pr-2">
                    <Input
                      aria-label={`${r.metric} measured`}
                      className="h-8"
                      placeholder="after the PoC"
                      value={r.measured}
                      onChange={(ev) => setR(i, "measured", ev.target.value)}
                    />
                  </td>
                  <td className="text-muted-foreground">{r.unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-[12.5px] text-muted-foreground">
            Ask how they measure the work today (Understand) to add a baseline.
          </p>
        )}
        <div className="mt-3 flex justify-end">
          <Button variant="outline" disabled={saving} onClick={() => save({ results })}>
            Save measures
          </Button>
        </div>
      </Card>

      <Card title="Decide" sub="Every engagement ends in a decision, recorded with who made it.">
        {e.decision && (
          <p className="mb-3 rounded-lg border border-success/30 bg-success/5 px-3 py-2 text-[12.5px]">
            <b className="font-semibold capitalize">{e.decision.choice}</b> · {e.decision.by} ·{" "}
            {new Date(e.decision.at).toLocaleDateString()}
            {e.decision.note ? ` — ${e.decision.note}` : ""}
          </p>
        )}
        <Textarea
          rows={2}
          aria-label="Decision note"
          placeholder="Why, and what happens next"
          value={note}
          onChange={(ev) => setNote(ev.target.value)}
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {(
            [
              ["scale", "Scale it to production"],
              ["iterate", "Iterate on the PoC"],
              ["stop", "Stop here"],
            ] as const
          ).map(([k, label]) => (
            <Button
              key={k}
              variant={k === "scale" ? "default" : "outline"}
              disabled={saving}
              onClick={() => save({ results, decision: { choice: k, note } })}
            >
              {label}
            </Button>
          ))}
          <Link
            to="/audit"
            className="ml-auto inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground"
          >
            <ScrollText className="size-3" /> Recorded in the audit log
          </Link>
        </div>
      </Card>
    </div>
  );
}
