/*
 * The five stages of an engagement. Each view edits a local draft and saves it; "Continue" saves and moves the
 * engagement on. Propose is generated from what the other stages captured.
 */
import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Check,
  ClipboardCopy,
  Lock,
  MessageSquareQuote,
  Plus,
  Rocket,
  ScrollText,
  Target,
  Trash2,
} from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { toast } from "sonner";

import { Pill } from "@/components/Primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  type Audience,
  type Brief,
  CONCEPTS,
  type ConceptKey,
  type Engagement,
  type MapItem,
  READINESS,
  type Readiness,
  type ReadinessMap,
  type Result,
  buildStory,
  storyText,
} from "@/lib/engagements";
import type { EngagementInstall } from "@/lib/engagements.functions";
import { cn } from "@/lib/utils";

export type CatalogProduct = {
  id: string;
  name: string;
  description: string | null;
};
export type Save = (patch: Record<string, unknown>, next?: string) => void;

const AUDIENCE_LABEL: Record<Audience, string> = {
  executive: "Customer executive",
  technical: "Technical & field",
  internal: "Internal",
};

function Card({
  title,
  sub,
  children,
  className,
}: {
  title?: string;
  sub?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-xl border border-border bg-card p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]",
        className,
      )}
    >
      {title && <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>}
      {sub && <p className="mt-0.5 text-[12.5px] text-muted-foreground">{sub}</p>}
      <div className={title || sub ? "mt-4" : ""}>{children}</div>
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[12.5px] font-medium">{label}</span>
      {children}
      {hint && <span className="block text-[11.5px] text-muted-foreground">{hint}</span>}
    </label>
  );
}

function Footer({
  saving,
  onSave,
  next,
  onNext,
}: {
  saving: boolean;
  onSave: () => void;
  next?: string;
  onNext?: () => void;
}) {
  return (
    <div className="sticky bottom-0 z-10 -mx-1 flex justify-end gap-2 border-t border-border bg-background/90 px-1 py-3 backdrop-blur">
      <Button variant="outline" disabled={saving} onClick={onSave}>
        Save
      </Button>
      {next && onNext && (
        <Button disabled={saving} onClick={onNext}>
          Continue to {next} <ArrowRight className="size-4" />
        </Button>
      )}
    </div>
  );
}

/* --------------------------------------------------------------------------------------------- listen */

const OPENERS = [
  "What has to be true in a year for this to have been worth it?",
  "Which piece of work, if it got faster or more accurate, would matter most?",
  "Who owns that outcome today, and how do they measure it?",
  "What have you already tried, and what got in the way?",
  "Why now: what changes if this waits a year?",
  "What can't change: data location, approvals, regulation?",
];

export function ListenView({ e, save, saving }: { e: Engagement; save: Save; saving: boolean }) {
  const [b, setB] = useState<Brief>(() => ({
    ...e.brief,
    stakeholders: e.brief.stakeholders ?? [],
    baseline: e.brief.baseline?.length ? e.brief.baseline : [{ metric: "", value: "", unit: "" }],
  }));
  const set = (k: keyof Brief, v: unknown) => setB((x) => ({ ...x, [k]: v }));
  const clean = () => ({
    ...b,
    stakeholders: (b.stakeholders ?? []).filter((s) => s.name.trim() || s.role.trim()),
    baseline: (b.baseline ?? []).filter((m) => m.metric.trim()),
  });
  const baseline = b.baseline ?? [];
  const people = b.stakeholders ?? [];
  const setMetric = (i: number, k: "metric" | "value" | "unit", v: string) =>
    set(
      "baseline",
      baseline.map((x, j) => (j === i ? { ...x, [k]: v } : x)),
    );
  const setPerson = (i: number, k: "name" | "role" | "audience", v: string) =>
    set(
      "stakeholders",
      people.map((x, j) => (j === i ? { ...x, [k]: v } : x)),
    );
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="space-y-5">
        <Card
          title="The business problem"
          sub="In the customer's words. No products, no architecture yet."
        >
          <div className="grid gap-4">
            <Field label="The workflow that should change">
              <Input
                value={b.workflow ?? ""}
                onChange={(ev) => set("workflow", ev.target.value)}
                placeholder="e.g. Maintenance work-package preparation"
              />
            </Field>
            <Field label="What's wrong with it today">
              <Textarea
                rows={3}
                value={b.problem ?? ""}
                onChange={(ev) => set("problem", ev.target.value)}
                placeholder="Who does it, how long it takes, what goes wrong, what it costs"
              />
            </Field>
            <Field label="The outcome they want">
              <Textarea
                rows={2}
                value={b.outcome ?? ""}
                onChange={(ev) => set("outcome", ev.target.value)}
                placeholder="What's different when it works"
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Why now">
                <Textarea
                  rows={2}
                  value={b.whyNow ?? ""}
                  onChange={(ev) => set("whyNow", ev.target.value)}
                  placeholder="A deadline, a risk, a cost that's growing"
                />
              </Field>
              <Field label="Constraints">
                <Textarea
                  rows={2}
                  value={b.constraints ?? ""}
                  onChange={(ev) => set("constraints", ev.target.value)}
                  placeholder="Data location, approvals, regulation"
                />
              </Field>
            </div>
            <Field
              label="Accountable owner (customer side)"
              hint="A role or a name. No owner usually means no outcome."
            >
              <Input
                value={b.owner ?? ""}
                onChange={(ev) => set("owner", ev.target.value)}
                placeholder="e.g. VP Maintenance & Reliability"
              />
            </Field>
          </div>
        </Card>

        <Card
          title="Baseline"
          sub="How they measure it today. Leave the value empty until it's measured: the story says so, and never guesses."
        >
          <div className="space-y-2">
            {baseline.map((m, i) => (
              <div key={i} className="grid grid-cols-[minmax(0,1fr)_110px_90px_36px] gap-2">
                <Input
                  aria-label="Metric"
                  placeholder="Metric, e.g. Time to assemble a work package"
                  value={m.metric}
                  onChange={(ev) => setMetric(i, "metric", ev.target.value)}
                />
                <Input
                  aria-label="Today"
                  placeholder="Today"
                  value={m.value}
                  onChange={(ev) => setMetric(i, "value", ev.target.value)}
                />
                <Input
                  aria-label="Unit"
                  placeholder="Unit"
                  value={m.unit}
                  onChange={(ev) => setMetric(i, "unit", ev.target.value)}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Remove metric"
                  onClick={() =>
                    set(
                      "baseline",
                      baseline.filter((_, j) => j !== i),
                    )
                  }
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() => set("baseline", [...baseline, { metric: "", value: "", unit: "" }])}
            >
              <Plus className="size-3.5" /> Add a metric
            </Button>
          </div>
        </Card>

        <Card title="Who's in the room" sub="Each audience gets its own version of the story.">
          <div className="space-y-2">
            {people.map((s, i) => (
              <div
                key={i}
                className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_170px_36px] gap-2"
              >
                <Input
                  aria-label="Name"
                  placeholder="Name"
                  value={s.name}
                  onChange={(ev) => setPerson(i, "name", ev.target.value)}
                />
                <Input
                  aria-label="Role"
                  placeholder="Role"
                  value={s.role}
                  onChange={(ev) => setPerson(i, "role", ev.target.value)}
                />
                <Select value={s.audience} onValueChange={(v) => setPerson(i, "audience", v)}>
                  <SelectTrigger aria-label="Audience">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="executive">Customer executive</SelectItem>
                    <SelectItem value="technical">Technical & field</SelectItem>
                    <SelectItem value="internal">Internal</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Remove person"
                  onClick={() =>
                    set(
                      "stakeholders",
                      people.filter((_, j) => j !== i),
                    )
                  }
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                set("stakeholders", [...people, { name: "", role: "", audience: "executive" }])
              }
            >
              <Plus className="size-3.5" /> Add a person
            </Button>
          </div>
        </Card>
        <Footer
          saving={saving}
          onSave={() => save({ brief: clean() })}
          next="Assess"
          onNext={() => save({ brief: clean() }, "assess")}
        />
      </div>
      <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
        <Card title="Open with" sub="Listen before you solution.">
          <ul className="space-y-2.5">
            {OPENERS.map((q) => (
              <li key={q} className="flex gap-2 text-[12.5px]">
                <MessageSquareQuote className="mt-0.5 size-3.5 shrink-0 text-primary" /> {q}
              </li>
            ))}
          </ul>
        </Card>
      </aside>
    </div>
  );
}

/* --------------------------------------------------------------------------------------------- assess */

const ORDER: Readiness[] = ["ready", "partial", "blocker", "not-needed"];

export function AssessView({ e, save, saving }: { e: Engagement; save: Save; saving: boolean }) {
  const [r, setR] = useState<ReadinessMap>(() => ({ ...e.readiness }));
  const counts = ORDER.map(
    (s) => [s, CONCEPTS.filter((c) => r[c.key]?.status === s).length] as const,
  );
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-[12.5px]">
        <span className="font-medium">Readiness for {e.brief.workflow || "this workflow"}:</span>
        {counts.map(([s, n]) => (
          <Pill key={s} tone={READINESS[s].tone as never}>
            {n} {READINESS[s].label.toLowerCase()}
          </Pill>
        ))}
        <span className="text-muted-foreground">
          · Data being reachable, its meaning being shared, and agents acting on it are separate
          questions.
        </span>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {CONCEPTS.map((c) => {
          const cur = r[c.key] ?? { status: "unknown" as Readiness, note: "" };
          return (
            <article
              key={c.key}
              className="rounded-xl border border-border bg-card p-5"
              data-concept={c.key}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-[14.5px] font-semibold">{c.title}</h3>
                  <p className="mt-1 text-[12.5px] text-muted-foreground">{c.meaning}</p>
                </div>
                <Pill tone={READINESS[cur.status].tone as never}>
                  {READINESS[cur.status].label}
                </Pill>
              </div>
              <ul className="mt-3 space-y-1">
                {c.questions.map((q) => (
                  <li key={q} className="flex gap-1.5 text-[12px] text-foreground/80">
                    <span className="text-primary">?</span> {q}
                  </li>
                ))}
              </ul>
              <div
                role="radiogroup"
                aria-label={`${c.title} readiness`}
                className="mt-3 flex flex-wrap gap-1"
              >
                {ORDER.map((s) => (
                  <button
                    key={s}
                    role="radio"
                    aria-checked={cur.status === s}
                    onClick={() => setR((x) => ({ ...x, [c.key]: { ...cur, status: s } }))}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors",
                      cur.status === s
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border hover:bg-muted",
                    )}
                  >
                    {READINESS[s].label}
                  </button>
                ))}
              </div>
              <Input
                className="mt-2"
                aria-label={`${c.title} note`}
                placeholder="What you heard"
                value={cur.note}
                onChange={(ev) =>
                  setR((x) => ({ ...x, [c.key]: { ...cur, note: ev.target.value } }))
                }
              />
              {c.platform && (
                <Link
                  to={c.platform.to as never}
                  className="mt-2 inline-flex items-center gap-1 text-[12px] text-primary hover:underline"
                >
                  {c.platform.label} <ArrowRight className="size-3" />
                </Link>
              )}
            </article>
          );
        })}
      </div>
      <Footer
        saving={saving}
        onSave={() => save({ readiness: r })}
        next="Map"
        onNext={() => save({ readiness: r }, "map")}
      />
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------ map */

const RANK: Record<Readiness, number> = {
  blocker: 0,
  partial: 1,
  unknown: 2,
  ready: 3,
  "not-needed": 4,
};

export function MapView({
  e,
  save,
  saving,
  products,
}: {
  e: Engagement;
  save: Save;
  saving: boolean;
  products: CatalogProduct[];
}) {
  const [items, setItems] = useState<Record<ConceptKey, MapItem>>(() => {
    const out = {} as Record<ConceptKey, MapItem>;
    for (const c of CONCEPTS)
      out[c.key] = e.solution_map.find((m) => m.concept === c.key) ?? {
        concept: c.key,
        products: [],
        note: "",
      };
    return out;
  });
  const byName = new Map(products.map((p) => [p.name, p]));
  const ordered = [...CONCEPTS].sort(
    (a, b) =>
      RANK[e.readiness[a.key]?.status ?? "unknown"] - RANK[e.readiness[b.key]?.status ?? "unknown"],
  );
  const toggle = (k: ConceptKey, id: string) =>
    setItems((x) => ({
      ...x,
      [k]: {
        ...x[k],
        products: x[k].products.includes(id)
          ? x[k].products.filter((p) => p !== id)
          : [...x[k].products, id],
      },
    }));
  const payload = () => Object.values(items).filter((m) => m.products.length || m.note.trim());
  const chosen = [...new Set(Object.values(items).flatMap((m) => m.products))]
    .map((id) => products.find((p) => p.id === id))
    .filter(Boolean) as CatalogProduct[];
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="space-y-3">
        {ordered.map((c) => {
          const st = e.readiness[c.key]?.status ?? "unknown";
          const suggested = c.accelerators
            .map((n) => byName.get(n))
            .filter(Boolean) as CatalogProduct[];
          const others = products.filter(
            (p) => !c.accelerators.includes(p.name) && items[c.key].products.includes(p.id),
          );
          return (
            <article
              key={c.key}
              className={cn(
                "rounded-xl border bg-card p-4",
                st === "blocker" ? "border-danger/30" : "border-border",
              )}
              data-concept={c.key}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-[14px] font-semibold">{c.title}</h3>
                <Pill tone={READINESS[st].tone as never}>{READINESS[st].label}</Pill>
              </div>
              {e.readiness[c.key]?.note && (
                <p className="mt-1 text-[12px] text-muted-foreground">
                  Heard: {e.readiness[c.key]!.note}
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {[...suggested, ...others].map((p) => {
                  const on = items[c.key].products.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      aria-pressed={on}
                      onClick={() => toggle(c.key, p.id)}
                      className={cn(
                        "flex max-w-[280px] items-start gap-2 rounded-lg border px-3 py-2 text-left transition-colors",
                        on
                          ? "border-primary bg-primary/[0.06] ring-2 ring-primary/15"
                          : "border-border hover:border-primary/30",
                      )}
                    >
                      <span
                        className={cn(
                          "mt-0.5 grid size-4 shrink-0 place-items-center rounded border",
                          on
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border",
                        )}
                      >
                        {on && <Check className="size-3" />}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[12.5px] font-semibold">{p.name}</span>
                        <span className="line-clamp-2 block text-[11.5px] text-muted-foreground">
                          {p.description}
                        </span>
                      </span>
                    </button>
                  );
                })}
                <Select value="" onValueChange={(id) => toggle(c.key, id)}>
                  <SelectTrigger
                    className="h-auto w-[210px] self-stretch text-[12px]"
                    aria-label={`Add another solution for ${c.title}`}
                  >
                    <SelectValue placeholder="Another from the catalog" />
                  </SelectTrigger>
                  <SelectContent>
                    {products
                      .filter(
                        (p) =>
                          !items[c.key].products.includes(p.id) && !c.accelerators.includes(p.name),
                      )
                      .map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <Input
                  className="max-w-xl flex-1"
                  aria-label={`${c.title} approach`}
                  placeholder="How it addresses the priority"
                  value={items[c.key].note}
                  onChange={(ev) =>
                    setItems((x) => ({ ...x, [c.key]: { ...x[c.key], note: ev.target.value } }))
                  }
                />
                {c.platform && (
                  <Link
                    to={c.platform.to as never}
                    className="inline-flex items-center gap-1 text-[12px] text-primary hover:underline"
                  >
                    {c.platform.label} <ArrowRight className="size-3" />
                  </Link>
                )}
              </div>
            </article>
          );
        })}
        <Footer
          saving={saving}
          onSave={() => save({ solution_map: payload() })}
          next="Propose"
          onNext={() => save({ solution_map: payload() }, "propose")}
        />
      </div>
      <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
        <Card title="The solution" sub="Reuse before you build.">
          {chosen.length ? (
            <ul className="space-y-3">
              {chosen.map((p) => (
                <li key={p.id}>
                  <Link
                    to="/products/$productId"
                    params={{ productId: p.id }}
                    className="text-[13px] font-semibold hover:text-primary"
                  >
                    {p.name}
                  </Link>
                  <p className="mt-0.5 line-clamp-2 text-[11.5px] text-muted-foreground">
                    {p.description}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12.5px] text-muted-foreground">
              Pick accelerators for the priorities that block value first.
            </p>
          )}
        </Card>
      </aside>
    </div>
  );
}

/* -------------------------------------------------------------------------------------------- propose */

export function ProposeView({
  e,
  products,
  onNext,
}: {
  e: Engagement;
  products: CatalogProduct[];
  onNext: () => void;
}) {
  const [aud, setAud] = useState<Audience>("executive");
  const story = useMemo(
    () => buildStory(e, aud, (id) => products.find((p) => p.id === id)?.name),
    [e, aud, products],
  );
  const people = (e.brief.stakeholders ?? []).filter((s) => s.audience === aud);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label="Audience"
          className="flex gap-1 rounded-full border border-border bg-muted/40 p-1"
        >
          {(Object.keys(AUDIENCE_LABEL) as Audience[]).map((a) => (
            <button
              key={a}
              role="tab"
              aria-selected={aud === a}
              onClick={() => setAud(a)}
              className={cn(
                "rounded-full px-3.5 py-1.5 text-[12.5px] font-medium",
                aud === a
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {AUDIENCE_LABEL[a]}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => {
              void navigator.clipboard?.writeText(storyText(story));
              toast.success("Copied. Paste it into your notes or deck.");
            }}
          >
            <ClipboardCopy className="size-4" /> Copy
          </Button>
          <Button onClick={onNext}>
            Continue to Prove <ArrowRight className="size-4" />
          </Button>
        </div>
      </div>

      {story.internalOnly && (
        <p className="flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/5 px-4 py-2 text-[12.5px] font-medium text-danger">
          <Lock className="size-3.5" /> Internal: priorities, accountability and commercial
          measures. Never in customer material.
        </p>
      )}

      <article className="overflow-hidden rounded-2xl border border-border bg-card">
        <header
          className={cn(
            "px-6 py-5 text-white",
            story.internalOnly
              ? "bg-[linear-gradient(135deg,#3b1d1d,#5b2626)]"
              : "bg-[linear-gradient(135deg,#0b2a6b,#1d4ed8)]",
          )}
        >
          <p className="text-[11px] font-semibold tracking-[0.14em] text-white/70 uppercase">
            {AUDIENCE_LABEL[aud]}
          </p>
          <h2 className="mt-1 text-[22px] font-bold tracking-tight">{story.title}</h2>
          {people.length > 0 && (
            <p className="mt-1 text-[12.5px] text-white/75">
              For {people.map((p) => `${p.name}${p.role ? ` (${p.role})` : ""}`).join(", ")}
            </p>
          )}
        </header>
        <div className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <div className="space-y-3 text-[14px] leading-[1.7]">
            <p className="text-[11px] font-semibold tracking-[0.14em] text-primary uppercase">
              {aud === "executive" ? "The opening" : "Summary"}
            </p>
            {story.opening.map((p) => (
              <p key={p.slice(0, 40)}>{p}</p>
            ))}
            <div className="mt-4 rounded-xl border border-primary/20 bg-primary/[0.04] p-4">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-primary uppercase">
                <Target className="size-3.5" /> The ask
              </p>
              <p className="mt-1 text-[13.5px] font-medium">{story.ask}</p>
            </div>
          </div>
          <div>
            <p className="text-[11px] font-semibold tracking-[0.14em] text-primary uppercase">
              Three things to remember
            </p>
            <ol className="mt-2 space-y-2">
              {story.messages.map((m, i) => (
                <li key={m} className="flex gap-3 text-[13.5px]">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
                    {i + 1}
                  </span>
                  {m}
                </li>
              ))}
            </ol>
          </div>
        </div>
        <div className="grid gap-px border-t border-border bg-border md:grid-cols-2">
          {story.sections.map((s) => {
            const outline = s.title === "Briefing outline";
            return (
              <section key={s.title} className="bg-card p-5 md:last:odd:col-span-2">
                <h3 className="text-[13px] font-semibold">{s.title}</h3>
                <ol
                  className={cn("mt-2 space-y-1.5 text-[12.5px]", outline && "list-decimal pl-5")}
                >
                  {s.items.map((it) => (
                    <li key={it} className={outline ? "" : "flex gap-2"}>
                      {!outline && (
                        <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary/60" />
                      )}
                      {it}
                    </li>
                  ))}
                </ol>
              </section>
            );
          })}
        </div>
      </article>
      <p className="text-[11.5px] text-muted-foreground">
        Generated from this engagement's brief, readiness and solution map. It states only what was
        captured: unmeasured baselines say so, and nothing here is a statistic or a commitment.
      </p>
    </div>
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
        sub="Deploy the mapped accelerators from their pinned releases, into a sandbox or the customer's subscription."
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
          <p className="text-[12.5px] text-muted-foreground">Map an accelerator first.</p>
        )}
      </Card>

      <Card
        title="Measure it"
        sub="Against the baseline captured in Listen. Targets are agreed with the customer; nothing is filled in for them."
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
          <p className="text-[12.5px] text-muted-foreground">Add a baseline metric in Listen.</p>
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
