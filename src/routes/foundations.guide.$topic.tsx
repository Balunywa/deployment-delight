import { createFileRoute } from "@tanstack/react-router";

import { GuideSectionNav, GuideTopicBody, GuideTopicList } from "@/components/lz/Guide";
import { KNOWLEDGE_TOPICS, getKnowledgeTopic } from "@/lib/alz/knowledge";

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
        </main>
        <GuideSectionNav topic={topic} />
      </div>
    </div>
  );
}
