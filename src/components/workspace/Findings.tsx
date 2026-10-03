/*
 * Confirm what you heard, after each meeting: what the customer actually said, which assumptions they confirmed,
 * corrected or rejected (the point of view updates and keeps its history), the underlying need, options and the
 * trade-offs accepted, decisions versus topics still open, owned actions and who's missing. Saves as you go; applying
 * the results to the point of view is an explicit step.
 */
import { CircleCheck, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { Action } from "@/lib/engagements";
import {
  type AssumptionStatus,
  type CallPlan,
  type MeetingReview,
  applyAssumptionResults,
  assumptionKey,
  newAction,
  uid,
} from "@/lib/workspace";

import { Panel, TextField } from "./ui";
import { day, useAutosave, useWs, useWsValue } from "./ws";

const RESULT_LABEL: Record<AssumptionStatus, string> = {
  open: "Not discussed",
  confirmed: "Confirmed",
  revised: "Corrected",
  rejected: "Rejected",
};

const emptyReview = (by: string): MeetingReview => ({
  need: "",
  options: [],
  decisions: [],
  missing: "",
  at: "",
  by,
});

function Actions() {
  const { e, apply } = useWs();
  const [list, setList] = useState<Action[]>(() => e.actions);
  useAutosave(list, (v) => apply({ actions: v }));
  const update = (id: string, patch: Partial<Action>) =>
    setList(list.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  return (
    <Panel
      title="Actions"
      sub="Customer and Microsoft actions, each with an owner and a date."
      actions={
        <Button
          size="sm"
          variant="outline"
          onClick={() => setList([...list, newAction("", "", "")])}
        >
          <Plus className="size-3.5" /> Add an action
        </Button>
      }
    >
      {list.length ? (
        <ul className="space-y-1.5">
          {list.map((a, i) => (
            <li
              key={a.id}
              className="grid items-center gap-1.5 sm:grid-cols-[auto_3fr_1fr_9rem_auto]"
            >
              <input
                type="checkbox"
                aria-label={`Action ${i + 1} done`}
                checked={a.done}
                onChange={(ev) => update(a.id, { done: ev.target.checked })}
              />
              <Input
                aria-label={`Action ${i + 1}`}
                value={a.text}
                onChange={(ev) => update(a.id, { text: ev.target.value })}
                className={cn("h-8 text-[12.5px]", a.done && "line-through opacity-60")}
              />
              <Input
                aria-label={`Action ${i + 1} owner`}
                placeholder="Owner"
                value={a.owner}
                onChange={(ev) => update(a.id, { owner: ev.target.value })}
                className="h-8 text-[12.5px]"
              />
              <Input
                aria-label={`Action ${i + 1} due`}
                type="date"
                value={a.due}
                onChange={(ev) => update(a.id, { due: ev.target.value })}
                className="h-8 text-[12.5px]"
              />
              <button
                type="button"
                aria-label={`Remove action ${i + 1}`}
                onClick={() => setList(list.filter((x) => x.id !== a.id))}
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-danger"
              >
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[12.5px] text-muted-foreground">No actions yet.</p>
      )}
    </Panel>
  );
}

export function FindingsView() {
  const { e, saveWs, apply, go } = useWs();
  const [stored, setPlans] = useWsValue("plans", "Meeting findings");
  const plans = stored ?? [];
  const held = plans.filter((p) => p.held);
  const [active, setActive] = useState<string | null>(
    () => held.find((p) => !p.review?.at)?.id ?? held.at(-1)?.id ?? null,
  );
  const plan = held.find((p) => p.id === active) ?? null;
  const pov = e.workspace.pov;

  if (!plan)
    return (
      <Panel title="No meeting held yet" tone="primary">
        <p className="text-[13px]">
          Findings come after a conversation. Run it from the meeting view, then come back here.
        </p>
        <Button className="mt-3" onClick={() => go("meeting")}>
          Open the meeting view
        </Button>
      </Panel>
    );

  const set = (p: CallPlan) => setPlans(plans.map((x) => (x.id === p.id ? p : x)));
  const review = plan.review ?? emptyReview(e.owner_name ?? "");
  const setReview = (r: Partial<MeetingReview>) => set({ ...plan, review: { ...review, ...r } });
  const answer = (k: string, v: string) => set({ ...plan, answers: { ...plan.answers, [k]: v } });
  const tested = (pov?.assumptions ?? []).filter(
    (a) => a.status === "open" || a.meeting === plan.id,
  );
  const applied = !!review.at;

  const applyResults = async () => {
    if (!pov) return;
    const results = tested.map((a) => {
      const k = assumptionKey(a.id);
      return {
        id: a.id,
        status: (plan.answers[k.status] ?? "open") as AssumptionStatus,
        quote: plan.answers[k.quote] ?? "",
        revisedTo: plan.answers[assumptionKey(a.id).revised] ?? "",
      };
    });
    const next = applyAssumptionResults(pov, e.findings, results, plan.id);
    const at = new Date().toISOString();
    const nextPlans = plans.map((x) =>
      x.id === plan.id ? { ...plan, review: { ...review, at } } : x,
    );
    setPlans(nextPlans);
    await saveWs({ pov: next.pov, plans: nextPlans }, `After: ${plan.title}`);
    apply(
      { findings: next.findings },
      "Findings saved. The point of view is updated; its history is kept.",
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="findings-plan" className="text-[12.5px] text-muted-foreground">
          Meeting
        </label>
        <select
          id="findings-plan"
          value={plan.id}
          onChange={(ev) => setActive(ev.target.value)}
          className="h-8 rounded-md border border-border bg-card px-2 text-[13px]"
        >
          {held.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title} · {day(p.held?.at)}
              {p.review?.at ? " (confirmed)" : ""}
            </option>
          ))}
        </select>
        {applied && (
          <span className="inline-flex items-center gap-1 text-[12px] text-success">
            <CircleCheck className="size-3.5" /> Applied {day(review.at)}
          </span>
        )}
      </div>

      <Panel
        title="What the customer actually said"
        sub="From the meeting view. Edit there or here."
      >
        {plan.questions.some((q) => plan.answers[q.id]?.trim()) ? (
          <dl className="space-y-2 text-[12.5px]">
            {plan.questions
              .filter((q) => plan.answers[q.id]?.trim())
              .map((q) => (
                <div key={q.id}>
                  <dt className="font-medium">{q.text}</dt>
                  <dd className="text-foreground/85">“{plan.answers[q.id]}”</dd>
                </div>
              ))}
          </dl>
        ) : (
          <p className="text-[12.5px] text-muted-foreground">No answers captured.</p>
        )}
        {plan.notes && (
          <p className="mt-2 text-[12.5px] whitespace-pre-wrap text-foreground/80">{plan.notes}</p>
        )}
        {plan.agreedNext && (
          <p className="mt-2 text-[12.5px]">
            <span className="font-medium">Agreed next step:</span> {plan.agreedNext}
          </p>
        )}
      </Panel>

      <Panel
        title="Our assumptions, tested"
        sub="Confirmed, corrected or rejected by the customer. Applying them updates the point of view and keeps the earlier version."
      >
        {tested.length ? (
          <ul className="space-y-3">
            {tested.map((a) => {
              const k = assumptionKey(a.id);
              const st = (plan.answers[k.status] ?? a.status) as AssumptionStatus;
              return (
                <li key={a.id} className="rounded-lg border border-border p-3">
                  <p className="text-[13px]">{a.text}</p>
                  <div
                    role="radiogroup"
                    aria-label={`Result: ${a.text.slice(0, 50)}`}
                    className="mt-1.5 flex flex-wrap gap-1"
                  >
                    {(["open", "confirmed", "revised", "rejected"] as const).map((s) => (
                      <button
                        key={s}
                        type="button"
                        role="radio"
                        aria-checked={st === s}
                        onClick={() => answer(k.status, s)}
                        className={cn(
                          "rounded-full border px-2 py-0.5 text-[11.5px]",
                          st === s
                            ? "border-primary bg-primary/10 font-medium text-primary"
                            : "border-border",
                        )}
                      >
                        {RESULT_LABEL[s]}
                      </button>
                    ))}
                  </div>
                  {st !== "open" && (
                    <div className="mt-2 grid gap-2 md:grid-cols-2">
                      <Input
                        aria-label={`Their words about: ${a.text.slice(0, 50)}`}
                        placeholder="Their words"
                        value={plan.answers[k.quote] ?? a.quote ?? ""}
                        onChange={(ev) => answer(k.quote, ev.target.value)}
                        className="h-8 text-[12.5px]"
                      />
                      {st === "revised" && (
                        <Input
                          aria-label={`Corrected version of: ${a.text.slice(0, 50)}`}
                          placeholder="What's actually true"
                          value={plan.answers[assumptionKey(a.id).revised] ?? a.revisedTo ?? ""}
                          onChange={(ev) => answer(assumptionKey(a.id).revised, ev.target.value)}
                          className="h-8 text-[12.5px]"
                        />
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-[12.5px] text-muted-foreground">
            No open assumptions in the point of view.
          </p>
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="The underlying need">
          <TextField
            label="What they actually need, in their terms"
            rows={3}
            value={review.need}
            onChange={(v) => setReview({ need: v })}
          />
        </Panel>
        <Panel title="Missing stakeholders or approvals">
          <TextField
            label="Who wasn't there, and who still has to say yes"
            rows={3}
            value={review.missing}
            onChange={(v) => setReview({ missing: v })}
          />
        </Panel>
      </div>

      <Panel
        title="Options discussed and trade-offs accepted"
        actions={
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              setReview({ options: [...review.options, { id: uid("op"), text: "", tradeoff: "" }] })
            }
          >
            <Plus className="size-3.5" /> Add an option
          </Button>
        }
      >
        {review.options.length ? (
          <ul className="space-y-1.5">
            {review.options.map((o, i) => (
              <li key={o.id} className="grid gap-1.5 md:grid-cols-[1fr_1fr_auto]">
                <Input
                  aria-label={`Option ${i + 1}`}
                  placeholder="Option"
                  value={o.text}
                  onChange={(ev) =>
                    setReview({
                      options: review.options.map((x) =>
                        x.id === o.id ? { ...x, text: ev.target.value } : x,
                      ),
                    })
                  }
                  className="h-8 text-[12.5px]"
                />
                <Input
                  aria-label={`Trade-off for option ${i + 1}`}
                  placeholder="Trade-off they accepted"
                  value={o.tradeoff}
                  onChange={(ev) =>
                    setReview({
                      options: review.options.map((x) =>
                        x.id === o.id ? { ...x, tradeoff: ev.target.value } : x,
                      ),
                    })
                  }
                  className="h-8 text-[12.5px]"
                />
                <button
                  type="button"
                  aria-label={`Remove option ${i + 1}`}
                  onClick={() =>
                    setReview({ options: review.options.filter((x) => x.id !== o.id) })
                  }
                  className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-danger"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12.5px] text-muted-foreground">None recorded.</p>
        )}
      </Panel>

      <Panel
        title="Decisions made, and topics still open"
        sub="Keep them apart: an open topic isn't a decision."
        actions={
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              setReview({
                decisions: [...review.decisions, { id: uid("de"), text: "", status: "open" }],
              })
            }
          >
            <Plus className="size-3.5" /> Add
          </Button>
        }
      >
        {review.decisions.length ? (
          <ul className="space-y-1.5">
            {review.decisions.map((d, i) => (
              <li key={d.id} className="grid items-center gap-1.5 md:grid-cols-[8rem_1fr_auto]">
                <select
                  aria-label={`Decision ${i + 1} status`}
                  value={d.status}
                  onChange={(ev) =>
                    setReview({
                      decisions: review.decisions.map((x) =>
                        x.id === d.id ? { ...x, status: ev.target.value as "decided" | "open" } : x,
                      ),
                    })
                  }
                  className="h-8 rounded-md border border-border bg-card px-2 text-[12.5px]"
                >
                  <option value="decided">Decided</option>
                  <option value="open">Still open</option>
                </select>
                <Input
                  aria-label={`Decision ${i + 1}`}
                  value={d.text}
                  onChange={(ev) =>
                    setReview({
                      decisions: review.decisions.map((x) =>
                        x.id === d.id ? { ...x, text: ev.target.value } : x,
                      ),
                    })
                  }
                  className="h-8 text-[12.5px]"
                />
                <button
                  type="button"
                  aria-label={`Remove decision ${i + 1}`}
                  onClick={() =>
                    setReview({ decisions: review.decisions.filter((x) => x.id !== d.id) })
                  }
                  className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-danger"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12.5px] text-muted-foreground">None recorded.</p>
        )}
      </Panel>

      <Actions />

      <div className="flex flex-wrap items-center justify-end gap-2 rounded-xl border border-border bg-card p-3">
        <p className="mr-auto text-[12.5px] text-muted-foreground">
          Applying updates the point of view and the working summary. Nothing goes to the customer
          or MSX.
        </p>
        <Button onClick={() => void applyResults()}>
          {applied ? "Apply again" : "Apply to the point of view"}
        </Button>
        <Button variant="outline" onClick={() => go(e.status === "draft" ? "charter" : "overview")}>
          {e.status === "draft" ? "Review engagement" : "Back to overview"}
        </Button>
      </div>
    </div>
  );
}
