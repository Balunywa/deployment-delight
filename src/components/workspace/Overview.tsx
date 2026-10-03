/*
 * Overview of an active engagement: where it is, the outcome and how success is proven, the next decision, the
 * working hypothesis and what's been tested, every meeting, decisions versus open topics, and open actions.
 */
import { CalendarCheck, CalendarClock, Check } from "lucide-react";

import { cn } from "@/lib/utils";
import { ENGAGEMENT_TYPES, PURPOSES } from "@/lib/playbook";
import { PHASES, phaseOf } from "@/lib/workspace";

import { Chip, Panel } from "./ui";
import { day, useWs } from "./ws";

export function OverviewView() {
  const { e, go } = useWs();
  const w = e.workspace;
  const c = w.charter;
  const phase = phaseOf(e);
  const at = PHASES.findIndex((p) => p.key === phase);
  const plans = w.plans ?? [];
  const decisions = plans.flatMap((p) =>
    (p.review?.decisions ?? []).map((d) => ({ ...d, meeting: p.title })),
  );
  const assumptions = w.pov?.assumptions ?? [];
  const open = e.actions.filter((a) => !a.done);
  const empty = !c?.outcome.trim() && !w.pov && !plans.length && !open.length;

  if (empty)
    return (
      <div className="space-y-4">
        <Panel
          title="Start here"
          sub="Nothing prepared for this engagement yet. Three steps get you ready for a useful conversation."
          tone="primary"
        >
          <ol className="grid gap-3 md:grid-cols-3">
            {(
              [
                [
                  "context",
                  "1. Understand the context",
                  "What MSX and your notes say, and what isn't confirmed yet.",
                ],
                [
                  "pov",
                  "2. Shape a point of view",
                  "A hypothesis to test, drafted from the evidence.",
                ],
                [
                  "plan",
                  "3. Prepare the conversation",
                  "Purpose, opening, questions and an agenda that fits the time.",
                ],
              ] as const
            ).map(([tab, title, sub]) => (
              <li key={tab}>
                <button
                  type="button"
                  onClick={() => go(tab)}
                  className="h-full w-full rounded-lg border border-border bg-card p-3 text-left transition-colors hover:border-primary"
                >
                  <span className="block text-[13.5px] font-semibold">{title}</span>
                  <span className="mt-0.5 block text-[12px] text-muted-foreground">{sub}</span>
                </button>
              </li>
            ))}
          </ol>
        </Panel>
      </div>
    );

  return (
    <div className="space-y-4">
      <ol aria-label="Phases" className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {PHASES.map((p, i) => (
          <li
            key={p.key}
            aria-current={p.key === phase ? "step" : undefined}
            className={cn(
              "rounded-lg border px-3 py-2",
              p.key === phase
                ? "border-primary bg-primary/5"
                : i < at
                  ? "border-border bg-muted/40"
                  : "border-border",
            )}
          >
            <p className="flex items-center gap-1 text-[12.5px] font-semibold">
              {i < at && <Check className="size-3 text-success" />} {p.title}
            </p>
            <p className="text-[11px] text-muted-foreground">{p.sub}</p>
          </li>
        ))}
      </ol>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="Outcome"
          actions={
            <button
              type="button"
              className="text-[12px] text-primary hover:underline"
              onClick={() => go("charter")}
            >
              Engagement plan
            </button>
          }
        >
          {c ? (
            <div className="space-y-2 text-[13px]">
              <p>{c.outcome || <span className="text-muted-foreground">Not written yet.</span>}</p>
              {c.objective && (
                <p className="text-foreground/80">Technical objective: {c.objective}</p>
              )}
              <p className="text-[12px] text-muted-foreground">
                {ENGAGEMENT_TYPES[c.type].label}
                {c.sponsor && ` · sponsor ${c.sponsor}`}
                {c.targetDate && ` · target ${day(c.targetDate)}`}
              </p>
              {c.success.length > 0 && (
                <ul className="space-y-1 text-[12.5px]">
                  {c.success.map((s) => (
                    <li key={s.id}>
                      <span className="font-medium">{s.criterion}</span>
                      {s.evidence && (
                        <span className="text-muted-foreground"> · evidence: {s.evidence}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {c.nextDecision.what && (
                <p className="rounded-md bg-muted/60 px-2.5 py-1.5 text-[12.5px]">
                  <span className="font-medium">Next decision:</span> {c.nextDecision.what}
                  {c.nextDecision.when && ` (by ${day(c.nextDecision.when)})`}
                </p>
              )}
            </div>
          ) : (
            <p className="text-[12.5px] text-muted-foreground">No engagement plan yet.</p>
          )}
        </Panel>

        <Panel
          title="Working hypothesis"
          actions={
            <button
              type="button"
              className="text-[12px] text-primary hover:underline"
              onClick={() => go("pov")}
            >
              Point of view
            </button>
          }
        >
          {w.pov?.opening ? (
            <p className="text-[13px]">{w.pov.opening}</p>
          ) : (
            <p className="text-[12.5px] text-muted-foreground">Not written yet.</p>
          )}
          {assumptions.length > 0 && (
            <ul className="mt-2 space-y-1 text-[12.5px]">
              {assumptions.map((a) => (
                <li key={a.id} className="flex items-start gap-1.5">
                  <Chip
                    className={cn(
                      a.status === "confirmed" && "bg-success/10 text-success",
                      a.status === "revised" && "bg-info/10 text-info",
                      a.status === "rejected" && "bg-danger/10 text-danger",
                    )}
                  >
                    {a.status === "open" ? "to test" : a.status}
                  </Chip>
                  <span className={cn(a.status === "rejected" && "line-through opacity-70")}>
                    {a.revisedTo || a.text}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel
        title="Meetings"
        actions={
          <button
            type="button"
            className="text-[12px] text-primary hover:underline"
            onClick={() => go("plan")}
          >
            Plan the next one
          </button>
        }
      >
        {plans.length ? (
          <ul className="divide-y divide-border">
            {plans.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2 text-[12.5px]"
              >
                <span className="inline-flex items-center gap-1.5">
                  {p.held ? (
                    <CalendarCheck className="size-3.5 text-success" />
                  ) : (
                    <CalendarClock className="size-3.5 text-muted-foreground" />
                  )}
                  <span className="font-medium">{p.title}</span>
                  <span className="text-muted-foreground">
                    · {PURPOSES[p.purpose].label}
                    {p.date && ` · ${day(p.date)}`}
                  </span>
                </span>
                <span className="text-muted-foreground">
                  {p.review?.at ? (
                    "Findings confirmed"
                  ) : p.held ? (
                    <button
                      type="button"
                      className="text-primary hover:underline"
                      onClick={() => go("findings")}
                    >
                      Confirm findings
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="text-primary hover:underline"
                      onClick={() => go("meeting")}
                    >
                      Open meeting view
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12.5px] text-muted-foreground">No meetings planned.</p>
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Decisions and open topics">
          {decisions.length ? (
            <ul className="space-y-1 text-[12.5px]">
              {decisions.map((d) => (
                <li key={d.id}>
                  <Chip
                    className={d.status === "decided" ? "bg-success/10 text-success" : undefined}
                  >
                    {d.status === "decided" ? "Decided" : "Open"}
                  </Chip>{" "}
                  {d.text} <span className="text-muted-foreground">· {d.meeting}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12.5px] text-muted-foreground">None recorded.</p>
          )}
        </Panel>
        <Panel
          title="Open actions"
          actions={
            <button
              type="button"
              className="text-[12px] text-primary hover:underline"
              onClick={() => go("findings")}
            >
              Edit
            </button>
          }
        >
          {open.length ? (
            <ul className="space-y-1 text-[12.5px]">
              {open.map((a) => (
                <li key={a.id}>
                  {a.text}
                  <span className="text-muted-foreground">
                    {" "}
                    · {a.owner || "no owner"}
                    {a.due ? ` · ${day(a.due)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12.5px] text-muted-foreground">Nothing open.</p>
          )}
        </Panel>
      </div>
    </div>
  );
}
