/*
 * The prep: everything an SE needs before the conversation, on one page and already drafted from MSX and the notes.
 * What to say first, what to ask, the agenda, who to talk to, what Microsoft is already driving at the account and
 * what's stuck, and what we don't know yet. Everything is editable in place and saves as you type; the detailed
 * tabs (context, point of view, call plan) hold the rest.
 */
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCopy,
  Plus,
  RefreshCw,
  Users,
  Workflow,
  X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Pill } from "@/components/Primitives";
import { MsxConnect } from "@/components/customer/MsxConnect";
import { useConnector, useRefreshFromMsx } from "@/components/customer/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { relative } from "@/lib/format";
import { FLAG_LABEL, fiscal, niceName } from "@/lib/msx-signals";
import { DURATIONS, PURPOSES, PURPOSE_ORDER, type Purpose } from "@/lib/playbook";
import { type CallPlan, agendaFor, buildPlan, cleanWorkload, draftPov, uid } from "@/lib/workspace";

import { Panel } from "./ui";
import { useWs, useWsValue } from "./ws";

const SHOWN_QUESTIONS = 7;

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

  if (!plan || !pov)
    return (
      <Panel title="Prepare this conversation" tone="primary">
        <p className="text-[13px]">
          Draft the opening, the questions and the agenda from MSX and your notes. You can change
          everything afterwards.
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

  const setPurpose = (purpose: Purpose, duration = plan.duration) => {
    const g = PURPOSES[purpose];
    setPlan({
      ...plan,
      purpose,
      duration,
      title: `${g.label} with ${customer.name}`,
      outcome: g.aim,
      agenda: agendaFor(purpose, duration),
      listenFor: [...g.listenFor],
      objections: [...g.objections],
      nextStep: g.nextStep,
      participants: g.participants,
    });
  };
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
  const team = data.team?.slice(0, 6) ?? [];
  const age = prep.account.fetchedAt;

  const brief = () =>
    [
      `# ${plan.title}`,
      `${PURPOSES[plan.purpose].label} · ${plan.duration} minutes`,
      "",
      "## Opening",
      plan.opening,
      "",
      "## Questions",
      ...questions.map((q, i) => `${i + 1}. ${q.text}`),
      "",
      "## Agenda",
      ...plan.agenda.map((a) => `- ${a.minutes} min: ${a.item}`),
      "",
      "## The account",
      [customer.name, customer.tpid && `TPID ${customer.tpid}`, s?.industry, s?.country]
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
      "",
      `Next step to ask for: ${plan.nextStep}`,
    ].join("\n");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[17px] font-semibold tracking-tight">
            Your prep for {niceName(customer.name)}
          </h2>
          <p className="text-[12.5px] text-muted-foreground">
            Drafted from MSX{age ? ` (pulled ${relative(age)})` : ""} and your notes. Change
            anything; it saves as you type.
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

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <Panel
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
            <p className="mt-1.5 text-[11.5px] text-muted-foreground">
              Drafted from what MSX shows. The hypothesis behind it is in your point of view.{" "}
              <button type="button" className="underline" onClick={() => go("pov")}>
                Edit the details
              </button>
            </p>
          </Panel>

          <Panel
            title="Ask"
            sub="Open questions, in order: their outcomes, then what MSX shows, the timing and who decides. The grey line is why, for you."
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
          </Panel>

          <Panel
            title="Agenda"
            actions={
              <>
                <select
                  aria-label="Purpose"
                  value={plan.purpose}
                  onChange={(ev) => setPurpose(ev.target.value as Purpose)}
                  className="h-8 rounded-md border border-input bg-background px-2 text-[12.5px]"
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
                  onChange={(ev) => setPurpose(plan.purpose, Number(ev.target.value))}
                  className="h-8 rounded-md border border-input bg-background px-2 text-[12.5px]"
                >
                  {DURATIONS.map((d) => (
                    <option key={d} value={d}>
                      {d} min
                    </option>
                  ))}
                </select>
              </>
            }
          >
            <ol className="space-y-1 text-[13px]">
              {plan.agenda.map((a, i) => (
                <li key={i} className="flex gap-3">
                  <span className="w-14 shrink-0 text-muted-foreground">{a.minutes} min</span>
                  {a.item}
                </li>
              ))}
            </ol>
            <div className="mt-3 grid gap-3 text-[12.5px] sm:grid-cols-2">
              <div>
                <p className="font-medium">Listen for</p>
                <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-muted-foreground">
                  {plan.listenFor.slice(0, 4).map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="font-medium">Ask for this next step</p>
                <p className="mt-0.5 text-muted-foreground">{plan.nextStep}</p>
              </div>
            </div>
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel title="The account">
            <p className="text-[14px] font-medium">{customer.name}</p>
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
              From MSX contacts, senior first. Who decides isn't in MSX: ask.
            </p>
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
