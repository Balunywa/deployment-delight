/*
 * The prep, laid out the way the FY27 Cloud + AI Solution Engineers Playbook works: prepare (know the customer and
 * pick the conversation), engage (open, discover, propose), handle objections, then execute in MSX (log the
 * high-value activity, drive the conversation's milestones from uncommitted to committed, #RTC for the CSU handoff).
 * Everything is drafted from MSX, the notes and the playbook, editable in place, and saves as you type.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCopy,
  Plus,
  RefreshCw,
  Sparkles,
  Users,
  Workflow,
  X,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";

import { Pill } from "@/components/Primitives";
import { MsxConnect } from "@/components/customer/MsxConnect";
import { useConnector, useRefreshFromMsx } from "@/components/customer/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  conversationById,
  decisionMakersAmong,
  milestonesFor,
  recommendConversations,
} from "@/lib/conversations";
import { relative } from "@/lib/format";
import { FLAG_LABEL, fiscal, niceName } from "@/lib/msx-signals";
import { DURATIONS, PURPOSES, PURPOSE_ORDER, type Purpose } from "@/lib/playbook";
import {
  COMMITMENT_CRITERIA,
  CONVERSATIONS,
  type ConversationId,
  HIGH_VALUE_ACTIVITIES,
  PLAYBOOK_SOURCE,
} from "@/lib/se-playbook";
import { type CallPlan, agendaFor, buildPlan, cleanWorkload, draftPov, uid } from "@/lib/workspace";
import { redraftPrep } from "@/lib/workspace.functions";

import { Panel } from "./ui";
import { discardPending, useWs, useWsValue } from "./ws";

const SHOWN_QUESTIONS = 8;

/** The high-value activity to log in MSX after a meeting of this purpose (playbook: HVA definitions). */
const HVA_FOR: Record<Purpose, string[]> = {
  discovery: ["Solution Whiteboarding", "Assessment"],
  architecture: ["Architecture Design Session", "Solution Whiteboarding"],
  workshop: ["Technical Workshop"],
  demo: ["Demo"],
  poc: ["POC/Pilot", "Rapid Prototyping"],
  kickoff: ["Technical Close/Win Plan"],
};

function Step({
  n,
  title,
  sub,
  children,
  actions,
  tone,
}: {
  n: number;
  title: string;
  sub?: string;
  children: ReactNode;
  actions?: ReactNode;
  tone?: "primary";
}) {
  return (
    <Panel
      label={title}
      tone={tone}
      title={
        <span className="flex items-center gap-2">
          <span className="grid size-5 place-items-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
            {n}
          </span>
          {title}
        </span>
      }
      sub={sub}
      actions={actions}
    >
      {children}
    </Panel>
  );
}

export function PrepView() {
  const { data, e, go, refresh } = useWs();
  const [pov, setPov] = useWsValue("pov", "Point of view");
  const [stored, setPlans] = useWsValue("plans", "Call plan");
  const plans = stored ?? [];
  const plan = plans.find((p) => !p.held) ?? plans.at(-1) ?? null;
  const setPlan = (p: CallPlan) => setPlans(plans.map((x) => (x.id === p.id ? p : x)));
  const conn = useConnector();
  const pull = useRefreshFromMsx(data.customer?.id ?? null);
  const [newQ, setNewQ] = useState("");
  const queryClient = useQueryClient();
  const redraftFn = useServerFn(redraftPrep);
  const redraft = useMutation({
    mutationFn: async () => {
      discardPending(e.id, ["pov", "plans"]);
      await redraftFn({ data: { id: e.id } });
      await queryClient.invalidateQueries({ queryKey: ["workspace", e.id] });
    },
    onSuccess: () =>
      toast.success("Redrafted from the evidence. It keeps itself current until you edit it."),
    onError: (err: Error) => toast.error(err.message),
  });
  const held = plans.some((p) => p.held);

  if (!data.customer || !data.prep)
    return (
      <Panel title="No customer yet" tone="warning">
        <p className="text-[13px]">
          The prep is built from the customer's MSX record and your notes. Onboard the customer by
          TPID, or link one from the engagement header.
        </p>
      </Panel>
    );
  const prep = data.prep;
  const s = prep.msx;
  const customer = data.customer;
  const name = niceName(customer.name);

  if (!plan || !pov)
    return (
      <Panel title="Prepare this conversation" tone="primary">
        <p className="text-[13px]">
          Draft the opening, the questions and the agenda from MSX, your notes and the SE playbook.
          You can change everything afterwards.
        </p>
        <Button
          className="mt-3"
          onClick={() => {
            const p = pov ?? draftPov(prep, data.items);
            if (!pov) setPov(p);
            setPlans([
              ...plans,
              buildPlan({
                purpose: "discovery",
                duration: 60,
                pov: p,
                prep,
                customer: customer.name,
              }),
            ]);
          }}
        >
          Draft the prep
        </Button>
      </Panel>
    );

  const recs = recommendConversations(prep);
  const conv = conversationById(plan.conversation);
  const rec = recs.find((r) => r.id === plan.conversation);
  const top = recs[0] && recs[0].score > 0 ? recs[0] : null;

  /** A new plan for another conversation or purpose; what the SE wrote in the meeting stays. */
  const rebuild = (patch: {
    conversation?: ConversationId | null;
    purpose?: Purpose;
    duration?: number;
  }) => {
    const next = buildPlan({
      purpose: patch.purpose ?? plan.purpose,
      duration: patch.duration ?? plan.duration,
      pov,
      prep,
      customer: customer.name,
      conversation:
        patch.conversation === undefined ? (plan.conversation ?? null) : patch.conversation,
    });
    setPlan({
      ...next,
      id: plan.id,
      opening: plan.opening,
      date: plan.date,
      audience: plan.audience,
      notes: plan.notes,
      answers: plan.answers,
    });
  };
  const setLength = (duration: number) =>
    setPlan({ ...plan, duration, agenda: agendaFor(plan.purpose, duration) });

  const questions = plan.questions;
  const setQuestion = (id: string, text: string) =>
    setPlan({ ...plan, questions: questions.map((q) => (q.id === id ? { ...q, text } : q)) });
  const removeQuestion = (id: string) =>
    setPlan({ ...plan, questions: questions.filter((q) => q.id !== id) });
  const addQuestion = () => {
    if (!newQ.trim()) return;
    setPlan({
      ...plan,
      questions: [...questions, { id: uid("q"), text: newQ.trim(), why: "", source: "own" }],
    });
    setNewQ("");
  };

  const contacts = s?.contacts.slice(0, 6) ?? [];
  const deciders = conv ? decisionMakersAmong(conv, s?.contacts ?? []) : [];
  const team = data.team?.slice(0, 6) ?? [];
  const age = prep.account.fetchedAt;
  const convMilestones = conv && s ? milestonesFor(conv, s.open) : [];
  const hvas = HVA_FOR[plan.purpose]
    .map((n) => HIGH_VALUE_ACTIVITIES.find((h) => h.name.toLowerCase().startsWith(n.toLowerCase())))
    .filter((h): h is (typeof HIGH_VALUE_ACTIVITIES)[number] => !!h);

  const brief = () =>
    [
      `# ${plan.title}`,
      [conv?.title, PURPOSES[plan.purpose].label, `${plan.duration} minutes`]
        .filter(Boolean)
        .join(" · "),
      "",
      "## Open",
      plan.opening,
      "",
      "## Discover",
      ...questions.map((q, i) => `${i + 1}. ${q.text}`),
      ...(conv?.scenarios.length
        ? [
            "",
            "## Propose: scenarios to go deeper",
            ...conv.scenarios.slice(0, 3).map((x) => `- ${x.title}`),
          ]
        : []),
      "",
      `Next step to ask for: ${plan.nextStep}`,
      ...(plan.objections.length
        ? [
            "",
            "## If you hear",
            ...plan.objections.slice(0, 3).map((o) => `- "${o.text}" ${o.explore}`),
          ]
        : []),
      "",
      "## Agenda",
      ...plan.agenda.map((a) => `- ${a.minutes} min: ${a.item}`),
      "",
      "## The account",
      [name, customer.tpid && `TPID ${customer.tpid}`, s?.industry, s?.country]
        .filter(Boolean)
        .join(" · "),
      ...(s?.inMotion.length
        ? [
            "",
            "## What Microsoft is driving (MSX)",
            ...s.inMotion
              .slice(0, 6)
              .map(
                (w) =>
                  `- ${w.workload}: next “${w.next.name}” (${w.next.status ?? "no status"}${w.next.date ? `, ${fiscal(w.next.date).label}` : ""})`,
              ),
          ]
        : []),
      ...(s?.attention.length
        ? ["", "## Stuck (MSX)", ...s.attention.slice(0, 4).map((a) => `- ${a.text}`)]
        : []),
      ...(contacts.length
        ? [
            "",
            "## Customer contacts (MSX)",
            ...contacts.map((c) => `- ${c.name}${c.title ? `, ${c.title}` : ""}`),
          ]
        : []),
      ...(prep.gaps.length ? ["", "## Not known yet", ...prep.gaps.map((g) => `- ${g}`)] : []),
    ].join("\n");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[17px] font-semibold tracking-tight">Your prep for {name}</h2>
          <p className="text-[12.5px] text-muted-foreground">
            Drafted from MSX{age ? ` (pulled ${relative(age)})` : ""}, your notes and the{" "}
            {PLAYBOOK_SOURCE}. Change anything; it saves as you type.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {customer.tpid && conn.data?.state === "ready" && (
            <Button
              size="sm"
              variant="outline"
              disabled={pull.isPending}
              onClick={() => pull.mutate(customer.tpid!, { onSuccess: () => refresh() })}
            >
              <RefreshCw className="size-3.5" />
              {pull.isPending ? "Reading MSX…" : "Refresh from MSX"}
            </Button>
          )}
          {!held && (
            <Button
              size="sm"
              variant="ghost"
              disabled={redraft.isPending}
              onClick={() => {
                if (
                  window.confirm(
                    "Replace the opening, questions and agenda with a fresh draft from MSX, your notes and the playbook? Your edits to them are replaced; the old point of view stays in its history.",
                  )
                )
                  redraft.mutate();
              }}
            >
              <RefreshCw className="size-3.5" />
              {redraft.isPending ? "Redrafting…" : "Redraft from the evidence"}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              void navigator.clipboard
                .writeText(brief())
                .then(() =>
                  toast.success(
                    "Meeting brief copied. Paste it into Teams, OneNote or the invite.",
                  ),
                )
            }
          >
            <ClipboardCopy className="size-3.5" /> Copy meeting brief
          </Button>
          <Button size="sm" onClick={() => go("meeting")}>
            Start the meeting
          </Button>
        </div>
      </div>
      {customer.tpid && conn.data?.state !== "ready" && <MsxConnect />}

      <section
        aria-label="The conversation"
        className="rounded-xl border border-primary/30 bg-primary/[0.03] p-4"
      >
        <div className="flex flex-wrap items-center gap-2">
          <Sparkles className="size-4 text-primary" />
          <label htmlFor="prep-conversation" className="text-[13px] font-semibold">
            The conversation
          </label>
          <select
            id="prep-conversation"
            aria-label="Conversation"
            value={plan.conversation ?? ""}
            onChange={(ev) =>
              rebuild({ conversation: (ev.target.value || null) as ConversationId | null })
            }
            className="h-8 rounded-md border border-input bg-background px-2 text-[13px]"
          >
            <option value="">General discovery (no play)</option>
            {CONVERSATIONS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
                {top?.id === c.id ? " (recommended)" : ""}
              </option>
            ))}
          </select>
          <select
            aria-label="Purpose"
            value={plan.purpose}
            onChange={(ev) => rebuild({ purpose: ev.target.value as Purpose })}
            className="h-8 rounded-md border border-input bg-background px-2 text-[13px]"
          >
            {PURPOSE_ORDER.map((p) => (
              <option key={p} value={p}>
                {PURPOSES[p].label}
              </option>
            ))}
          </select>
          <select
            aria-label="Length"
            value={plan.duration}
            onChange={(ev) => setLength(Number(ev.target.value))}
            className="h-8 rounded-md border border-input bg-background px-2 text-[13px]"
          >
            {DURATIONS.map((d) => (
              <option key={d} value={d}>
                {d} min
              </option>
            ))}
          </select>
        </div>
        {conv ? (
          <div className="mt-2 grid gap-3 text-[12.5px] lg:grid-cols-3">
            <div className="lg:col-span-1">
              <p className="font-medium">{conv.tagline}</p>
              {rec && rec.reasons.length > 0 ? (
                <ul className="mt-1 space-y-0.5 text-muted-foreground">
                  {rec.reasons.map((r) => (
                    <li key={r}>· {r}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-muted-foreground">
                  Nothing in MSX or your notes points here yet.
                </p>
              )}
            </div>
            <div>
              <p className="font-medium">Why now</p>
              <p className="mt-0.5 text-muted-foreground">{conv.whyNow}</p>
            </div>
            <div>
              <p className="font-medium">Who decides</p>
              <p className="mt-0.5 text-muted-foreground">{conv.decisionMakers.join(" · ")}</p>
            </div>
          </div>
        ) : (
          <p className="mt-2 text-[12.5px] text-muted-foreground">
            {top
              ? `MSX and your notes point to ${top.title}: ${top.reasons.join("; ")}. Pick it to get its discovery questions, objections and next steps.`
              : "Nothing in MSX or your notes points to one of the four conversations yet. Keep it general, or pick one."}
          </p>
        )}
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <Step
            n={1}
            title="Open with"
            sub="A working hypothesis, not a pitch. Say it in your own words."
            tone="primary"
          >
            <Textarea
              aria-label="Opening"
              rows={4}
              value={plan.opening}
              onChange={(ev) => setPlan({ ...plan, opening: ev.target.value })}
              className="text-[13.5px]"
            />
            {conv?.hook && (
              <p className="mt-1.5 text-[11.5px] text-muted-foreground">
                <span className="font-medium text-foreground">Hook ({conv.title}):</span>{" "}
                {conv.hook}
              </p>
            )}
          </Step>

          <Step
            n={2}
            title="Discover"
            sub="Open questions, in order: their outcomes, what MSX shows, the playbook's discovery questions, timing and who decides. The grey line is why, for you."
            actions={
              <span className="text-[11.5px] text-muted-foreground">
                {questions.length} question{questions.length === 1 ? "" : "s"}
              </span>
            }
          >
            <ol className="space-y-2">
              {questions.slice(0, SHOWN_QUESTIONS).map((q, i) => (
                <li key={q.id} className="flex items-start gap-2">
                  <span className="mt-2 w-4 shrink-0 text-right text-[12px] text-muted-foreground">
                    {i + 1}.
                  </span>
                  <div className="min-w-0 flex-1">
                    <Textarea
                      aria-label={`Question ${i + 1}`}
                      rows={2}
                      value={q.text}
                      onChange={(ev) => setQuestion(q.id, ev.target.value)}
                      className="min-h-0 resize-none text-[13px]"
                    />
                    {q.why && <p className="mt-0.5 text-[11.5px] text-muted-foreground">{q.why}</p>}
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Remove question ${i + 1}`}
                    onClick={() => removeQuestion(q.id)}
                  >
                    <X className="size-3.5" />
                  </Button>
                </li>
              ))}
            </ol>
            {questions.length > SHOWN_QUESTIONS && (
              <button
                type="button"
                className="mt-2 text-[12px] text-primary underline"
                onClick={() => go("plan")}
              >
                {questions.length - SHOWN_QUESTIONS} more in the call plan
              </button>
            )}
            <form
              className="mt-3 flex gap-2"
              onSubmit={(ev) => {
                ev.preventDefault();
                addQuestion();
              }}
            >
              <Input
                aria-label="Add a question"
                placeholder="Add your own question"
                value={newQ}
                onChange={(ev) => setNewQ(ev.target.value)}
              />
              <Button type="submit" variant="outline" disabled={!newQ.trim()}>
                <Plus className="size-3.5" /> Add
              </Button>
            </form>
          </Step>

          <Step
            n={3}
            title="Propose"
            sub="Where to go deeper once you've heard them, and the next step to ask for."
          >
            <div className="space-y-3 text-[12.5px]">
              {conv && conv.scenarios.length > 0 && (
                <div>
                  <p className="font-medium">Scenarios to go deeper ({conv.title})</p>
                  <ul className="mt-1 space-y-1">
                    {conv.scenarios.slice(0, 3).map((x) => (
                      <li key={x.title}>
                        <span className="font-medium">{x.title}</span>
                        <span className="text-muted-foreground"> · {x.summary}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div>
                <p className="font-medium">Ask for this next step</p>
                <p className="mt-0.5 text-muted-foreground">{plan.nextStep}</p>
              </div>
              {conv?.workshop.name && (
                <div>
                  <p className="font-medium">Leave behind: {conv.workshop.name}</p>
                  {conv.workshop.outcome && (
                    <p className="mt-0.5 text-muted-foreground">{conv.workshop.outcome}</p>
                  )}
                  {conv.workshop.modules.length > 0 && (
                    <p className="mt-0.5 text-muted-foreground">
                      Modules: {conv.workshop.modules.slice(0, 5).join(" · ")}
                    </p>
                  )}
                </div>
              )}
            </div>
          </Step>

          {plan.objections.length > 0 && (
            <Step n={4} title="If you hear…" sub="Objections worth exploring, and how to answer.">
              <ul className="space-y-2.5 text-[12.5px]">
                {plan.objections.slice(0, 4).map((o) => (
                  <li key={o.text}>
                    <p className="font-medium">“{o.text.replace(/^[“"]|[”"]$/g, "")}”</p>
                    <p className="mt-0.5 text-muted-foreground">{o.explore}</p>
                  </li>
                ))}
              </ul>
            </Step>
          )}
        </div>

        <div className="space-y-4">
          <Panel title="Agenda" sub={`${PURPOSES[plan.purpose].label} · ${plan.duration} minutes`}>
            <ol className="space-y-1 text-[13px]">
              {plan.agenda.map((a, i) => (
                <li key={i} className="flex gap-3">
                  <span className="w-14 shrink-0 text-muted-foreground">{a.minutes} min</span>
                  {a.item}
                </li>
              ))}
            </ol>
            <div className="mt-3 text-[12.5px]">
              <p className="font-medium">Listen for</p>
              <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-muted-foreground">
                {plan.listenFor.slice(0, 5).map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </div>
          </Panel>

          <Panel title="The account">
            <p className="text-[14px] font-medium">{name}</p>
            <p className="text-[12.5px] text-muted-foreground">
              {[
                customer.tpid && `TPID ${customer.tpid}`,
                s?.industry,
                s?.country,
                prep.account.accounts != null && `${prep.account.accounts} accounts in MSX`,
                `${prep.origin.length} open opportunit${prep.origin.length === 1 ? "y" : "ies"}`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {s && s.stages.length > 0 && (
              <p className="mt-1 text-[12px] text-muted-foreground">
                By stage: {s.stages.map((x) => `${x.stage} ${x.count}`).join(" · ")}
              </p>
            )}
            {team.length > 0 && (
              <div className="mt-2 text-[12.5px]">
                <p className="font-medium">Microsoft account team</p>
                <ul className="mt-0.5 grid gap-x-3 sm:grid-cols-2">
                  {team.map((m) => (
                    <li key={`${m.name}-${m.role}`} className="truncate">
                      {m.name}
                      {m.role && <span className="text-muted-foreground"> · {m.role}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Panel>

          {s && (
            <Panel title="What Microsoft is driving">
              {s.inMotion.length === 0 && s.live.length === 0 ? (
                <p className="text-[12.5px] text-muted-foreground">
                  No milestones in MSX yet: nothing is planned for a workload.
                </p>
              ) : (
                <ul className="space-y-1.5 text-[12.5px]">
                  {s.inMotion.slice(0, 6).map((w) => (
                    <li key={w.workload} className="flex items-start gap-1.5">
                      <Workflow className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                      <span>
                        <span className="font-medium">{cleanWorkload(w.workload)}</span>
                        <span className="text-muted-foreground">
                          {" "}
                          · {w.next.status ?? "no status"}
                          {w.next.date && `, ${fiscal(w.next.date).label}`}
                          {w.next.ownerTeam && ` · ${w.next.ownerTeam}`}
                        </span>
                      </span>
                    </li>
                  ))}
                  {s.live.slice(0, 4).map((l) => (
                    <li key={`live-${l.workload}`} className="flex items-start gap-1.5">
                      <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" />
                      <span>
                        <span className="font-medium">{cleanWorkload(l.workload)}</span>
                        <span className="text-muted-foreground"> · in production</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {s.attention.length > 0 && (
                <div className="mt-3 border-t border-border pt-2">
                  <p className="flex items-center gap-1 text-[12.5px] font-medium">
                    <AlertTriangle className="size-3.5 text-warning" /> Stuck or stale
                  </p>
                  <ul className="mt-1 space-y-1.5 text-[12px]">
                    {s.attention.slice(0, 3).map((a) => (
                      <li key={a.milestone.id}>
                        <Pill
                          tone={
                            a.flags[0] === "blocked" || a.flags[0] === "overdue"
                              ? "danger"
                              : "warning"
                          }
                        >
                          {FLAG_LABEL[a.flags[0]!]}
                        </Pill>{" "}
                        {a.text}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {s.partners.length > 0 && (
                <p className="mt-2 text-[12px] text-muted-foreground">
                  Partners:{" "}
                  {s.partners
                    .slice(0, 4)
                    .map((p) => p.partner)
                    .join(", ")}
                </p>
              )}
            </Panel>
          )}

          <Panel title="Who to talk to">
            {conv && (
              <p className="mb-2 text-[12px] text-muted-foreground">
                For {conv.title}, the decision makers are {conv.decisionMakers.join(", ")}.
                {deciders.length > 0
                  ? ` In MSX: ${deciders
                      .map((d) => `${d.name} (${d.title})`)
                      .slice(0, 3)
                      .join(", ")}.`
                  : " None of the MSX contacts has that title: ask the account team who it is."}
              </p>
            )}
            {contacts.length === 0 ? (
              <p className="text-[12.5px] text-muted-foreground">
                MSX has no customer contacts with a title. Ask the account team who owns this.
              </p>
            ) : (
              <ul className="space-y-0.5 text-[12.5px]">
                {contacts.map((c) => (
                  <li key={`${c.name}-${c.title}`} className="flex items-center gap-1.5">
                    <Users className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">
                      {c.name}
                      {c.title && <span className="text-muted-foreground"> · {c.title}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-1.5 text-[11.5px] text-muted-foreground">
              From MSX contacts, senior first. Who decides isn't in MSX: confirm it.
            </p>
          </Panel>

          <Panel
            title="After the call: execute in MSX"
            sub="Win the technical decision and keep MSX clean."
          >
            <div className="space-y-3 text-[12.5px]">
              {hvas.length > 0 && (
                <div>
                  <p className="font-medium">Log the high-value activity on the milestone</p>
                  <ul className="mt-0.5 space-y-0.5 text-muted-foreground">
                    {hvas.map((h) => (
                      <li key={h.name}>
                        <span className="text-foreground">{h.name}</span>: {h.definition}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {conv && s && (
                <div>
                  <p className="font-medium">{conv.title} milestones in MSX</p>
                  {convMilestones.length === 0 ? (
                    <p className="mt-0.5 text-muted-foreground">
                      None yet. If the customer agrees on an outcome, create an uncommitted
                      milestone with the specialist.
                    </p>
                  ) : (
                    <ul className="mt-0.5 space-y-0.5 text-muted-foreground">
                      {convMilestones.slice(0, 5).map((m) => (
                        <li key={m.id}>
                          <span className="text-foreground">{m.name}</span> ·{" "}
                          {m.commitment ?? "no commitment"}
                          {m.category && ` · ${m.category}`}
                          {m.date && ` · ${fiscal(m.date).label}`}
                        </li>
                      ))}
                    </ul>
                  )}
                  {convMilestones.some((m) => m.commitment !== "Committed") && (
                    <p className="mt-1 text-muted-foreground">
                      Drive the uncommitted ones to committed: prove the solution, then mark #RTC
                      for the CSU handoff.
                    </p>
                  )}
                </div>
              )}
              <div>
                <p className="font-medium">Ready to commit (#RTC) when</p>
                <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-muted-foreground">
                  {COMMITMENT_CRITERIA.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </div>
            </div>
          </Panel>

          {prep.gaps.length > 0 && (
            <Panel title="Not known yet">
              <ul className="list-disc space-y-0.5 pl-4 text-[12.5px] text-muted-foreground">
                {prep.gaps.map((g) => (
                  <li key={g}>{g}</li>
                ))}
              </ul>
              <button
                type="button"
                className="mt-2 text-[12px] text-primary underline"
                onClick={() => go("context")}
              >
                Add notes, emails or a transcript
              </button>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
