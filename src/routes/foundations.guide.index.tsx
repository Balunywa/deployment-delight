import { Link, createFileRoute } from "@tanstack/react-router";
import { BookOpen, ChevronRight } from "lucide-react";

import { GuideTopicList } from "@/components/lz/Guide";
import { KNOWLEDGE_TOPICS } from "@/lib/alz/knowledge";

export const Route = createFileRoute("/foundations/guide/")({
  head: () => ({ meta: [{ title: "ALZ design guide · Cloud Delivery" }] }),
  component: GuideIndex,
});

function GuideIndex() {
  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <header className="rounded-2xl border border-border bg-card p-6">
        <p className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.14em] text-primary uppercase">
          <BookOpen className="size-3.5" /> ALZ knowledge library
        </p>
        <h1 className="mt-2 text-[28px] leading-tight font-semibold tracking-tight">
          Design guide
        </h1>
        <p className="mt-2 max-w-3xl text-[14px] leading-6 text-muted-foreground">
          Contextual Azure Landing Zone guidance tied to what Cloud Delivery designs, simulates, and
          generates as Terraform.
        </p>
      </header>

      <div className="flex flex-col gap-5 md:flex-row">
        <GuideTopicList />
        <main className="min-w-0 flex-1">
          <div className="grid gap-3 lg:grid-cols-2">
            {KNOWLEDGE_TOPICS.map((topic) => (
              <Link
                key={topic.id}
                to="/foundations/guide/$topic"
                params={{ topic: topic.id }}
                className="group rounded-xl border border-border bg-card p-5 transition-[border-color,box-shadow] hover:border-border-strong"
              >
                <p className="text-[14px] font-semibold tracking-tight text-foreground group-hover:text-primary">
                  {topic.title}
                </p>
                <p className="mt-2 text-[13px] leading-5 text-muted-foreground">{topic.summary}</p>
                <p className="mt-4 inline-flex items-center gap-1 text-[12.5px] font-medium text-primary">
                  Read topic <ChevronRight className="size-3.5" />
                </p>
              </Link>
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}
