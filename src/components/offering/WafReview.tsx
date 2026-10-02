/*
 * The Well-Architected review of a design, as a scorecard (five pillars and overall) and findings grouped by
 * pillar or service, each with the check's result on this design and, where there is one, a one-click fix.
 */
import { ExternalLink } from "lucide-react";
import { useState } from "react";

import { ServiceIcon } from "@/components/architecture/ServiceIcon";
import { Button } from "@/components/ui/button";
import { SERVICE_BY_ID } from "@/lib/catalog";
import { type Finding, PILLARS, PILLAR_TONE, type Pillar, type Review } from "@/lib/waf";
import { cn } from "@/lib/utils";

import { PillarTag, ResultIcon, WafLink } from "./WafGuide";

const scoreTone = (n: number | null) =>
  n === null
    ? "text-muted-foreground"
    : n >= 90
      ? "text-success"
      : n >= 70
        ? "text-warning"
        : "text-danger";

export function WafScorecard({ review, compact }: { review: Review; compact?: boolean }) {
  return (
    <section
      aria-label="Well-Architected score"
      className={cn("rounded-xl border border-border bg-card", compact ? "p-3.5" : "p-4")}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-[13px] font-semibold">Well-Architected</h3>
        <span className={cn("text-[22px] font-bold tabular-nums", scoreTone(review.overall))}>
          {review.overall ?? "–"}
          <span className="text-[12px] font-normal text-muted-foreground">/100</span>
        </span>
      </div>
      <ul className="mt-2.5 space-y-2">
        {review.pillars.map((p) => {
          const meta = PILLARS.find((x) => x.id === p.pillar)!;
          return (
            <li key={p.pillar}>
              <WafLink topic={p.pillar} className="block w-full">
                <span className="flex items-center justify-between text-[12px]">
                  <span className="font-medium">{meta.title}</span>
                  <span className="flex items-center gap-2 tabular-nums text-muted-foreground">
                    {p.fail > 0 && <span className="text-danger">{p.fail} fail</span>}
                    {p.warn > 0 && <span className="text-warning">{p.warn} warn</span>}
                    <span className={cn("font-semibold", scoreTone(p.score))}>
                      {p.score ?? "–"}
                    </span>
                  </span>
                </span>
                <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-muted">
                  <span
                    className="block h-full rounded-full transition-[width]"
                    style={{ width: `${p.score ?? 0}%`, background: PILLAR_TONE[p.pillar] }}
                  />
                </span>
              </WafLink>
            </li>
          );
        })}
      </ul>
      {!compact && (
        <p className="mt-3 text-[11px] text-muted-foreground">
          Checked against this design and its requirements ({review.workload.criticality},{" "}
          {review.workload.slo}% SLO, {review.workload.data} data), not answered as a questionnaire.
        </p>
      )}
    </section>
  );
}

export function WafFindings({
  review,
  onFix,
  only,
  limit,
}: {
  review: Review;
  onFix?: ((f: Finding) => void) | undefined;
  /** Only these results (default: fail and warn). */
  only?: Finding["result"][] | undefined;
  limit?: number | undefined;
}) {
  const [by, setBy] = useState<"pillar" | "service">("pillar");
  const show = only ?? ["fail", "warn"];
  const list = review.findings
    .filter((f) => show.includes(f.result))
    .sort((a, b) => (a.result === b.result ? 0 : a.result === "fail" ? -1 : 1));
  const groups: { key: string; title: React.ReactNode; items: Finding[] }[] =
    by === "pillar"
      ? PILLARS.map((p) => ({
          key: p.id,
          title: <PillarTag pillar={p.id as Pillar} />,
          items: list.filter((f) => f.rec.pillar === p.id),
        }))
      : [...new Set(list.map((f) => f.service ?? "workload"))].map((s) => ({
          key: s,
          title: (
            <span className="flex items-center gap-1.5 text-[12.5px] font-semibold">
              {s !== "workload" && <ServiceIcon id={s} size="sm" />}
              {s === "workload" ? "The workload as a whole" : (SERVICE_BY_ID.get(s)?.name ?? s)}
            </span>
          ),
          items: list.filter((f) => (f.service ?? "workload") === s),
        }));
  let shown = 0;
  return (
    <section aria-label="Well-Architected findings" className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12.5px] text-muted-foreground">
          {list.length ? `${list.length} to look at` : "Nothing failing or to warn about."}
        </p>
        <div className="inline-flex rounded-md border border-border p-0.5 text-[11.5px]">
          {(["pillar", "service"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setBy(k)}
              className={cn(
                "rounded px-2 py-0.5",
                by === k ? "bg-muted font-semibold" : "text-muted-foreground",
              )}
            >
              By {k}
            </button>
          ))}
        </div>
      </div>
      {groups.map((g) => {
        if (!g.items.length || (limit && shown >= limit)) return null;
        const items = limit ? g.items.slice(0, Math.max(0, limit - shown)) : g.items;
        shown += items.length;
        return (
          <div key={g.key}>
            <div className="mb-1.5">{g.title}</div>
            <ul className="space-y-1.5">
              {items.map((f) => (
                <li
                  key={`${f.service ?? "w"}:${f.rec.id}`}
                  className={cn(
                    "flex items-start gap-2.5 rounded-lg border px-3 py-2.5",
                    f.result === "fail"
                      ? "border-danger/30 bg-danger/[0.04]"
                      : "border-warning/30 bg-warning/[0.05]",
                  )}
                >
                  <ResultIcon result={f.result} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[12.5px] font-semibold">
                      {by === "pillar" && f.service && (
                        <span className="mr-1 font-normal text-muted-foreground">
                          {SERVICE_BY_ID.get(f.service)?.short ?? f.service} ·
                        </span>
                      )}
                      {f.rec.title}
                    </p>
                    <p className="mt-0.5 text-[12px] text-muted-foreground">{f.detail}</p>
                    {f.rec.learn && (
                      <a
                        href={f.rec.learn}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                      >
                        <ExternalLink className="size-3" /> Microsoft Learn
                      </a>
                    )}
                  </div>
                  {f.fix && onFix && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 shrink-0"
                      onClick={() => onFix(f)}
                    >
                      {f.fix.label}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}

/** One service's Well-Architected results, compact enough for an inspector. */
export function ServiceWaf({
  service,
  review,
  onFix,
}: {
  service: string;
  review: Review;
  onFix?: ((f: Finding) => void) | undefined;
}) {
  const mine = review.findings.filter((f) => f.service === service);
  const count = (r: Finding["result"]) => mine.filter((f) => f.result === r).length;
  const open = mine
    .filter((f) => f.result === "fail" || f.result === "warn")
    .sort((a, b) => (a.result === b.result ? 0 : a.result === "fail" ? -1 : 1));
  return (
    <section
      aria-label="Well-Architected for this service"
      className="mt-3 rounded-sm border border-border p-2.5"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-medium">Well-Architected</p>
        <p className="text-[11px] text-muted-foreground">
          <span className="text-danger">{count("fail")} fail</span> ·{" "}
          <span className="text-warning">{count("warn")} warn</span> ·{" "}
          <span className="text-success">{count("pass")} pass</span>
        </p>
      </div>
      {open.length === 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">
          Every check for this service passes on this design.
        </p>
      ) : (
        <ul className="mt-1.5 space-y-1.5">
          {open.slice(0, 4).map((f) => (
            <li key={f.rec.id} className="flex items-start gap-1.5">
              <ResultIcon result={f.result} />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium">{f.rec.title}</p>
                <p className="text-[11px] text-muted-foreground">{f.detail}</p>
                {f.fix && onFix && (
                  <button
                    onClick={() => onFix(f)}
                    className="mt-0.5 text-[11px] font-medium text-primary hover:underline"
                  >
                    {f.fix.label}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <WafLink
        topic={service}
        findings={mine}
        onFix={onFix}
        className="mt-2 text-[11px] text-primary hover:underline"
      >
        All {mine.length} recommendations and the pillar trade-offs
      </WafLink>
    </section>
  );
}
