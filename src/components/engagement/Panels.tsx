/*
 * Around the conversation: Prep (before the meeting), Fit & gap (what the answers point to, and what stands in
 * the way), Recap (what the customer sees) and Handoff (what the CSA and delivery team inherit, internal only).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowRight,
  Building2,
  ClipboardCopy,
  ExternalLink,
  Lock,
  Plus,
  Presentation,
  Sparkles,
  UserRound,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Pill } from "@/components/Primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  ACCELERATORS,
  CARD_BY_ID,
  KIND_LABEL,
  PATHS,
  agentGates,
  fitOf,
  newId,
  readinessOf,
  suggest,
} from "@/lib/conversation";
import {
  type Audience,
  CONCEPTS,
  type Engagement,
  READINESS,
  type Readiness,
  type Stakeholder,
} from "@/lib/engagements";
import {
  type AccountContext,
  type EngagementInstall,
  assistEngagement,
  handOff,
} from "@/lib/engagements.functions";
import { assistStatusQuery, customersQuery, recapQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

import type { Apply, Focus } from "./Conversation";
import { Card, type CatalogProduct } from "./Prove";
import { RecapDocument } from "./Recap";

const TONE: Record<Readiness, "success" | "warning" | "danger" | "neutral"> = {
  ready: "success",
  partial: "warning",
  blocker: "danger",
  "not-needed": "neutral",
  unknown: "neutral",
};

const CARES: Record<Audience, string> = {
  executive: "Business value, investment trade-offs, risk and time to value.",
  technical: "Dependencies, technical validation, production readiness and hand-offs.",
  internal: "Priorities, ownership, resources and what we commit.",
};

/* ------------------------------------------------------------------------------------------- prep */

export function PrepView({
  e,
  account,
  installs,
  products,
  apply,
  onAsk,
}: {
  e: Engagement;
  account: AccountContext | null;
  installs: EngagementInstall[];
  products: CatalogProduct[];
  apply: Apply;
  onAsk: (f: Focus) => void;
}) {
  const running = [
    ...new Set(
      installs.map((i) => products.find((p) => p.id === i.product_id)?.name).filter(Boolean),
    ),
  ] as string[];
  const hypotheses: string[] = [];
  if (account) {
    if (account.foundation)
      hypotheses.push(
        `They have a landing zone on record (${account.foundation.status}). Start the security conversation from it, not from scratch.`,
      );
    else
      hypotheses.push(
        "No landing zone on record. Security approval is likely to gate any proof; ask about it early.",
      );
    if (running.length)
      hypotheses.push(
        `They already run ${running.join(", ")}. Build on it; don't propose a parallel platform.`,
      );
    if (/util|energy|oil|gas|power/i.test(account.industry ?? ""))
      hypotheses.push(
        `In ${account.industry?.toLowerCase()}, maintenance planning, outage and turnaround work packages, permits and field inspections are common first workflows. Prompts, not answers.`,
      );
    for (const o of account.others)
      hypotheses.push(`There's another engagement with them: “${o.name}”. Read its handoff first.`);
  }
  const have = new Set(e.findings.map((f) => f.text));
  const openers = suggest(e).slice(0, 3);
  const [person, setPerson] = useState<Stakeholder>({ name: "", role: "", audience: "executive" });
  const people = e.brief.stakeholders ?? [];
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-5">
        <Card
          title="What we already know about the account"
          sub="From Cloud Delivery. Check it with the account team; it isn't the customer's view."
        >
          {account ? (
            <dl className="grid gap-x-6 gap-y-3 text-[13px] sm:grid-cols-2">
              <div>
                <dt className="text-[11.5px] text-muted-foreground">Industry</dt>
                <dd className="mt-0.5 font-medium">{account.industry ?? "Not recorded"}</dd>
              </div>
              <div>
                <dt className="text-[11.5px] text-muted-foreground">Azure</dt>
                <dd className="mt-0.5 font-medium">
                  {account.azure_model?.replace(/_/g, " ").replace("alz", "landing zone") ??
                    "Unknown"}
                </dd>
              </div>
              <div>
                <dt className="text-[11.5px] text-muted-foreground">Landing zone</dt>
                <dd className="mt-0.5 font-medium">
                  {account.foundation ? (
                    <Link to="/foundations" className="hover:text-primary">
                      {account.foundation.name} · {account.foundation.status}
                    </Link>
                  ) : (
                    "None on record"
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-[11.5px] text-muted-foreground">Catalog solutions running</dt>
                <dd className="mt-0.5 font-medium">
                  {running.length ? running.join(", ") : "None yet"}
                </dd>
              </div>
            </dl>
          ) : (
            <LinkCustomer e={e} apply={apply} />
          )}
        </Card>

        <Card
          title="Starting hypotheses"
          sub="What we'd expect before anyone has said anything. Test them; never present them as findings."
        >
          {hypotheses.length ? (
            <ul className="space-y-2">
              {hypotheses.map((h) => (
                <li
                  key={h}
                  className="flex items-start justify-between gap-3 rounded-lg border border-border px-3.5 py-2.5 text-[13px]"
                >
                  <span>{h}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="shrink-0"
                    disabled={have.has(h)}
                    onClick={() =>
                      apply(
                        {
                          findings: [
                            ...e.findings,
                            {
                              id: newId(),
                              text: h,
                              kind: "hypothesis",
                              source: "presenter",
                              edited: true,
                              at: new Date().toISOString(),
                            },
                          ],
                        },
                        "Added as a hypothesis to test.",
                      )
                    }
                  >
                    {have.has(h) ? (
                      "Added"
                    ) : (
                      <>
                        <Plus className="size-3.5" /> Test it
                      </>
                    )}
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12.5px] text-muted-foreground">Nothing on record to start from.</p>
          )}
        </Card>

        <Card
          title={e.trail.length ? "Open the next conversation with" : "Open with"}
          sub="Given what's been heard so far, with the reason for each."
        >
          <ul className="space-y-2">
            {openers.map((s) => (
              <li key={s.card.id}>
                <button
                  onClick={() => onAsk({ stage: s.card.stage, card: s.card.id })}
                  className="flex w-full items-start justify-between gap-3 rounded-lg border border-border px-3.5 py-2.5 text-left hover:border-primary/40"
                >
                  <span>
                    <span className="block text-[13.5px] font-medium">{s.card.question}</span>
                    <span className="mt-0.5 block text-[12px] text-muted-foreground">
                      {s.because}
                    </span>
                  </span>
                  <ArrowRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="space-y-5">
        <Card title="What we've heard so far">
          {e.brief.signals?.length ? (
            <ul className="space-y-1.5 text-[13px]">
              {PATHS.filter((p) => e.brief.signals!.includes(p.key)).map((p) => (
                <li key={p.key}>“{p.says}”</li>
              ))}
            </ul>
          ) : (
            <p className="text-[12.5px] text-muted-foreground">Nothing yet.</p>
          )}
          {e.brief.words && (
            <p className="mt-3 rounded-md bg-muted/50 px-3 py-2 text-[12.5px] italic">
              “{e.brief.words}”
            </p>
          )}
        </Card>

        <TeamCard e={e} apply={apply} />

        <Card title="Who's in the room" sub="And what each of them will listen for.">
          {people.length > 0 && (
            <ul className="space-y-2.5">
              {people.map((p, i) => (
                <li key={`${p.name}-${i}`} className="flex items-start gap-2.5 text-[13px]">
                  <UserRound className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0">
                    <span className="font-medium">{p.name}</span>
                    <span className="text-muted-foreground"> · {p.role}</span>
                    <span className="mt-0.5 block text-[11.5px] text-muted-foreground">
                      {CARES[p.audience]}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 grid gap-1.5">
            <div className="grid grid-cols-2 gap-1.5">
              <Input
                className="h-8 text-[12.5px]"
                placeholder="Name"
                aria-label="Stakeholder name"
                value={person.name}
                onChange={(ev) => setPerson({ ...person, name: ev.target.value })}
              />
              <Input
                className="h-8 text-[12.5px]"
                placeholder="Role"
                aria-label="Stakeholder role"
                value={person.role}
                onChange={(ev) => setPerson({ ...person, role: ev.target.value })}
              />
            </div>
            <div className="flex gap-1.5">
              <Select
                value={person.audience}
                onValueChange={(v) => setPerson({ ...person, audience: v as Audience })}
              >
                <SelectTrigger className="h-8 text-[12.5px]" aria-label="Audience">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="executive">Customer executive</SelectItem>
                  <SelectItem value="technical">Technical</SelectItem>
                  <SelectItem value="internal">Our side</SelectItem>
                </SelectContent>
              </Select>
              <Button
                size="sm"
                variant="outline"
                className="h-8"
                disabled={!person.name.trim()}
                onClick={() => {
                  apply({ brief: { ...e.brief, stakeholders: [...people, person] } }, "Added.");
                  setPerson({ name: "", role: "", audience: "executive" });
                }}
              >
                <Plus className="size-3.5" /> Add
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

function LinkCustomer({ e, apply }: { e: Engagement; apply: Apply }) {
  const customers = useQuery(customersQuery);
  const [pick, setPick] = useState("");
  return (
    <div className="space-y-2.5">
      <p className="text-[12.5px] text-muted-foreground">
        Not linked to a customer, so there's nothing on record, and nothing can be deployed to their
        Azure. Link it when they're in Cloud Delivery.
      </p>
      <div className="flex gap-2">
        <Select value={pick} onValueChange={setPick}>
          <SelectTrigger className="h-9 max-w-xs" aria-label="Customer to link">
            <SelectValue placeholder="Choose the customer" />
          </SelectTrigger>
          <SelectContent>
            {(customers.data ?? []).map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          disabled={!pick}
          onClick={() => apply({ customer_id: pick }, "Linked to the customer.")}
        >
          Link
        </Button>
      </div>
    </div>
  );
}

function TeamCard({ e, apply }: { e: Engagement; apply: Apply }) {
  const [team, setTeam] = useState({
    se: e.brief.team?.se ?? e.owner_name ?? "",
    csa: e.brief.team?.csa ?? "",
    ssp: e.brief.team?.ssp ?? "",
  });
  const roles = [
    ["se", "Solution engineer", "Leads the conversation and the proof"],
    ["csa", "Cloud solution architect", "Takes it to production"],
    ["ssp", "Specialist seller", "Owns the commercial side"],
  ] as const;
  const changed = roles.some(
    ([k]) => team[k] !== (e.brief.team?.[k] ?? (k === "se" ? (e.owner_name ?? "") : "")),
  );
  return (
    <Card title="Our team" sub="Who does what on our side, so the handoff has a name on it.">
      <div className="space-y-2">
        {roles.map(([k, label, hint]) => (
          <label key={k} className="block">
            <span className="text-[12px] font-medium">{label}</span>
            <span className="ml-1.5 text-[11px] text-muted-foreground">{hint}</span>
            <Input
              className="mt-1 h-8 text-[12.5px]"
              aria-label={label}
              placeholder="Name"
              value={team[k]}
              onChange={(ev) => setTeam({ ...team, [k]: ev.target.value })}
            />
          </label>
        ))}
      </div>
      <Button
        size="sm"
        variant="outline"
        className="mt-3"
        disabled={!changed}
        onClick={() => apply({ brief: { ...e.brief, team } }, "Team saved.")}
      >
        Save team
      </Button>
    </Card>
  );
}

/* --------------------------------------------------------------------------------------- fit & gap */

export function FitGapView({
  e,
  products,
  apply,
  onAsk,
}: {
  e: Engagement;
  products: CatalogProduct[];
  apply: Apply;
  onAsk: (f: Focus) => void;
}) {
  const fit = fitOf(e);
  const readiness = readinessOf(e);
  const { gates, verdict } = agentGates(e);
  const chosen = new Set(e.solution_map.flatMap((m) => m.products));
  const toggle = (id: string, n: number) => {
    const on = chosen.has(id);
    const map = on
      ? e.solution_map
          .map((m) => ({ ...m, products: m.products.filter((p) => p !== id) }))
          .filter((m) => m.products.length)
      : [
          ...e.solution_map,
          {
            concept: ACCELERATORS[n]?.needs[0] ?? "workflows",
            products: [id],
            note: fit.find((f) => f.id === id)?.because[0] ?? "",
          },
        ];
    apply({ solution_map: map }, on ? "Removed from the proof." : "Added to the proof.");
  };
  const evidence = e.findings.filter((f) => f.kind === "hypothesis" || f.kind === "unknown");
  return (
    <div className="space-y-5">
      <Card
        title="Is an agent the right answer yet?"
        sub="Three different questions that are easy to blur. A blocked gate means a smaller first step, not a platform rebuild."
      >
        <div className="grid gap-3 md:grid-cols-3">
          {gates.map((g) => (
            <div key={g.key} className="rounded-lg border border-border p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[13.5px] font-semibold">{g.title}</p>
                <Pill tone={TONE[g.status]}>{READINESS[g.status].label}</Pill>
              </div>
              <p className="mt-1.5 text-[12px] text-muted-foreground">
                {g.key === "reach"
                  ? "Data availability: where it lives, and whether it can be read."
                  : g.key === "meaning"
                    ? "Business context: shared definitions and knowledge."
                    : "Action: which steps a person approves, and under what controls."}
              </p>
              {g.note && <p className="mt-2 text-[12px]">Heard: {g.note}</p>}
            </div>
          ))}
        </div>
        <p className="mt-4 rounded-lg bg-muted/50 px-4 py-3 text-[13px] font-medium">{verdict}</p>
      </Card>

      <Card
        title="What the answers point to"
        sub="Ranked by how many of the customer's answers point to each accelerator. Gaps are shown even when the fit looks good."
      >
        {fit.length ? (
          <ul className="space-y-3">
            {fit.map((f) => {
              const p = products.find((x) => x.id === f.id);
              const on = chosen.has(f.id);
              return (
                <li
                  key={f.n}
                  className={cn(
                    "rounded-xl border p-5",
                    on ? "border-primary/40 bg-primary/[0.03]" : "border-border",
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        to="/products/$productId"
                        params={{ productId: f.id }}
                        className="text-[15px] font-semibold hover:text-primary"
                      >
                        {p?.name ?? `Accelerator ${f.n}`}
                      </Link>
                      {p?.outcome && (
                        <p className="mt-0.5 text-[12.5px] text-muted-foreground">{p.outcome}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Pill>
                        {f.score} {f.score === 1 ? "answer" : "answers"}
                      </Pill>
                      <Button
                        size="sm"
                        variant={on ? "default" : "outline"}
                        onClick={() => toggle(f.id, f.n)}
                      >
                        {on ? "In the proof" : "Use for the proof"}
                      </Button>
                    </div>
                  </div>
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <div>
                      <p className="text-[11px] font-semibold tracking-[0.08em] text-success uppercase">
                        Fits because they said
                      </p>
                      <ul className="mt-1.5 space-y-1 text-[12.5px]">
                        {f.because.map((b) => (
                          <li key={b}>{b}</li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold tracking-[0.08em] text-[oklch(0.5_0.12_70)] uppercase">
                        Gaps
                      </p>
                      <ul className="mt-1.5 space-y-1 text-[12.5px]">
                        {f.gaps.map((g) => (
                          <li key={g}>{g}</li>
                        ))}
                        <li className="text-muted-foreground">{f.caveat}</li>
                      </ul>
                    </div>
                  </div>
                  {f.agent && (
                    <p className="mt-3 border-t border-border pt-3 text-[12.5px]">
                      <span className="font-medium">Where the agent comes in: </span>
                      <span className="text-muted-foreground">{f.agent}</span>
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-[12.5px] text-muted-foreground">
            Nothing yet. The fit comes from the customer's answers, so explore first.
          </p>
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Readiness, from what they said" sub="The latest answer about each concept.">
          <ul className="divide-y divide-border">
            {CONCEPTS.map((c) => {
              const r = readiness[c.key];
              const st = r?.status ?? "unknown";
              return (
                <li key={c.key} className="flex items-start justify-between gap-3 py-2.5">
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium">{c.title}</span>
                    <span className="block text-[12px] text-muted-foreground">
                      {r?.note ?? c.meaning}
                    </span>
                  </span>
                  <Pill tone={TONE[st]}>{READINESS[st].label}</Pill>
                </li>
              );
            })}
          </ul>
        </Card>
        <Card title="Evidence to collect" sub="Hypotheses and unknowns the proof must settle.">
          {evidence.length ? (
            <ul className="space-y-2">
              {evidence.map((f) => (
                <li key={f.id} className="flex items-start gap-2 text-[12.5px]">
                  <Pill tone={f.kind === "hypothesis" ? "warning" : "info"}>
                    {KIND_LABEL[f.kind]}
                  </Pill>
                  <span>{f.text}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12.5px] text-muted-foreground">Nothing open.</p>
          )}
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => onAsk({ stage: "validate" })}
          >
            Test them with the customer <ArrowRight className="size-3.5" />
          </Button>
        </Card>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------ recap */

export function RecapView({ e }: { e: Engagement }) {
  const recap = useQuery(recapQuery(e.id));
  const status = useQuery(assistStatusQuery);
  const draft = useMutation({
    mutationFn: useServerFn(assistEngagement),
    onError: (err: Error) => toast.error(err.message),
  });
  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div>
        {recap.data ? (
          <RecapDocument recap={recap.data} />
        ) : (
          <p className="text-[12.5px] text-muted-foreground">Loading…</p>
        )}
      </div>
      <div className="space-y-4 lg:sticky lg:top-4">
        <Card title="Show it to the customer">
          <p className="text-[12.5px] text-muted-foreground">
            The customer view is a separate page with none of the presenter's notes. Hypotheses, fit
            scoring and internal notes are never sent to it.
          </p>
          <Button asChild className="mt-3 w-full">
            <Link to="/recap/$engagementId" params={{ engagementId: e.id }} target="_blank">
              <Presentation className="size-4" /> Open customer view
            </Link>
          </Button>
        </Card>
        <Card title="Follow-up email">
          {status.data && !status.data.configured ? (
            <p className="text-[12.5px] text-muted-foreground">
              Connect a Microsoft Foundry model to draft it.
            </p>
          ) : (
            <>
              <Button
                variant="outline"
                className="w-full"
                disabled={draft.isPending}
                onClick={() => draft.mutate({ data: { id: e.id, mode: "recap", notes: "" } })}
              >
                <Sparkles className="size-4" />{" "}
                {draft.isPending ? "Drafting…" : "Draft with Foundry"}
              </Button>
              {draft.data?.recap && (
                <>
                  <Textarea
                    className="mt-3 text-[12.5px]"
                    rows={14}
                    aria-label="Draft follow-up"
                    defaultValue={draft.data.recap}
                  />
                  <p className="mt-1.5 text-[11px] text-muted-foreground">
                    Drafted from confirmed findings, open questions and agreed actions only. Edit
                    before sending.
                  </p>
                </>
              )}
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------------------- handoff */

function HandOffCard({ e }: { e: Engagement }) {
  const queryClient = useQueryClient();
  const [to, setTo] = useState(e.brief.team?.csa ?? "");
  const [note, setNote] = useState("");
  const hand = useMutation({
    mutationFn: useServerFn(handOff),
    onSuccess: async () => {
      toast.success(`Handed off to ${to}. Recorded in the audit log.`);
      await queryClient.invalidateQueries({ queryKey: ["engagement", e.id] });
      void queryClient.invalidateQueries({ queryKey: ["engagements"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });
  const h = e.brief.handoff;
  const open = e.findings.filter((f) => f.kind === "hypothesis" || f.kind === "unknown").length;
  return (
    <Card
      title={h ? `Handed off to ${h.to}` : "Hand it to the CSA"}
      sub={
        h
          ? `By ${h.by} on ${new Date(h.at).toLocaleDateString()}. They take it to production; you stay on the account.`
          : "When the proof is agreed, the CSA takes it to production. They inherit everything on this page."
      }
    >
      {h ? (
        h.note && <p className="text-[12.5px] text-muted-foreground italic">“{h.note}”</p>
      ) : (
        <div className="grid gap-2 md:grid-cols-[220px_1fr_auto]">
          <Input
            className="h-9"
            aria-label="CSA"
            placeholder="CSA name"
            value={to}
            onChange={(ev) => setTo(ev.target.value)}
          />
          <Input
            className="h-9"
            aria-label="Handoff note"
            placeholder="Anything they must know first"
            value={note}
            onChange={(ev) => setNote(ev.target.value)}
          />
          <Button
            disabled={to.trim().length < 2 || hand.isPending}
            onClick={() => hand.mutate({ data: { id: e.id, to, note } })}
          >
            Hand off
          </Button>
        </div>
      )}
      {!h && open > 0 && (
        <p className="mt-2 text-[12px] text-muted-foreground">
          {open} {open === 1 ? "hypothesis or unknown is" : "hypotheses and unknowns are"} still
          open. They go with it; nothing is lost.
        </p>
      )}
    </Card>
  );
}

function handoffText(e: Engagement, products: CatalogProduct[]) {
  const b = e.brief;
  const name = (id: string) => products.find((p) => p.id === id)?.name ?? id;
  const list = (items: string[]) => (items.length ? items.map((i) => `- ${i}`) : ["- None"]);
  const by = (k: string) => e.findings.filter((f) => f.kind === k);
  return [
    `INTERNAL HANDOFF — NOT FOR THE CUSTOMER`,
    `${e.customer_name ?? "Prospect"}: ${e.name}`,
    "",
    `Outcome: ${b.outcome ?? "not captured"}`,
    `Workflow: ${b.workflow ?? "not captured"}`,
    `Owner: ${b.owner ?? "not named"}`,
    `Team: SE ${b.team?.se ?? "—"}, CSA ${b.team?.csa ?? "—"}, SSP ${b.team?.ssp ?? "—"}`,
    `Why now: ${b.whyNow ?? "not captured"}`,
    "",
    "Chosen for the proof:",
    ...list([...new Set(e.solution_map.flatMap((m) => m.products))].map(name)),
    "",
    "Confirmed:",
    ...list(by("confirmed").map((f) => f.text + (f.quote ? ` ("${f.quote}")` : ""))),
    "",
    "Open hypotheses:",
    ...list(by("hypothesis").map((f) => `${f.text}${f.source === "ai" ? " [AI suggestion]" : ""}`)),
    "",
    "Still unknown:",
    ...list(by("unknown").map((f) => f.text)),
    "",
    "Ruled out:",
    ...list(by("ruled-out").map((f) => f.text)),
    "",
    "Actions:",
    ...list(e.actions.map((a) => `${a.text} (${a.owner || "no owner"}, ${a.due || "no date"})`)),
    "",
    `Internal notes: ${b.internal ?? ""}`,
  ].join("\n");
}

export function HandoffView({
  e,
  products,
  apply,
}: {
  e: Engagement;
  products: CatalogProduct[];
  apply: Apply;
}) {
  const [internal, setInternal] = useState(e.brief.internal ?? "");
  const readiness = readinessOf(e);
  const deps = CONCEPTS.filter((c) =>
    ["blocker", "partial"].includes(readiness[c.key]?.status ?? ""),
  );
  const chosen = [...new Set(e.solution_map.flatMap((m) => m.products))];
  const fit = fitOf(e);
  const sessions = e.sessions.length
    ? e.sessions
    : [{ id: "s1", title: "Conversation", at: e.created_at, attendees: "" }];
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning/[0.07] px-4 py-2.5 text-[12.5px]">
        <span className="inline-flex items-center gap-2 font-medium">
          <Lock className="size-3.5" /> Internal. For the CSA and delivery team; never shown to the
          customer.
        </span>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            void navigator.clipboard
              .writeText(handoffText(e, products))
              .then(() => toast.success("Handoff copied."))
          }
        >
          <ClipboardCopy className="size-3.5" /> Copy handoff
        </Button>
      </div>

      <HandOffCard e={e} />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <Card title="Why this direction" sub="What the customer said that led here.">
            {chosen.length ? (
              <ul className="space-y-4">
                {chosen.map((id) => {
                  const f = fit.find((x) => x.id === id);
                  return (
                    <li key={id}>
                      <p className="text-[14px] font-semibold">
                        {products.find((p) => p.id === id)?.name ?? id}
                      </p>
                      <ul className="mt-1.5 space-y-1 text-[12.5px] text-muted-foreground">
                        {(f?.because ?? ["Chosen by the presenter."]).map((b) => (
                          <li key={b}>Because they said: {b}</li>
                        ))}
                        {f?.caveat && <li className="text-foreground/80">Watch: {f.caveat}</li>}
                      </ul>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-[12.5px] text-muted-foreground">
                Nothing chosen for the proof yet (Fit &amp; gap).
              </p>
            )}
          </Card>

          <Card
            title="How we got here"
            sub="Every question asked, what they said, and what it indicated."
          >
            <ol className="space-y-5">
              {sessions.map((s) => {
                const turns = e.trail.filter((t) => t.session === s.id);
                if (!turns.length) return null;
                return (
                  <li key={s.id}>
                    <p className="text-[12px] font-semibold">
                      {s.title}{" "}
                      <span className="font-normal text-muted-foreground">
                        · {new Date(s.at).toLocaleDateString()}
                        {s.attendees ? ` · ${s.attendees}` : ""}
                      </span>
                    </p>
                    <ul className="mt-2 space-y-2 border-l-2 border-border pl-4">
                      {turns.map((t) => {
                        const card = CARD_BY_ID.get(t.card);
                        const shown = t.card.startsWith("show:")
                          ? products.find((p) => p.id.endsWith(t.card.slice(5).padStart(11, "0")))
                          : undefined;
                        const answers = card
                          ? card.answers.filter((a) => t.answers.includes(a.id))
                          : [];
                        return (
                          <li key={t.card} className="text-[12.5px]">
                            <p className="font-medium">
                              {t.parked && <Pill tone="warning">Parked</Pill>}{" "}
                              {card?.question ?? (shown ? `Showed ${shown.name}` : t.card)}
                            </p>
                            {answers.map((a) => (
                              <p key={a.id} className="text-muted-foreground">
                                → {a.label}. <span className="text-foreground/70">{a.means}</span>
                              </p>
                            ))}
                            {t.note && <p className="text-muted-foreground italic">“{t.note}”</p>}
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                );
              })}
            </ol>
          </Card>
        </div>

        <div className="space-y-5">
          <Card title="Open for the CSA">
            {(["hypothesis", "unknown", "ruled-out"] as const).map((k) => {
              const items = e.findings.filter((f) => f.kind === k);
              return (
                <div key={k} className="mb-3 last:mb-0">
                  <p className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                    {k === "hypothesis" ? "Hypotheses" : KIND_LABEL[k]} · {items.length}
                  </p>
                  <ul className="mt-1 space-y-1 text-[12.5px]">
                    {items.map((f) => (
                      <li
                        key={f.id}
                        className={cn(k === "ruled-out" && "text-muted-foreground line-through")}
                      >
                        {f.text}
                        {f.source === "ai" && (
                          <span className="ml-1 text-[10.5px] text-[oklch(0.5_0.15_300)]">
                            AI suggestion
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </Card>
          <Card title="Dependencies">
            {deps.length ? (
              <ul className="space-y-2">
                {deps.map((c) => (
                  <li key={c.key} className="text-[12.5px]">
                    <span className="flex items-center justify-between gap-2 font-medium">
                      {c.title}
                      <Pill tone={TONE[readiness[c.key]!.status]}>
                        {READINESS[readiness[c.key]!.status].label}
                      </Pill>
                    </span>
                    <span className="text-muted-foreground">{readiness[c.key]!.note}</span>
                    {c.platform && (
                      <Link
                        to={c.platform.to}
                        className="mt-0.5 flex items-center gap-1 text-[11.5px] text-primary hover:underline"
                      >
                        <ExternalLink className="size-3" /> {c.platform.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[12.5px] text-muted-foreground">None identified yet.</p>
            )}
          </Card>
          <Card
            title="Internal notes"
            sub="Account context, politics, commercial notes. Never in the recap."
          >
            <Textarea
              rows={5}
              aria-label="Internal notes"
              value={internal}
              onChange={(ev) => setInternal(ev.target.value)}
            />
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              disabled={internal === (e.brief.internal ?? "")}
              onClick={() => apply({ brief: { ...e.brief, internal } }, "Saved.")}
            >
              Save notes
            </Button>
          </Card>
          {e.customer_id && (
            <Link
              to="/customers/$customerId"
              params={{ customerId: e.customer_id }}
              className="flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground"
            >
              <Building2 className="size-3.5" /> {e.customer_name} in Cloud Delivery
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
