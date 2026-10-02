import { createFileRoute } from "@tanstack/react-router";

import { GuideNav, PillarGuide, ServiceGuide } from "@/components/offering/WafGuide";
import { SERVICE_BY_ID } from "@/lib/catalog";
import { PILLARS } from "@/lib/waf";

export const Route = createFileRoute("/well-architected/$topic")({
  head: ({ params }) => ({
    meta: [
      {
        title: `${PILLARS.find((p) => p.id === params.topic)?.title ?? SERVICE_BY_ID.get(params.topic)?.name ?? "Well-Architected"} · Well-Architected guide`,
      },
    ],
  }),
  component: Topic,
});

function Topic() {
  const { topic } = Route.useParams();
  const pillar = PILLARS.find((p) => p.id === topic)?.id;
  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-6 md:flex-row">
      <aside className="w-full shrink-0 md:sticky md:top-4 md:w-64 md:self-start">
        <GuideNav active={topic} />
      </aside>
      <main className="min-w-0 flex-1 rounded-2xl border border-border bg-card p-6">
        {pillar ? <PillarGuide pillar={pillar} /> : <ServiceGuide service={topic} />}
      </main>
    </div>
  );
}
