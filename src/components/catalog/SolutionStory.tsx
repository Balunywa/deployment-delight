import { Link } from "@tanstack/react-router";
import {
  BookOpen,
  ClipboardList,
  ExternalLink,
  Globe2,
  Rocket,
  ShieldCheck,
  Target,
} from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";

import { ArchitectureCanvas } from "@/components/architecture/ArchitectureCanvas";
import { Button } from "@/components/ui/button";
import { type Architecture, LANDING_LABEL } from "@/lib/architecture";
import { type Benefit, howItWorks, stepMarkers, whatYouNeed } from "@/lib/solution-story";
import { cn } from "@/lib/utils";

const BENEFIT_ICON: Record<Benefit["kind"], ReactNode> = {
  outcome: <Target className="size-4" />,
  reach: <Globe2 className="size-4" />,
  secure: <ShieldCheck className="size-4" />,
};

export function Benefits({ items }: { items: Benefit[] }) {
  return (
    <section id="benefits" className="scroll-mt-20">
      <h2 className="text-[15px] font-semibold">Benefits</h2>
      <div className="mt-2.5 grid gap-3 md:grid-cols-3">
        {items.map((b) => (
          <article key={b.kind} className="rounded-lg border border-border bg-card p-4">
            <span className="grid size-8 place-items-center rounded-md bg-primary/10 text-primary">
              {BENEFIT_ICON[b.kind]}
            </span>
            <h3 className="mt-3 text-[13.5px] leading-snug font-semibold">{b.title}</h3>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">{b.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

export type StoryModel = {
  id: string;
  name: string;
  version: string | null;
  published: boolean;
  arch: Architecture;
};

/**
 * The architecture of one delivery model with its steps numbered on the diagram, the way solution libraries
 * explain a reference architecture. Hovering a step highlights its services.
 */
export function HowItWorks({ models, productName }: { models: StoryModel[]; productName: string }) {
  const [modelId, setModelId] = useState(
    (models.find((m) => m.published) ?? models[0])?.id ?? null,
  );
  const [hover, setHover] = useState<number | null>(null);
  const model = models.find((m) => m.id === modelId) ?? models[0];
  const steps = useMemo(
    () => (model ? howItWorks(model.arch, productName) : []),
    [model, productName],
  );
  if (!model) return null;
  const landing = LANDING_LABEL[model.arch.topology.landing];
  return (
    <section
      id="how-it-works"
      className="scroll-mt-20 overflow-hidden rounded-lg border border-border bg-card"
    >
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-[15px] font-semibold">How it works</h2>
          <p className="text-xs text-muted-foreground">
            {landing.title}. {landing.body}
          </p>
        </div>
        {models.length > 1 && (
          <div
            role="tablist"
            aria-label="Delivery model"
            className="flex flex-wrap gap-0.5 rounded-md border border-border bg-muted/40 p-0.5"
          >
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
                  "rounded-[5px] px-2.5 py-1 text-[11.5px] font-medium transition-colors",
                  m.id === model.id
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {m.name}
              </button>
            ))}
          </div>
        )}
      </header>
      <div className="flex justify-center overflow-x-auto bg-muted/20 p-3">
        <ArchitectureCanvas
          selected={model.arch.selected}
          topology={model.arch.topology}
          markers={stepMarkers(steps)}
          highlight={hover !== null ? steps[hover]?.services : null}
        />
      </div>
      <ol className="grid gap-px border-t border-border bg-border md:grid-cols-2">
        {steps.map((s, i) => (
          <li
            key={s.title}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(i)}
            onBlur={() => setHover(null)}
            tabIndex={0}
            className={cn(
              "flex gap-3 bg-card px-4 py-3 outline-none transition-shadow md:last:odd:col-span-2",
              hover === i && "shadow-[inset_3px_0_0_var(--color-primary)]",
            )}
          >
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
              {i + 1}
            </span>
            <div className="min-w-0">
              <p className="text-[13px] font-semibold">{s.title}</p>
              <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
        {model.name}
        {model.version ? ` v${model.version}` : ""} · generated from the offering's reviewed
        architecture, so it matches what gets deployed.
      </p>
    </section>
  );
}

/** Everything needed to launch it: pick a model, what the customer provides, and where the code is. */
export function DeployWithConfidence({
  productId,
  models,
  source,
}: {
  productId: string;
  models: StoryModel[];
  source: { repository: string; iac: string; ref?: string } | null;
}) {
  const deployable = models.filter((m) => m.published);
  const first = deployable[0] ?? models[0];
  const needs = first ? whatYouNeed(first.arch) : [];
  return (
    <section
      id="deploy"
      className="scroll-mt-20 overflow-hidden rounded-lg border border-border bg-card"
    >
      <header className="border-b border-border px-4 py-3">
        <h2 className="text-[15px] font-semibold">Deploy with confidence</h2>
        <p className="text-xs text-muted-foreground">
          Everything you need to put it in a customer's hands.
        </p>
      </header>
      <div className="grid gap-px bg-border md:grid-cols-3">
        <div className="bg-card p-4">
          <p className="flex items-center gap-2 text-[13px] font-semibold">
            <Rocket className="size-4 text-primary" /> Let's make it happen
          </p>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            Pick a customer and a delivery model. Onboarding asks only for what this architecture
            needs, then deploys a published, reviewed version.
          </p>
          <div className="mt-3 flex flex-col gap-1.5">
            {deployable.length ? (
              deployable.map((m) => (
                <Button key={m.id} asChild size="sm" variant={m === first ? "default" : "outline"}>
                  <Link to="/onboard" search={{ product: productId, offering: m.id }}>
                    Deploy {m.name}
                    {m.version ? ` v${m.version}` : ""}
                  </Link>
                </Button>
              ))
            ) : (
              <Button size="sm" disabled>
                Publish a reviewed version first
              </Button>
            )}
          </div>
        </div>
        <div className="bg-card p-4">
          <p className="flex items-center gap-2 text-[13px] font-semibold">
            <ClipboardList className="size-4 text-primary" /> What the customer provides
          </p>
          {needs.length ? (
            <ul className="mt-2 space-y-1.5 text-[12.5px]">
              {needs.slice(0, 6).map((n) => (
                <li key={n.key}>
                  <b className="font-medium">{n.label}</b>
                  <span className="block text-[11.5px] text-muted-foreground">{n.help}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-[12.5px] text-muted-foreground">
              Nothing beyond a sign-in domain: it runs in your Azure.
            </p>
          )}
          {first && <p className="mt-2 text-[11px] text-muted-foreground">For {first.name}.</p>}
        </div>
        <div className="bg-card p-4">
          <p className="flex items-center gap-2 text-[13px] font-semibold">
            <BookOpen className="size-4 text-primary" /> Review it first
          </p>
          <ul className="mt-2 space-y-1.5 text-[12.5px]">
            {first && (
              <li>
                <Link
                  to="/offerings"
                  search={{ offering: first.id, view: first.published ? "architecture" : "review" }}
                  className="text-primary hover:underline"
                >
                  Architecture review and policy checks
                </Link>
              </li>
            )}
            {source && (
              <li>
                <a
                  href={source.repository}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  Source code ({source.iac}) <ExternalLink className="size-3" />
                </a>
              </li>
            )}
            <li>
              <Link to="/upgrades" className="text-primary hover:underline">
                Release history
              </Link>
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}

const NAV = [
  ["overview", "Overview"],
  ["benefits", "Benefits"],
  ["how-it-works", "How it works"],
  ["models", "Delivery models"],
  ["deploy", "Deploy"],
] as const;

export function SectionNav() {
  return (
    <nav
      aria-label="On this page"
      className="sticky top-14 z-10 -mx-1 flex gap-1 overflow-x-auto border-b border-border bg-background/90 px-1 py-1.5 backdrop-blur"
    >
      {NAV.map(([id, label]) => (
        <a
          key={id}
          href={`#${id}`}
          className="rounded-md px-2.5 py-1 text-[12.5px] font-medium whitespace-nowrap text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          {label}
        </a>
      ))}
    </nav>
  );
}
