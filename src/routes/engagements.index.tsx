import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, Ear, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState, PageHeader, Pill } from "@/components/Primitives";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { NeedsYou } from "@/components/engagement/NeedsYou";
import { createEngagement } from "@/lib/engagements.functions";
import { relative } from "@/lib/format";
import { customersQuery, engagementsQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";
import {
  PHASES,
  allOk,
  nextAction,
  phaseOf,
  readinessOf,
  type Check,
  type Phase,
  type WorkspaceEngagement,
} from "@/lib/workspace";

type Search = { new?: string; phase?: Phase };

const phaseKeys = new Set<Phase>(PHASES.map((p) => p.key));

export const Route = createFileRoute("/engagements/")({
  validateSearch: (s: Record<string, unknown>): Search => {
    const search: Search = {};
    if (typeof s["new"] === "string") search.new = s["new"];
    if (typeof s["phase"] === "string" && phaseKeys.has(s["phase"] as Phase))
      search.phase = s["phase"] as Phase;
    return search;
  },
  head: () => ({ meta: [{ title: "Engagements · Cloud Delivery" }] }),
  component: Engagements,
});

function Engagements() {
  const list = useQuery(engagementsQuery);
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  // Started from a customer's page: open with that customer chosen.
  const [open, setOpen] = useState(!!search.new);
  const items = (list.data ?? []) as WorkspaceEngagement[];
  const selectedPhase = search.phase;
  const visibleItems = selectedPhase ? items.filter((e) => phaseOf(e) === selectedPhase) : items;
  const phaseCounts = PHASES.map((phase) => ({
    ...phase,
    count: items.filter((e) => phaseOf(e) === phase.key).length,
  }));
  const groups = PHASES.map((phase) => ({
    phase,
    items: visibleItems.filter((e) => phaseOf(e) === phase.key),
  })).filter((group) => group.items.length > 0);
  const choosePhase = (phase?: Phase) =>
    void navigate({
      search: (current: Search): Search => {
        const next: Search = {};
        if (current.new) next.new = current.new;
        if (phase) next.phase = phase;
        return next;
      },
    });

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Engagements"
        description="From the first look at a customer to production."
        actions={
          <>
            <Button asChild>
              <Link to="/customers/onboard">
                <Plus className="size-4" /> New engagement
              </Link>
            </Button>
            <Button variant="outline" onClick={() => setOpen(true)}>
              Start without a customer
            </Button>
          </>
        }
      />

      <NeedsYou className="mb-5" />

      <div className="mb-6 grid gap-2 sm:grid-cols-2 lg:grid-cols-7" aria-label="Filter by phase">
        <button
          type="button"
          aria-pressed={!selectedPhase}
          onClick={() => choosePhase()}
          className={phaseButtonClass(!selectedPhase)}
        >
          <span className="flex items-center justify-between gap-2">
            <span className="text-[13px] font-semibold">All</span>
            <span className="font-mono text-[11px] text-muted-foreground">{items.length}</span>
          </span>
          <span className="mt-1 block text-left text-[11.5px] text-muted-foreground">
            Every engagement
          </span>
        </button>
        {phaseCounts.map((phase) => (
          <button
            key={phase.key}
            type="button"
            aria-pressed={selectedPhase === phase.key}
            onClick={() => choosePhase(phase.key)}
            className={phaseButtonClass(selectedPhase === phase.key)}
          >
            <span className="flex items-center justify-between gap-2">
              <span className="text-[13px] font-semibold">{phase.title}</span>
              <span className="font-mono text-[11px] text-muted-foreground">{phase.count}</span>
            </span>
            <span className="mt-1 block text-left text-[11.5px] text-muted-foreground">
              {phase.sub}
            </span>
          </button>
        ))}
      </div>

      {list.isLoading ? (
        <EmptyState title="Loading engagements…" />
      ) : !items.length ? (
        <div className="space-y-3">
          <EmptyState
            title="No engagements yet"
            description="Onboard a customer by TPID to prepare your first conversation."
          />
          <div className="flex justify-center">
            <Button asChild>
              <Link to="/customers/onboard">
                <Plus className="size-4" /> New engagement
              </Link>
            </Button>
          </div>
        </div>
      ) : !groups.length ? (
        <EmptyState
          title="No engagements in this phase"
          description="Choose All or another phase to see the rest."
        />
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <section key={group.phase.key} aria-labelledby={`phase-${group.phase.key}`}>
              <div className="mb-2 flex items-end justify-between gap-3">
                <div>
                  <h2 id={`phase-${group.phase.key}`} className="text-[15px] font-semibold">
                    {group.phase.title}
                  </h2>
                  <p className="text-[12px] text-muted-foreground">{group.phase.sub}</p>
                </div>
                <span className="text-[11.5px] text-muted-foreground">
                  {group.items.length} {group.items.length === 1 ? "engagement" : "engagements"}
                </span>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {group.items.map((e) => (
                  <EngagementCard key={e.id} engagement={e} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
      <NewEngagement open={open} onOpenChange={setOpen} customer={search.new} />
    </div>
  );
}

function EngagementCard({ engagement: e }: { engagement: WorkspaceEngagement }) {
  const phase = phaseMeta(phaseOf(e));
  const next = nextAction(e);
  const readiness = readinessOf(e);
  const outcome = e.workspace.charter?.outcome || e.brief.outcome;
  return (
    <article className="group relative rounded-xl border border-border bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_14px_32px_-18px_rgba(30,64,175,0.45)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            to="/engagements/$engagementId"
            params={{ engagementId: e.id }}
            className="text-[15px] leading-tight font-semibold group-hover:text-primary after:absolute after:inset-0 after:rounded-xl after:content-['']"
          >
            {e.name}
          </Link>
          <p className="mt-0.5 line-clamp-1 text-[12px] text-muted-foreground">
            {e.customer_name ?? "No customer yet"}
            {e.msx_opportunity_id ? ` · MSX ${e.msx_opportunity_id}` : " · Proactive"}
          </p>
        </div>
        <Pill tone={phaseTone(phase.key)}>
          {phase.key === "preparing" ? "Preparing — not started with the customer" : phase.title}
        </Pill>
      </div>

      {outcome && <p className="mt-2 line-clamp-2 text-[12.5px] text-foreground/85">{outcome}</p>}

      <div className="mt-3 flex flex-wrap gap-2 text-[11.5px]">
        <ReadinessItem label="Discovery" checks={readiness.discovery} />
        <ReadinessItem label="Validation" checks={readiness.validation} />
        <ReadinessItem label="Handoff" checks={readiness.handoff} />
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2.5 text-[11.5px] text-muted-foreground">
        <Link
          to="/engagements/$engagementId"
          params={{ engagementId: e.id }}
          search={{ tab: next.tab }}
          className="relative z-10 inline-flex items-center gap-1 font-medium text-foreground hover:text-primary"
        >
          <ArrowRight className="size-3 text-primary" /> Next: {next.label}
        </Link>
        <span>
          {e.owner_name ?? "No owner"} · updated {relative(e.updated_at)}
        </span>
      </div>
    </article>
  );
}

function ReadinessItem({ label, checks }: { label: string; checks: Check[] }) {
  const ready = allOk(checks);
  const missing = checks.filter((check) => !check.ok).map((check) => check.label);
  return (
    <span
      title={missing.length ? `Missing: ${missing.join(", ")}` : "Ready"}
      className={cn(
        "inline-flex items-center gap-1",
        ready ? "text-success" : "text-muted-foreground",
      )}
    >
      <span
        className={cn("size-1.5 rounded-full", ready ? "bg-success" : "bg-muted-foreground/35")}
      />
      {label}
    </span>
  );
}

function phaseButtonClass(active: boolean) {
  return cn(
    "rounded-xl border px-3.5 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
    active
      ? "border-primary/40 bg-primary/5 shadow-[inset_0_1px_0_rgb(255_255_255/0.45)]"
      : "border-border bg-card hover:border-primary/30 hover:bg-muted/35",
  );
}

function phaseMeta(phase: Phase) {
  const found = PHASES.find((p) => p.key === phase);
  if (found) return found;
  switch (phase) {
    case "preparing":
      return { key: phase, title: "Preparing", sub: "Not started with the customer" };
    case "discovery":
      return { key: phase, title: "Discovery", sub: "Testing the point of view" };
    case "validation":
      return { key: phase, title: "Validation", sub: "Proving it against agreed criteria" };
    case "handoff":
      return { key: phase, title: "Handoff", sub: "Receiving team reviews and accepts" };
    case "delivery":
      return { key: phase, title: "Delivery and value", sub: "In production, measured" };
    case "closed":
      return { key: phase, title: "Closed", sub: "Decided or realized" };
  }
}

function phaseTone(phase: Phase): "neutral" | "success" | "warning" | "info" | "primary" {
  if (phase === "preparing") return "warning";
  if (phase === "closed") return "success";
  if (phase === "delivery") return "info";
  return "primary";
}

function NewEngagement({
  open,
  onOpenChange,
  customer,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  customer?: string | undefined;
}) {
  const customers = useQuery(customersQuery);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [customerId, setCustomerId] = useState<string>(customer ?? "none");
  const [origin, setOrigin] = useState<"opportunity" | "proactive">("proactive");
  const [oppId, setOppId] = useState("");
  const [oppName, setOppName] = useState("");
  const oppOk = origin === "proactive" || /^[A-Za-z0-9][A-Za-z0-9-]{2,63}$/.test(oppId.trim());
  const create = useMutation({
    mutationFn: useServerFn(createEngagement),
    onSuccess: (r: { id: string; created: boolean }) => {
      void queryClient.invalidateQueries({ queryKey: ["engagements"] });
      onOpenChange(false);
      toast.success(
        r.created
          ? "Engagement started. Start with what they're trying to accomplish."
          : "That opportunity already has an engagement, so it's opened instead of a duplicate.",
      );
      // No customer to prepare from: straight to the question bank to listen.
      void navigate({
        to: "/engagements/$engagementId",
        params: { engagementId: r.id },
        search: { tab: "conversation" },
      });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Ear className="size-4 text-primary" /> Start an engagement
          </DialogTitle>
          <DialogDescription>
            Name it after the outcome the customer wants, not the technology.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="eng-name">Engagement</Label>
            <Input
              id="eng-name"
              placeholder="e.g. Maintenance work packages in days, not weeks"
              value={name}
              onChange={(ev) => setName(ev.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Customer</Label>
            <Select value={customerId} onValueChange={setCustomerId}>
              <SelectTrigger aria-label="Customer">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not a customer yet</SelectItem>
                {(customers.data ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Tracked in MSX</Label>
            <div role="radiogroup" aria-label="Tracked in MSX" className="grid grid-cols-2 gap-1.5">
              {(
                [
                  ["opportunity", "Under an opportunity", "A seller or specialist brought it in."],
                  ["proactive", "Proactive", "No opportunity yet; link one later."],
                ] as const
              ).map(([k, t, b]) => (
                <button
                  key={k}
                  role="radio"
                  aria-checked={origin === k}
                  onClick={() => setOrigin(k)}
                  className={cn(
                    "rounded-md border p-2 text-left",
                    origin === k ? "border-primary bg-primary/5" : "border-border",
                  )}
                >
                  <span className="block text-[12.5px] font-medium">{t}</span>
                  <span className="block text-[11.5px] text-muted-foreground">{b}</span>
                </button>
              ))}
            </div>
            {origin === "opportunity" && (
              <div className="grid grid-cols-[150px_1fr] gap-1.5">
                <Input
                  aria-label="Opportunity ID"
                  placeholder="7-ABC123XYZ"
                  value={oppId}
                  onChange={(ev) => setOppId(ev.target.value)}
                />
                <Input
                  aria-label="Opportunity name"
                  placeholder="Opportunity name (optional)"
                  value={oppName}
                  onChange={(ev) => setOppName(ev.target.value)}
                />
              </div>
            )}
            <p className="text-[11.5px] text-muted-foreground">
              Internal only. MSX stays the record; this keeps the link, and never shows it to the
              customer.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={name.trim().length < 3 || !oppOk || create.isPending}
            onClick={() =>
              create.mutate({
                data: {
                  name: name.trim(),
                  customerId: customerId === "none" ? null : customerId,
                  signals: [],
                  words: "",
                  ...(origin === "opportunity"
                    ? {
                        opportunityId: oppId.trim(),
                        ...(oppName.trim() ? { opportunityName: oppName.trim() } : {}),
                      }
                    : {}),
                },
              })
            }
          >
            Start listening
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
