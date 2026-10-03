/*
 * Shape the point of view: the centerpiece. A hypothesis to test with the customer, not a conclusion to sell. Every
 * material claim links to evidence or is visibly an assumption; the opening is labelled a working hypothesis; two or
 * three paths include keeping today's approach. Every saved change keeps the previous version.
 */
import {
  ChevronDown,
  ChevronRight,
  Copy,
  History,
  Link2,
  Plus,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  type Assumption,
  type AssumptionStatus,
  type PathOption,
  type Pov,
  composeOpening,
  draftPov,
  emptyPov,
  uid,
  unsupported,
} from "@/lib/workspace";

import { Chip, Panel, StatusChip, TextField } from "./ui";
import { day, useWs, useWsValue } from "./ws";

const ASSUMPTION_TONE: Record<AssumptionStatus, string> = {
  open: "bg-muted text-muted-foreground",
  confirmed: "bg-success/10 text-success",
  revised: "bg-info/10 text-info",
  rejected: "bg-danger/10 text-danger line-through",
};
const ASSUMPTION_LABEL: Record<AssumptionStatus, string> = {
  open: "To test",
  confirmed: "Confirmed",
  revised: "Revised",
  rejected: "Rejected",
};

function EvidencePicker({ pov, set }: { pov: Pov; set: (p: Pov) => void }) {
  const { data } = useWs();
  const [open, setOpen] = useState(false);
  const linked = data.items.filter((i) => pov.evidence.includes(i.id));
  const missing = pov.evidence.filter((id) => !data.items.some((i) => i.id === id)).length;
  return (
    <div role="group" aria-label="Evidence" className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12.5px] font-medium">Evidence that supports it</p>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
        >
          <Link2 className="size-3.5" /> {open ? "Done" : "Link evidence"}
        </Button>
      </div>
      {linked.length ? (
        <ul className="space-y-1">
          {linked.map((i) => (
            <li key={i.id} className="flex items-start gap-2 text-[12.5px]">
              <StatusChip status={i.status} />
              <span className="text-foreground/85">
                {i.text} <span className="text-muted-foreground">({i.source.label})</span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[12px] text-muted-foreground">
          Nothing linked: the point of view is a hypothesis until evidence backs it.
        </p>
      )}
      {missing > 0 && (
        <p className="text-[11.5px] text-muted-foreground">
          {missing} linked item{missing === 1 ? "" : "s"} no longer in the brief (the source
          changed).
        </p>
      )}
      {open && (
        <ul className="max-h-72 space-y-1 overflow-auto rounded-lg border border-border p-2">
          {data.items.map((i) => (
            <li key={i.id}>
              <label className="flex cursor-pointer items-start gap-2 rounded px-1 py-1 text-[12.5px] hover:bg-muted">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={pov.evidence.includes(i.id)}
                  onChange={(ev) =>
                    set({
                      ...pov,
                      evidence: ev.target.checked
                        ? [...pov.evidence, i.id]
                        : pov.evidence.filter((x) => x !== i.id),
                    })
                  }
                />
                <span>
                  {i.text} <span className="text-muted-foreground">· {i.source.label}</span>
                </span>
              </label>
            </li>
          ))}
          {!data.items.length && (
            <li className="text-[12px] text-muted-foreground">No evidence in the brief yet.</li>
          )}
        </ul>
      )}
    </div>
  );
}

function Assumptions({ pov, set }: { pov: Pov; set: (p: Pov) => void }) {
  const update = (id: string, patch: Partial<Assumption>) =>
    set({
      ...pov,
      assumptions: pov.assumptions.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    });
  return (
    <div role="group" aria-label="Assumptions" className="space-y-1.5">
      <p className="text-[12.5px] font-medium">Assumptions and missing evidence</p>
      <p className="text-[11.5px] text-muted-foreground">
        What has to be true for this to hold. Each becomes a question in the call plan.
      </p>
      {pov.assumptions.map((a, i) => (
        <div key={a.id} className="rounded-lg border border-border p-2">
          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
                ASSUMPTION_TONE[a.status],
              )}
            >
              {ASSUMPTION_LABEL[a.status]}
            </span>
            <Input
              aria-label={`Assumption ${i + 1}`}
              value={a.text}
              onChange={(ev) => update(a.id, { text: ev.target.value })}
              className="h-8 text-[12.5px]"
            />
            <button
              type="button"
              aria-label={`Remove assumption ${i + 1}`}
              onClick={() =>
                set({ ...pov, assumptions: pov.assumptions.filter((x) => x.id !== a.id) })
              }
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-danger"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
          {(a.quote || a.revisedTo) && (
            <p className="mt-1 pl-1 text-[11.5px] text-muted-foreground">
              {a.revisedTo && <>Now: {a.revisedTo}. </>}
              {a.quote && <>They said: “{a.quote}”</>}
            </p>
          )}
        </div>
      ))}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() =>
          set({
            ...pov,
            assumptions: [...pov.assumptions, { id: uid("as"), text: "", status: "open" }],
          })
        }
      >
        <Plus className="size-3.5" /> Add an assumption
      </Button>
    </div>
  );
}

function Paths({ pov, set }: { pov: Pov; set: (p: Pov) => void }) {
  const update = (id: string, patch: Partial<PathOption>) =>
    set({ ...pov, paths: pov.paths.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
  return (
    <Panel
      title="Plausible paths"
      sub="Two or three directions and what each needs. Keeping today's approach counts. No service picks before the need is clear."
      actions={
        pov.paths.length < 4 && (
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              set({
                ...pov,
                paths: [
                  ...pov.paths,
                  {
                    id: uid("pa"),
                    title: "",
                    outcome: "",
                    prerequisites: "",
                    implications: "",
                    risks: "",
                    evidenceNeeded: "",
                  },
                ],
              })
            }
          >
            <Plus className="size-3.5" /> Add a path
          </Button>
        )
      }
    >
      <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
        {pov.paths.map((p, i) => (
          <article
            key={p.id}
            aria-label={`Path ${i + 1}`}
            className={cn(
              "space-y-2 rounded-lg border p-3",
              p.current ? "border-border bg-muted/30" : "border-border",
            )}
          >
            <div className="flex items-center gap-1.5">
              <Input
                aria-label={`Path ${i + 1} title`}
                value={p.title}
                placeholder="Name the path"
                onChange={(ev) => update(p.id, { title: ev.target.value })}
                className="h-8 text-[13px] font-medium"
              />
              <button
                type="button"
                aria-label={`Remove path ${i + 1}`}
                onClick={() => set({ ...pov, paths: pov.paths.filter((x) => x.id !== p.id) })}
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-danger"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
            <label className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
              <input
                type="checkbox"
                checked={!!p.current}
                onChange={(ev) => update(p.id, { current: ev.target.checked })}
              />
              Keeps today's approach
            </label>
            <TextField
              label="Outcome it could enable"
              rows={2}
              value={p.outcome}
              onChange={(v) => update(p.id, { outcome: v })}
            />
            <TextField
              label="Prerequisites and dependencies"
              rows={2}
              value={p.prerequisites}
              onChange={(v) => update(p.id, { prerequisites: v })}
            />
            <TextField
              label="Integration, security, operations, adoption"
              rows={2}
              value={p.implications}
              onChange={(v) => update(p.id, { implications: v })}
            />
            <TextField
              label="What it risks or delays"
              rows={2}
              value={p.risks}
              onChange={(v) => update(p.id, { risks: v })}
            />
            <TextField
              label="Evidence needed to choose it"
              rows={2}
              value={p.evidenceNeeded}
              onChange={(v) => update(p.id, { evidenceNeeded: v })}
            />
          </article>
        ))}
      </div>
    </Panel>
  );
}

function HistoryList() {
  const { e } = useWs();
  const [open, setOpen] = useState<number | null>(null);
  const history = [...(e.workspace.povHistory ?? [])].reverse();
  if (!history.length) return null;
  return (
    <Panel
      title="Revision history"
      sub="Earlier versions, newest first. Customer feedback never erases them."
    >
      <ul className="space-y-1.5">
        {history.map((h, i) => (
          <li key={h.at} className="rounded-lg border border-border">
            <button
              type="button"
              onClick={() => setOpen(open === i ? null : i)}
              aria-expanded={open === i}
              className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-[12.5px]"
            >
              {open === i ? (
                <ChevronDown className="size-3.5" />
              ) : (
                <ChevronRight className="size-3.5" />
              )}
              <History className="size-3.5 text-muted-foreground" />
              <span className="font-medium">{h.reason}</span>
              <span className="text-muted-foreground">
                · {h.by} · {day(h.at)}{" "}
                {new Date(h.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
              </span>
            </button>
            {open === i && (
              <div className="space-y-1.5 border-t border-border px-3 py-2 text-[12.5px]">
                {h.pov.opening && (
                  <p>
                    <span className="font-medium">Opening then:</span> {h.pov.opening}
                  </p>
                )}
                {h.pov.assumptions.length > 0 && (
                  <ul className="list-disc pl-4 text-foreground/85">
                    {h.pov.assumptions.map((a) => (
                      <li key={a.id}>
                        {a.text}{" "}
                        <span className="text-muted-foreground">
                          ({ASSUMPTION_LABEL[a.status].toLowerCase()})
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export function PovView() {
  const { data, go } = useWs();
  const [stored, setPov] = useWsValue("pov", "Edited the point of view");
  const pov = stored ?? null;

  if (!pov)
    return (
      <Panel
        title="Shape your point of view"
        sub="Bring a hypothesis to test, not a conclusion to sell. It should connect what you see technically to what it means for the business, and say what would prove it wrong."
        tone="primary"
      >
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={!data.prep}
            onClick={() => data.prep && setPov(draftPov(data.prep, data.items))}
          >
            <Wand2 className="size-4" /> Draft from the evidence
          </Button>
          <Button variant="outline" onClick={() => setPov(emptyPov())}>
            Start blank
          </Button>
        </div>
        <p className="mt-2 text-[12px] text-muted-foreground">
          The draft only quotes the brief and lists what it assumes. Nothing is invented; you edit
          everything.
        </p>
      </Panel>
    );

  const set = (p: Pov) => setPov(p);
  const f = (
    k: "pressure" | "stakeholders" | "consequence" | "technical" | "disprove" | "invite",
  ) => ({
    value: pov[k],
    onChange: (v: string) => set({ ...pov, [k]: v }),
  });
  const warnings = unsupported(pov);

  return (
    <div className="space-y-4">
      <Panel
        title="Point of view"
        sub="Facts, interpretations and open questions kept apart. Edit freely: earlier versions are kept."
        label="Point of view"
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <TextField
            label="Observed pressure or change"
            hint="What changed for them. Link the evidence below."
            rows={3}
            {...f("pressure")}
          />
          <TextField
            label="Stakeholders affected, and what they value"
            hint="Label anything you inferred."
            rows={3}
            {...f("stakeholders")}
          />
          <TextField
            label="Business consequence or opportunity"
            hint="Their words only. No invented costs, urgency or intent; leave it blank until they say it."
            rows={3}
            {...f("consequence")}
          />
          <TextField
            label="Technical factors contributing"
            hint="What in their environment makes it hard today."
            rows={3}
            {...f("technical")}
          />
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <EvidencePicker pov={pov} set={set} />
          <Assumptions pov={pov} set={set} />
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <TextField
            label="What would disprove it"
            hint="If you heard this, you'd change your view."
            rows={2}
            {...f("disprove")}
          />
          <TextField label="A question that invites them to correct it" rows={2} {...f("invite")} />
        </div>
        {warnings.length > 0 && (
          <ul className="mt-3 space-y-0.5 text-[12px] text-[oklch(0.5_0.12_70)]">
            {warnings.map((w) => (
              <li key={w}>· {w}</li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        title={
          <span className="inline-flex items-center gap-2">
            Opening statement <Chip className="bg-primary/10 text-primary">Working hypothesis</Chip>
          </span>
        }
        label="Opening statement"
        sub="Say it in under thirty seconds, then listen. Built only from what you wrote above."
        actions={
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={() => set({ ...pov, opening: composeOpening(pov) })}
            >
              <Sparkles className="size-3.5" /> Compose from the fields
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={!pov.opening}
              onClick={() =>
                void navigator.clipboard.writeText(pov.opening).then(() => toast.success("Copied."))
              }
            >
              <Copy className="size-3.5" /> Copy
            </Button>
          </>
        }
      >
        <TextField
          label="Opening"
          rows={4}
          value={pov.opening}
          onChange={(v) => set({ ...pov, opening: v })}
        />
        <div className="mt-3 flex justify-end">
          <Button onClick={() => go("plan")}>Prepare the conversation</Button>
        </div>
      </Panel>

      <Paths pov={pov} set={set} />
      <HistoryList />
    </div>
  );
}
