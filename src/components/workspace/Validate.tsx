import * as React from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { type Check, emptyPoc, readinessOf, TAB_TITLE, uid, type Poc } from "@/lib/workspace";
import { ENGAGEMENT_TYPES, RESOURCES } from "@/lib/playbook";

import { Chip, Panel, StringList, TextField } from "./ui";
import { useWs, useWsValue } from "./ws";

const tcpUrl =
  RESOURCES.find((r) => r.title === "Technical Close Plan")?.url ??
  "https://aka.ms/CAIPTechnicalClosePlan";

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
          {check.fix !== "prove" && (
            <Button type="button" size="sm" variant="outline" onClick={() => go(check.fix)}>
              Go to {TAB_TITLE[check.fix]}
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

function hasText(value: string) {
  return value.trim().length > 0;
}

export function ValidateView({ children }: { children: React.ReactNode }) {
  const { e } = useWs();
  const [stored, setStored] = useWsValue("poc", "Validation plan");
  const poc = stored ?? emptyPoc();
  const setPoc = (u: Poc | ((current: Poc) => Poc)) =>
    setStored((cur) => (typeof u === "function" ? u(cur ?? emptyPoc()) : u));
  const type = e.workspace.charter?.type;
  const isPocOrPilot = type === "poc" || type === "pilot";
  const isProduction = type ? ENGAGEMENT_TYPES[type].production : false;
  const checks = readinessOf(e).validation;
  const assumptions =
    e.workspace.pov?.assumptions.filter((a) => a.status === "open" || a.status === "revised") ?? [];
  const assumptionTexts = assumptions
    .map((a) => (a.status === "revised" && a.revisedTo ? a.revisedTo : a.text).trim())
    .filter(hasText);
  const customHypotheses = poc.hypotheses.filter((h) => !assumptionTexts.includes(h));
  const showGuidance = !isPocOrPilot || !poc.decision.trim();

  const updatePoc = (patch: Partial<Poc>) => setPoc((current) => ({ ...current, ...patch }));
  const toggleHypothesis = (text: string, checked: boolean) =>
    setPoc((current) => {
      const without = current.hypotheses.filter((h) => h !== text);
      return { ...current, hypotheses: checked ? [...without, text] : without };
    });
  const setCustomHypotheses = (values: string[]) =>
    updatePoc({
      hypotheses: [...assumptionTexts.filter((text) => poc.hypotheses.includes(text)), ...values],
    });
  const updatePassFail = (id: string, patch: Partial<Poc["passFail"][number]>) =>
    setPoc((current) => ({
      ...current,
      passFail: current.passFail.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    }));
  const addPassFail = () =>
    updatePoc({
      passFail: [...poc.passFail, { id: uid("pf"), criterion: "", threshold: "" }],
    });
  const removePassFail = (id: string) =>
    updatePoc({ passFail: poc.passFail.filter((item) => item.id !== id) });

  return (
    <div className="space-y-5">
      {showGuidance && (
        <Panel
          title="Is a POC the right step?"
          tone="warning"
          sub="Use validation only when the result changes a real decision."
        >
          <div className="space-y-3 text-[12.5px] text-muted-foreground">
            <p>
              A demo, assessment or workshop is usually faster when no decision depends on the
              result. Do not force a POC; choose the lightest step that helps the customer decide.
            </p>
            {!isPocOrPilot && type && (
              <p>
                The charter is set to{" "}
                <b className="font-medium text-foreground">{ENGAGEMENT_TYPES[type].label}</b>.
                Change the charter only if the next step really is a POC or pilot.
              </p>
            )}
            {!poc.decision.trim() && (
              <p>Write the decision this validation will inform before planning the work.</p>
            )}
          </div>
        </Panel>
      )}

      <Panel
        title="Ready for validation"
        sub="Checks are guidance. Open the linked area to fill a gap."
      >
        <ReadyChecklist checks={checks} />
        {isProduction && (
          <p className="mt-3 text-[12px] text-muted-foreground">
            Production engagements should also keep a{" "}
            <a
              href={tcpUrl}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-primary hover:underline"
            >
              Technical Close Plan
            </a>
            .
          </p>
        )}
      </Panel>

      <Panel
        title="Validation plan"
        sub="Plan the POC or pilot around the decision, evidence and owner."
      >
        <div className="space-y-4">
          <TextField
            label="Decision this will inform"
            hint="If no decision depends on the result, choose a lighter activity."
            value={poc.decision}
            onChange={(decision) => updatePoc({ decision })}
            rows={2}
          />

          <div className="space-y-2 rounded-lg border border-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[12.5px] font-medium">Hypotheses being tested</p>
              <Chip>{poc.hypotheses.filter(hasText).length} selected</Chip>
            </div>
            {assumptionTexts.length ? (
              <ul className="space-y-2">
                {assumptionTexts.map((text) => (
                  <li key={text}>
                    <label className="flex items-start gap-2 text-[12.5px]">
                      <Checkbox
                        className="mt-0.5"
                        checked={poc.hypotheses.includes(text)}
                        onCheckedChange={(checked) => toggleHypothesis(text, checked === true)}
                      />
                      <span>{text}</span>
                    </label>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[12px] text-muted-foreground">
                No open or revised assumptions are in the point of view yet.
              </p>
            )}
            <StringList
              label="Own hypotheses"
              hint="Add customer-specific things this validation must prove or disprove."
              values={customHypotheses}
              onChange={setCustomHypotheses}
              placeholder="Hypothesis to test"
              addLabel="Add hypothesis"
            />
          </div>

          <div className="space-y-2 rounded-lg border border-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[12.5px] font-medium">Pass/fail criteria</p>
              <Button type="button" size="sm" variant="outline" onClick={addPassFail}>
                Add criterion
              </Button>
            </div>
            {poc.passFail.length ? (
              <div className="space-y-2">
                {poc.passFail.map((item, index) => (
                  <div
                    key={item.id}
                    className="grid gap-2 rounded-lg border border-border p-3 md:grid-cols-[1fr_1fr_auto]"
                  >
                    <label className="space-y-1">
                      <span className="block text-[12px] font-medium">Criterion {index + 1}</span>
                      <Input
                        value={item.criterion}
                        onChange={(ev) => updatePassFail(item.id, { criterion: ev.target.value })}
                        className="h-8 text-[12.5px]"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="block text-[12px] font-medium">Threshold</span>
                      <Input
                        value={item.threshold}
                        onChange={(ev) => updatePassFail(item.id, { threshold: ev.target.value })}
                        className="h-8 text-[12.5px]"
                      />
                    </label>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="self-end"
                      onClick={() => removePassFail(item.id)}
                    >
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[12px] text-muted-foreground">
                Add the evidence and threshold the customer will use to decide.
              </p>
            )}
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <TextField
              label="Environment"
              value={poc.environment}
              onChange={(environment) => updatePoc({ environment })}
              rows={3}
            />
            <TextField
              label="Data restrictions"
              value={poc.data}
              onChange={(data) => updatePoc({ data })}
              rows={3}
            />
            <TextField
              label="Duration"
              value={poc.duration}
              onChange={(duration) => updatePoc({ duration })}
            />
            <TextField
              label="Resource limits"
              value={poc.resources}
              onChange={(resources) => updatePoc({ resources })}
              rows={2}
            />
            <TextField
              label="Production implications"
              value={poc.production}
              onChange={(production) => updatePoc({ production })}
              rows={3}
            />
            <TextField
              label="Exit decision"
              value={poc.exitDecision}
              onChange={(exitDecision) => updatePoc({ exitDecision })}
              rows={3}
            />
            <TextField
              label="Next owner"
              value={poc.nextOwner}
              onChange={(nextOwner) => updatePoc({ nextOwner })}
            />
          </div>
        </div>
      </Panel>

      <section aria-label="Run, measure and decide" className="space-y-3">
        <div>
          <h2 className="text-[16px] font-semibold tracking-tight">Run, measure and decide</h2>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">
            Deploy only what was agreed, measure against the plan, and record the decision.
          </p>
        </div>
        {children}
      </section>
    </div>
  );
}
