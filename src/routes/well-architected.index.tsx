import { Link, createFileRoute } from "@tanstack/react-router";

import { ServiceIcon } from "@/components/architecture/ServiceIcon";
import { PageHeader } from "@/components/Primitives";
import { SERVICE_BY_ID } from "@/lib/catalog";
import { PILLARS, PILLAR_TONE, SERVICE_GUIDES } from "@/lib/waf";

export const Route = createFileRoute("/well-architected/")({
  head: () => ({ meta: [{ title: "Well-Architected guide · Cloud Delivery" }] }),
  component: WellArchitected,
});

function WellArchitected() {
  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <PageHeader
        title="Well-Architected guide"
        description="The Azure Well-Architected Framework as this app applies it: five pillars, and a guide per service whose recommendations are checked against every offering's design, not answered as a questionnaire."
      />
      <section className="grid gap-3 md:grid-cols-5">
        {PILLARS.map((p) => (
          <Link
            key={p.id}
            to="/well-architected/$topic"
            params={{ topic: p.id }}
            className="rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40"
          >
            <span
              className="block h-1 w-8 rounded-full"
              style={{ background: PILLAR_TONE[p.id] }}
            />
            <p className="mt-2 text-[14px] font-semibold">{p.title}</p>
            <p className="mt-1 text-[12px] text-muted-foreground">{p.meaning}</p>
          </Link>
        ))}
      </section>
      <section>
        <h2 className="mb-3 text-[15px] font-semibold">Service guides</h2>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {SERVICE_GUIDES.map((s) => (
            <li key={s.service}>
              <Link
                to="/well-architected/$topic"
                params={{ topic: s.service }}
                className="flex items-start gap-3 rounded-lg border border-border bg-card p-3 hover:border-primary/40"
              >
                <ServiceIcon id={s.service} />
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold">
                    {SERVICE_BY_ID.get(s.service)?.name ?? s.service}
                  </span>
                  <span className="line-clamp-2 block text-[12px] text-muted-foreground">
                    {s.recs.length} recommendations · {s.summary}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
