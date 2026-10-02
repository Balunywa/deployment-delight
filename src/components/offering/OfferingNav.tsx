/*
 * The offering's one navigation: five lifecycle stages (design → build → validate → release → operate), each with
 * its views, so where a tab sits says what it's for. Under it, the one thing to do next and why.
 */
import { ArrowRight, Check } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type OfferingView =
  | "architecture"
  | "flows"
  | "waf"
  | "iac"
  | "pipeline"
  | "inputs"
  | "review"
  | "deploy"
  | "releases"
  | "operate";

export type Tone = "warning" | "success" | "danger" | "muted";

export type Stage = {
  id: "design" | "build" | "validate" | "release" | "operate";
  title: string;
  status: { text: string; tone?: Tone };
  done?: boolean;
  views: { id: OfferingView; label: string }[];
};

const toneText = (t?: Tone) =>
  t === "warning"
    ? "text-warning"
    : t === "success"
      ? "text-success"
      : t === "danger"
        ? "text-danger"
        : "text-muted-foreground";

export function OfferingNav({
  stages,
  view,
  onGo,
}: {
  stages: Stage[];
  view: OfferingView;
  onGo: (v: OfferingView) => void;
}) {
  return (
    <nav aria-label="Offering lifecycle" className="-mb-px flex flex-wrap items-stretch gap-x-1">
      {stages.map((s, i) => {
        const active = s.views.some((v) => v.id === view);
        return (
          <div key={s.id} className="flex items-stretch">
            {i > 0 && (
              <ArrowRight
                aria-hidden
                className="mx-1 mt-3 size-3.5 shrink-0 text-muted-foreground/50"
              />
            )}
            <section aria-label={s.title} className="flex flex-col">
              <button
                onClick={() => onGo(s.views[0]!.id)}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1 text-left transition-colors hover:bg-muted/60",
                )}
                title={`Go to ${s.title}`}
              >
                <span
                  className={cn(
                    "grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-semibold",
                    active
                      ? "bg-primary text-primary-foreground"
                      : s.done
                        ? "bg-success/15 text-success"
                        : "bg-muted text-muted-foreground",
                  )}
                >
                  {s.done && !active ? <Check className="size-3" /> : i + 1}
                </span>
                <span className="leading-tight">
                  <span
                    className={cn(
                      "block text-[12.5px] font-semibold",
                      active ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {s.title}
                  </span>
                  <span className={cn("block text-[10.5px]", toneText(s.status.tone))}>
                    {s.status.text}
                  </span>
                </span>
              </button>
              <div className="mt-1 flex gap-3 px-2 text-[13px]">
                {s.views.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => onGo(v.id)}
                    aria-current={view === v.id ? "page" : undefined}
                    className={cn(
                      "border-b-2 pb-2 whitespace-nowrap transition-colors",
                      view === v.id
                        ? "border-primary font-medium text-foreground"
                        : "border-transparent text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
            </section>
          </div>
        );
      })}
    </nav>
  );
}

/** The one thing to do next, why, and the button that does it. */
export function NextStep({
  title,
  why,
  tone = "muted",
  action,
  secondary,
}: {
  title: string;
  why: ReactNode;
  tone?: Tone;
  action?: { label: string; onClick: () => void; disabled?: boolean } | undefined;
  secondary?: { label: string; onClick: () => void } | undefined;
}) {
  return (
    <section
      aria-label="Next step"
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2.5 lg:px-6",
        tone === "danger"
          ? "border-danger/20 bg-danger/[0.04]"
          : tone === "warning"
            ? "border-warning/25 bg-warning/[0.05]"
            : tone === "success"
              ? "border-success/20 bg-success/[0.04]"
              : "border-border bg-muted/30",
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="text-[13px]">
          <span className="mr-2 text-[10.5px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
            Next step
          </span>
          <span className="font-semibold">{title}</span>
        </p>
        <p className="mt-0.5 text-[12px] text-muted-foreground">{why}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {secondary && (
          <Button size="sm" variant="ghost" onClick={secondary.onClick}>
            {secondary.label}
          </Button>
        )}
        {action && (
          <Button size="sm" onClick={action.onClick} disabled={action.disabled}>
            {action.label} <ArrowRight className="size-3.5" />
          </Button>
        )}
      </div>
    </section>
  );
}
