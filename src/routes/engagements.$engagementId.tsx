import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Building2, Presentation, UserRound } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { StageDots } from "@/components/engagement/StageDots";
import { type Apply, Conversation, type Focus } from "@/components/engagement/Conversation";
import { FitGapView, HandoffView, PrepView, RecapView } from "@/components/engagement/Panels";
import { type CatalogProduct, ProveView } from "@/components/engagement/Prove";
import { RealizeView } from "@/components/engagement/Realize";
import { EmptyState, Pill } from "@/components/Primitives";
import { Button } from "@/components/ui/button";
import { advance } from "@/lib/conversation";
import type { Engagement } from "@/lib/engagements";
import { saveEngagement } from "@/lib/engagements.functions";
import { relative } from "@/lib/format";
import { engagementQuery, productsQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

const TABS = [
  { key: "prep", title: "Prep" },
  { key: "conversation", title: "Conversation" },
  { key: "fit", title: "Fit & gap" },
  { key: "recap", title: "Customer recap" },
  { key: "handoff", title: "Handoff" },
  { key: "prove", title: "Prove" },
  { key: "realize", title: "Realize value" },
] as const;
type Tab = (typeof TABS)[number]["key"];

export const Route = createFileRoute("/engagements/$engagementId")({
  validateSearch: (s: Record<string, unknown>): { tab?: Tab } =>
    typeof s["tab"] === "string" && TABS.some((t) => t.key === s["tab"])
      ? { tab: s["tab"] as Tab }
      : {},
  head: () => ({ meta: [{ title: "Engagement · Cloud Delivery" }] }),
  component: EngagementPage,
});

function EngagementPage() {
  const { engagementId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const queryClient = useQueryClient();
  const q = useQuery(engagementQuery(engagementId));
  const catalog = useQuery(productsQuery);
  const [focus, setFocus] = useState<Focus>({});
  const save = useMutation({ mutationFn: useServerFn(saveEngagement) });

  if (q.isLoading) return <EmptyState title="Loading engagement…" />;
  if (!q.data)
    return (
      <EmptyState
        title="Engagement not found"
        description={q.error?.message ?? "It may have been removed."}
      />
    );
  const { engagement: e, installs, account } = q.data;
  const products: CatalogProduct[] = (catalog.data ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    outcome: (p as { outcome?: string | null }).outcome ?? null,
  }));
  const tab: Tab = search.tab ?? "conversation";
  const go = (t: Tab) => void navigate({ search: { tab: t } });
  const key = engagementQuery(engagementId).queryKey;

  // Every change shows at once and saves in the background; the conversation shouldn't wait on the network.
  const apply: Apply = (patch, message) => {
    const prev = queryClient.getQueryData(key);
    // A decision is stamped by the server (who, when), so it shows once saved.
    if (!("decision" in patch))
      queryClient.setQueryData(key, (old) =>
        old ? { ...old, engagement: { ...old.engagement, ...patch } as Engagement } : old,
      );
    save.mutate(
      { data: { id: e.id, patch: patch as never } },
      {
        onSuccess: () => {
          if (message) toast.success(message);
          void queryClient.invalidateQueries({ queryKey: ["engagements"] });
          void queryClient.invalidateQueries({ queryKey: [...key, "recap"] });
          if ("decision" in patch || "results" in patch)
            void queryClient.invalidateQueries({ queryKey: key });
        },
        onError: (err: Error) => {
          queryClient.setQueryData(key, prev);
          toast.error(err.message);
        },
      },
    );
  };

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <Link
        to="/engagements"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" /> Engagements
      </Link>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold tracking-[0.14em] text-primary uppercase">
            Engagement
          </p>
          <h1 className="mt-1 text-[26px] leading-tight font-bold tracking-tight">{e.name}</h1>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-muted-foreground">
            {e.customer_id ? (
              <Link
                to="/customers/$customerId"
                params={{ customerId: e.customer_id }}
                className="inline-flex items-center gap-1 hover:text-foreground"
              >
                <Building2 className="size-3.5" /> {e.customer_name}
              </Link>
            ) : (
              <span className="inline-flex items-center gap-1">
                <Building2 className="size-3.5" /> Not a customer yet
              </span>
            )}
            {e.owner_name && (
              <span className="inline-flex items-center gap-1">
                <UserRound className="size-3.5" /> {e.owner_name}
              </span>
            )}
            <span>Updated {relative(e.updated_at)}</span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <StageDots e={e} />
          {e.realization.confirmed ? (
            <Pill tone="success">Value realized</Pill>
          ) : e.decision ? (
            <Pill tone={e.decision.choice === "stop" ? "neutral" : "success"}>
              Decided: {e.decision.choice}
            </Pill>
          ) : (
            <Button asChild variant="outline" size="sm">
              <Link to="/recap/$engagementId" params={{ engagementId: e.id }} target="_blank">
                <Presentation className="size-3.5" /> Customer view
              </Link>
            </Button>
          )}
        </div>
      </header>

      <nav aria-label="Engagement" className="flex gap-1 overflow-x-auto border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => go(t.key)}
            aria-current={tab === t.key ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3.5 py-2 text-[13px] font-medium whitespace-nowrap transition-colors",
              tab === t.key
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.title}
          </button>
        ))}
      </nav>

      {tab === "conversation" && (
        <Conversation
          e={e}
          apply={apply}
          products={products}
          focus={focus}
          setFocus={setFocus}
          onTab={go}
        />
      )}
      {tab === "prep" && (
        <PrepView
          e={e}
          account={account}
          installs={installs}
          products={products}
          apply={apply}
          onAsk={(f) => {
            setFocus(f);
            go("conversation");
          }}
        />
      )}
      {tab === "fit" && (
        <FitGapView
          e={e}
          products={products}
          apply={apply}
          onAsk={(f) => {
            setFocus(f);
            go("conversation");
          }}
        />
      )}
      {tab === "recap" && <RecapView e={e} />}
      {tab === "handoff" && <HandoffView e={e} products={products} apply={apply} />}
      {tab === "prove" && (
        <ProveView
          key={e.updated_at}
          e={e}
          save={(patch) =>
            apply(
              {
                ...patch,
                ...(patch["decision"] ? {} : advance(e, "prove")),
              } as Partial<Engagement>,
              "decision" in patch
                ? (patch["decision"] as { choice?: string } | null)?.choice === "scale"
                  ? "Decision recorded. Next: realize the value."
                  : "Decision recorded."
                : "Saved.",
            )
          }
          saving={save.isPending}
          products={products}
          installs={installs}
        />
      )}
      {tab === "realize" && (
        <RealizeView
          key={e.updated_at}
          e={e}
          products={products}
          installs={installs}
          apply={apply}
          onProve={() => go("prove")}
        />
      )}
    </div>
  );
}
