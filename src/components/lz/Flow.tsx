import { ArrowRight, CircleMinus, CirclePlus, PenLine, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { AlzLibrary, Answers } from "@/lib/alz/engine";
import { type DesignChange, describeChanges, impactOf } from "@/lib/alz/changes";
import { cn } from "@/lib/utils";

export type Step = "assessment" | "design" | "review" | "deploy";

/** Assess → Design → Review → Deploy, with where you are and what each step says right now. */
export function StepBar({
  view,
  onGo,
  status,
}: {
  view: string;
  onGo: (s: Step) => void;
  status: Record<Step, { text: string; tone?: "warning" | "success" | "muted" }>;
}) {
  const steps: [Step, string][] = [
    ["assessment", "Assess"],
    ["design", "Design"],
    ["review", "Review changes"],
    ["deploy", "Deploy"],
  ];
  return (
    <ol className="flex flex-wrap items-stretch gap-1">
      {steps.map(([id, label], i) => (
        <li key={id} className="flex items-center gap-1">
          {i > 0 && <ArrowRight className="size-3.5 text-muted-foreground/60" />}
          <button
            onClick={() => onGo(id)}
            className={cn(
              "flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-left transition-colors",
              view === id
                ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                : "border-border bg-card hover:border-border-strong",
            )}
          >
            <span
              className={cn(
                "grid size-5 place-items-center rounded-full text-[11px] font-semibold",
                view === id
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {i + 1}
            </span>
            <span>
              <span className="block text-[12.5px] font-medium">
                {label}
                {id === "assessment" && (
                  <span className="ml-1 font-normal text-muted-foreground">(optional)</span>
                )}
              </span>
              <span
                className={cn(
                  "block text-[10.5px]",
                  status[id].tone === "warning"
                    ? "text-warning"
                    : status[id].tone === "success"
                      ? "text-success"
                      : "text-muted-foreground",
                )}
              >
                {status[id].text}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}

const ICON = {
  add: <CirclePlus className="size-3.5 shrink-0 text-success" />,
  remove: <CircleMinus className="size-3.5 shrink-0 text-danger" />,
  change: <PenLine className="size-3.5 shrink-0 text-info" />,
};

function jumpTo(c: DesignChange) {
  const target =
    c.section === "mg" || c.section === "landing"
      ? `[data-section="${c.section}"]`
      : c.section === "none"
        ? ""
        : `[data-anchor="sub:${c.section}"]`;
  if (target)
    document.querySelector(target)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/** Sticky bar under the canvas: what the unsaved edits change, and the next step. */
export function ChangeBar({
  lib,
  saved,
  answers,
  saving,
  onDiscard,
  onSave,
}: {
  lib: AlzLibrary;
  saved: Answers;
  answers: Answers;
  saving: boolean;
  onDiscard: () => void;
  onSave: () => void;
}) {
  const changes = describeChanges(saved, answers);
  if (!changes.length) return null;
  const impact = impactOf(lib, saved, answers);
  const bits = [
    impact.groups.added.length &&
      `+${impact.groups.added.length} management group${impact.groups.added.length === 1 ? "" : "s"}`,
    impact.groups.removed.length &&
      `−${impact.groups.removed.length} management group${impact.groups.removed.length === 1 ? "" : "s"}`,
    impact.resources.added.length &&
      `+${impact.resources.added.length} platform resource${impact.resources.added.length === 1 ? "" : "s"}`,
    impact.resources.removed.length &&
      `−${impact.resources.removed.length} platform resource${impact.resources.removed.length === 1 ? "" : "s"}`,
    impact.resources.changed.length &&
      `~${impact.resources.changed.length} platform resource${impact.resources.changed.length === 1 ? "" : "s"} changed`,
    impact.subscriptions.added.length &&
      `+${impact.subscriptions.added.length} subscription${impact.subscriptions.added.length === 1 ? "" : "s"}`,
    impact.subscriptions.removed.length &&
      `−${impact.subscriptions.removed.length} subscription${impact.subscriptions.removed.length === 1 ? "" : "s"}`,
    impact.assignments.before !== impact.assignments.after &&
      `policy assignments ${impact.assignments.before} → ${impact.assignments.after}`,
  ].filter(Boolean);
  return (
    <div className="sticky bottom-0 z-30 mt-3 rounded-md border border-warning/40 bg-card shadow-lg">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold">
            {changes.length} unsaved change{changes.length === 1 ? "" : "s"}
            {bits.length > 0 && (
              <span className="ml-2 font-normal text-muted-foreground">
                In Azure: {bits.join(" · ")}
              </span>
            )}
          </p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {changes.slice(0, 6).map((c) => (
              <button
                key={c.id}
                onClick={() => jumpTo(c)}
                title="Show it on the drawing"
                className="inline-flex items-center gap-1 rounded-sm border border-border bg-background px-1.5 py-0.5 text-[11.5px] hover:border-primary"
              >
                {ICON[c.kind]}
                {c.text}
              </button>
            ))}
            {changes.length > 6 && (
              <span className="px-1 text-[11.5px] text-muted-foreground">
                +{changes.length - 6} more
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button size="sm" variant="ghost" onClick={onDiscard}>
            <RotateCcw className="size-3.5" /> Discard
          </Button>
          <Button size="sm" disabled={saving} onClick={onSave}>
            {saving ? "Saving…" : "Save & review"} <ArrowRight className="size-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Step 3: the saved design compared with what's deployed, in plain words and in Azure terms. */
export function ReviewView({
  lib,
  deployed,
  saved,
  status,
  dirty,
  baselineUnknown,
  onBackToDesign,
  onDeploy,
  onTerraform,
}: {
  lib: AlzLibrary;
  deployed: Answers | null;
  saved: Answers;
  status: string;
  dirty: boolean;
  baselineUnknown: boolean;
  onBackToDesign: () => void;
  onDeploy: () => void;
  onTerraform: () => void;
}) {
  const first = !deployed;
  const changes = deployed ? describeChanges(deployed, saved) : [];
  const impact = impactOf(lib, deployed, saved);
  const nothing = !first && !changes.length;
  const List = ({
    title,
    items,
    kind,
  }: {
    title: string;
    items: string[];
    kind: "add" | "remove";
  }) =>
    items.length ? (
      <div>
        <p className="text-[11px] font-medium text-muted-foreground">{title}</p>
        <ul className="mt-1 space-y-0.5">
          {items.map((x) => (
            <li key={x} className="flex items-center gap-1.5 text-[12.5px]">
              {ICON[kind]}
              {x}
            </li>
          ))}
        </ul>
      </div>
    ) : null;
  return (
    <div className="max-w-4xl space-y-4">
      {dirty && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-warning/40 bg-warning/5 px-4 py-2.5 text-[13px]">
          You have unsaved changes on the canvas. Review covers the saved design.
          <Button size="sm" variant="outline" onClick={onBackToDesign}>
            Back to design
          </Button>
        </div>
      )}
      <section className="rounded-md border border-border bg-card">
        <header className="border-b border-border px-4 py-2.5">
          <h2 className="text-[13px] font-semibold">
            {baselineUnknown
              ? "The saved design, in full"
              : first
                ? "First deployment — everything below will be created"
                : nothing
                  ? "Nothing to deploy — the saved design matches what's in Azure"
                  : `${changes.length} design change${changes.length === 1 ? "" : "s"} since the last deployment`}
          </h2>
          <p className="text-xs text-muted-foreground">
            {baselineUnknown
              ? "This landing zone was deployed before changes were recorded here. The Deploy step's plan compares it with Azure and shows exactly what changes."
              : first
                ? "Nothing from this landing zone exists in Azure yet."
                : status === "deployed" && !changes.length
                  ? "Change something on the design canvas to deploy it."
                  : "Compared with the design that was last applied."}
          </p>
        </header>
        {changes.length > 0 && (
          <ul className="divide-y divide-border">
            {changes.map((c) => (
              <li key={c.id} className="flex items-center gap-2 px-4 py-2 text-[12.5px]">
                {ICON[c.kind]}
                <span className="rounded-sm bg-muted px-1 py-px text-[10px] text-muted-foreground">
                  {c.area}
                </span>
                {c.text}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-md border border-border bg-card p-4">
        <h3 className="text-[13px] font-semibold">What changes in Azure</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Stat
            label="Management groups"
            value={impact.total.groups}
            delta={impact.groups.added.length - impact.groups.removed.length}
            first={first}
          />
          <Stat
            label="Policy assignments"
            value={impact.assignments.after}
            delta={impact.assignments.after - impact.assignments.before}
            first={first}
          />
          <Stat
            label="Platform resources"
            value={impact.total.resources}
            delta={impact.resources.added.length - impact.resources.removed.length}
            first={first}
          />
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <List
            title="Management groups created"
            items={first ? [] : impact.groups.added}
            kind="add"
          />
          <List title="Management groups removed" items={impact.groups.removed} kind="remove" />
          <List
            title={first ? "Platform resources" : "Platform resources created"}
            items={impact.resources.added}
            kind="add"
          />
          <List title="Platform resources removed" items={impact.resources.removed} kind="remove" />
          {!first && impact.resources.changed.length > 0 && (
            <div>
              <p className="text-[11px] font-medium text-muted-foreground">
                Platform resources changed
              </p>
              <ul className="mt-1 space-y-0.5">
                {impact.resources.changed.map((x) => (
                  <li key={x} className="flex items-center gap-1.5 text-[12.5px]">
                    {ICON.change}
                    {x}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <List
            title={first ? "Subscriptions" : "Subscriptions added"}
            items={impact.subscriptions.added}
            kind="add"
          />
          <List title="Subscriptions removed" items={impact.subscriptions.removed} kind="remove" />
        </div>
        <p className="mt-4 text-[11px] text-muted-foreground">
          The Deploy step turns this into a Terraform plan against your tenant, with the exact
          resource count, before anything changes.
        </p>
      </section>

      <div className="flex flex-wrap justify-between gap-2">
        <Button variant="outline" onClick={onBackToDesign}>
          Back to design
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onTerraform}>
            See the Terraform
          </Button>
          <Button disabled={dirty || nothing} onClick={onDeploy}>
            Continue to deploy <ArrowRight className="size-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  delta,
  first,
}: {
  label: string;
  value: number;
  delta: number;
  first: boolean;
}) {
  return (
    <div className="rounded-md border border-border px-3 py-2.5">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="font-mono text-[20px] font-semibold">
        {value}
        {!first && delta !== 0 && (
          <span className={cn("ml-2 text-[13px]", delta > 0 ? "text-success" : "text-danger")}>
            {delta > 0 ? `+${delta}` : delta}
          </span>
        )}
      </p>
    </div>
  );
}
