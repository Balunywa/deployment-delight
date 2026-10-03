/*
 * The engagement workspace: one place from the first look at a customer to production. A persistent header (customer,
 * MSX link, phase, save state), compact journey navigation, the work in the middle, and a rail with the next action,
 * readiness checks and the working hypothesis. A draft is preparation, never a commitment.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  Building2,
  Check,
  PanelRightClose,
  PanelRightOpen,
  Presentation,
  UserRound,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { EmptyState, Pill } from "@/components/Primitives";
import { type Apply, Conversation, type Focus } from "@/components/engagement/Conversation";
import { MsxLink } from "@/components/engagement/MsxLink";
import { FitGapView, HandoffView, RecapView } from "@/components/engagement/Panels";
import { type CatalogProduct, ProveView } from "@/components/engagement/Prove";
import { RealizeView } from "@/components/engagement/Realize";
import { Button } from "@/components/ui/button";
import { CharterView } from "@/components/workspace/Charter";
import { ContextView } from "@/components/workspace/Context";
import { FindingsView } from "@/components/workspace/Findings";
import { HandoffPlanView } from "@/components/workspace/Handoff";
import { OverviewView } from "@/components/workspace/Overview";
import { MeetingView, PlanView } from "@/components/workspace/Plan";
import { PovView } from "@/components/workspace/Pov";
import { Rail } from "@/components/workspace/Rail";
import { ValidateView } from "@/components/workspace/Validate";
import { SaveIndicator } from "@/components/workspace/ui";
import { WsProvider, useWorkspaceSave, withUnsaved } from "@/components/workspace/ws";
import { advance } from "@/lib/conversation";
import type { Engagement } from "@/lib/engagements";
import { saveEngagement } from "@/lib/engagements.functions";
import { engagementQuery, productsQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";
import {
  PHASES,
  TAB_TITLE,
  type Tab,
  type WorkspaceEngagement,
  nextAction,
  phaseOf,
} from "@/lib/workspace";
import { type WorkspaceData, getWorkspace } from "@/lib/workspace.functions";

const TABS: Tab[] = [
  "overview",
  "context",
  "pov",
  "plan",
  "meeting",
  "findings",
  "charter",
  "prove",
  "handoff",
  "realize",
  "recap",
  "conversation",
  "fit",
];
const TITLE = TAB_TITLE;

export const Route = createFileRoute("/engagements/$engagementId")({
  validateSearch: (s: Record<string, unknown>): { tab?: Tab } => {
    // "prep" was the old preparation tab; the brief is its successor.
    const t = s["tab"] === "prep" ? "context" : s["tab"];
    return typeof t === "string" && (TABS as string[]).includes(t) ? { tab: t as Tab } : {};
  },
  head: () => ({ meta: [{ title: "Engagement · Cloud Delivery" }] }),
  component: EngagementPage,
});

function doneFor(e: WorkspaceEngagement, t: Tab) {
  const w = e.workspace;
  const plans = w.plans ?? [];
  switch (t) {
    case "pov":
      return !!(w.pov?.pressure.trim() || w.pov?.opening.trim());
    case "plan":
      return plans.length > 0;
    case "meeting":
      return plans.some((p) => p.held);
    case "findings":
      return plans.some((p) => p.review?.at);
    case "charter":
      return e.status === "active" && !!w.charter?.outcome.trim();
    case "prove":
      return !!e.decision;
    case "handoff":
      return !!w.handoff?.accepted;
    case "realize":
      return !!e.realization.confirmed;
    default:
      return false;
  }
}

function EngagementPage() {
  const { engagementId: id } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const queryClient = useQueryClient();
  const load = useServerFn(getWorkspace);
  const ws = useQuery({
    queryKey: ["workspace", id],
    queryFn: async () => withUnsaved(await load({ data: { id } })),
  });
  const legacy = useQuery(engagementQuery(id));
  const catalog = useQuery(productsQuery);
  const { saveWs, state } = useWorkspaceSave(id);
  const save = useMutation({ mutationFn: useServerFn(saveEngagement) });
  const [focus, setFocus] = useState<Focus>({});
  const [rail, setRail] = useState(true);
  // When an older view saves the engagement (a decision, the owner's confirmation…), refresh the workspace too.
  const legacyAt = legacy.data?.engagement.updated_at;
  const wsAt = ws.data?.engagement.updated_at;
  useEffect(() => {
    if (legacyAt && wsAt && new Date(legacyAt) > new Date(wsAt))
      void queryClient.invalidateQueries({ queryKey: ["workspace", id] });
  }, [legacyAt, wsAt, id, queryClient]);

  if (ws.isLoading || legacy.isLoading) return <EmptyState title="Loading engagement…" />;
  if (!ws.data || !legacy.data)
    return (
      <EmptyState
        title="Engagement not found"
        description={(ws.error ?? legacy.error)?.message ?? "It may have been removed."}
      />
    );
  const data = ws.data;
  const e = data.engagement;
  const draft = e.status === "draft";
  const tab: Tab = search.tab ?? (draft ? nextAction(e).tab : "overview");
  const go = (t: Tab) => void navigate({ search: { tab: t } });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["workspace", id] });
    void queryClient.invalidateQueries({ queryKey: ["engagement", id] });
    void queryClient.invalidateQueries({ queryKey: ["engagements"] });
  };
  const products: CatalogProduct[] = (catalog.data ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    outcome: (p as { outcome?: string | null }).outcome ?? null,
    offerings: p.offerings.map((o) => ({
      id: o.id,
      name: o.name,
      offering_type: o.offering_type,
      version: o.version,
    })),
  }));
  const legacyKey = engagementQuery(id).queryKey;
  // The older views save engagement fields through their own query; the workspace owns status and the workspace.
  const le = legacy.data
    ? ({ ...e, ...legacy.data.engagement, status: e.status, workspace: e.workspace } as Engagement)
    : (e as Engagement);
  const { installs } = legacy.data;

  // Engagement fields (findings, actions, decisions…) show at once and save in the background.
  const apply: Apply = (patch, message) => {
    const prevLegacy = queryClient.getQueryData(legacyKey);
    const prevWs = queryClient.getQueryData<WorkspaceData>(["workspace", id]);
    if (!("decision" in patch)) {
      queryClient.setQueryData(legacyKey, (old) =>
        old ? { ...old, engagement: { ...old.engagement, ...patch } as Engagement } : old,
      );
      queryClient.setQueryData<WorkspaceData>(["workspace", id], (old) =>
        old ? { ...old, engagement: { ...old.engagement, ...patch } as WorkspaceEngagement } : old,
      );
    }
    save.mutate(
      { data: { id, patch: patch as never } },
      {
        onSuccess: () => {
          if (message) toast.success(message);
          void queryClient.invalidateQueries({ queryKey: ["engagements"] });
          void queryClient.invalidateQueries({ queryKey: [...legacyKey, "recap"] });
          if ("decision" in patch || "results" in patch || "customer_id" in patch) refresh();
        },
        onError: (err: Error) => {
          queryClient.setQueryData(legacyKey, prevLegacy);
          queryClient.setQueryData(["workspace", id], prevWs);
          toast.error(err.message);
        },
      },
    );
  };

  const phase = phaseOf(e);
  const groups: { label: string; tabs: Tab[] }[] = draft
    ? [
        { label: "Prepare", tabs: ["context", "pov", "plan"] },
        { label: "Engage", tabs: ["meeting", "findings", "charter"] },
      ]
    : [
        { label: "", tabs: ["overview"] },
        { label: "Prepare", tabs: ["context", "pov", "plan"] },
        { label: "Engage", tabs: ["meeting", "findings", "charter"] },
        { label: "Deliver", tabs: ["prove", "handoff", "realize"] },
        { label: "Share", tabs: ["recap"] },
      ];
  const label = (t: Tab) => (draft && t === "charter" ? "Confirm and create" : TITLE[t]);

  return (
    <WsProvider value={{ data, e, saveWs, apply, save: state, go, refresh }}>
      <div className="mx-auto max-w-[1500px] space-y-4">
        <Link
          to="/engagements"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" /> Engagements
        </Link>

        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.14em] text-primary uppercase">
              Engagement
              <Pill tone={draft ? "warning" : phase === "closed" ? "neutral" : "primary"}>
                {le.realization.confirmed
                  ? "Value realized"
                  : le.decision
                    ? `Decided: ${le.decision.choice}`
                    : PHASES.find((p) => p.key === phase)?.title}
              </Pill>
            </p>
            <h1 className="mt-1 text-[24px] leading-tight font-bold tracking-tight">{e.name}</h1>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-muted-foreground">
              {e.customer_id ? (
                <Link
                  to="/customers/$customerId"
                  params={{ customerId: e.customer_id }}
                  className="inline-flex items-center gap-1 hover:text-foreground"
                >
                  <Building2 className="size-3.5" /> {e.customer_name}
                  {e.customer_tpid && <span className="font-mono">· TPID {e.customer_tpid}</span>}
                </Link>
              ) : (
                <span className="inline-flex items-center gap-1">
                  <Building2 className="size-3.5" /> No customer yet
                </span>
              )}
              {e.owner_name && (
                <span className="inline-flex items-center gap-1">
                  <UserRound className="size-3.5" /> {e.owner_name}
                </span>
              )}
              <MsxLink e={le} />
              <SaveIndicator save={state} />
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!draft && (
              <Button asChild variant="outline" size="sm">
                <Link to="/recap/$engagementId" params={{ engagementId: e.id }} target="_blank">
                  <Presentation className="size-3.5" /> Customer view
                </Link>
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setRail(!rail)}
              aria-pressed={rail}
              title={rail ? "Hide the summary" : "Show the summary"}
            >
              {rail ? (
                <PanelRightClose className="size-4" />
              ) : (
                <PanelRightOpen className="size-4" />
              )}
              <span className="sr-only">Summary</span>
            </Button>
          </div>
        </header>

        {draft && (
          <div className="rounded-lg border border-warning/40 bg-warning/5 px-4 py-2 text-[12.5px]">
            <span className="font-semibold">Preparing: not started with the customer.</span> Nothing
            here is a commitment, and MSX is never changed from this workspace.
          </div>
        )}

        <nav
          aria-label="Engagement"
          className="flex flex-wrap items-center gap-x-1 gap-y-2 border-b border-border pb-2"
        >
          {draft && e.customer_id && (
            <Link
              to="/customers/onboard"
              search={{
                customer: e.customer_id,
                ...(e.customer_tpid ? { tpid: e.customer_tpid } : {}),
              }}
              className="mr-1 inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12.5px] text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Check className="size-3 text-success" /> Customer
            </Link>
          )}
          {groups.map((g, gi) => (
            <div key={gi} className="flex items-center gap-0.5">
              {g.label && (
                <span className="mr-1 ml-2 text-[10.5px] font-semibold tracking-[0.08em] text-muted-foreground/70 uppercase">
                  {g.label}
                </span>
              )}
              {g.tabs.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => go(t)}
                  aria-current={tab === t ? "page" : undefined}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[13px] font-medium whitespace-nowrap transition-colors",
                    tab === t
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {doneFor(e, t) && <Check className="size-3 text-success" aria-hidden />}
                  {label(t)}
                </button>
              ))}
            </div>
          ))}
          {!draft && (
            <div className="ml-auto flex items-center gap-0.5">
              {(["conversation", "fit"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => go(t)}
                  aria-current={tab === t ? "page" : undefined}
                  className={cn(
                    "rounded-md px-2 py-1 text-[12px] whitespace-nowrap",
                    tab === t
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {TITLE[t]}
                </button>
              ))}
            </div>
          )}
        </nav>

        <div className={cn("grid gap-5", rail && "xl:grid-cols-[minmax(0,1fr)_300px]")}>
          <div className="min-w-0" key={`${e.id}-${tab}`}>
            {tab === "overview" && <OverviewView />}
            {tab === "context" && <ContextView />}
            {tab === "pov" && <PovView />}
            {tab === "plan" && <PlanView />}
            {tab === "meeting" && <MeetingView />}
            {tab === "findings" && <FindingsView />}
            {tab === "charter" && <CharterView />}
            {tab === "prove" && (
              <ValidateView>
                <ProveView
                  key={e.updated_at}
                  e={le}
                  save={(patch) =>
                    apply(
                      {
                        ...patch,
                        ...(patch["decision"] ? {} : advance(le, "prove")),
                      } as Partial<Engagement>,
                      "decision" in patch
                        ? (patch["decision"] as { choice?: string } | null)?.choice === "scale"
                          ? "Decision recorded. Next: hand off and realize the value."
                          : "Decision recorded."
                        : "Saved.",
                    )
                  }
                  saving={save.isPending}
                  products={products}
                  installs={installs}
                />
              </ValidateView>
            )}
            {tab === "handoff" && (
              <HandoffPlanView>
                <HandoffView e={le} products={products} apply={apply} showHandOff={false} />
              </HandoffPlanView>
            )}
            {tab === "realize" && (
              <RealizeView
                key={e.updated_at}
                e={le}
                products={products}
                installs={installs}
                apply={apply}
                onProve={() => go("prove")}
              />
            )}
            {tab === "recap" && <RecapView e={le} />}
            {tab === "conversation" && (
              <Conversation
                e={le}
                apply={apply}
                products={products}
                focus={focus}
                setFocus={setFocus}
                onTab={(t) => go(t as Tab)}
              />
            )}
            {tab === "fit" && (
              <FitGapView
                e={le}
                products={products}
                apply={apply}
                onAsk={(f) => {
                  setFocus(f);
                  go("conversation");
                }}
              />
            )}
          </div>
          {rail && (
            <div className="xl:sticky xl:top-16 xl:self-start">
              <Rail />
            </div>
          )}
        </div>
      </div>
    </WsProvider>
  );
}
