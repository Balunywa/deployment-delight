/*
 * Realize value: the last step. Is it running in production, what the customer's measures say at 30, 60 and 90
 * days against the baseline, and the business owner's confirmation. Microsoft's commercial view (MSX links, run
 * cost, the milestone update) sits beside it, internal only, and never reaches the customer recap.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  BadgeCheck,
  ClipboardCopy,
  ExternalLink,
  Lock,
  Plus,
  Rocket,
  ScrollText,
  Server,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Pill } from "@/components/Primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  CHECKPOINTS,
  type Engagement,
  type ValueMeasure,
  latestOf,
  measuresOf,
} from "@/lib/engagements";
import { type EngagementInstall, confirmValue } from "@/lib/engagements.functions";
import { cn } from "@/lib/utils";

import type { Apply } from "./Conversation";
import { DeployStatus } from "./Deploy";
import { Card, type CatalogProduct } from "./Prove";

const day = (s: string) =>
  new Date(s).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

function milestoneUpdate(
  e: Engagement,
  products: CatalogProduct[],
  running: EngagementInstall[],
  measures: ValueMeasure[],
) {
  const name = (id: string) => products.find((p) => p.id === id)?.name ?? "Solution";
  const c = e.realization.confirmed;
  const status = c
    ? `Value confirmed by ${c.by} on ${day(c.at)}`
    : running.length
      ? "In production; measuring value"
      : e.decision?.choice === "scale"
        ? "Scaling to production"
        : "Proof in progress";
  const open = e.actions.filter((a) => !a.done);
  const unknowns = e.findings.filter((f) => f.kind === "unknown" || f.kind === "hypothesis");
  return [
    `Milestone update: ${e.name}${e.customer_name ? ` (${e.customer_name})` : ""}`,
    `Status: ${status}`,
    e.brief.outcome ? `Customer outcome: ${e.brief.outcome}` : "",
    e.decision
      ? `Decision: ${e.decision.choice}, by ${e.decision.by} on ${day(e.decision.at)}`
      : "",
    "",
    "In production:",
    ...(running.length
      ? running.map(
          (r) =>
            `- ${name(r.product_id)}: ${r.name}${r.version ? ` v${r.version}` : ""}, since ${day(r.created_at)}`,
        )
      : ["- Not yet"]),
    "",
    "Results against the baseline (customer-measured):",
    ...(measures.filter((m) => m.metric.trim()).length
      ? measures
          .filter((m) => m.metric.trim())
          .map((m) => {
            const l = latestOf(m);
            return `- ${m.metric}${m.unit ? ` (${m.unit})` : ""}: ${m.baseline || "baseline not measured"} → ${l ? `${l.value}, at ${l.when}` : "not measured yet"}${m.target ? `; target ${m.target}` : ""}`;
          })
      : ["- No measures yet"]),
    "",
    "Open next steps:",
    ...(open.length
      ? open.map((a) => `- ${a.text} (${a.owner || "no owner"}, ${a.due || "no date"})`)
      : ["- None"]),
    unknowns.length
      ? `\nOpen risks: ${unknowns.length} (${unknowns
          .slice(0, 2)
          .map((f) => f.text)
          .join(" ")})`
      : "",
  ]
    .filter((l, i, a) => !(l === "" && a[i - 1] === ""))
    .join("\n")
    .trim();
}

export function RealizeView({
  e,
  products,
  installs,
  apply,
  onProve,
}: {
  e: Engagement;
  products: CatalogProduct[];
  installs: EngagementInstall[];
  apply: Apply;
  onProve: () => void;
}) {
  const queryClient = useQueryClient();
  const [measures, setMeasures] = useState<ValueMeasure[]>(() => measuresOf(e));
  const [adoption, setAdoption] = useState(e.realization.adoption ?? "");
  const [metric, setMetric] = useState({ metric: "", unit: "" });
  const [by, setBy] = useState(e.brief.owner ?? "");
  const [note, setNote] = useState("");
  const [opp, setOpp] = useState(e.realization.msx?.opportunity ?? "");
  const [ms, setMs] = useState({ title: "", url: "" });
  const confirm = useMutation({
    mutationFn: useServerFn(confirmValue),
    onSuccess: async () => {
      toast.success("Value confirmed and recorded in the audit log.");
      await queryClient.invalidateQueries({ queryKey: ["engagement", e.id] });
      void queryClient.invalidateQueries({ queryKey: ["engagements"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const chosen = [...new Set(e.solution_map.flatMap((m) => m.products))];
  const prod = installs.filter(
    (i) => chosen.includes(i.product_id) && i.environment_type === "production",
  );
  const cost = prod.reduce((s, i) => s + (i.monthly_cost_estimate ?? 0), 0);
  const scaled = e.stage === "realize" || !!e.realization.confirmed;
  const measured = measures.some((m) => CHECKPOINTS.some(([k]) => m[k].trim()));
  const msx = e.realization.msx ?? {};
  const set = (i: number, k: keyof ValueMeasure, v: string) =>
    setMeasures((ms) => ms.map((m, j) => (j === i ? { ...m, [k]: v } : m)));
  const saveMsx = (patch: NonNullable<Engagement["realization"]["msx"]>, msg: string) =>
    apply({ realization: { ...e.realization, msx: { ...msx, ...patch } } }, msg);
  const update = milestoneUpdate(e, products, prod, measuresOf(e));

  return (
    <div className="space-y-5">
      {!scaled && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3 text-[13px]">
          <span>
            Realizing value starts once the proof is scaled to production.
            {e.decision ? ` The decision was "${e.decision.choice}".` : " No decision yet."}
          </span>
          {!e.decision && (
            <Button size="sm" variant="outline" onClick={onProve}>
              Go to Prove
            </Button>
          )}
        </div>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-5">
          <Card
            title="In production"
            sub="From Cloud Delivery's installed base: what the customer actually runs, not what was proposed."
          >
            {chosen.length ? (
              <ul className="grid gap-3 md:grid-cols-2">
                {chosen.map((id) => {
                  const p = products.find((x) => x.id === id);
                  return (
                    <li key={id} className="rounded-lg border border-border p-4">
                      <span className="text-[13.5px] font-semibold">{p?.name ?? "Solution"}</span>
                      {p && (
                        <DeployStatus
                          e={e}
                          product={p}
                          installs={installs}
                          kind="production"
                          blocked={
                            !e.customer_id
                              ? "Link the engagement to a customer first."
                              : !scaled
                                ? "After the decision to scale it."
                                : undefined
                          }
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-[12.5px] text-muted-foreground">
                Nothing chosen for the proof yet (Fit &amp; gap).
              </p>
            )}
          </Card>

          <Card
            title="Value against the baseline"
            sub="The customer's measures, taken by them, at 30, 60 and 90 days in production. Nothing is filled in for them."
          >
            {measures.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-[12.5px]">
                  <thead className="text-[11px] text-muted-foreground uppercase">
                    <tr>
                      <th className="py-1.5 font-medium">Measure</th>
                      <th className="font-medium">Baseline</th>
                      <th className="font-medium">Target</th>
                      <th className="font-medium">Proof</th>
                      {CHECKPOINTS.map(([k, label]) => (
                        <th key={k} className="font-medium">
                          {label}
                        </th>
                      ))}
                      <th />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {measures.map((m, i) => (
                      <tr key={i}>
                        <td className="py-2 pr-2">
                          <span className="font-medium">{m.metric}</span>
                          {m.unit && <span className="text-muted-foreground"> ({m.unit})</span>}
                        </td>
                        {(["baseline", "target", "proof"] as const).map((k) => (
                          <td key={k} className="pr-2">
                            <Input
                              aria-label={`${m.metric} ${k}`}
                              className="h-8 w-20"
                              placeholder="—"
                              value={m[k]}
                              onChange={(ev) => set(i, k, ev.target.value)}
                            />
                          </td>
                        ))}
                        {CHECKPOINTS.map(([k, label]) => (
                          <td key={k} className="pr-2">
                            <Input
                              aria-label={`${m.metric} at ${label}`}
                              className="h-8 w-20 border-primary/30"
                              placeholder="—"
                              value={m[k]}
                              onChange={(ev) => set(i, k, ev.target.value)}
                            />
                          </td>
                        ))}
                        <td>
                          <button
                            aria-label={`Remove ${m.metric}`}
                            onClick={() => setMeasures((ms) => ms.filter((_, j) => j !== i))}
                            className="text-muted-foreground hover:text-danger"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-[12.5px] text-muted-foreground">
                No measures yet. Add the ones the owner will judge it by.
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <Input
                className="h-8 min-w-0 flex-1 text-[12.5px]"
                placeholder="Add a measure, e.g. planners using it weekly"
                aria-label="New measure"
                value={metric.metric}
                onChange={(ev) => setMetric({ ...metric, metric: ev.target.value })}
              />
              <Input
                className="h-8 w-24 text-[12.5px]"
                placeholder="Unit"
                aria-label="New measure unit"
                value={metric.unit}
                onChange={(ev) => setMetric({ ...metric, unit: ev.target.value })}
              />
              <Button
                size="sm"
                variant="outline"
                disabled={!metric.metric.trim()}
                onClick={() => {
                  setMeasures((ms) => [
                    ...ms,
                    {
                      metric: metric.metric.trim(),
                      unit: metric.unit.trim(),
                      baseline: "",
                      target: "",
                      proof: "",
                      d30: "",
                      d60: "",
                      d90: "",
                    },
                  ]);
                  setMetric({ metric: "", unit: "" });
                }}
              >
                <Plus className="size-3.5" /> Add
              </Button>
            </div>
            <label className="mt-4 block">
              <span className="text-[12.5px] font-medium">Adoption, in their words</span>
              <Textarea
                className="mt-1.5"
                rows={2}
                aria-label="Adoption"
                placeholder="Who uses it, how often, and what they'd miss if it went away"
                value={adoption}
                onChange={(ev) => setAdoption(ev.target.value)}
              />
            </label>
            <div className="mt-3 flex justify-end">
              <Button
                variant="outline"
                onClick={() =>
                  apply(
                    { realization: { ...e.realization, measures, adoption } },
                    "Measures saved.",
                  )
                }
              >
                Save measures
              </Button>
            </div>
          </Card>

          <Card
            title="The owner confirms the value"
            sub="The engagement closes when the business owner agrees the outcome was delivered, in their words."
          >
            {e.realization.confirmed ? (
              <div className="rounded-lg border border-success/30 bg-success/5 px-4 py-3 text-[13px]">
                <p className="flex items-center gap-2 font-semibold">
                  <BadgeCheck className="size-4 text-success" /> Confirmed by{" "}
                  {e.realization.confirmed.by} on {day(e.realization.confirmed.at)}
                </p>
                {e.realization.confirmed.note && (
                  <p className="mt-1 text-muted-foreground italic">
                    “{e.realization.confirmed.note}”
                  </p>
                )}
                <p className="mt-1.5 text-[11.5px] text-muted-foreground">
                  Recorded by {e.realization.confirmed.recordedBy}.
                </p>
              </div>
            ) : (
              <div className="space-y-2.5">
                <Input
                  aria-label="Confirmed by"
                  placeholder="Business owner, name and role"
                  value={by}
                  onChange={(ev) => setBy(ev.target.value)}
                />
                <Textarea
                  rows={2}
                  aria-label="What the owner said"
                  placeholder="What they said, in their words"
                  value={note}
                  onChange={(ev) => setNote(ev.target.value)}
                />
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    disabled={!scaled || !measured || by.trim().length < 2 || confirm.isPending}
                    onClick={() => confirm.mutate({ data: { id: e.id, by, note } })}
                  >
                    <BadgeCheck className="size-4" /> Record the owner's confirmation
                  </Button>
                  <span className="text-[11.5px] text-muted-foreground">
                    {!scaled
                      ? "After the proof is scaled."
                      : !measured
                        ? "After at least one measure in production is saved."
                        : "Recorded with both names in the audit log."}
                  </span>
                </div>
              </div>
            )}
            <Link
              to="/audit"
              className="mt-3 inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground"
            >
              <ScrollText className="size-3" /> Audit log
            </Link>
          </Card>
        </div>

        <div className="space-y-5 lg:sticky lg:top-4">
          <section
            aria-label="Microsoft commercial"
            className="space-y-4 rounded-xl border border-warning/30 bg-warning/[0.05] p-5"
          >
            <p className="flex items-center gap-2 text-[12.5px] font-semibold">
              <Lock className="size-3.5" /> Microsoft commercial · internal only
            </p>
            <div>
              <p className="text-[11.5px] text-muted-foreground">Estimated Azure run cost</p>
              <p className="mt-0.5 text-[20px] font-bold tracking-tight">
                {prod.length ? `$${cost.toLocaleString()}/month` : "Nothing in production"}
              </p>
              <p className="text-[11px] text-muted-foreground">
                The installs' own estimates. Actual consumption is in MSX and Cost Management.
              </p>
            </div>

            <div className="space-y-1.5">
              <p className="text-[12px] font-medium">MSX opportunity</p>
              <div className="flex gap-1.5">
                <Input
                  className="h-8 bg-card text-[12px]"
                  placeholder="Paste the opportunity's link from MSX"
                  aria-label="MSX opportunity link"
                  value={opp}
                  onChange={(ev) => setOpp(ev.target.value)}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8"
                  disabled={opp === (msx.opportunity ?? "") || (!!opp && !/^https:\/\//.test(opp))}
                  onClick={() => saveMsx({ opportunity: opp.trim() }, "Opportunity linked.")}
                >
                  Save
                </Button>
              </div>
              {msx.opportunity && (
                <a
                  href={msx.opportunity}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[11.5px] text-primary hover:underline"
                >
                  <ExternalLink className="size-3" /> Open in MSX
                </a>
              )}
            </div>

            <div className="space-y-1.5">
              <p className="text-[12px] font-medium">Milestones</p>
              {(msx.milestones ?? []).map((m, i) => (
                <div key={m.url} className="flex items-center justify-between gap-2 text-[12px]">
                  <a
                    href={m.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-w-0 items-center gap-1 text-primary hover:underline"
                  >
                    <ExternalLink className="size-3 shrink-0" />
                    <span className="truncate">{m.title}</span>
                  </a>
                  <button
                    aria-label={`Unlink ${m.title}`}
                    onClick={() =>
                      saveMsx(
                        { milestones: (msx.milestones ?? []).filter((_, j) => j !== i) },
                        "Milestone unlinked.",
                      )
                    }
                    className="text-muted-foreground hover:text-danger"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
              ))}
              <Input
                className="h-8 bg-card text-[12px]"
                placeholder="Milestone name"
                aria-label="Milestone name"
                value={ms.title}
                onChange={(ev) => setMs({ ...ms, title: ev.target.value })}
              />
              <div className="flex gap-1.5">
                <Input
                  className="h-8 bg-card text-[12px]"
                  placeholder="Paste the milestone's link from MSX"
                  aria-label="Milestone link"
                  value={ms.url}
                  onChange={(ev) => setMs({ ...ms, url: ev.target.value })}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8"
                  disabled={!ms.title.trim() || !/^https:\/\/\S+$/.test(ms.url.trim())}
                  onClick={() => {
                    saveMsx(
                      {
                        milestones: [
                          ...(msx.milestones ?? []),
                          { title: ms.title.trim(), url: ms.url.trim() },
                        ],
                      },
                      "Milestone linked.",
                    );
                    setMs({ title: "", url: "" });
                  }}
                >
                  <Plus className="size-3.5" /> Link
                </Button>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <p className="text-[12px] font-medium">Milestone update for MSX</p>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7"
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(update)
                      .then(() => toast.success("Copied. Paste it into the milestone in MSX."))
                  }
                >
                  <ClipboardCopy className="size-3.5" /> Copy
                </Button>
              </div>
              <pre
                aria-label="Milestone update"
                className={cn(
                  "mt-1.5 max-h-72 overflow-auto rounded-md border border-border bg-card p-3",
                  "font-sans text-[11.5px] leading-relaxed whitespace-pre-wrap",
                )}
              >
                {update}
              </pre>
            </div>

            <div className="rounded-md border border-dashed border-border bg-card/60 p-3 text-[11.5px] text-muted-foreground">
              <p className="font-medium text-foreground">Live MSX sync: off</p>
              <p className="mt-1">
                Reading the opportunity and milestones, and writing this update back as the
                signed-in seller, needs an app registration approved by the MSX team and runs only
                in Microsoft's corporate tenant. Until then: link and paste.
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
