/*
 * A solution's page, laid out like a solutions library: hero, overview, benefits, how it works (the project's own
 * diagram with numbered steps, or the interactive architecture of each delivery model), business scenario and how
 * to deploy. Curated content comes from the repository; anything missing is generated from the architecture.
 */
import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  BookOpen,
  Check,
  ClipboardList,
  Copy,
  ExternalLink,
  Github,
  Globe2,
  Layers3,
  Rocket,
  ShieldCheck,
  Sparkles,
  Target,
  Terminal,
  Zap,
} from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";

import { ArchitectureCanvas } from "@/components/architecture/ArchitectureCanvas";
import { ServiceIcon } from "@/components/architecture/ServiceIcon";
import { Button } from "@/components/ui/button";
import { type Architecture, LANDING_LABEL } from "@/lib/architecture";
import { SERVICE_BY_ID } from "@/lib/catalog";
import {
  type CuratedStory,
  type StoryStep,
  howItWorks,
  stepMarkers,
  whatYouNeed,
} from "@/lib/solution-story";
import { cn } from "@/lib/utils";

export type StoryModel = {
  id: string;
  name: string;
  version: string | null;
  published: boolean;
  arch: Architecture;
};

const BENEFIT_ICONS = [Target, Globe2, ShieldCheck, Zap, Sparkles, Layers3];

/* ----------------------------------------------------------------------------------------------- hero */

export function Hero({
  eyebrow,
  title,
  badge,
  summary,
  meta,
  actions,
  facts,
}: {
  eyebrow: string;
  title: string;
  badge: ReactNode;
  summary: string | null;
  meta: ReactNode;
  actions: ReactNode;
  facts: { label: string; value: ReactNode }[];
}) {
  return (
    <section
      id="overview-top"
      className="relative overflow-hidden rounded-2xl border border-white/10 bg-[radial-gradient(120%_140%_at_0%_0%,#1d4ed8_0%,#0b2a6b_45%,#071a3d_100%)] text-white shadow-[0_20px_60px_-25px_rgba(7,26,61,0.6)]"
    >
      {/* A faint engineering grid and a soft glow, so the hero reads as a product page, not a form. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.12] [background-image:linear-gradient(rgba(255,255,255,.5)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.5)_1px,transparent_1px)] [background-size:28px_28px] [mask-image:radial-gradient(80%_80%_at_70%_30%,black,transparent)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 -right-24 size-80 rounded-full bg-sky-400/30 blur-3xl"
      />
      <div className="relative grid gap-8 p-7 lg:grid-cols-[minmax(0,1fr)_300px] lg:p-9">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold tracking-[0.14em] text-sky-200 uppercase">
              {eyebrow}
            </span>
            {badge}
          </div>
          <h1 className="mt-3 text-[30px] leading-[1.15] font-bold tracking-tight lg:text-[36px]">
            {title}
          </h1>
          {summary && (
            <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-white/80">{summary}</p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12.5px] text-white/75">
            {meta}
          </div>
          <div className="mt-6 flex flex-wrap gap-2.5">{actions}</div>
        </div>
        <dl className="self-start rounded-xl border border-white/15 bg-white/[0.07] p-4 backdrop-blur-sm">
          <p className="text-[11px] font-semibold tracking-[0.12em] text-white/60 uppercase">
            At a glance
          </p>
          <div className="mt-2 divide-y divide-white/10">
            {facts.map((f) => (
              <div key={f.label} className="flex items-baseline justify-between gap-3 py-2">
                <dt className="text-[12px] text-white/65">{f.label}</dt>
                <dd className="text-right text-[13px] font-semibold">{f.value}</dd>
              </div>
            ))}
          </div>
        </dl>
      </div>
    </section>
  );
}

/* ----------------------------------------------------------------------------------- section chrome */

const NAV = [
  ["overview", "Overview"],
  ["benefits", "Benefits"],
  ["how-it-works", "How it works"],
  ["scenario", "Scenario"],
  ["models", "Delivery models"],
  ["deploy", "Deploy"],
] as const;

export function SectionNav({ hide = [] }: { hide?: string[] }) {
  return (
    <nav
      aria-label="On this page"
      className="sticky top-14 z-10 -mx-1 flex gap-1 overflow-x-auto border-b border-border bg-background/85 px-1 py-2 backdrop-blur-md"
    >
      {NAV.filter(([id]) => !hide.includes(id)).map(([id, label]) => (
        <a
          key={id}
          href={`#${id}`}
          className="rounded-full px-3 py-1 text-[12.5px] font-medium whitespace-nowrap text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
        >
          {label}
        </a>
      ))}
    </nav>
  );
}

function Heading({
  id,
  kicker,
  title,
  sub,
}: {
  id: string;
  kicker: string;
  title: string;
  sub?: string;
}) {
  return (
    <header id={id} className="scroll-mt-28">
      <p className="text-[11px] font-semibold tracking-[0.14em] text-primary uppercase">{kicker}</p>
      <h2 className="mt-1 text-[20px] font-bold tracking-tight">{title}</h2>
      {sub && <p className="mt-1 max-w-2xl text-[13px] text-muted-foreground">{sub}</p>}
    </header>
  );
}

/* ------------------------------------------------------------------------------- overview & benefits */

export function Overview({
  paragraphs,
  outcome,
  audience,
  source,
}: {
  paragraphs: string[];
  outcome: string | null;
  audience: string | null;
  source: string | null;
}) {
  return (
    <section className="space-y-4">
      <Heading id="overview" kicker="Overview" title="What it is" />
      <div className="space-y-3 text-[14.5px] leading-[1.7] text-foreground/90">
        {paragraphs.map((p) => (
          <p key={p.slice(0, 40)}>{p}</p>
        ))}
      </div>
      {(outcome || audience) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {outcome && (
            <div className="rounded-xl border border-primary/20 bg-primary/[0.04] p-4">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-primary uppercase">
                <Target className="size-3.5" /> Outcome
              </p>
              <p className="mt-1 text-[13.5px] font-medium">{outcome}</p>
            </div>
          )}
          {audience && (
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                Built for
              </p>
              <p className="mt-1 text-[13.5px] font-medium">{audience}</p>
            </div>
          )}
        </div>
      )}
      {source && <p className="text-[11px] text-muted-foreground">Source: {source}.</p>}
    </section>
  );
}

export function Benefits({ items }: { items: { title: string; body: string }[] }) {
  return (
    <section className="space-y-4">
      <Heading id="benefits" kicker="Benefits" title="Why teams use it" />
      <div className="grid gap-3 md:grid-cols-3">
        {items.map((b, i) => {
          const Icon = BENEFIT_ICONS[i % BENEFIT_ICONS.length]!;
          return (
            <article
              key={b.title}
              className="group relative overflow-hidden rounded-xl border border-border bg-card p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_12px_30px_-15px_rgba(30,64,175,0.35)]"
            >
              <span className="grid size-10 place-items-center rounded-lg bg-gradient-to-br from-primary to-sky-500 text-white shadow-sm">
                <Icon className="size-5" />
              </span>
              <h3 className="mt-4 text-[14.5px] leading-snug font-semibold">{b.title}</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{b.body}</p>
            </article>
          );
        })}
      </div>
    </section>
  );
}

/* --------------------------------------------------------------------------------------- how it works */

function Steps({
  steps,
  hover,
  onHover,
}: {
  steps: StoryStep[];
  hover: number | null;
  onHover: (i: number | null) => void;
}) {
  return (
    <ol className="relative space-y-1">
      {steps.map((s, i) => (
        <li
          key={s.title}
          tabIndex={0}
          onMouseEnter={() => onHover(i)}
          onMouseLeave={() => onHover(null)}
          onFocus={() => onHover(i)}
          onBlur={() => onHover(null)}
          className={cn(
            "relative flex gap-3.5 rounded-xl p-3 outline-none transition-colors",
            hover === i ? "bg-primary/[0.06]" : "hover:bg-muted/50",
          )}
        >
          {i < steps.length - 1 && (
            <span
              aria-hidden
              className="absolute top-11 bottom-[-6px] left-[25px] w-px bg-border"
            />
          )}
          <span
            className={cn(
              "relative z-[1] grid size-7 shrink-0 place-items-center rounded-full text-[12px] font-bold transition-colors",
              hover === i
                ? "bg-primary text-primary-foreground shadow-[0_0_0_4px] shadow-primary/15"
                : "bg-primary/10 text-primary",
            )}
          >
            {i + 1}
          </span>
          <div className="min-w-0 pt-0.5">
            <p className="text-[13.5px] font-semibold">{s.title}</p>
            <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">{s.body}</p>
            {s.services.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {s.services
                  .filter((id) => SERVICE_BY_ID.has(id))
                  .map((id) => (
                    <span
                      key={id}
                      className="inline-flex items-center gap-1 rounded-full border border-border bg-card py-0.5 pr-2 pl-0.5 text-[11px]"
                    >
                      <ServiceIcon id={id} size="sm" />
                      {SERVICE_BY_ID.get(id)?.short}
                    </span>
                  ))}
              </div>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

/**
 * The architecture the platform draws from the solution's code, per delivery model, with the flow in numbered
 * steps. Hovering a step highlights its services on the diagram.
 */
export function HowItWorks({
  models,
  productName,
  story,
}: {
  models: StoryModel[];
  productName: string;
  story: CuratedStory | null;
}) {
  const [modelId, setModelId] = useState(
    (models.find((m) => m.published) ?? models[0])?.id ?? null,
  );
  const [hover, setHover] = useState<number | null>(null);
  const model = models.find((m) => m.id === modelId) ?? models[0];
  const generated = useMemo(
    () => (model ? howItWorks(model.arch, productName) : []),
    [model, productName],
  );
  if (!model) return null;
  const steps = story?.steps?.length ? story.steps : generated;
  const landing = LANDING_LABEL[model.arch.topology.landing];
  return (
    <section className="space-y-4">
      <Heading
        id="how-it-works"
        kicker="How it works"
        title="Architecture, step by step"
        sub={`${landing.title}. Drawn from the solution's code, as the platform deploys it; the numbers match the steps.`}
      />
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        <div className="bg-muted/20">
          {models.length > 1 && (
            <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
              <span className="text-[11.5px] text-muted-foreground">Delivery model</span>
              <div role="tablist" aria-label="Delivery model" className="flex flex-wrap gap-1">
                {models.map((m) => (
                  <button
                    key={m.id}
                    role="tab"
                    aria-selected={m.id === model.id}
                    onClick={() => {
                      setModelId(m.id);
                      setHover(null);
                    }}
                    className={cn(
                      "rounded-full border px-2.5 py-0.5 text-[11.5px] font-medium transition-colors",
                      m.id === model.id
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-card text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {m.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="flex justify-center overflow-x-auto p-4">
            <ArchitectureCanvas
              selected={model.arch.selected}
              topology={model.arch.topology}
              markers={stepMarkers(steps)}
              highlight={hover !== null ? steps[hover]?.services : null}
            />
          </div>
        </div>
        <div className="border-t border-border p-3">
          <Steps steps={steps} hover={hover} onHover={setHover} />
        </div>
        <p className="border-t border-border bg-muted/20 px-4 py-2 text-[11px] text-muted-foreground">
          {story?.steps?.length
            ? `Steps from the ${story.source.replace(/^Project /, "project ").replace(/ and (architecture )?diagrams?$/, "")}; architecture drawn from ${model.name}${model.version ? ` v${model.version}` : ""}'s code.`
            : `Generated from ${model.name}${model.version ? ` v${model.version}` : ""}'s reviewed architecture, so it matches what gets deployed.`}
        </p>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------------------------------- scenario */

export function Scenario({ scenario }: { scenario: NonNullable<CuratedStory["scenario"]> }) {
  return (
    <section className="space-y-4">
      <Heading id="scenario" kicker="Business scenario" title={scenario.title} />
      <div className="grid gap-4 rounded-2xl border border-border bg-gradient-to-br from-card to-muted/40 p-5 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <p className="text-[14px] leading-[1.7] text-foreground/90">{scenario.body}</p>
        <ul className="space-y-2">
          {scenario.points.map((p) => (
            <li key={p} className="flex gap-2 text-[13px]">
              <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-warning/15 text-warning">
                <ArrowRight className="size-3" />
              </span>
              {p}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------------------------------------- deploy */

function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  const isCli = /^[a-z][\w-]* /.test(command) || /^(azd|spi|az)\b/.test(command);
  if (!isCli)
    return (
      <span className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-[13px] font-medium">
        <Rocket className="size-3.5" /> {command}
      </span>
    );
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(command);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="inline-flex items-center gap-2 rounded-lg bg-black/30 px-3 py-2 font-mono text-[13px] ring-1 ring-white/15 hover:bg-black/40"
      aria-label={`Copy ${command}`}
    >
      <Terminal className="size-3.5 text-sky-300" /> {command}
      {copied ? (
        <Check className="size-3.5 text-emerald-300" />
      ) : (
        <Copy className="size-3.5 opacity-60" />
      )}
    </button>
  );
}

/** Everything needed to put it in a customer's hands, and how the project itself deploys. */
export function Deploy({
  productId,
  models,
  story,
  source,
}: {
  productId: string;
  models: StoryModel[];
  story: CuratedStory | null;
  source: { repository: string; iac: string } | null;
}) {
  const deployable = models.filter((m) => m.published);
  const first = deployable[0] ?? models[0];
  const needs = first ? whatYouNeed(first.arch) : [];
  const own = story?.deploy;
  return (
    <section className="space-y-4">
      <Heading id="deploy" kicker="Deploy with confidence" title="Put it in a customer's hands" />
      <div className="relative overflow-hidden rounded-2xl bg-[linear-gradient(135deg,#0b2a6b_0%,#123a8c_55%,#1d4ed8_100%)] p-6 text-white shadow-[0_20px_50px_-25px_rgba(7,26,61,0.7)]">
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-20 -left-16 size-72 rounded-full bg-sky-400/25 blur-3xl"
        />
        <div className="relative grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div>
            <ol className="space-y-3">
              {[
                ["Pick a customer", "New or existing, with where their Azure is."],
                [
                  "Choose where it runs",
                  models.map((m) => m.name).join(" or ") || "A delivery model",
                ],
                [
                  "Review, approve, deploy",
                  "A published, architecture-reviewed version, through a pipeline that waits for approval.",
                ],
              ].map(([t, b], i) => (
                <li key={t} className="flex gap-3">
                  <span className="grid size-7 shrink-0 place-items-center rounded-full bg-white/15 text-[12px] font-bold ring-1 ring-white/25">
                    {i + 1}
                  </span>
                  <div>
                    <p className="text-[14px] font-semibold">{t}</p>
                    <p className="text-[12.5px] text-white/70">{b}</p>
                  </div>
                </li>
              ))}
            </ol>
            <div className="mt-5 flex flex-wrap gap-2">
              {deployable.length ? (
                deployable.map((m, i) => (
                  <Button
                    key={m.id}
                    asChild
                    className={cn(
                      i === 0
                        ? "bg-white text-[#0b2a6b] shadow-sm hover:bg-white/90"
                        : "border border-white/30 bg-white/5 text-white hover:bg-white/15",
                    )}
                  >
                    <Link to="/onboard" search={{ product: productId, offering: m.id }}>
                      <Rocket className="size-4" /> Deploy {m.name}
                      {m.version ? ` v${m.version}` : ""}
                    </Link>
                  </Button>
                ))
              ) : (
                <Button disabled className="bg-white/20 text-white">
                  Publish a reviewed version first
                </Button>
              )}
            </div>
          </div>
          <div className="space-y-4 rounded-xl border border-white/15 bg-white/[0.06] p-4 backdrop-blur-sm">
            {own?.command && (
              <div>
                <p className="text-[11px] font-semibold tracking-wider text-white/60 uppercase">
                  How the project deploys itself
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <CopyCommand command={own.command} />
                  {own.minutes && (
                    <span className="text-[12px] text-white/70">about {own.minutes}</span>
                  )}
                  {own.guide && (
                    <a
                      href={own.guide}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[12px] text-sky-200 hover:text-white"
                    >
                      Deployment guide <ExternalLink className="size-3" />
                    </a>
                  )}
                </div>
              </div>
            )}
            {(own?.prerequisites?.length ?? 0) > 0 && (
              <div>
                <p className="text-[11px] font-semibold tracking-wider text-white/60 uppercase">
                  You'll need
                </p>
                <ul className="mt-1.5 space-y-1">
                  {own!.prerequisites!.map((p) => (
                    <li key={p} className="flex gap-2 text-[12.5px] text-white/85">
                      <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-300" /> {p}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {needs.length > 0 && (
              <div>
                <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-white/60 uppercase">
                  <ClipboardList className="size-3" /> The customer provides
                </p>
                <ul className="mt-1.5 grid gap-1 sm:grid-cols-2">
                  {needs.slice(0, 6).map((n) => (
                    <li key={n.key} className="text-[12.5px] text-white/85" title={n.help}>
                      {n.label}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-white/10 pt-3 text-[12px]">
              {first && (
                <Link
                  to="/offerings"
                  search={{ offering: first.id, view: first.published ? "architecture" : "review" }}
                  className="inline-flex items-center gap-1 text-sky-200 hover:text-white"
                >
                  <ShieldCheck className="size-3.5" /> Architecture review
                </Link>
              )}
              {source && (
                <a
                  href={source.repository}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-sky-200 hover:text-white"
                >
                  <Github className="size-3.5" /> Source ({source.iac})
                </a>
              )}
              <Link
                to="/upgrades"
                className="inline-flex items-center gap-1 text-sky-200 hover:text-white"
              >
                <BookOpen className="size-3.5" /> Release history
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
