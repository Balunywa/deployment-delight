/*
 * Prepare the conversation, then run it. A call plan is specific to this customer and the meeting's purpose: the
 * outcome we want, who's in the room, the opening, prioritized questions (causes, consequences, decision criteria,
 * ownership), follow-ups tied to our assumptions and gaps, what to listen for, objections worth exploring, an agenda
 * that fits the time, and resources ranked essential or optional. The meeting view keeps only what's needed live.
 */
import {
  ArrowDown,
  ArrowUp,
  CalendarCheck,
  ExternalLink,
  Plus,
  Presentation,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { DURATIONS, PURPOSES, PURPOSE_ORDER, type Purpose } from "@/lib/playbook";
import {
  type Attendee,
  type CallPlan,
  type PlanQuestion,
  agendaFor,
  assumptionKey,
  buildPlan,
  emptyPov,
  newAction,
  resourcesFor,
  uid,
} from "@/lib/workspace";

import { Chip, Field, Panel, StringList, TextField } from "./ui";
import { day, useWs, useWsValue } from "./ws";

const SOURCE_LABEL: Record<PlanQuestion["source"], string> = {
  pov: "Invites correction",
  assumption: "Tests an assumption",
  playbook: "Playbook",
  area: "Technical",
  prep: "From MSX and notes",
  own: "Yours",
};

function usePlans() {
  const [plans, setPlans] = useWsValue("plans", "Call plan");
  return [plans ?? [], setPlans] as const;
}

function NewPlan({ onCreate, compact }: { onCreate: (p: CallPlan) => void; compact?: boolean }) {
  const { e, data } = useWs();
  const [purpose, setPurpose] = useState<Purpose>("discovery");
  const [duration, setDuration] = useState(60);
  const [date, setDate] = useState("");
  return (
    <Panel
      title={compact ? "Plan another meeting" : "Prepare the conversation"}
      sub="Pick what this meeting is for. The plan is built from your point of view, the brief and the playbook; edit anything."
      tone={compact ? undefined : "primary"}
    >
      <div
        role="radiogroup"
        aria-label="Meeting purpose"
        className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3"
      >
        {PURPOSE_ORDER.map((p) => (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={purpose === p}
            onClick={() => setPurpose(p)}
            className={cn(
              "rounded-lg border px-3 py-2 text-left transition-colors",
              purpose === p
                ? "border-primary bg-primary/5"
                : "border-border hover:border-border-strong",
            )}
          >
            <span className="block text-[13px] font-semibold">{PURPOSES[p].label}</span>
            <span className="block text-[11.5px] text-muted-foreground">{PURPOSES[p].aim}</span>
          </button>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <Field label="Length" htmlFor="plan-duration">
          <select
            id="plan-duration"
            value={duration}
            onChange={(ev) => setDuration(Number(ev.target.value))}
            className="h-9 rounded-md border border-border bg-card px-2 text-[13px]"
          >
            {DURATIONS.map((d) => (
              <option key={d} value={d}>
                {d} minutes
              </option>
            ))}
          </select>
        </Field>
        <TextField label="Date" type="date" value={date} onChange={setDate} />
        <Button
          disabled={!data.prep && !e.workspace.pov}
          onClick={() => {
            const p = buildPlan({
              purpose,
              duration,
              pov: e.workspace.pov ?? emptyPov(),
              prep: data.prep ?? {
                sources: { msx: false, added: 0 },
                account: { name: null, accounts: null, fetchedAt: null },
                origin: [],
                goals: [],
                whyNow: [],
                people: [],
                areas: [],
                gaps: [],
                questions: [],
                similar: [],
              },
              customer: e.customer_name ?? "the customer",
            });
            onCreate({ ...p, date });
          }}
        >
          Prepare {PURPOSES[purpose].label.toLowerCase()}
        </Button>
      </div>
      {!e.workspace.pov?.opening && (
        <p className="mt-2 text-[12px] text-muted-foreground">
          Tip: shape the point of view first; its assumptions become questions here.
        </p>
      )}
    </Panel>
  );
}

function Questions({ plan, set }: { plan: CallPlan; set: (p: CallPlan) => void }) {
  const qs = plan.questions;
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= qs.length) return;
    const next = [...qs];
    [next[i], next[j]] = [next[j]!, next[i]!];
    set({ ...plan, questions: next });
  };
  return (
    <Panel
      title="Questions, in priority order"
      sub="Causes, consequences, decision criteria and ownership, not an inventory of requirements."
      actions={
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            set({ ...plan, questions: [...qs, { id: uid("q"), text: "", why: "", source: "own" }] })
          }
        >
          <Plus className="size-3.5" /> Add a question
        </Button>
      }
    >
      <ol className="space-y-2">
        {qs.map((q, i) => (
          <li key={q.id} className="rounded-lg border border-border p-2.5">
            <div className="flex items-start gap-2">
              <span className="mt-1.5 w-5 shrink-0 text-right font-mono text-[12px] text-muted-foreground">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1 space-y-1">
                <Input
                  aria-label={`Question ${i + 1}`}
                  value={q.text}
                  onChange={(ev) =>
                    set({
                      ...plan,
                      questions: qs.map((x) =>
                        x.id === q.id ? { ...x, text: ev.target.value } : x,
                      ),
                    })
                  }
                  className="h-8 text-[13px] font-medium"
                />
                <p className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted-foreground">
                  <Chip>{SOURCE_LABEL[q.source]}</Chip> {q.why}
                </p>
              </div>
              <div className="flex shrink-0 items-center">
                <button
                  type="button"
                  aria-label={`Move question ${i + 1} up`}
                  onClick={() => move(i, -1)}
                  className="rounded p-1 text-muted-foreground hover:bg-muted"
                >
                  <ArrowUp className="size-3.5" />
                </button>
                <button
                  type="button"
                  aria-label={`Move question ${i + 1} down`}
                  onClick={() => move(i, 1)}
                  className="rounded p-1 text-muted-foreground hover:bg-muted"
                >
                  <ArrowDown className="size-3.5" />
                </button>
                <button
                  type="button"
                  aria-label={`Remove question ${i + 1}`}
                  onClick={() => set({ ...plan, questions: qs.filter((x) => x.id !== q.id) })}
                  className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-danger"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </div>
          </li>
        ))}
      </ol>
      {plan.followUps.length > 0 && (
        <div className="mt-3">
          <p className="text-[12.5px] font-medium">Follow-ups tied to our assumptions and gaps</p>
          <ul className="mt-1 space-y-1">
            {plan.followUps.map((f, i) => (
              <li key={i} className="text-[12.5px]">
                {f.text} <span className="text-muted-foreground">({f.because})</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

function Audience({ plan, set }: { plan: CallPlan; set: (p: CallPlan) => void }) {
  const { data } = useWs();
  const update = (id: string, patch: Partial<Attendee>) =>
    set({ ...plan, audience: plan.audience.map((a) => (a.id === id ? { ...a, ...patch } : a)) });
  const mentioned = data.prep?.people ?? [];
  return (
    <Panel
      title="Who's in the room"
      sub="What each of them values. Tick “inferred” for anything you haven't heard them say."
      actions={
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            set({
              ...plan,
              audience: [
                ...plan.audience,
                { id: uid("at"), name: "", role: "", priorities: "", inferred: true },
              ],
            })
          }
        >
          <Plus className="size-3.5" /> Add a person
        </Button>
      }
    >
      {mentioned.length > 0 && (
        <p className="mb-2 text-[12px] text-muted-foreground">
          Mentioned in the context: {mentioned.map((q) => `“${q.text}”`).join(" ")}
        </p>
      )}
      {plan.audience.length ? (
        <ul className="space-y-2">
          {plan.audience.map((a, i) => (
            <li
              key={a.id}
              className="grid gap-1.5 sm:grid-cols-[1fr_1fr_2fr_auto_auto] sm:items-center"
            >
              <Input
                aria-label={`Person ${i + 1} name`}
                placeholder="Name"
                value={a.name}
                onChange={(ev) => update(a.id, { name: ev.target.value })}
                className="h-8 text-[12.5px]"
              />
              <Input
                aria-label={`Person ${i + 1} role`}
                placeholder="Role"
                value={a.role}
                onChange={(ev) => update(a.id, { role: ev.target.value })}
                className="h-8 text-[12.5px]"
              />
              <Input
                aria-label={`Person ${i + 1} priorities`}
                placeholder="What they value"
                value={a.priorities}
                onChange={(ev) => update(a.id, { priorities: ev.target.value })}
                className="h-8 text-[12.5px]"
              />
              <label className="flex items-center gap-1 text-[11.5px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={a.inferred}
                  onChange={(ev) => update(a.id, { inferred: ev.target.checked })}
                />
                Inferred
              </label>
              <button
                type="button"
                aria-label={`Remove person ${i + 1}`}
                onClick={() =>
                  set({ ...plan, audience: plan.audience.filter((x) => x.id !== a.id) })
                }
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-danger"
              >
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[12.5px] text-muted-foreground">Nobody added yet.</p>
      )}
    </Panel>
  );
}

function Agenda({ plan, set }: { plan: CallPlan; set: (p: CallPlan) => void }) {
  const total = plan.agenda.reduce((s, a) => s + a.minutes, 0);
  return (
    <Panel
      title="Agenda"
      sub={`${total} of ${plan.duration} minutes${total !== plan.duration ? " (adjust to fit)" : ""}`}
      actions={
        <Button
          size="sm"
          variant="ghost"
          onClick={() => set({ ...plan, agenda: agendaFor(plan.purpose, plan.duration) })}
        >
          Reset for {plan.duration} minutes
        </Button>
      }
    >
      <ol className="space-y-1.5">
        {plan.agenda.map((a, i) => (
          <li key={i} className="flex items-center gap-2">
            <Input
              aria-label={`Agenda item ${i + 1} minutes`}
              type="number"
              min={0}
              value={a.minutes}
              onChange={(ev) =>
                set({
                  ...plan,
                  agenda: plan.agenda.map((x, j) =>
                    j === i ? { ...x, minutes: Number(ev.target.value) || 0 } : x,
                  ),
                })
              }
              className="h-8 w-16 text-[12.5px]"
            />
            <span className="text-[11.5px] text-muted-foreground">min</span>
            <Input
              aria-label={`Agenda item ${i + 1}`}
              value={a.item}
              onChange={(ev) =>
                set({
                  ...plan,
                  agenda: plan.agenda.map((x, j) =>
                    j === i ? { ...x, item: ev.target.value } : x,
                  ),
                })
              }
              className="h-8 text-[12.5px]"
            />
          </li>
        ))}
      </ol>
    </Panel>
  );
}

function Resources({ plan }: { plan: CallPlan }) {
  const { data } = useWs();
  const list = resourcesFor(plan.purpose, data.prep?.areas ?? []);
  const essential = list.filter((r) => r.essential);
  const optional = list.filter((r) => !r.essential);
  const Item = ({ r }: { r: (typeof list)[number] }) => (
    <li className="text-[12.5px]">
      {r.url ? (
        <a
          href={r.url}
          target={r.url.startsWith("/") ? undefined : "_blank"}
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
        >
          {r.title} {!r.url.startsWith("/") && <ExternalLink className="size-3" />}
        </a>
      ) : (
        <span className="font-medium">
          {r.title}{" "}
          <span className="font-normal text-muted-foreground">(internal; no link stored)</span>
        </span>
      )}
      <span className="block text-[11.5px] text-muted-foreground">{r.why}</span>
    </li>
  );
  return (
    <Panel title="Prepare with" sub="Essential for this call first; the rest is deeper reading.">
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <p className="mb-1 text-[12px] font-semibold tracking-wide text-muted-foreground uppercase">
            Essential for this call
          </p>
          <ul className="space-y-1.5">
            {essential.length ? (
              essential.map((r) => <Item key={r.title} r={r} />)
            ) : (
              <li className="text-[12px] text-muted-foreground">Nothing specific.</li>
            )}
          </ul>
        </div>
        <div>
          <p className="mb-1 text-[12px] font-semibold tracking-wide text-muted-foreground uppercase">
            Optional deeper reading
          </p>
          <ul className="space-y-1.5">
            {optional.map((r) => (
              <Item key={r.title} r={r} />
            ))}
          </ul>
        </div>
      </div>
    </Panel>
  );
}

function PlanEditor({
  plan,
  set,
  remove,
}: {
  plan: CallPlan;
  set: (p: CallPlan) => void;
  remove: () => void;
}) {
  const { e, go } = useWs();
  return (
    <div className="space-y-4">
      <Panel
        title={plan.title || PURPOSES[plan.purpose].label}
        label="Call plan"
        sub={plan.held ? `Held ${day(plan.held.at)}` : "Not held yet"}
        actions={
          <>
            <Button size="sm" onClick={() => go("meeting")}>
              <Presentation className="size-3.5" /> Open meeting view
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                if (confirm("Delete this call plan?")) remove();
              }}
            >
              <Trash2 className="size-3.5" /> Delete
            </Button>
          </>
        }
      >
        <div className="grid gap-3 md:grid-cols-[2fr_1fr_1fr_1fr]">
          <TextField
            label="Title"
            value={plan.title}
            onChange={(v) => set({ ...plan, title: v })}
          />
          <Field label="Purpose" htmlFor={`purpose-${plan.id}`}>
            <select
              id={`purpose-${plan.id}`}
              value={plan.purpose}
              onChange={(ev) => {
                const purpose = ev.target.value as Purpose;
                const g = PURPOSES[purpose];
                set({
                  ...plan,
                  purpose,
                  outcome: g.aim,
                  listenFor: [...g.listenFor],
                  objections: [...g.objections],
                  nextStep: g.nextStep,
                  participants: g.participants,
                  agenda: agendaFor(purpose, plan.duration),
                });
              }}
              className="h-9 w-full rounded-md border border-border bg-card px-2 text-[13px]"
            >
              {PURPOSE_ORDER.map((p) => (
                <option key={p} value={p}>
                  {PURPOSES[p].label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Length" htmlFor={`len-${plan.id}`}>
            <select
              id={`len-${plan.id}`}
              value={plan.duration}
              onChange={(ev) => {
                const duration = Number(ev.target.value);
                set({ ...plan, duration, agenda: agendaFor(plan.purpose, duration) });
              }}
              className="h-9 w-full rounded-md border border-border bg-card px-2 text-[13px]"
            >
              {DURATIONS.map((d) => (
                <option key={d} value={d}>
                  {d} minutes
                </option>
              ))}
            </select>
          </Field>
          <TextField
            label="Date"
            type="date"
            value={plan.date}
            onChange={(v) => set({ ...plan, date: v })}
          />
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <TextField
            label="Intended customer outcome"
            hint="What the customer should leave with."
            rows={2}
            value={plan.outcome}
            onChange={(v) => set({ ...plan, outcome: v })}
          />
          <div className="space-y-1">
            <TextField
              label="Opening (working hypothesis)"
              rows={3}
              value={plan.opening}
              onChange={(v) => set({ ...plan, opening: v })}
            />
            {e.workspace.pov?.opening && e.workspace.pov.opening !== plan.opening && (
              <button
                type="button"
                onClick={() => set({ ...plan, opening: e.workspace.pov!.opening })}
                className="text-[11.5px] text-primary hover:underline"
              >
                Use the latest from the point of view
              </button>
            )}
          </div>
        </div>
      </Panel>

      <Audience plan={plan} set={set} />
      <Questions plan={plan} set={set} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Listen for" sub="Signals that confirm or change your view.">
          <StringList
            label="Signals"
            values={plan.listenFor}
            onChange={(v) => set({ ...plan, listenFor: v })}
            addLabel="Add a signal"
          />
        </Panel>
        <Panel
          title="Objections worth exploring"
          sub="Possibilities to be ready for, not what they think."
        >
          <ul className="space-y-2">
            {plan.objections.map((o, i) => (
              <li key={i} className="space-y-1">
                <Input
                  aria-label={`Objection ${i + 1}`}
                  value={o.text}
                  onChange={(ev) =>
                    set({
                      ...plan,
                      objections: plan.objections.map((x, j) =>
                        j === i ? { ...x, text: ev.target.value } : x,
                      ),
                    })
                  }
                  className="h-8 text-[12.5px] font-medium"
                />
                <Input
                  aria-label={`How to explore objection ${i + 1}`}
                  value={o.explore}
                  onChange={(ev) =>
                    set({
                      ...plan,
                      objections: plan.objections.map((x, j) =>
                        j === i ? { ...x, explore: ev.target.value } : x,
                      ),
                    })
                  }
                  className="h-8 text-[12px]"
                />
              </li>
            ))}
          </ul>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              set({ ...plan, objections: [...plan.objections, { text: "", explore: "" }] })
            }
          >
            <Plus className="size-3.5" /> Add an objection
          </Button>
        </Panel>
        <Panel title="Technical constraints to validate">
          <StringList
            label="Constraints"
            values={plan.constraints}
            onChange={(v) => set({ ...plan, constraints: v })}
            addLabel="Add a constraint"
          />
        </Panel>
        <Panel title="The next step to aim for">
          <div className="space-y-3">
            <TextField
              label="Suggested next step"
              rows={2}
              value={plan.nextStep}
              onChange={(v) => set({ ...plan, nextStep: v })}
            />
            <TextField
              label="Who needs to be there"
              rows={2}
              value={plan.participants}
              onChange={(v) => set({ ...plan, participants: v })}
            />
          </div>
        </Panel>
      </div>

      <Agenda plan={plan} set={set} />
      <Resources plan={plan} />
    </div>
  );
}

export function PlanView() {
  const [plans, setPlans] = usePlans();
  const [active, setActive] = useState<string | null>(
    () => plans.find((p) => !p.held)?.id ?? plans.at(-1)?.id ?? null,
  );
  const [adding, setAdding] = useState(false);
  const plan = plans.find((p) => p.id === active) ?? null;

  if (!plans.length) return <NewPlan onCreate={(p) => (setPlans([p]), setActive(p.id))} />;

  return (
    <div className="space-y-4">
      <nav aria-label="Call plans" className="flex flex-wrap items-center gap-2">
        {plans.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-current={p.id === active ? "true" : undefined}
            onClick={() => (setActive(p.id), setAdding(false))}
            className={cn(
              "rounded-full border px-3 py-1 text-[12.5px]",
              p.id === active && !adding
                ? "border-primary bg-primary/5 font-medium"
                : "border-border hover:border-border-strong",
            )}
          >
            {p.title || PURPOSES[p.purpose].label}
            {p.held && <CalendarCheck className="ml-1 inline size-3 text-success" />}
          </button>
        ))}
        <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
          <Plus className="size-3.5" /> New call plan
        </Button>
      </nav>
      {adding ? (
        <NewPlan
          compact
          onCreate={(p) => {
            setPlans([...plans, p]);
            setActive(p.id);
            setAdding(false);
          }}
        />
      ) : (
        plan && (
          <PlanEditor
            key={plan.id}
            plan={plan}
            set={(p) => setPlans(plans.map((x) => (x.id === p.id ? p : x)))}
            remove={() => {
              const rest = plans.filter((x) => x.id !== plan.id);
              setPlans(rest);
              setActive(rest.at(-1)?.id ?? null);
            }}
          />
        )
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------ meeting */

export function MeetingView() {
  const { e, apply, go } = useWs();
  const [plans, setPlans] = usePlans();
  const candidates = plans.filter((p) => !p.held);
  const [active, setActive] = useState<string | null>(
    () => candidates[0]?.id ?? plans.at(-1)?.id ?? null,
  );
  const plan = plans.find((p) => p.id === active) ?? null;
  const [action, setAction] = useState({
    text: "",
    owner: "",
    due: "",
    side: "customer" as "customer" | "microsoft",
  });

  if (!plan)
    return (
      <Panel title="No call plan yet" tone="primary">
        <p className="text-[13px]">
          Prepare the conversation first; the meeting view shows its opening and questions.
        </p>
        <Button className="mt-3" onClick={() => go("plan")}>
          Prepare the conversation
        </Button>
      </Panel>
    );

  const set = (p: CallPlan) => setPlans(plans.map((x) => (x.id === p.id ? p : x)));
  const answer = (k: string, v: string) => set({ ...plan, answers: { ...plan.answers, [k]: v } });
  const open = (e.workspace.pov?.assumptions ?? []).filter((a) => a.status === "open");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="meeting-plan" className="text-[12.5px] text-muted-foreground">
            Meeting
          </label>
          <select
            id="meeting-plan"
            value={plan.id}
            onChange={(ev) => setActive(ev.target.value)}
            className="h-8 rounded-md border border-border bg-card px-2 text-[13px]"
          >
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
                {p.held ? " (held)" : ""}
              </option>
            ))}
          </select>
        </div>
        <ol
          aria-label="Agenda"
          className="flex flex-wrap gap-1 text-[11.5px] text-muted-foreground"
        >
          {plan.agenda.map((a, i) => (
            <li key={i} className="rounded-full bg-muted px-2 py-0.5">
              {a.minutes}′ {a.item}
            </li>
          ))}
        </ol>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          <Panel title="Open with" tone="primary">
            <p className="text-[17px] leading-relaxed">{plan.opening || "No opening written."}</p>
            <p className="mt-1 text-[11.5px] text-muted-foreground">
              A working hypothesis. Say it, then listen.
            </p>
          </Panel>
          <Panel title="Key questions" sub="Capture what they say, in their words.">
            <ol className="space-y-3">
              {plan.questions.map((q, i) => (
                <li key={q.id}>
                  <p
                    className={cn(
                      "text-[14px] font-medium",
                      plan.answers[q.id]?.trim() && "text-muted-foreground",
                    )}
                  >
                    {i + 1}. {q.text}
                  </p>
                  <Textarea
                    aria-label={`Answer to question ${i + 1}`}
                    rows={2}
                    value={plan.answers[q.id] ?? ""}
                    placeholder="What they said"
                    onChange={(ev) => answer(q.id, ev.target.value)}
                    className="mt-1 text-[13px]"
                  />
                </li>
              ))}
            </ol>
          </Panel>
          <Panel title="Notes">
            <Textarea
              aria-label="Meeting notes"
              rows={6}
              value={plan.notes}
              onChange={(ev) => set({ ...plan, notes: ev.target.value })}
              className="text-[13px]"
            />
          </Panel>
        </div>

        <div className="space-y-4">
          {open.length > 0 && (
            <Panel title="Test the assumptions" sub="Mark what they confirm, correct or reject.">
              <ul className="space-y-3">
                {open.map((a) => {
                  const k = assumptionKey(a.id);
                  const st = plan.answers[k.status] ?? "open";
                  return (
                    <li key={a.id} className="space-y-1">
                      <p className="text-[12.5px]">{a.text}</p>
                      <div
                        role="radiogroup"
                        aria-label={`Result: ${a.text.slice(0, 50)}`}
                        className="flex flex-wrap gap-1"
                      >
                        {(["confirmed", "revised", "rejected"] as const).map((s) => (
                          <button
                            key={s}
                            type="button"
                            role="radio"
                            aria-checked={st === s}
                            onClick={() => answer(k.status, st === s ? "open" : s)}
                            className={cn(
                              "rounded-full border px-2 py-0.5 text-[11.5px]",
                              st === s
                                ? "border-primary bg-primary/10 font-medium text-primary"
                                : "border-border",
                            )}
                          >
                            {s === "confirmed"
                              ? "Confirmed"
                              : s === "revised"
                                ? "Corrected"
                                : "Rejected"}
                          </button>
                        ))}
                      </div>
                      {st !== "open" && (
                        <Input
                          aria-label={`What they said about: ${a.text.slice(0, 50)}`}
                          placeholder="Their words"
                          value={plan.answers[k.quote] ?? ""}
                          onChange={(ev) => answer(k.quote, ev.target.value)}
                          className="h-8 text-[12.5px]"
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
            </Panel>
          )}
          <Panel title="Listen for">
            <ul className="list-disc space-y-0.5 pl-4 text-[12.5px] text-foreground/85">
              {plan.listenFor.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </Panel>
          <Panel
            title="Capture an action"
            sub="Customer and Microsoft actions, each with an owner and a date."
          >
            <div className="space-y-2">
              <Input
                aria-label="New action"
                placeholder="What will happen"
                value={action.text}
                onChange={(ev) => setAction({ ...action, text: ev.target.value })}
                className="h-8 text-[12.5px]"
              />
              <div className="flex gap-2">
                <Input
                  aria-label="New action owner"
                  placeholder="Owner"
                  value={action.owner}
                  onChange={(ev) => setAction({ ...action, owner: ev.target.value })}
                  className="h-8 text-[12.5px]"
                />
                <Input
                  aria-label="New action due"
                  type="date"
                  value={action.due}
                  onChange={(ev) => setAction({ ...action, due: ev.target.value })}
                  className="h-8 w-36 text-[12.5px]"
                />
              </div>
              <div className="flex items-center justify-between gap-2">
                <select
                  aria-label="Whose action"
                  value={action.side}
                  onChange={(ev) =>
                    setAction({ ...action, side: ev.target.value as "customer" | "microsoft" })
                  }
                  className="h-8 rounded-md border border-border bg-card px-2 text-[12.5px]"
                >
                  <option value="customer">Customer</option>
                  <option value="microsoft">Microsoft</option>
                </select>
                <Button
                  size="sm"
                  disabled={!action.text.trim()}
                  onClick={() => {
                    const text = `${action.side === "customer" ? "[Customer] " : "[Microsoft] "}${action.text.trim()}`;
                    apply(
                      { actions: [...e.actions, newAction(text, action.owner.trim(), action.due)] },
                      "Action added.",
                    );
                    setAction({ text: "", owner: "", due: "", side: action.side });
                  }}
                >
                  Add action
                </Button>
              </div>
            </div>
          </Panel>
          <Panel title="Agreed next step">
            <Input
              aria-label="Agreed next step"
              placeholder={plan.nextStep}
              value={plan.agreedNext}
              onChange={(ev) => set({ ...plan, agreedNext: ev.target.value })}
              className="text-[13px]"
            />
          </Panel>
          {!plan.held ? (
            <Button
              className="w-full"
              onClick={() => {
                // Shared data updates at once; the save is sent as the view closes.
                setPlans(
                  plans.map((x) =>
                    x.id === plan.id ? { ...plan, held: { at: new Date().toISOString() } } : x,
                  ),
                );
                toast.success("Marked as held. Now confirm what you heard.");
                go("findings");
              }}
            >
              <CalendarCheck className="size-4" /> Meeting held: confirm findings
            </Button>
          ) : (
            <Button className="w-full" variant="outline" onClick={() => go("findings")}>
              Confirm findings
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
