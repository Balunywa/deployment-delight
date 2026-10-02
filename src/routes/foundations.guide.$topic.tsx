import { createFileRoute } from "@tanstack/react-router";

import { GuideSectionNav, GuideTopicBody, GuideTopicList } from "@/components/lz/Guide";
import { TrafficStory } from "@/components/lz/traffic/TrafficStory";
import { type Answers, DEFAULT_ANSWERS, LATEST_REF, libraryFor } from "@/lib/alz/engine";
import { KNOWLEDGE_TOPICS, getKnowledgeTopic } from "@/lib/alz/knowledge";

/**
 * Each networking topic shows the traffic in a reference design next to the alternative it discusses, drawn and
 * computed by the same engine as a real landing zone, so the guide and the designer never disagree.
 */
const REFERENCE: Answers = { ...DEFAULT_ANSWERS, intermediateRootName: "Reference design" };
const SEE_IT: Record<
  string,
  { only?: string[]; base: Answers; alt: { label: string; answers: Answers }; note: string }
> = {
  "outbound-internet": {
    only: ["egress", "telemetry"],
    base: REFERENCE,
    alt: { label: "Without Azure Firewall", answers: { ...REFERENCE, firewall: "none" } },
    note: "Left: Corp egress through Azure Firewall. Right: the same design without it, where private subnets have no way out.",
  },
  "hybrid-connectivity": {
    only: ["hybrid", "p2s"],
    base: { ...REFERENCE, vpnGateway: "yes" },
    alt: {
      label: "With ExpressRoute instead",
      answers: { ...REFERENCE, vpnGateway: "no", expressRoute: "yes" },
    },
    note: "The office reaching a Corp workload over a site-to-site VPN, and over ExpressRoute. Watch the return path through the firewall.",
  },
  "dns-private-link": {
    only: ["private-endpoint"],
    base: REFERENCE,
    alt: { label: "Without platform private DNS", answers: { ...REFERENCE, privateDns: "none" } },
    note: "A workload resolving its database's private endpoint through the hub, and what happens without the platform's zones.",
  },
  "hub-and-spoke-vs-virtual-wan": {
    base: REFERENCE,
    alt: { label: "As Virtual WAN", answers: { ...REFERENCE, connectivity: "virtual_wan" } },
    note: "Every path in the reference design as hub and spoke, and the same design as Virtual WAN.",
  },
};

export const Route = createFileRoute("/foundations/guide/$topic")({
  head: ({ params }) => {
    const topic = getKnowledgeTopic(params.topic);
    return { meta: [{ title: `${topic?.title ?? "ALZ design guide"} · Cloud Delivery` }] };
  },
  component: GuideTopicPage,
});

function GuideTopicPage() {
  const { topic: topicId } = Route.useParams();
  const topic = getKnowledgeTopic(topicId) ?? KNOWLEDGE_TOPICS[0]!;

  return (
    <div className="mx-auto max-w-[1500px]">
      <div className="flex flex-col gap-5 md:flex-row">
        <GuideTopicList activeTopic={topic.id} />
        <main className="min-w-0 flex-1">
          <GuideTopicBody topic={topic} />
          {SEE_IT[topic.id] && (
            <section className="mt-6 rounded-2xl border border-border bg-card p-5">
              <h2 className="text-[17px] font-semibold tracking-tight">See the traffic</h2>
              <p className="mt-1 mb-4 text-[13px] text-muted-foreground">
                {SEE_IT[topic.id]!.note} Computed from the reference design by the same engine as
                the designer; press Step through to add one kind of traffic at a time.
              </p>
              <TrafficStory
                input={{ lib: libraryFor(LATEST_REF), answers: SEE_IT[topic.id]!.base, placed: [] }}
                only={SEE_IT[topic.id]!.only}
                compareWith={SEE_IT[topic.id]!.alt}
                baseLabel="Reference design"
                stacked
              />
            </section>
          )}
        </main>
        <GuideSectionNav topic={topic} />
      </div>
    </div>
  );
}
