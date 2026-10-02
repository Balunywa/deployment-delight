/*
 * The Well-Architected guide in the app: the five pillars (principles, the official checklist, tradeoffs) and a
 * guide per service (its recommendations by pillar, and how this design does against them when there is one).
 * Opens as a page, or beside the designer in a sheet.
 */
import { Link } from "@tanstack/react-router";
import {
  BookOpen,
  CircleAlert,
  CircleCheck,
  ExternalLink,
  Info,
  TriangleAlert,
} from "lucide-react";
import { type ReactNode, useState } from "react";

import { ServiceIcon } from "@/components/architecture/ServiceIcon";
import { Pill } from "@/components/Primitives";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { SERVICE_BY_ID } from "@/lib/catalog";
import {
  type Finding,
  GUIDE_BY_SERVICE,
  PILLAR_TONE,
  PILLARS,
  PILLAR_GUIDES,
  type Pillar,
  SERVICE_GUIDES,
} from "@/lib/waf";
import { cn } from "@/lib/utils";

export function ResultIcon({ result }: { result: Finding["result"] }) {
  return result === "pass" ? (
    <CircleCheck className="size-4 shrink-0 text-success" />
  ) : result === "fail" ? (
    <CircleAlert className="size-4 shrink-0 text-danger" />
  ) : result === "warn" ? (
    <TriangleAlert className="size-4 shrink-0 text-warning" />
  ) : (
    <Info className="size-4 shrink-0 text-muted-foreground" />
  );
}

export function PillarTag({ pillar }: { pillar: Pillar }) {
  const p = PILLARS.find((x) => x.id === pillar)!;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold"
      style={{ background: `${PILLAR_TONE[pillar]}1f`, color: PILLAR_TONE[pillar] }}
    >
      {p.short}
    </span>
  );
}

/** A pillar's guide: what it means, its principles, Microsoft's checklist and its tradeoffs. */
export function PillarGuide({ pillar }: { pillar: Pillar }) {
  const p = PILLARS.find((x) => x.id === pillar)!;
  const g = PILLAR_GUIDES.find((x) => x.pillar === pillar);
  return (
    <article className="space-y-5">
      <header>
        <p
          className="text-[11px] font-semibold tracking-[0.12em] uppercase"
          style={{ color: PILLAR_TONE[pillar] }}
        >
          Well-Architected pillar
        </p>
        <h1 className="mt-1 text-[24px] font-bold tracking-tight">{p.title}</h1>
        <p className="mt-1 text-[14px] text-muted-foreground">{g?.summary ?? p.meaning}</p>
        <a
          href={g?.learn ?? p.learn}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-[12.5px] text-primary hover:underline"
        >
          <ExternalLink className="size-3.5" /> On Microsoft Learn
        </a>
      </header>
      {g && (
        <>
          <Section title="Design principles">
            <ul className="grid gap-3 md:grid-cols-2">
              {g.principles.map((x) => (
                <li key={x.title} className="rounded-lg border border-border p-3.5">
                  <p className="text-[13.5px] font-semibold">{x.title}</p>
                  <p className="mt-1 text-[12.5px] text-muted-foreground">{x.body}</p>
                </li>
              ))}
            </ul>
          </Section>
          <Section title="Microsoft's checklist">
            <ol className="divide-y divide-border rounded-lg border border-border">
              {g.checklist.map((x) => (
                <li key={x.id} className="flex items-start gap-3 px-3.5 py-2.5 text-[13px]">
                  <span className="w-14 shrink-0 font-mono text-[12px] text-muted-foreground">
                    {x.id}
                  </span>
                  <a
                    href={x.learn}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:text-primary hover:underline"
                  >
                    {x.title}
                  </a>
                </li>
              ))}
            </ol>
          </Section>
          {g.tradeoffs.length > 0 && (
            <Section title="Tradeoffs">
              <ul className="list-disc space-y-1.5 pl-5 text-[13px]">
                {g.tradeoffs.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </Section>
          )}
        </>
      )}
      <Section title="Service guides with recommendations for this pillar">
        <ul className="flex flex-wrap gap-1.5">
          {SERVICE_GUIDES.filter((s) => s.recs.some((r) => r.pillar === pillar)).map((s) => (
            <li key={s.service}>
              <Link
                to="/well-architected/$topic"
                params={{ topic: s.service }}
                className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[12px] hover:border-primary/40"
              >
                <ServiceIcon id={s.service} size="sm" />
                {SERVICE_BY_ID.get(s.service)?.short ?? s.service}
              </Link>
            </li>
          ))}
        </ul>
      </Section>
    </article>
  );
}

/** A service's guide: its recommendations by pillar, and (when given) how this design does on each. */
export function ServiceGuide({
  service,
  findings,
  onFix,
}: {
  service: string;
  findings?: Finding[] | undefined;
  onFix?: ((f: Finding) => void) | undefined;
}) {
  const g = GUIDE_BY_SERVICE.get(service);
  const def = SERVICE_BY_ID.get(service);
  if (!g)
    return (
      <p className="text-[13px] text-muted-foreground">
        No Well-Architected guide for {def?.name ?? service} yet.
      </p>
    );
  const byRec = new Map(
    (findings ?? []).filter((f) => f.service === service).map((f) => [f.rec.id, f]),
  );
  return (
    <article className="space-y-5">
      <header className="flex items-start gap-3">
        <ServiceIcon id={service} />
        <div className="min-w-0">
          <p className="text-[11px] font-semibold tracking-[0.12em] text-primary uppercase">
            Well-Architected service guide
          </p>
          <h1 className="mt-0.5 text-[22px] font-bold tracking-tight">{def?.name ?? service}</h1>
          <p className="mt-1 text-[13.5px] text-muted-foreground">{g.summary}</p>
          <a
            href={g.learn}
            target="_blank"
            rel="noreferrer"
            className="mt-1.5 inline-flex items-center gap-1 text-[12.5px] text-primary hover:underline"
          >
            <ExternalLink className="size-3.5" /> The guide on Microsoft Learn
          </a>
        </div>
      </header>
      {PILLARS.map((p) => {
        const recs = g.recs.filter((r) => r.pillar === p.id);
        if (!recs.length) return null;
        return (
          <Section key={p.id} title={p.title} tone={PILLAR_TONE[p.id]}>
            <ul className="space-y-2">
              {recs.map((r) => {
                const f = byRec.get(r.id);
                return (
                  <li key={r.id} className="rounded-lg border border-border p-3">
                    <div className="flex items-start gap-2.5">
                      {f ? (
                        <ResultIcon result={f.result} />
                      ) : (
                        <BookOpen className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-semibold">{r.title}</p>
                        <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                          {f && f.result !== "advice" ? f.detail : r.why}
                        </p>
                        {r.learn && (
                          <a
                            href={r.learn}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-1 inline-flex items-center gap-1 text-[11.5px] text-primary hover:underline"
                          >
                            <ExternalLink className="size-3" /> Learn more
                          </a>
                        )}
                      </div>
                      {f?.fix && onFix && (f.result === "fail" || f.result === "warn") && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 shrink-0"
                          onClick={() => onFix(f)}
                        >
                          {f.fix.label}
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </Section>
        );
      })}
    </article>
  );
}

function Section({ title, tone, children }: { title: string; tone?: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 flex items-center gap-2 text-[15px] font-semibold tracking-tight">
        {tone && <span className="size-2 rounded-full" style={{ background: tone }} />}
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Opens a pillar or service guide beside the designer. */
export function WafLink({
  topic,
  findings,
  onFix,
  children,
  className,
}: {
  topic: string;
  findings?: Finding[] | undefined;
  onFix?: ((f: Finding) => void) | undefined;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const pillar = PILLARS.find((p) => p.id === topic)?.id;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={cn("text-left", className)}>
        {children}
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle className="sr-only">Well-Architected guide</SheetTitle>
          </SheetHeader>
          <div className="px-5 pb-8">
            {pillar ? (
              <PillarGuide pillar={pillar} />
            ) : (
              <ServiceGuide service={topic} findings={findings} onFix={onFix} />
            )}
            <Link
              to="/well-architected/$topic"
              params={{ topic }}
              target="_blank"
              className="mt-6 inline-flex items-center gap-1 text-[12.5px] text-primary hover:underline"
            >
              <ExternalLink className="size-3.5" /> Open the full guide
            </Link>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

export function GuideNav({ active }: { active?: string }) {
  return (
    <nav aria-label="Well-Architected guide" className="space-y-4">
      <div>
        <p className="mb-1.5 text-[10.5px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
          Pillars
        </p>
        <ul className="space-y-0.5">
          {PILLARS.map((p) => (
            <li key={p.id}>
              <Link
                to="/well-architected/$topic"
                params={{ topic: p.id }}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] hover:bg-muted/60",
                  active === p.id && "bg-primary/[0.08] font-semibold text-primary",
                )}
              >
                <span className="size-2 rounded-full" style={{ background: PILLAR_TONE[p.id] }} />
                {p.title}
              </Link>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p className="mb-1.5 text-[10.5px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
          Services
        </p>
        <ul className="space-y-0.5">
          {SERVICE_GUIDES.map((s) => (
            <li key={s.service}>
              <Link
                to="/well-architected/$topic"
                params={{ topic: s.service }}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1 text-[12.5px] hover:bg-muted/60",
                  active === s.service && "bg-primary/[0.08] font-semibold text-primary",
                )}
              >
                <ServiceIcon id={s.service} size="sm" />
                <span className="truncate">{SERVICE_BY_ID.get(s.service)?.name ?? s.service}</span>
                <Pill className="ml-auto">{s.recs.length}</Pill>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
