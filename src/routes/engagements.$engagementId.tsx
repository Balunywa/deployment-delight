import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Building2, Check, UserRound } from "lucide-react";
import { toast } from "sonner";

import {
  AssessView,
  type CatalogProduct,
  ListenView,
  MapView,
  ProposeView,
  ProveView,
} from "@/components/engagement/Stages";
import { EmptyState, Pill } from "@/components/Primitives";
import { STAGES, type Stage, gaps } from "@/lib/engagements";
import { saveEngagement } from "@/lib/engagements.functions";
import { relative } from "@/lib/format";
import { engagementQuery, productsQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

type View = Exclude<Stage, "decided">;

export const Route = createFileRoute("/engagements/$engagementId")({
  validateSearch: (s: Record<string, unknown>): { view?: View } =>
    typeof s["view"] === "string" && STAGES.some((x) => x.key === s["view"])
      ? { view: s["view"] as View }
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
  const save = useMutation({
    mutationFn: useServerFn(saveEngagement),
    onError: (err: Error) => toast.error(err.message),
  });

  if (q.isLoading) return <EmptyState title="Loading engagement…" />;
  if (!q.data)
    return (
      <EmptyState
        title="Engagement not found"
        description={q.error?.message ?? "It may have been removed."}
      />
    );
  const { engagement: e, installs } = q.data;
  const products: CatalogProduct[] = (catalog.data ?? [])
    .filter((p) => p.offerings.some((o) => o.version))
    .map((p) => ({ id: p.id, name: p.name, description: p.description }));
  const reached =
    e.stage === "decided" ? STAGES.length : STAGES.findIndex((s) => s.key === e.stage);
  const view: View = search.view ?? (e.stage === "decided" ? "prove" : (e.stage as View));
  const g = gaps(e);
  const go = (v: View) => void navigate({ search: { view: v } });

  const persist = (patch: Record<string, unknown>, next?: string) => {
    const idx = next ? STAGES.findIndex((s) => s.key === next) : -1;
    // Moving on never moves the engagement backwards.
    const stage = next && idx > reached && e.stage !== "decided" ? { stage: next } : {};
    save.mutate(
      { data: { id: e.id, patch: { ...patch, ...stage } as never } },
      {
        onSuccess: async () => {
          await queryClient.invalidateQueries({ queryKey: ["engagement", e.id] });
          void queryClient.invalidateQueries({ queryKey: ["engagements"] });
          toast.success(
            "decision" in patch
              ? "Decision recorded."
              : next
                ? `Saved. On to ${STAGES[idx]!.title}.`
                : "Saved.",
          );
          if (next) go(next as View);
        },
      },
    );
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5">
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
            {e.brief.workflow && <span>{e.brief.workflow}</span>}
            {e.owner_name && (
              <span className="inline-flex items-center gap-1">
                <UserRound className="size-3.5" /> {e.owner_name}
              </span>
            )}
            <span>Updated {relative(e.updated_at)}</span>
          </p>
        </div>
        {e.decision && (
          <Pill tone={e.decision.choice === "stop" ? "neutral" : "success"}>
            Decided: {e.decision.choice}
          </Pill>
        )}
      </header>

      <nav
        aria-label="Engagement stages"
        className="grid gap-2 rounded-xl border border-border bg-card p-2 sm:grid-cols-5"
      >
        {STAGES.map((s, i) => {
          const done = i < reached && !(g[s.key] as string[]).length;
          const active = view === s.key;
          return (
            <button
              key={s.key}
              onClick={() => go(s.key)}
              aria-current={active ? "step" : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-colors",
                active ? "bg-primary/[0.07] ring-1 ring-primary/25" : "hover:bg-muted/60",
              )}
            >
              <span
                className={cn(
                  "grid size-7 shrink-0 place-items-center rounded-full text-[12px] font-semibold",
                  done
                    ? "bg-success text-white"
                    : active
                      ? "bg-primary text-primary-foreground"
                      : i <= reached
                        ? "bg-primary/15 text-primary"
                        : "bg-muted text-muted-foreground",
                )}
              >
                {done ? <Check className="size-3.5" /> : i + 1}
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold">{s.title}</span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {(g[s.key] as string[]).length && i <= reached
                    ? `Needs ${(g[s.key] as string[])[0]}`
                    : s.sub}
                </span>
              </span>
            </button>
          );
        })}
      </nav>

      {view === "listen" && (
        <ListenView key={e.updated_at} e={e} save={persist} saving={save.isPending} />
      )}
      {view === "assess" && (
        <AssessView key={e.updated_at} e={e} save={persist} saving={save.isPending} />
      )}
      {view === "map" && (
        <MapView
          key={e.updated_at}
          e={e}
          save={persist}
          saving={save.isPending}
          products={products}
        />
      )}
      {view === "propose" && (
        <ProposeView
          e={e}
          products={products}
          onNext={() => (reached < 4 ? persist({}, "prove") : go("prove"))}
        />
      )}
      {view === "prove" && (
        <ProveView
          key={e.updated_at}
          e={e}
          save={persist}
          saving={save.isPending}
          products={products}
          installs={installs}
        />
      )}
    </div>
  );
}
