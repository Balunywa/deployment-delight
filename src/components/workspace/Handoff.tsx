import { useServerFn } from "@tanstack/react-start";
import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { HANDOFF_CRITERIA, ENGAGEMENT_TYPES, RESOURCES, ROUTING } from "@/lib/playbook";
import { acceptHandoff } from "@/lib/workspace.functions";
import {
  type Check,
  emptyHandoff,
  emptyTcp,
  type Handoff,
  readinessOf,
  TAB_TITLE,
  type Tcp,
  uid,
} from "@/lib/workspace";

import { Chip, Field, Panel, TextField } from "./ui";
import { day, useWs, useWsValue } from "./ws";

type RoutingValue = Handoff["routing"];
type Risk = Tcp["risks"][number];

const tcpUrl =
  RESOURCES.find((r) => r.title === "Technical Close Plan")?.url ??
  "https://aka.ms/CAIPTechnicalClosePlan";
const handoffUrl =
  RESOURCES.find((r) => r.title === "STU-to-CSU handoff conversation")?.url ??
  "https://aka.ms/CAIPCSUHandoff";

function ReadyChecklist({ checks }: { checks: Check[] }) {
  const { go } = useWs();
  return (
    <ul className="space-y-2">
      {checks.map((check) => (
        <li
          key={check.id}
          className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border p-3"
        >
          <div className="min-w-0">
            <p className="text-[12.5px] font-medium">
              <span className={check.ok ? "text-success" : "text-muted-foreground"}>
                {check.ok ? "✓" : "○"}
              </span>{" "}
              {check.label}
            </p>
            <p className="mt-0.5 text-[11.5px] text-muted-foreground">{check.hint}</p>
          </div>
          {check.fix !== "handoff" && (
            <Button type="button" size="sm" variant="outline" onClick={() => go(check.fix)}>
              Go to {TAB_TITLE[check.fix]}
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

function stepDone(done: boolean) {
  return (
    <Chip className={done ? "bg-success/10 text-success" : ""}>
      {done ? "✓ Done" : "○ Not yet"}
    </Chip>
  );
}

function SectionStep({
  title,
  done,
  children,
}: {
  title: string;
  done: boolean;
  children: React.ReactNode;
}) {
  return (
    <li className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-[13px] font-semibold">{title}</h3>
        {stepDone(done)}
      </div>
      <div className="mt-3 space-y-3">{children}</div>
    </li>
  );
}

function toRouting(value: string): RoutingValue {
  return value === "unified" || value === "non-unified" ? value : "";
}

function hasText(value: string) {
  return value.trim().length > 0;
}

export function HandoffPlanView({ children }: { children: React.ReactNode }) {
  const { e, saveWs, refresh } = useWs();
  const accept = useServerFn(acceptHandoff);
  const [storedTcp, setStoredTcp] = useWsValue("tcp", "Technical Close Plan");
  const [storedHandoff, setStoredHandoff] = useWsValue("handoff", "Handoff");
  const tcp = storedTcp ?? emptyTcp();
  const handoff = storedHandoff ?? emptyHandoff();
  const setTcp = (u: Tcp | ((current: Tcp) => Tcp)) =>
    setStoredTcp((cur) => ({
      ...(typeof u === "function" ? u(cur ?? emptyTcp()) : u),
      updatedAt: new Date().toISOString(),
    }));
  const setHandoff = (u: Handoff | ((current: Handoff) => Handoff)) =>
    setStoredHandoff((cur) => (typeof u === "function" ? u(cur ?? emptyHandoff()) : u));
  const [discussionNote, setDiscussionNote] = React.useState(() => handoff.discussed?.note ?? "");
  const [acceptedBy, setAcceptedBy] = React.useState("");
  const [acceptedByTouched, setAcceptedByTouched] = React.useState(false);
  const [acceptanceNote, setAcceptanceNote] = React.useState("");
  const [confirmedAcceptance, setConfirmedAcceptance] = React.useState(false);
  const [accepting, setAccepting] = React.useState(false);
  const type = e.workspace.charter?.type;
  const isProduction = type ? ENGAGEMENT_TYPES[type].production : false;
  const checks = readinessOf(e).handoff;
  const accepted = e.workspace.handoff?.accepted ?? handoff.accepted;
  const acceptedByValue = acceptedByTouched ? acceptedBy : handoff.receivingOwner;
  const allCriteria = HANDOFF_CRITERIA.every((criterion) => handoff.criteria[criterion.id]);
  const transferred = handoff.transferred.architecture && handoff.transferred.risks;
  const acceptanceDisabledReason = !handoff.discussed
    ? "Record the handoff discussion first."
    : !handoff.receivingOwner.trim()
      ? "Name the receiving owner first."
      : !acceptedByValue.trim()
        ? "Enter who accepted ownership."
        : !confirmedAcceptance
          ? "Confirm that the receiving owner reviewed this and accepts ownership."
          : "";
  const canAccept = !acceptanceDisabledReason && !accepting;

  const updateTcp = (patch: Partial<Tcp>) => setTcp((current) => ({ ...current, ...patch }));
  const updateRisk = (id: string, patch: Partial<Risk>) =>
    setTcp((current) => ({
      ...current,
      risks: current.risks.map((risk) => (risk.id === id ? { ...risk, ...patch } : risk)),
    }));
  const addRisk = () =>
    updateTcp({
      risks: [...tcp.risks, { id: uid("tr"), text: "", owner: "", mitigation: "" }],
    });
  const removeRisk = (id: string) =>
    updateTcp({ risks: tcp.risks.filter((risk) => risk.id !== id) });
  const updateHandoff = (patch: Partial<Handoff>) =>
    setHandoff((current) => ({ ...current, ...patch }));
  const recordDiscussion = () =>
    updateHandoff({ discussed: { at: new Date().toISOString(), note: discussionNote } });
  const recordAcceptance = async () => {
    if (!canAccept) return;
    setAccepting(true);
    try {
      await saveWs({ handoff }, "Handoff");
      await accept({
        data: {
          id: e.id,
          by: acceptedByValue.trim(),
          note: acceptanceNote.trim(),
        },
      });
      toast.success("Handoff acceptance recorded.");
      refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not record acceptance.");
    } finally {
      setAccepting(false);
    }
  };

  return (
    <div className="space-y-5">
      <Panel
        title="Ready for delivery handoff"
        sub="Checks are guidance. Open the linked area to fill a gap."
      >
        <ReadyChecklist checks={checks} />
        <p className="mt-3 text-[12px] text-muted-foreground">
          Creating or handing off never commits an MSX milestone, transfers ownership automatically
          or triggers a deployment.
        </p>
      </Panel>

      <Panel
        title="Technical Close Plan"
        sub="Use for production milestones and keep MSX as the record."
        actions={
          <a
            href={tcpUrl}
            target="_blank"
            rel="noreferrer"
            className="text-[12px] font-medium text-primary hover:underline"
          >
            Open TCP resource
          </a>
        }
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3">
            <div>
              <p className="text-[12.5px] font-medium">
                This engagement has a production milestone
              </p>
              <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                {isProduction
                  ? "Suggested on because the charter type is production."
                  : "Turn this on only when the engagement has a production milestone."}
              </p>
            </div>
            <Switch
              aria-label="This engagement has a production milestone"
              checked={tcp.on}
              onCheckedChange={(on) => updateTcp({ on })}
            />
          </div>

          {!tcp.on ? (
            <p className="text-[12.5px] text-muted-foreground">
              TCPs are for production milestones only and are not imposed on discovery.
            </p>
          ) : (
            <div className="space-y-4">
              <TextField
                label="Milestone"
                hint="MSX stays the record; nothing is changed in MSX from here."
                value={tcp.milestone}
                onChange={(milestone) => updateTcp({ milestone })}
              />
              <div className="grid gap-3 md:grid-cols-2">
                <TextField
                  label="Target production date"
                  type="date"
                  value={tcp.productionDate}
                  onChange={(productionDate) => updateTcp({ productionDate })}
                />
                <TextField
                  label="Workload"
                  value={tcp.workload}
                  onChange={(workload) => updateTcp({ workload })}
                />
                <TextField
                  label="Architecture decisions"
                  value={tcp.architecture}
                  onChange={(architecture) => updateTcp({ architecture })}
                  rows={3}
                />
                <TextField
                  label="Deployment path"
                  value={tcp.deploymentPath}
                  onChange={(deploymentPath) => updateTcp({ deploymentPath })}
                  rows={3}
                />
                <TextField
                  label="Support model"
                  value={tcp.supportModel}
                  onChange={(supportModel) => updateTcp({ supportModel })}
                  rows={3}
                />
                <TextField
                  label="Acceptance criteria"
                  value={tcp.acceptance}
                  onChange={(acceptance) => updateTcp({ acceptance })}
                  rows={3}
                />
              </div>

              <div className="space-y-2 rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[12.5px] font-medium">Risks</p>
                  <Button type="button" size="sm" variant="outline" onClick={addRisk}>
                    Add risk
                  </Button>
                </div>
                {tcp.risks.length ? (
                  <div className="space-y-2">
                    {tcp.risks.map((risk) => (
                      <div
                        key={risk.id}
                        className="grid gap-2 rounded-lg border border-border p-3 md:grid-cols-[1fr_12rem_1fr_auto]"
                      >
                        <label className="space-y-1">
                          <span className="block text-[12px] font-medium">Risk</span>
                          <Input
                            value={risk.text}
                            onChange={(ev) => updateRisk(risk.id, { text: ev.target.value })}
                            className="h-8 text-[12.5px]"
                          />
                        </label>
                        <label className="space-y-1">
                          <span className="block text-[12px] font-medium">Owner</span>
                          <Input
                            value={risk.owner}
                            onChange={(ev) => updateRisk(risk.id, { owner: ev.target.value })}
                            className="h-8 text-[12.5px]"
                          />
                        </label>
                        <label className="space-y-1">
                          <span className="block text-[12px] font-medium">Mitigation</span>
                          <Input
                            value={risk.mitigation}
                            onChange={(ev) => updateRisk(risk.id, { mitigation: ev.target.value })}
                            className="h-8 text-[12.5px]"
                          />
                        </label>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="self-end"
                          onClick={() => removeRisk(risk.id)}
                        >
                          Remove
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[12px] text-muted-foreground">
                    Add risks with owners and mitigations when production work is in scope.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </Panel>

      <Panel
        title="STU-to-CSU handoff"
        sub="A human-reviewed transition. Guidance is recorded here; no ownership changes automatically."
        actions={
          <a
            href={handoffUrl}
            target="_blank"
            rel="noreferrer"
            className="text-[12px] font-medium text-primary hover:underline"
          >
            Open handoff resource
          </a>
        }
      >
        <div className="space-y-4">
          <p className="text-[12.5px] text-muted-foreground">
            Creating or handing off never commits an MSX milestone, never transfers ownership
            automatically and never triggers a deployment.
          </p>

          <ol className="list-decimal space-y-3 pl-5">
            <SectionStep title="Routing" done={!!handoff.routing}>
              <Field
                label="Routing"
                hint="Routing rules are guidance to confirm, not enforced here."
              >
                <Select
                  value={handoff.routing || "unset"}
                  onValueChange={(value) => updateHandoff({ routing: toRouting(value) })}
                >
                  <SelectTrigger aria-label="Routing" className="h-8 text-[12.5px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unset">Select routing</SelectItem>
                    <SelectItem value="unified">Unified</SelectItem>
                    <SelectItem value="non-unified">Non-Unified</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              {handoff.routing && (
                <p className="rounded-lg border border-border bg-muted/40 p-3 text-[12px] text-muted-foreground">
                  {ROUTING[handoff.routing]}
                </p>
              )}
            </SectionStep>

            <SectionStep title="Handoff discussion recorded" done={!!handoff.discussed}>
              <TextField
                label="Discussion note"
                value={discussionNote}
                onChange={(note) => {
                  setDiscussionNote(note);
                  setHandoff((current) =>
                    current.discussed
                      ? { ...current, discussed: { ...current.discussed, note } }
                      : current,
                  );
                }}
                rows={3}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" onClick={recordDiscussion}>
                  Record discussion
                </Button>
                {handoff.discussed && (
                  <span className="text-[12px] text-muted-foreground">
                    Recorded on {day(handoff.discussed.at)}. The saver is in the workspace audit.
                  </span>
                )}
              </div>
            </SectionStep>

            <SectionStep title="Commitment criteria validated" done={allCriteria}>
              <ul className="space-y-2">
                {HANDOFF_CRITERIA.map((criterion) => (
                  <li key={criterion.id}>
                    <label className="flex items-start gap-2 text-[12.5px]">
                      <Checkbox
                        className="mt-0.5"
                        checked={handoff.criteria[criterion.id] === true}
                        onCheckedChange={(checked) =>
                          setHandoff((current) => ({
                            ...current,
                            criteria: { ...current.criteria, [criterion.id]: checked === true },
                          }))
                        }
                      />
                      <span>{criterion.label}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </SectionStep>

            <SectionStep title="Receiving owner identified" done={hasText(handoff.receivingOwner)}>
              <div className="grid gap-3 md:grid-cols-2">
                <TextField
                  label="Receiving owner"
                  value={handoff.receivingOwner}
                  onChange={(receivingOwner) => updateHandoff({ receivingOwner })}
                />
                <TextField
                  label="Receiving team"
                  value={handoff.receivingTeam}
                  onChange={(receivingTeam) => updateHandoff({ receivingTeam })}
                />
              </div>
            </SectionStep>

            <SectionStep title="Risks and architecture context transferred" done={transferred}>
              <div className="space-y-2">
                <label className="flex items-start gap-2 text-[12.5px]">
                  <Checkbox
                    className="mt-0.5"
                    checked={handoff.transferred.architecture}
                    onCheckedChange={(checked) =>
                      updateHandoff({
                        transferred: { ...handoff.transferred, architecture: checked === true },
                      })
                    }
                  />
                  <span>Architecture context transferred</span>
                </label>
                <label className="flex items-start gap-2 text-[12.5px]">
                  <Checkbox
                    className="mt-0.5"
                    checked={handoff.transferred.risks}
                    onCheckedChange={(checked) =>
                      updateHandoff({
                        transferred: { ...handoff.transferred, risks: checked === true },
                      })
                    }
                  />
                  <span>Risk context transferred</span>
                </label>
              </div>
              <TextField
                label="Transfer notes"
                value={handoff.notes}
                onChange={(notes) => updateHandoff({ notes })}
                rows={3}
              />
            </SectionStep>

            <SectionStep title="Ownership accepted" done={!!accepted}>
              {accepted ? (
                <p className="rounded-lg border border-success/30 bg-success/5 p-3 text-[12.5px]">
                  Accepted by <b className="font-medium">{accepted.by}</b> on {day(accepted.at)}{" "}
                  (recorded by {accepted.recordedBy}){accepted.note ? ` — ${accepted.note}` : ""}
                </p>
              ) : (
                <div className="space-y-3">
                  <TextField
                    label="Accepted by"
                    value={acceptedByValue}
                    onChange={(by) => {
                      setAcceptedByTouched(true);
                      setAcceptedBy(by);
                    }}
                  />
                  <label className="flex items-start gap-2 text-[12.5px]">
                    <Checkbox
                      className="mt-0.5"
                      checked={confirmedAcceptance}
                      onCheckedChange={(checked) => setConfirmedAcceptance(checked === true)}
                    />
                    <span>The receiving owner reviewed this with me and accepts ownership.</span>
                  </label>
                  <TextField
                    label="Acceptance note"
                    value={acceptanceNote}
                    onChange={setAcceptanceNote}
                    rows={3}
                  />
                  {acceptanceDisabledReason && (
                    <p className="text-[12px] text-muted-foreground">{acceptanceDisabledReason}</p>
                  )}
                  <Button
                    type="button"
                    disabled={!canAccept}
                    onClick={() => void recordAcceptance()}
                  >
                    {accepting ? "Recording..." : "Record acceptance"}
                  </Button>
                </div>
              )}
            </SectionStep>
          </ol>
        </div>
      </Panel>

      <section aria-label="Context for the receiving team" className="space-y-3">
        <div>
          <h2 className="text-[16px] font-semibold tracking-tight">
            Context for the receiving team
          </h2>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">
            Share the internal handoff story after the plan is ready.
          </p>
        </div>
        {children}
      </section>
    </div>
  );
}
