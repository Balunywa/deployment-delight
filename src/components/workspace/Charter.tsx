/*
 * The engagement plan (charter): the outcome and technical objective, scope with explicit exclusions, type, owners,
 * customer sponsor and contact, success criteria with how the evidence is collected (never an activity), dates,
 * dependencies, risks, resources, the first activity and the next decision. Pre-filled from what's already in the
 * workspace, so nothing is typed twice. From a draft, "Review engagement" then "Create engagement".
 */
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Circle, Plus, Trash2, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ENGAGEMENT_TYPES, type EngagementType, type Purpose } from "@/lib/playbook";
import {
  type Charter,
  type WorkspaceEngagement,
  emptyCharter,
  readinessOf,
  uid,
} from "@/lib/workspace";
import { createFromDraft } from "@/lib/workspace.functions";

import { Field, Panel, TextField } from "./ui";
import { useWs, useWsValue } from "./ws";

const TYPE_FOR: Record<Purpose, EngagementType> = {
  discovery: "discovery",
  architecture: "architecture",
  workshop: "workshop",
  demo: "demo",
  poc: "poc",
  kickoff: "delivery",
};

/** A first charter from the workspace: only what's already there. */
function seed(e: WorkspaceEngagement): Charter {
  const plans = e.workspace.plans ?? [];
  const last = plans.at(-1);
  const reviewed = [...plans].reverse().find((p) => p.review?.need);
  return {
    ...emptyCharter(),
    outcome: reviewed?.review?.need ?? e.brief.outcome ?? "",
    type: last ? TYPE_FOR[last.purpose] : "discovery",
    owner: e.owner_name ?? "",
    roles: {
      se: e.brief.team?.se ?? e.owner_name ?? "",
      csa: e.brief.team?.csa ?? "",
      ssp: e.brief.team?.ssp ?? "",
      other: "",
    },
    sponsor: e.brief.owner ?? "",
    firstActivity: last?.agreedNext ?? "",
    nextDecision: { what: last?.nextStep ?? "", when: "" },
  };
}

const ACTIVITY =
  /^(run|hold|deliver|complete|conduct|do|host|schedule|present|demo|hand ?over|kick ?off)\b/i;

export function CharterView() {
  const { e, saveWs, refresh, go } = useWs();
  const [stored, setC] = useWsValue("charter", "Engagement plan");
  const c = stored ?? seed(e);
  const [reviewing, setReviewing] = useState(false);
  const [name, setName] = useState(e.name);
  const create = useMutation({
    mutationFn: useServerFn(createFromDraft),
    onSuccess: () => {
      toast.success("Engagement created. MSX is unchanged; nothing was deployed.");
      refresh();
      go("overview");
    },
    onError: (err: Error) => toast.error(err.message),
  });
  const draft = e.status === "draft";
  const set = (p: Partial<Charter>) => setC({ ...c, ...p });
  const checks = readinessOf({ ...e, workspace: { ...e.workspace, charter: c } }).validation;
  const missing = [
    !c.outcome.trim() && "business outcome",
    !c.success.some((s) => s.criterion.trim()) && "success criteria",
    !c.sponsor.trim() && "customer sponsor",
    !c.firstActivity.trim() && "first activity",
    !c.nextDecision.what.trim() && "next decision",
  ].filter(Boolean) as string[];

  return (
    <div className="space-y-4">
      {draft && (
        <div className="rounded-lg border border-primary/30 bg-primary/[0.04] px-4 py-2.5 text-[12.5px]">
          This is still a draft: you're preparing, not committed. Fill what you know; unknowns are
          fine.
        </div>
      )}

      <Panel title="Outcome and objective">
        <div className="grid gap-3 md:grid-cols-2">
          <TextField
            label="Business outcome"
            hint="What changes for the customer, in their words."
            rows={3}
            value={c.outcome}
            onChange={(v) => set({ outcome: v })}
          />
          <TextField
            label="Technical objective"
            hint="What we'll establish or build to get there."
            rows={3}
            value={c.objective}
            onChange={(v) => set({ objective: v })}
          />
          <TextField label="Scope" rows={3} value={c.scope} onChange={(v) => set({ scope: v })} />
          <TextField
            label="Explicit exclusions"
            hint="What this engagement won't do."
            rows={3}
            value={c.exclusions}
            onChange={(v) => set({ exclusions: v })}
          />
        </div>
        <Field label="Engagement type" htmlFor="charter-type" className="mt-3 max-w-sm">
          <select
            id="charter-type"
            value={c.type}
            onChange={(ev) => set({ type: ev.target.value as EngagementType })}
            className="h-9 w-full rounded-md border border-border bg-card px-2 text-[13px]"
          >
            {(Object.keys(ENGAGEMENT_TYPES) as EngagementType[]).map((t) => (
              <option key={t} value={t}>
                {ENGAGEMENT_TYPES[t].label}
              </option>
            ))}
          </select>
        </Field>
        {(c.type === "poc" || c.type === "pilot") && (
          <p className="mt-2 text-[12px] text-muted-foreground">
            A POC or pilot needs a decision it informs and pass/fail criteria (Validate). If no
            decision depends on it, a demo, assessment or workshop answers the question faster.
          </p>
        )}
      </Panel>

      <Panel title="People">
        <div className="grid gap-3 md:grid-cols-3">
          <TextField
            label="Accountable owner"
            value={c.owner}
            onChange={(v) => set({ owner: v })}
          />
          <TextField
            label="Customer sponsor"
            value={c.sponsor}
            onChange={(v) => set({ sponsor: v })}
          />
          <TextField
            label="Customer technical contact"
            value={c.technicalContact}
            onChange={(v) => set({ technicalContact: v })}
          />
          <TextField
            label="SE"
            value={c.roles.se}
            onChange={(v) => set({ roles: { ...c.roles, se: v } })}
          />
          <TextField
            label="CSA"
            value={c.roles.csa}
            onChange={(v) => set({ roles: { ...c.roles, csa: v } })}
          />
          <TextField
            label="Specialist / seller"
            value={c.roles.ssp}
            onChange={(v) => set({ roles: { ...c.roles, ssp: v } })}
          />
          <TextField
            label="Other roles"
            className="md:col-span-3"
            value={c.roles.other}
            onChange={(v) => set({ roles: { ...c.roles, other: v } })}
          />
        </div>
      </Panel>

      <Panel
        title="Success criteria"
        sub="Results that prove it worked, and how the evidence is collected. “Run a workshop” is an activity, not proof."
        actions={
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              set({ success: [...c.success, { id: uid("sc"), criterion: "", evidence: "" }] })
            }
          >
            <Plus className="size-3.5" /> Add a criterion
          </Button>
        }
      >
        {c.success.length ? (
          <ul className="space-y-2">
            {c.success.map((s, i) => (
              <li key={s.id}>
                <div className="grid gap-1.5 md:grid-cols-[1fr_1fr_auto]">
                  <Input
                    aria-label={`Success criterion ${i + 1}`}
                    placeholder="What will be true"
                    value={s.criterion}
                    onChange={(ev) =>
                      set({
                        success: c.success.map((x) =>
                          x.id === s.id ? { ...x, criterion: ev.target.value } : x,
                        ),
                      })
                    }
                    className="h-8 text-[12.5px]"
                  />
                  <Input
                    aria-label={`Evidence for criterion ${i + 1}`}
                    placeholder="How we'll know (who measures, from what)"
                    value={s.evidence}
                    onChange={(ev) =>
                      set({
                        success: c.success.map((x) =>
                          x.id === s.id ? { ...x, evidence: ev.target.value } : x,
                        ),
                      })
                    }
                    className="h-8 text-[12.5px]"
                  />
                  <button
                    type="button"
                    aria-label={`Remove criterion ${i + 1}`}
                    onClick={() => set({ success: c.success.filter((x) => x.id !== s.id) })}
                    className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-danger"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
                {ACTIVITY.test(s.criterion.trim()) && (
                  <p className="mt-0.5 inline-flex items-center gap-1 text-[11.5px] text-[oklch(0.5_0.12_70)]">
                    <TriangleAlert className="size-3" /> That reads like an activity. What result
                    would it prove?
                  </p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12.5px] text-muted-foreground">None yet.</p>
        )}
      </Panel>

      <Panel title="Plan">
        <div className="grid gap-3 md:grid-cols-2">
          <TextField
            label="Target date"
            type="date"
            value={c.targetDate}
            onChange={(v) => set({ targetDate: v })}
          />
          <TextField
            label="MSX milestone (reference)"
            hint="MSX stays the record; nothing in MSX changes from here."
            value={c.milestone}
            onChange={(v) => set({ milestone: v })}
          />
          <TextField
            label="Dependencies"
            rows={2}
            value={c.dependencies}
            onChange={(v) => set({ dependencies: v })}
          />
          <TextField label="Risks" rows={2} value={c.risks} onChange={(v) => set({ risks: v })} />
          <TextField
            label="Resources required"
            hint="People, environments, data access, time."
            rows={2}
            value={c.resources}
            onChange={(v) => set({ resources: v })}
          />
          <TextField
            label="First activity"
            rows={2}
            value={c.firstActivity}
            onChange={(v) => set({ firstActivity: v })}
          />
          <TextField
            label="Next decision point"
            rows={2}
            value={c.nextDecision.what}
            onChange={(v) => set({ nextDecision: { ...c.nextDecision, what: v } })}
          />
          <TextField
            label="Decision by"
            type="date"
            value={c.nextDecision.when}
            onChange={(v) => set({ nextDecision: { ...c.nextDecision, when: v } })}
          />
        </div>
      </Panel>

      <Panel
        title="Ready for validation"
        sub="Not needed to create the engagement; needed before a POC or pilot."
      >
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {checks.map((k) => (
            <li key={k.id} className="flex items-start gap-1.5 text-[12.5px]">
              {k.ok ? (
                <Check className="mt-0.5 size-3.5 text-success" />
              ) : (
                <Circle className="mt-0.5 size-3.5 text-muted-foreground" />
              )}
              <span>
                {k.label} <span className="text-muted-foreground">· {k.hint}</span>
              </span>
            </li>
          ))}
        </ul>
      </Panel>

      {draft &&
        (reviewing ? (
          <Panel title="Review engagement" tone="primary">
            <div className="space-y-3 text-[13px]">
              <TextField label="Engagement name" value={name} onChange={setName} />
              <dl className="grid gap-x-6 gap-y-1.5 text-[12.5px] md:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">Customer</dt>
                  <dd>{e.customer_name ?? "None"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">MSX</dt>
                  <dd>
                    {e.msx_opportunity_id
                      ? `Opportunity ${e.msx_opportunity_id}`
                      : "Proactive (no opportunity yet)"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Type</dt>
                  <dd>{ENGAGEMENT_TYPES[c.type].label}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Outcome</dt>
                  <dd>{c.outcome || "Not written yet"}</dd>
                </div>
              </dl>
              {missing.length > 0 && (
                <p className="text-[12.5px] text-[oklch(0.5_0.12_70)]">
                  Still open: {missing.join(", ")}. You can create it now and fill these in later.
                </p>
              )}
              <p className="rounded-md bg-muted/60 px-3 py-2 text-[12px] text-muted-foreground">
                Creating the engagement keeps everything you prepared. It doesn't change MSX, commit
                a milestone, transfer ownership or deploy anything.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={name.trim().length < 3 || create.isPending}
                  onClick={async () => {
                    await saveWs({ charter: c }, "Engagement plan");
                    create.mutate({ data: { id: e.id, name: name.trim(), charter: c } });
                  }}
                >
                  Create engagement
                </Button>
                <Button variant="ghost" onClick={() => setReviewing(false)}>
                  Keep editing
                </Button>
              </div>
            </div>
          </Panel>
        ) : (
          <div className="flex justify-end">
            <Button onClick={() => setReviewing(true)}>Review engagement</Button>
          </div>
        ))}
    </div>
  );
}
