import { Link } from "@tanstack/react-router";
import { BookOpen, CheckCircle2, ExternalLink, Info, Lightbulb, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

import {
  KNOWLEDGE_TOPICS,
  type Block,
  type ComparisonCell,
  type KnowledgeTopic,
  type KnowledgeTopicId,
  getKnowledgeTopic,
} from "@/lib/alz/knowledge";
import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

const calloutStyles = {
  info: {
    icon: Info,
    className: "border-info/25 bg-info/5 text-info",
    body: "text-foreground/80",
  },
  warning: {
    icon: TriangleAlert,
    className: "border-warning/30 bg-warning/10 text-[oklch(0.5_0.12_70)]",
    body: "text-foreground/80",
  },
  recommendation: {
    icon: Lightbulb,
    className: "border-success/25 bg-success/5 text-success",
    body: "text-foreground/80",
  },
} as const;

function cellText(cell: ComparisonCell) {
  return typeof cell === "string" ? cell : cell.text;
}

function isRecommended(cell: ComparisonCell) {
  return typeof cell !== "string" && cell.recommended === true;
}

function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case "paragraph":
      return <p className="text-[13.5px] leading-6 text-muted-foreground">{block.text}</p>;
    case "bullets":
      return (
        <ul className="space-y-2 text-[13.5px] leading-6 text-muted-foreground">
          {block.items.map((item) => (
            <li key={item} className="flex gap-2">
              <CheckCircle2 className="mt-1 size-3.5 shrink-0 text-primary" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      );
    case "comparison":
      return (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-[13px]">
              <thead className="bg-muted/50 text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                <tr>
                  {block.columns.map((column) => (
                    <th key={column} className="px-4 py-3 font-semibold">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {block.rows.map((row) => (
                  <tr key={row.cells.map(cellText).join("|")} className="align-top">
                    {row.cells.map((cell, index) => (
                      <td
                        key={`${index}-${cellText(cell)}`}
                        className={cn(
                          "px-4 py-3 leading-5 text-muted-foreground",
                          index === 0 && "font-medium text-foreground",
                          isRecommended(cell) && "bg-success/5 text-foreground",
                        )}
                      >
                        <span className="inline-flex gap-1.5">
                          {isRecommended(cell) && (
                            <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" />
                          )}
                          {cellText(cell)}
                        </span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    case "when-to-use":
      return (
        <div className="grid gap-3 md:grid-cols-2">
          {block.items.map((item) => (
            <div key={item.choice} className="rounded-xl border border-border bg-card p-4">
              <p className="text-[13px] font-semibold text-foreground">{item.choice}</p>
              <p className="mt-1.5 text-[13px] leading-5 text-muted-foreground">{item.when}</p>
            </div>
          ))}
        </div>
      );
    case "callout": {
      const style = calloutStyles[block.tone];
      const Icon = style.icon;
      return (
        <aside className={cn("rounded-xl border p-4", style.className)}>
          <div className="flex gap-3">
            <Icon className="mt-0.5 size-4 shrink-0" />
            <div>
              <p className="text-[13px] font-semibold text-foreground">{block.title}</p>
              <p className={cn("mt-1 text-[13px] leading-5", style.body)}>{block.body}</p>
            </div>
          </div>
        </aside>
      );
    }
    case "steps":
      return (
        <ol className="space-y-3">
          {block.steps.map((step, index) => (
            <li key={`${step.from}-${step.to}-${step.what}`} className="flex gap-3">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[12px] font-semibold text-primary ring-1 ring-primary/20 ring-inset">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1 rounded-xl border border-border bg-card p-3.5">
                <p className="text-[12px] font-semibold text-foreground">
                  {step.from} <span className="text-muted-foreground">→</span> {step.to}
                </p>
                <p className="mt-1 text-[13px] leading-5 text-muted-foreground">{step.what}</p>
              </div>
            </li>
          ))}
        </ol>
      );
    case "learn-links":
      return (
        <div className="grid gap-2 sm:grid-cols-2">
          {block.links.map((link) => (
            <a
              key={link.url}
              href={link.url}
              target="_blank"
              rel="noreferrer"
              className="group flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3.5 py-3 text-[13px] font-medium text-foreground hover:border-border-strong"
            >
              <span>{link.title}</span>
              <ExternalLink className="size-3.5 shrink-0 text-muted-foreground group-hover:text-primary" />
            </a>
          ))}
        </div>
      );
    case "in-this-app":
      return (
        <div className="rounded-xl border border-primary/15 bg-primary/[0.04] p-4">
          <p className="flex items-center gap-2 text-[12px] font-semibold tracking-[0.08em] text-primary uppercase">
            <BookOpen className="size-3.5" /> {block.title ?? "In this app"}
          </p>
          <ul className="mt-3 space-y-2 text-[13px] leading-5 text-foreground/80">
            {block.items.map((item) => (
              <li key={item} className="flex gap-2">
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      );
  }
}

export function GuideTopicBody({ topic }: { topic: KnowledgeTopic }) {
  return (
    <article className="space-y-8">
      <header className="rounded-2xl border border-border bg-card p-6">
        <p className="text-[11px] font-semibold tracking-[0.14em] text-primary uppercase">
          ALZ knowledge
        </p>
        <h1 className="mt-2 text-[26px] leading-tight font-semibold tracking-tight text-foreground">
          {topic.title}
        </h1>
        <p className="mt-2 max-w-3xl text-[14px] leading-6 text-muted-foreground">
          {topic.summary}
        </p>
        <div className="mt-4 rounded-xl bg-muted/50 p-4">
          <p className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
            Decision this informs
          </p>
          <p className="mt-1 text-[13.5px] leading-5 text-foreground">{topic.decision}</p>
        </div>
      </header>

      {topic.sections.map((section) => (
        <section key={section.id} id={section.id} className="scroll-mt-24 space-y-4">
          <h2 className="text-[18px] leading-tight font-semibold tracking-tight text-foreground">
            {section.title}
          </h2>
          <div className="space-y-4">
            {section.blocks.map((block, index) => (
              <BlockView key={`${section.id}-${index}-${block.type}`} block={block} />
            ))}
          </div>
        </section>
      ))}
    </article>
  );
}

export function GuideSectionNav({ topic }: { topic: KnowledgeTopic }) {
  return (
    <nav className="sticky top-6 hidden w-56 shrink-0 self-start rounded-xl border border-border bg-card p-3 lg:block">
      <p className="px-2 text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
        Sections
      </p>
      <div className="mt-2 space-y-1">
        {topic.sections.map((section) => (
          <a
            key={section.id}
            href={`#${section.id}`}
            className="block rounded-md px-2 py-1.5 text-[12.5px] text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {section.title}
          </a>
        ))}
      </div>
    </nav>
  );
}

export function GuideTopicList({ activeTopic }: { activeTopic?: KnowledgeTopicId }) {
  return (
    <nav className="sticky top-6 w-full shrink-0 self-start rounded-xl border border-border bg-card p-3 md:w-72">
      <p className="px-2 text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
        Topics
      </p>
      <div className="mt-2 space-y-1">
        {KNOWLEDGE_TOPICS.map((topic) => (
          <Link
            key={topic.id}
            to="/foundations/guide/$topic"
            params={{ topic: topic.id }}
            className={cn(
              "block rounded-lg px-3 py-2 text-[13px] transition-colors",
              activeTopic === topic.id
                ? "bg-primary/10 font-medium text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {topic.title}
          </Link>
        ))}
      </div>
    </nav>
  );
}

export function GuideLink({
  topic,
  section,
  children,
}: {
  topic: KnowledgeTopicId | string;
  section?: string;
  children: ReactNode;
}) {
  const guideTopic = getKnowledgeTopic(topic);
  if (!guideTopic) return null;
  const href = `/foundations/guide/${topic}${section ? `#${section}` : ""}`;

  return (
    <Sheet>
      <SheetTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md text-primary underline-offset-4 hover:underline"
        >
          {children}
        </button>
      </SheetTrigger>
      <SheetContent side="right" className="w-[min(920px,92vw)] overflow-y-auto sm:max-w-[920px]">
        <SheetHeader className="pr-8">
          <SheetTitle>{guideTopic.title}</SheetTitle>
          <SheetDescription>{guideTopic.summary}</SheetDescription>
          <a
            href={href}
            className="inline-flex w-fit items-center gap-1.5 text-[13px] font-medium text-primary hover:underline"
          >
            Open full guide <ExternalLink className="size-3.5" />
          </a>
        </SheetHeader>
        <div className="mt-6 pb-8">
          <GuideTopicBody topic={guideTopic} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
