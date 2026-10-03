/*
 * Know your customer (the playbook's first prep task): the snapshot, key stakeholders and the current Microsoft
 * relationship from MSX, and which of the four CAIP conversations to lead with, with the reasons. One click prepares
 * the chosen conversation.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, CheckCircle2, RefreshCw, Sparkles, Users, Workflow } from "lucide-react";
import { toast } from "sonner";

import { Pill } from "@/components/Primitives";
import { useConnector, useRefreshFromMsx } from "@/components/customer/hooks";
import { Button } from "@/components/ui/button";
import { recommendConversations } from "@/lib/conversations";
import { relative } from "@/lib/format";
import { FLAG_LABEL, TEAM_LABEL, cleanWorkload, fiscal } from "@/lib/msx-signals";
import { getCustomerPrep } from "@/lib/prep.functions";
import { CONVERSATIONS, type ConversationId } from "@/lib/se-playbook";
import { startDraft } from "@/lib/workspace.functions";

function Box({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="rounded-lg border border-border bg-background/60 p-3">
      <h3 className="text-[12.5px] font-semibold">{title}</h3>
      <div className="mt-1.5 text-[12.5px]">{children}</div>
    </section>
  );
}

export function KnowYourCustomer({
  customerId,
  tpid,
}: {
  customerId: string;
  tpid: string | null;
}) {
  const load = useServerFn(getCustomerPrep);
  const q = useQuery({
    queryKey: ["customer-prep", customerId],
    queryFn: () => load({ data: { id: customerId } }),
  });
  const conn = useConnector();
  const pull = useRefreshFromMsx(customerId);
  const navigate = useNavigate();
  const open = useServerFn(startDraft);
  const prepare = useMutation({
    mutationFn: (conversation?: ConversationId) =>
      open({ data: { customerId, ...(conversation ? { conversation } : {}) } }),
    onSuccess: (r) =>
      void navigate({
        to: "/engagements/$engagementId",
        params: { engagementId: r.id },
        search: { tab: r.status === "draft" ? "prep" : "overview" },
      }),
    onError: (e: Error) => toast.error(e.message),
  });

  const prep = q.data;
  const s = prep?.msx;
  const recs = recommendConversations(prep).filter((r) => r.score > 0);

  return (
    <section
      aria-label="Know your customer"
      className="mb-5 rounded-xl border border-border bg-card p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-[15px] font-semibold">Know your customer</h2>
          <p className="text-[12.5px] text-muted-foreground">
            {prep?.account.fetchedAt
              ? `From MSX, pulled ${relative(prep.account.fetchedAt)}.`
              : tpid
                ? "No MSX snapshot yet: refresh from MSX."
                : "No TPID: add one to read MSX."}
          </p>
        </div>
        <div className="flex gap-2">
          {tpid && conn.data?.state === "ready" && (
            <Button
              size="sm"
              variant="outline"
              disabled={pull.isPending}
              onClick={() => pull.mutate(tpid)}
            >
              <RefreshCw className="size-3.5" />
              {pull.isPending ? "Reading MSX…" : "Refresh from MSX"}
            </Button>
          )}
          <Button
            size="sm"
            disabled={prepare.isPending}
            onClick={() => prepare.mutate(recs[0]?.id)}
          >
            {prepare.isPending ? "Preparing…" : "Prepare a conversation"}
          </Button>
        </div>
      </div>

      {s ? (
        <div className="mt-3 grid gap-3 lg:grid-cols-3">
          <Box title="Snapshot">
            <p>
              {[s.industry, s.segment, s.country].filter(Boolean).join(" · ") ||
                "No industry in MSX"}
            </p>
            <p className="mt-1 text-muted-foreground">
              {prep.account.accounts != null && `${prep.account.accounts} accounts · `}
              {s.opportunities.length} open opportunit{s.opportunities.length === 1 ? "y" : "ies"}
            </p>
            {s.stages.length > 0 && (
              <ul className="mt-1 space-y-0.5 text-muted-foreground">
                {s.stages.map((x) => (
                  <li key={x.stage}>
                    {x.stage}: <span className="text-foreground">{x.count}</span>
                  </li>
                ))}
              </ul>
            )}
            {s.ownerTeams.length > 0 && (
              <p className="mt-1 text-muted-foreground">
                Owned by{" "}
                {s.ownerTeams.map((t) => `${TEAM_LABEL[t.team] ?? t.team} ${t.count}`).join(", ")}
              </p>
            )}
          </Box>

          <Box title="Key stakeholders">
            {s.contacts.length === 0 ? (
              <p className="text-muted-foreground">No customer contacts with a title in MSX.</p>
            ) : (
              <ul className="space-y-0.5">
                {s.contacts.slice(0, 6).map((c) => (
                  <li key={`${c.name}-${c.title}`} className="flex items-center gap-1.5 truncate">
                    <Users className="size-3.5 shrink-0 text-muted-foreground" />
                    {c.name}
                    {c.title && (
                      <span className="truncate text-muted-foreground"> · {c.title}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {s.team.length > 0 && (
              <p className="mt-2 text-muted-foreground">
                Account team:{" "}
                {s.team
                  .slice(0, 5)
                  .map((m) => (m.role ? `${m.name} (${m.role})` : m.name))
                  .join(", ")}
              </p>
            )}
          </Box>

          <Box title="Microsoft relationship">
            <p>
              <span className="font-medium">{s.committed}</span> committed ·{" "}
              <span className="font-medium">{s.uncommitted}</span> uncommitted milestones
              {s.rtc.length > 0 && (
                <>
                  {" "}
                  · <span className="font-medium">{s.rtc.length}</span> #RTC
                </>
              )}
            </p>
            <ul className="mt-1 space-y-0.5">
              {s.inMotion.slice(0, 4).map((w) => (
                <li key={w.workload} className="flex items-start gap-1.5">
                  <Workflow className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                  <span>
                    {cleanWorkload(w.workload)}
                    <span className="text-muted-foreground">
                      {" "}
                      · {w.next.status ?? "no status"}
                      {w.next.date && `, ${fiscal(w.next.date).label}`}
                    </span>
                  </span>
                </li>
              ))}
              {s.live.slice(0, 3).map((l) => (
                <li key={`live-${l.workload}`} className="flex items-start gap-1.5">
                  <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" />
                  {cleanWorkload(l.workload)}
                  <span className="text-muted-foreground"> · in production</span>
                </li>
              ))}
            </ul>
            {s.attention.slice(0, 2).map((a) => (
              <p key={a.milestone.id} className="mt-1 flex items-start gap-1.5">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
                <span>
                  <Pill
                    tone={
                      a.flags[0] === "blocked" || a.flags[0] === "overdue" ? "danger" : "warning"
                    }
                  >
                    {FLAG_LABEL[a.flags[0]!]}
                  </Pill>{" "}
                  {a.text}
                </span>
              </p>
            ))}
            {s.partners.length > 0 && (
              <p className="mt-1 text-muted-foreground">
                Partners:{" "}
                {s.partners
                  .map((p) => p.partner)
                  .slice(0, 4)
                  .join(", ")}
              </p>
            )}
          </Box>
        </div>
      ) : (
        q.isLoading && <p className="mt-2 text-[12.5px] text-muted-foreground">Loading…</p>
      )}

      <div className="mt-3">
        <h3 className="flex items-center gap-1.5 text-[12.5px] font-semibold">
          <Sparkles className="size-3.5 text-primary" /> Which conversation to lead with
        </h3>
        {recs.length === 0 ? (
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            Nothing in MSX or the notes points to one of the four conversations yet. Prepare a
            general discovery, or pick one:{" "}
            {CONVERSATIONS.map((c, i) => (
              <span key={c.id}>
                {i > 0 && " · "}
                <button
                  type="button"
                  className="text-primary underline"
                  onClick={() => prepare.mutate(c.id)}
                >
                  {c.title}
                </button>
              </span>
            ))}
          </p>
        ) : (
          <ul className="mt-1.5 grid gap-2 lg:grid-cols-3">
            {recs.slice(0, 3).map((r, i) => {
              const c = CONVERSATIONS.find((x) => x.id === r.id)!;
              return (
                <li key={r.id} className="rounded-lg border border-border p-3 text-[12.5px]">
                  <p className="font-medium">
                    {c.title} {i === 0 && <Pill tone="primary">Lead with this</Pill>}
                  </p>
                  <p className="mt-0.5 text-muted-foreground">{c.tagline}</p>
                  <ul className="mt-1 space-y-0.5 text-muted-foreground">
                    {r.reasons.map((x) => (
                      <li key={x}>· {x}</li>
                    ))}
                  </ul>
                  <Button
                    size="sm"
                    variant={i === 0 ? "default" : "outline"}
                    className="mt-2"
                    disabled={prepare.isPending}
                    onClick={() => prepare.mutate(r.id)}
                  >
                    Prepare this conversation
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
