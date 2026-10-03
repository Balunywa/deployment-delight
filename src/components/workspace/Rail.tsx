/*
 * The workspace's side rail: the one next action, transparent readiness checks (not a score), the working
 * hypothesis, what's still unconfirmed, and open actions. Collapsible; always one click from the work.
 */
import { ArrowRight, Check, Circle } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";
import { type Check as ReadyCheck, allOk, nextAction, readinessOf } from "@/lib/workspace";

import { Chip } from "./ui";
import { useWs } from "./ws";

function Checks({ title, checks }: { title: string; checks: ReadyCheck[] }) {
  const { go } = useWs();
  const ok = allOk(checks);
  const [open, setOpen] = useState(!ok);
  return (
    <div className="rounded-lg border border-border">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[12.5px] font-medium"
      >
        <span className="inline-flex items-center gap-1.5">
          {ok ? (
            <Check className="size-3.5 text-success" />
          ) : (
            <Circle className="size-3.5 text-muted-foreground" />
          )}
          {title}
        </span>
        <span className="text-[11px] text-muted-foreground">
          {checks.filter((c) => c.ok).length}/{checks.length}
        </span>
      </button>
      {open && (
        <ul className="space-y-0.5 border-t border-border px-2 py-1.5">
          {checks.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => go(c.fix)}
                title={c.hint}
                className="flex w-full items-start gap-1.5 rounded px-1 py-1 text-left text-[12px] hover:bg-muted"
              >
                {c.ok ? (
                  <Check className="mt-0.5 size-3 shrink-0 text-success" />
                ) : (
                  <Circle className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
                )}
                <span className={cn(c.ok ? "text-foreground/80" : "text-foreground")}>
                  {c.label}
                  {!c.ok && (
                    <span className="block text-[11px] text-muted-foreground">{c.hint}</span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Rail() {
  const { e, data, go } = useWs();
  const next = nextAction(e);
  const r = readinessOf(e);
  const pov = e.workspace.pov;
  const open = pov?.assumptions.filter((a) => a.status === "open") ?? [];
  const items = data.items;
  const count = (s: string) => items.filter((i) => i.status === s).length;
  const actions = e.actions.filter((a) => !a.done);

  return (
    <aside aria-label="Workspace summary" className="space-y-3">
      <section
        aria-label="Next action"
        className="rounded-xl border border-primary/30 bg-primary/[0.04] p-3.5"
      >
        <p className="text-[11px] font-semibold tracking-wide text-primary uppercase">Next</p>
        <button
          type="button"
          onClick={() => go(next.tab)}
          className="mt-1 flex w-full items-center justify-between gap-2 text-left text-[14px] font-semibold hover:text-primary"
        >
          {next.label} <ArrowRight className="size-4 shrink-0" />
        </button>
        <p className="mt-0.5 text-[12px] text-muted-foreground">{next.why}</p>
      </section>

      <section
        aria-label="Readiness"
        className="space-y-1.5 rounded-xl border border-border bg-card p-3"
      >
        <p className="px-0.5 text-[12.5px] font-semibold">Readiness</p>
        <Checks title="Ready for discovery" checks={r.discovery} />
        <Checks title="Ready for validation" checks={r.validation} />
        <Checks title="Ready for delivery handoff" checks={r.handoff} />
        <p className="px-0.5 text-[11px] text-muted-foreground">
          Discovery can start with unknowns. Checks are guidance, not a score.
        </p>
      </section>

      <section
        aria-label="Working hypothesis"
        className="rounded-xl border border-border bg-card p-3"
      >
        <div className="flex items-center justify-between gap-2">
          <p className="text-[12.5px] font-semibold">Working hypothesis</p>
          <button
            type="button"
            onClick={() => go("pov")}
            className="text-[11.5px] text-primary hover:underline"
          >
            Edit
          </button>
        </div>
        {pov?.opening ? (
          <p className="mt-1 line-clamp-5 text-[12.5px] text-foreground/85">{pov.opening}</p>
        ) : (
          <p className="mt-1 text-[12px] text-muted-foreground">Not written yet.</p>
        )}
        {open.length > 0 && (
          <p className="mt-1.5 text-[11.5px] text-muted-foreground">
            {open.length} assumption{open.length === 1 ? "" : "s"} to test with the customer
          </p>
        )}
      </section>

      {items.length > 0 && (
        <section aria-label="Evidence" className="rounded-xl border border-border bg-card p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[12.5px] font-semibold">Evidence</p>
            <button
              type="button"
              onClick={() => go("context")}
              className="text-[11.5px] text-primary hover:underline"
            >
              Open
            </button>
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1">
            <Chip className="bg-success/10 text-success">{count("confirmed")} confirmed</Chip>
            <Chip className="bg-warning/12 text-[oklch(0.5_0.12_70)]">
              {count("needs-validation")} to validate
            </Chip>
            {count("contradicted") > 0 && (
              <Chip className="bg-danger/10 text-danger">{count("contradicted")} contradicted</Chip>
            )}
            <Chip>{count("unknown")} unknown</Chip>
          </div>
        </section>
      )}

      {actions.length > 0 && (
        <section aria-label="Open actions" className="rounded-xl border border-border bg-card p-3">
          <p className="text-[12.5px] font-semibold">Open actions</p>
          <ul className="mt-1 space-y-1">
            {actions.slice(0, 5).map((a) => (
              <li key={a.id} className="text-[12px]">
                {a.text}
                <span className="text-muted-foreground">
                  {" "}
                  · {a.owner || "no owner"}
                  {a.due ? ` · ${a.due}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  );
}
