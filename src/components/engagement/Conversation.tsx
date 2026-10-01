/*
 * The live conversation: where the presenter is (map), one question at a time with what each answer would indicate
 * (centre), and the shared understanding so far, labelled by how sure we are (working summary). Suggestions are
 * rules with a stated reason; the Foundry assist is optional and never applies anything on its own.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowRight,
  CalendarPlus,
  Check,
  CircleHelp,
  ExternalLink,
  Eye,
  Lightbulb,
  ListChecks,
  Lock,
  MessageSquareQuote,
  Pause,
  Plus,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
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
  type Card as QCard,
  CARDS,
  CARD_BY_ID,
  KIND_LABEL,
  PATHS,
  type PathKey,
  SOURCE_LABEL,
  advance,
  counts,
  fitOf,
  newId,
  productId,
  proposedActions,
  recordAnswer,
  suggest,
} from "@/lib/conversation";
import {
  CONCEPT_BY_KEY,
  type Engagement,
  type Finding,
  type FindingKind,
  STAGES,
  type Stage,
  type Turn,
  stageIndex,
} from "@/lib/engagements";
import { assistEngagement } from "@/lib/engagements.functions";
import { assistStatusQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

import type { CatalogProduct } from "./Prove";

export type ConvStage = Extract<
  Stage,
  "understand" | "explore" | "illustrate" | "validate" | "agree"
>;
export type Focus = { stage?: ConvStage; card?: string };
export type Apply = (patch: Partial<Engagement>, message?: string) => void;

const CONV: ConvStage[] = ["understand", "explore", "illustrate", "validate", "agree"];
const STAGE_TITLE = Object.fromEntries(STAGES.map((s) => [s.key, s.title])) as Record<
  ConvStage,
  string
>;

const currentSession = (e: Engagement) => e.sessions.at(-1);

export function Conversation({
  e,
  apply,
  products,
  focus,
  setFocus,
  onTab,
}: {
  e: Engagement;
  apply: Apply;
  products: CatalogProduct[];
  focus: Focus;
  setFocus: (f: Focus) => void;
  onTab: (tab: "prove") => void;
}) {
  const suggestions = useMemo(() => suggest(e), [e]);
  const pname = (n: number) => products.find((p) => p.id === productId(n))?.name;
  const opened = !!e.brief.signals?.length || e.trail.length > 0;
  const stage: ConvStage =
    focus.stage ??
    (CONV.includes(e.stage as ConvStage)
      ? (e.stage as ConvStage)
      : e.trail.length
        ? "agree"
        : "understand");

  const session = () => {
    const s = currentSession(e);
    if (s) return { id: s.id, sessions: e.sessions };
    const first = {
      id: "s1",
      title: "First conversation",
      at: new Date().toISOString(),
      attendees: "",
    };
    return { id: first.id, sessions: [first] };
  };

  const record = (card: QCard, answers: string[], note: string, parked = false) => {
    const s = session();
    const next = recordAnswer(e, { card: card.id, answers, note, session: s.id, parked });
    const added = next.findings.length - e.findings.length;
    apply(
      { ...next, sessions: s.sessions, ...advance(e, card.stage) },
      parked
        ? "Parked. It's in the map when you want to come back to it."
        : added > 0
          ? `Recorded. ${added} new ${added === 1 ? "finding" : "findings"} in the summary.`
          : "Recorded.",
    );
    setFocus({ stage: card.stage === "understand" ? "explore" : card.stage });
  };

  if (!opened) return <Opening e={e} apply={apply} />;

  const turnOf = (id: string) => e.trail.find((t) => t.card === id);
  const pick =
    (focus.card && CARD_BY_ID.get(focus.card)) ||
    suggestions.find((s) => s.card.stage === stage)?.card;
  const because = pick && suggestions.find((s) => s.card.id === pick.id)?.because;

  let center: ReactNode;
  if (stage === "illustrate")
    center = <Illustrate e={e} apply={apply} products={products} session={session} />;
  else if (stage === "validate")
    center = (
      <Validate
        e={e}
        apply={apply}
        record={record}
        focusCard={focus.card}
        turnOf={turnOf}
        setFocus={setFocus}
      />
    );
  else if (stage === "agree")
    center = <Agree e={e} apply={apply} pname={pname} onProve={() => onTab("prove")} />;
  else
    center = (
      <div className="space-y-4">
        {pick ? (
          <QuestionCard
            key={pick.id}
            card={pick}
            because={because}
            turn={turnOf(pick.id)}
            pname={pname}
            onRecord={(a, n) => record(pick, a, n)}
            onPark={(n) => record(pick, [], n, true)}
            onShow={() => setFocus({ stage: "illustrate" })}
          />
        ) : (
          <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center">
            <p className="text-[14px] font-semibold">Nothing obvious left to ask here.</p>
            <p className="mt-1 text-[12.5px] text-muted-foreground">
              Show an example, or test the hypotheses with the customer.
            </p>
            <div className="mt-4 flex justify-center gap-2">
              <Button variant="outline" onClick={() => setFocus({ stage: "illustrate" })}>
                Illustrate
              </Button>
              <Button onClick={() => setFocus({ stage: "validate" })}>
                Validate <ArrowRight className="size-4" />
              </Button>
            </div>
          </div>
        )}
        <Alternatives
          items={suggestions.filter((s) => s.card.id !== pick?.id).slice(0, 3)}
          onPick={(id) => setFocus({ stage: CARD_BY_ID.get(id)!.stage, card: id })}
        />
        <AllQuestions
          e={e}
          stage={stage === "understand" ? "understand" : "explore"}
          current={pick?.id}
          onPick={(id) => setFocus({ stage: CARD_BY_ID.get(id)!.stage, card: id })}
        />
      </div>
    );

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[220px_minmax(0,1fr)_320px] xl:grid-cols-[236px_minmax(0,1fr)_352px]">
      <ConversationMap e={e} apply={apply} stage={stage} setFocus={setFocus} />
      <div className="min-w-0">
        <OpenedWith e={e} />
        {center}
      </div>
      <div className="space-y-4 lg:sticky lg:top-4">
        <WorkingSummary e={e} apply={apply} />
        <Assist
          e={e}
          apply={apply}
          onPick={(id) => setFocus({ stage: CARD_BY_ID.get(id)!.stage, card: id })}
        />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------------------- opening */

function Opening({ e, apply }: { e: Engagement; apply: Apply }) {
  const [signals, setSignals] = useState<PathKey[]>([]);
  const [words, setWords] = useState(e.brief.words ?? "");
  const toggle = (k: PathKey) =>
    setSignals((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));
  return (
    <div className="mx-auto max-w-3xl rounded-2xl border border-border bg-card p-8 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <p className="text-[11px] font-semibold tracking-[0.14em] text-primary uppercase">
        Start here
      </p>
      <h2 className="mt-2 text-[22px] leading-snug font-bold tracking-tight">
        What is the customer trying to accomplish, and what is getting in the way?
      </h2>
      <p className="mt-2 text-[13px] text-muted-foreground">
        Pick what sounds closest to what they said. More than one is fine. Their own words matter
        more than the label.
      </p>
      <div className="mt-5 grid gap-2">
        {PATHS.map((p) => {
          const on = signals.includes(p.key);
          return (
            <button
              key={p.key}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(p.key)}
              className={cn(
                "flex items-center gap-3 rounded-lg border px-4 py-3 text-left text-[14px] transition-colors",
                on
                  ? "border-primary bg-primary/[0.06] ring-1 ring-primary/30"
                  : "border-border hover:bg-muted/50",
              )}
            >
              <span
                className={cn(
                  "grid size-5 shrink-0 place-items-center rounded border",
                  on ? "border-primary bg-primary text-primary-foreground" : "border-border",
                )}
              >
                {on && <Check className="size-3.5" />}
              </span>
              <span>“{p.says}”</span>
            </button>
          );
        })}
      </div>
      <label className="mt-5 block">
        <span className="text-[12.5px] font-medium">In their words</span>
        <Textarea
          className="mt-1.5"
          rows={3}
          placeholder="What did they actually say?"
          value={words}
          onChange={(ev) => setWords(ev.target.value)}
        />
      </label>
      <div className="mt-5 flex justify-end">
        <Button
          disabled={!signals.length}
          onClick={() =>
            apply(
              { brief: { ...e.brief, signals, words: words.trim() } },
              "Got it. Start with the outcome.",
            )
          }
        >
          Start the conversation <ArrowRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}

function OpenedWith({ e }: { e: Engagement }) {
  const paths = PATHS.filter((p) => e.brief.signals?.includes(p.key));
  if (!paths.length && !e.brief.words) return null;
  return (
    <div className="mb-4 flex items-start gap-2.5 rounded-lg bg-muted/50 px-3.5 py-2.5 text-[12.5px]">
      <MessageSquareQuote className="mt-0.5 size-4 shrink-0 text-primary" />
      <p className="min-w-0 text-muted-foreground">
        <span className="font-medium text-foreground">They opened with: </span>
        {e.brief.words ? `“${e.brief.words}”` : paths.map((p) => `“${p.says}”`).join(" ")}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------- map */

function ConversationMap({
  e,
  apply,
  stage,
  setFocus,
}: {
  e: Engagement;
  apply: Apply;
  stage: ConvStage;
  setFocus: (f: Focus) => void;
}) {
  const c = counts(e);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [attendees, setAttendees] = useState("");
  const s = currentSession(e);
  const reached = stageIndex(e.stage);
  const label: Record<ConvStage, string> = {
    understand: c.understand ? `${c.understand} captured` : "Not yet",
    explore: c.explore ? `${c.explore} asked` : "Not yet",
    illustrate: c.illustrate ? `${c.illustrate} shown` : "Nothing shown",
    validate: c.validate ? `${c.validate} to test` : "Nothing to test",
    agree: c.agree ? `${e.actions.filter((a) => !a.done).length} open actions` : "No actions",
  };
  const asked = [...e.trail].filter((t) => !t.parked && CARD_BY_ID.has(t.card)).reverse();
  return (
    <nav aria-label="Conversation map" className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-3">
        <p className="text-[10.5px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
          Meeting {e.sessions.length || 1}
        </p>
        <p className="mt-0.5 text-[13px] leading-snug font-semibold">
          {s?.title ?? "First conversation"}
        </p>
        {s && (
          <p className="mt-0.5 text-[11.5px] text-muted-foreground">
            {new Date(s.at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
            {s.attendees ? ` · ${s.attendees}` : ""}
          </p>
        )}
        {adding ? (
          <div className="mt-2.5 space-y-1.5">
            <Input
              className="h-8 text-[12.5px]"
              placeholder="e.g. Architecture design session"
              aria-label="Meeting title"
              value={title}
              onChange={(ev) => setTitle(ev.target.value)}
            />
            <Input
              className="h-8 text-[12.5px]"
              placeholder="Who's in the room"
              aria-label="Attendees"
              value={attendees}
              onChange={(ev) => setAttendees(ev.target.value)}
            />
            <div className="flex gap-1.5">
              <Button
                size="sm"
                className="h-7"
                disabled={!title.trim()}
                onClick={() => {
                  apply(
                    {
                      sessions: [
                        ...e.sessions,
                        {
                          id: `s${e.sessions.length + 1}-${newId().slice(0, 6)}`,
                          title: title.trim(),
                          at: new Date().toISOString(),
                          attendees: attendees.trim(),
                        },
                      ],
                    },
                    "New meeting started. Everything so far carries over.",
                  );
                  setAdding(false);
                  setTitle("");
                  setAttendees("");
                }}
              >
                Start
              </Button>
              <Button size="sm" variant="ghost" className="h-7" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="mt-2 inline-flex items-center gap-1 text-[11.5px] font-medium text-primary hover:underline"
          >
            <CalendarPlus className="size-3.5" /> New meeting
          </button>
        )}
      </div>

      <ol className="space-y-1">
        {CONV.map((k, i) => {
          const active = k === stage;
          const done = i < reached;
          return (
            <li key={k}>
              <button
                onClick={() => setFocus({ stage: k })}
                aria-current={active ? "step" : undefined}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors",
                  active ? "bg-primary/[0.08] ring-1 ring-primary/25" : "hover:bg-muted/60",
                )}
              >
                <span
                  className={cn(
                    "grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold",
                    active
                      ? "bg-primary text-primary-foreground"
                      : done
                        ? "bg-success/15 text-success"
                        : "bg-muted text-muted-foreground",
                  )}
                >
                  {done && !active ? <Check className="size-3.5" /> : i + 1}
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold">{STAGE_TITLE[k]}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {label[k]}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {e.trail.some((t) => t.parked) && (
        <div>
          <p className="px-1 text-[10.5px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
            Parked
          </p>
          <ul className="mt-1.5 space-y-1">
            {e.trail
              .filter((t) => t.parked)
              .map((t) => (
                <li key={t.card}>
                  <button
                    onClick={() => setFocus({ stage: CARD_BY_ID.get(t.card)!.stage, card: t.card })}
                    className="w-full rounded-md px-2 py-1.5 text-left text-[12px] leading-snug hover:bg-muted/60"
                  >
                    <Pause className="mr-1 inline size-3 text-warning" />
                    {CARD_BY_ID.get(t.card)?.question}
                    {t.note && (
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">
                        {t.note}
                      </span>
                    )}
                  </button>
                </li>
              ))}
          </ul>
        </div>
      )}

      {asked.length > 0 && (
        <div>
          <p className="px-1 text-[10.5px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
            Asked so far
          </p>
          <ul className="mt-1.5 max-h-80 space-y-0.5 overflow-y-auto">
            {asked.map((t) => (
              <li key={t.card}>
                <button
                  onClick={() => setFocus({ stage: CARD_BY_ID.get(t.card)!.stage, card: t.card })}
                  className="flex w-full gap-1.5 rounded-md px-2 py-1 text-left text-[12px] leading-snug text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                >
                  <Check className="mt-0.5 size-3 shrink-0 text-success" />
                  {CARD_BY_ID.get(t.card)?.question}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </nav>
  );
}

/* -------------------------------------------------------------------------------------- question */

const KIND_TONE: Record<FindingKind, "success" | "warning" | "neutral" | "info"> = {
  confirmed: "success",
  hypothesis: "warning",
  unknown: "info",
  "ruled-out": "neutral",
};

const PLACEHOLDER: Partial<Record<NonNullable<QCard["capture"]>, string>> = {
  outcome: "What would be different, for whom, by when, in their words",
  workflow: "The work, and who does it today",
  owner: "Name and role",
  baseline: "What they measure, e.g. days to assemble a work package",
};

function QuestionCard({
  card,
  because,
  turn,
  pname,
  onRecord,
  onPark,
  onShow,
}: {
  card: QCard;
  because?: string | undefined;
  turn?: Turn | undefined;
  pname: (n: number) => string | undefined;
  onRecord: (answers: string[], note: string) => void;
  onPark: (note: string) => void;
  onShow?: () => void;
}) {
  const [sel, setSel] = useState<string[]>(turn?.answers ?? []);
  const [note, setNote] = useState(turn?.note ?? "");
  const toggle = (id: string) =>
    setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : card.multi ? [...s, id] : [id]));
  const chosen = card.answers.filter((a) => sel.includes(a.id));
  const examples = [...new Set(chosen.flatMap((a) => a.accelerators ?? []))];
  const concept = card.concept && CONCEPT_BY_KEY.get(card.concept);
  const answered = turn && !turn.parked;
  return (
    <article
      aria-label="Current question"
      className="rounded-2xl border border-border bg-card shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
    >
      <div className="border-b border-border px-6 pt-5 pb-4">
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className="font-semibold tracking-[0.12em] text-primary uppercase">
            {STAGE_TITLE[card.stage]}
          </span>
          {concept && <Pill>{concept.title}</Pill>}
          {answered && <Pill tone="success">Asked</Pill>}
          {turn?.parked && <Pill tone="warning">Parked</Pill>}
        </div>
        <h2 className="mt-2.5 text-[21px] leading-snug font-semibold tracking-tight">
          {card.question}
        </h2>
        {because && (
          <p className="mt-2 inline-flex items-start gap-1.5 text-[12.5px] text-primary">
            <Lightbulb className="mt-0.5 size-3.5 shrink-0" />
            <span>Suggested. {because}</span>
          </p>
        )}
        <p className="mt-2 flex items-start gap-1.5 text-[12.5px] text-muted-foreground">
          <Lock className="mt-0.5 size-3 shrink-0" />
          <span>
            <span className="font-medium text-foreground/80">Why ask: </span>
            {card.why}
          </span>
        </p>
      </div>

      <div className="space-y-4 px-6 py-5">
        {card.answers.length > 0 && (
          <div>
            <p className="text-[12px] font-medium text-muted-foreground">
              What did they say? {card.multi ? "Pick all that apply." : ""}
            </p>
            <ul className="mt-2 space-y-1.5">
              {card.answers.map((a) => {
                const on = sel.includes(a.id);
                return (
                  <li key={a.id}>
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggle(a.id)}
                      className={cn(
                        "w-full rounded-lg border px-3.5 py-2.5 text-left transition-colors",
                        on
                          ? "border-primary/50 bg-primary/[0.05] ring-1 ring-primary/25"
                          : "border-border hover:bg-muted/50",
                      )}
                    >
                      <span className="flex items-center gap-2.5 text-[13.5px] font-medium">
                        <span
                          className={cn(
                            "grid size-4 shrink-0 place-items-center border",
                            card.multi ? "rounded" : "rounded-full",
                            on
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border",
                          )}
                        >
                          {on && <Check className="size-3" />}
                        </span>
                        {a.label}
                      </span>
                      {on && (
                        <span className="mt-2 block space-y-1.5 pl-6.5 text-[12px] text-muted-foreground">
                          <span className="block">{a.means}</span>
                          {a.finding && (
                            <span className="flex flex-wrap items-center gap-1.5">
                              <Pill tone={KIND_TONE[a.finding.kind]}>
                                {KIND_LABEL[a.finding.kind]}
                              </Pill>
                              <span className="text-foreground/80">{a.finding.text}</span>
                            </span>
                          )}
                          {!!a.next?.length && (
                            <span className="block">
                              Opens:{" "}
                              {a.next
                                .map((n) => CARD_BY_ID.get(n)?.question)
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                          )}
                          {!!a.accelerators?.length && (
                            <span className="block">
                              Example to show:{" "}
                              {a.accelerators.map((n) => pname(n) ?? `#${n}`).join(", ")}
                            </span>
                          )}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        <label className="block">
          <span className="text-[12px] font-medium text-muted-foreground">
            In their words{card.capture ? "" : " (optional)"}
          </span>
          <Textarea
            className="mt-1.5"
            rows={card.answers.length ? 2 : 3}
            aria-label="Customer's words"
            placeholder={
              (card.capture && PLACEHOLDER[card.capture]) ?? "Quote them, don't paraphrase"
            }
            value={note}
            onChange={(ev) => setNote(ev.target.value)}
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border px-6 py-3.5">
        <Button disabled={!sel.length && !note.trim()} onClick={() => onRecord(sel, note)}>
          <Check className="size-4" /> {answered ? "Update answer" : "Record answer"}
        </Button>
        {examples.length > 0 && onShow && (
          <Button variant="outline" onClick={onShow}>
            <Eye className="size-4" /> Show an example
          </Button>
        )}
        <Button variant="ghost" className="ml-auto" onClick={() => onPark(note)}>
          <Pause className="size-4" /> Park this
        </Button>
      </div>
    </article>
  );
}

function Alternatives({
  items,
  onPick,
}: {
  items: { card: QCard; because: string }[];
  onPick: (id: string) => void;
}) {
  if (!items.length) return null;
  return (
    <section aria-label="Other directions">
      <p className="px-1 text-[10.5px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
        Or go here next
      </p>
      <ul className="mt-2 grid gap-2 md:grid-cols-3">
        {items.map((s) => (
          <li key={s.card.id}>
            <button
              onClick={() => onPick(s.card.id)}
              className="h-full w-full rounded-lg border border-border bg-card p-3 text-left transition-colors hover:border-primary/40 hover:bg-primary/[0.03]"
            >
              <span className="block text-[13px] leading-snug font-medium">{s.card.question}</span>
              <span className="mt-1.5 block text-[11.5px] leading-snug text-muted-foreground">
                {s.because}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function AllQuestions({
  e,
  stage,
  current,
  onPick,
}: {
  e: Engagement;
  stage: "understand" | "explore";
  current: string | undefined;
  onPick: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const asked = new Set(e.trail.filter((t) => !t.parked).map((t) => t.card));
  const list = CARDS.filter((c) => c.stage === stage);
  return (
    <section>
      <button
        onClick={() => setOpen((o) => !o)}
        className="px-1 text-[12px] font-medium text-muted-foreground hover:text-foreground"
      >
        {open ? "Hide" : "Ask something else"}: all {list.length} {STAGE_TITLE[stage].toLowerCase()}{" "}
        questions
      </button>
      {open && (
        <ul className="mt-2 divide-y divide-border rounded-lg border border-border bg-card">
          {list.map((c) => (
            <li key={c.id}>
              <button
                onClick={() => onPick(c.id)}
                className={cn(
                  "flex w-full items-start gap-2 px-3.5 py-2 text-left text-[12.5px] hover:bg-muted/50",
                  c.id === current && "bg-primary/[0.05]",
                )}
              >
                {asked.has(c.id) ? (
                  <Check className="mt-0.5 size-3.5 shrink-0 text-success" />
                ) : (
                  <CircleHelp className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0 flex-1">{c.question}</span>
                {c.concept && (
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {CONCEPT_BY_KEY.get(c.concept)?.title}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------------------------ illustrate */

function Illustrate({
  e,
  apply,
  products,
  session,
}: {
  e: Engagement;
  apply: Apply;
  products: CatalogProduct[];
  session: () => { id: string; sessions: Engagement["sessions"] };
}) {
  const fit = fitOf(e).slice(0, 4);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const shown = (n: number) => e.trail.find((t) => t.card === `show:${n}`);
  if (!fit.length)
    return (
      <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center">
        <p className="text-[14px] font-semibold">Nothing to show yet.</p>
        <p className="mt-1 text-[12.5px] text-muted-foreground">
          Examples are chosen from what the customer said. Explore first.
        </p>
      </div>
    );
  return (
    <div className="space-y-3">
      <p className="px-1 text-[12.5px] text-muted-foreground">
        One example at a time. Show it, then ask what they'd change. Their reaction is the finding.
      </p>
      {fit.map((f) => {
        const p = products.find((x) => x.id === f.id);
        const s = shown(f.n);
        return (
          <article key={f.n} className="rounded-xl border border-border bg-card p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-[15px] font-semibold">{p?.name ?? `Accelerator ${f.n}`}</h3>
                {p?.outcome && (
                  <p className="mt-0.5 text-[12.5px] text-muted-foreground">{p.outcome}</p>
                )}
              </div>
              {s ? (
                <Pill tone="success">
                  <Check className="size-3" /> Shown
                </Pill>
              ) : (
                <Pill>
                  {f.score} {f.score === 1 ? "answer points" : "answers point"} here
                </Pill>
              )}
            </div>
            <p className="mt-3 text-[12.5px]">
              <span className="font-medium">Why this example: </span>
              <span className="text-muted-foreground">{f.because[0]}</span>
            </p>
            {f.agent && (
              <p className="mt-1 text-[12.5px]">
                <span className="font-medium">Where the agent comes in: </span>
                <span className="text-muted-foreground">{f.agent}</span>
              </p>
            )}
            {s?.note && (
              <p className="mt-2 rounded-md bg-muted/50 px-3 py-2 text-[12.5px] text-muted-foreground">
                Their reaction: {s.note}
              </p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button asChild variant="outline" size="sm">
                <Link to="/products/$productId" params={{ productId: f.id }} target="_blank">
                  <ExternalLink className="size-3.5" /> Open the solution
                </Link>
              </Button>
              {!s && (
                <>
                  <Input
                    className="h-8 min-w-0 flex-1 text-[12.5px]"
                    placeholder="Their reaction, in their words"
                    aria-label={`Reaction to ${p?.name ?? f.n}`}
                    value={notes[f.n] ?? ""}
                    onChange={(ev) => setNotes((x) => ({ ...x, [f.n]: ev.target.value }))}
                  />
                  <Button
                    size="sm"
                    onClick={() => {
                      const ss = session();
                      apply(
                        {
                          sessions: ss.sessions,
                          trail: [
                            ...e.trail,
                            {
                              card: `show:${f.n}`,
                              answers: [],
                              note: (notes[f.n] ?? "").trim(),
                              session: ss.id,
                              at: new Date().toISOString(),
                            },
                          ],
                          ...advance(e, "illustrate"),
                        },
                        "Recorded as shown.",
                      );
                    }}
                  >
                    <Eye className="size-3.5" /> Mark as shown
                  </Button>
                </>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------------------- validate */

function Validate({
  e,
  apply,
  record,
  focusCard,
  turnOf,
  setFocus,
}: {
  e: Engagement;
  apply: Apply;
  record: (card: QCard, answers: string[], note: string, parked?: boolean) => void;
  focusCard: string | undefined;
  turnOf: (id: string) => Turn | undefined;
  setFocus: (f: Focus) => void;
}) {
  const [skipped, setSkipped] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const open = e.findings.filter((f) => f.kind === "hypothesis");
  const current = open.find((f) => !skipped.includes(f.id)) ?? open[0];
  const tested = e.findings.filter(
    (f) => f.edited && (f.kind === "confirmed" || f.kind === "ruled-out"),
  ).length;
  const resolve = (kind: FindingKind | "partly") => {
    if (!current) return;
    const quote = note.trim();
    const findings = e.findings.map((f) =>
      f.id === current.id
        ? {
            ...f,
            kind: kind === "partly" ? f.kind : kind,
            edited: true,
            ...(quote ? { quote } : {}),
          }
        : f,
    );
    apply(
      { findings, ...advance(e, "validate") },
      kind === "confirmed"
        ? "Confirmed by the customer."
        : kind === "ruled-out"
          ? "Ruled out. It stays in the handoff, so nobody re-tests it."
          : kind === "unknown"
            ? "Moved to still unknown."
            : "Kept as a hypothesis, with their words.",
    );
    if (kind === "partly") setSkipped((s) => [...s, current.id]);
    setNote("");
  };
  const closing = ["v-success", "v-constraints"].map((id) => CARD_BY_ID.get(id)!);
  const focused = focusCard && CARD_BY_ID.get(focusCard);
  return (
    <div className="space-y-4">
      {focused && focused.stage === "validate" && (
        <QuestionCard
          key={focused.id}
          card={focused}
          turn={turnOf(focused.id)}
          pname={() => undefined}
          onRecord={(a, n) => record(focused, a, n)}
          onPark={(n) => record(focused, [], n, true)}
        />
      )}
      <article
        aria-label="Hypothesis to test"
        className="rounded-2xl border border-border bg-card shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
      >
        <div className="border-b border-border px-6 pt-5 pb-4">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-semibold tracking-[0.12em] text-primary uppercase">Validate</span>
            <span className="text-muted-foreground">
              {open.length} to test · {tested} tested
            </span>
          </div>
          {current ? (
            <>
              <p className="mt-2.5 text-[12.5px] text-muted-foreground">We think:</p>
              <h2 className="mt-1 text-[21px] leading-snug font-semibold tracking-tight">
                {current.text}
              </h2>
              <p className="mt-2 flex items-start gap-1.5 text-[12.5px] text-muted-foreground">
                <Lock className="mt-0.5 size-3 shrink-0" />
                <span>
                  Ask it as a question, not a conclusion: “It sounds like{" "}
                  {current.text[0]!.toLowerCase() + current.text.slice(1).replace(/\.$/, "")}. Is
                  that right?” Source: {SOURCE_LABEL[current.source].toLowerCase()}
                  {current.card && CARD_BY_ID.get(current.card)
                    ? `, from “${CARD_BY_ID.get(current.card)!.question}”`
                    : ""}
                  .
                </span>
              </p>
            </>
          ) : (
            <h2 className="mt-2.5 text-[17px] font-semibold">
              Nothing left to test. Everything in the summary is confirmed, unknown or ruled out.
            </h2>
          )}
        </div>
        {current && (
          <div className="space-y-3 px-6 py-4">
            <Textarea
              rows={2}
              aria-label="Customer's words"
              placeholder="What they said, in their words"
              value={note}
              onChange={(ev) => setNote(ev.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => resolve("confirmed")}>
                <Check className="size-4" /> Yes, that's right
              </Button>
              <Button variant="outline" onClick={() => resolve("partly")}>
                Partly
              </Button>
              <Button variant="outline" onClick={() => resolve("ruled-out")}>
                <X className="size-4" /> No
              </Button>
              <Button variant="ghost" onClick={() => resolve("unknown")}>
                Not sure
              </Button>
            </div>
          </div>
        )}
      </article>
      <section>
        <p className="px-1 text-[10.5px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
          Before proposing a proof
        </p>
        <ul className="mt-2 grid gap-2 md:grid-cols-2">
          {closing.map((c) => {
            const t = turnOf(c.id);
            return (
              <li key={c.id}>
                <button
                  onClick={() => setFocus({ stage: "validate", card: c.id })}
                  className="h-full w-full rounded-lg border border-border bg-card p-3 text-left hover:border-primary/40"
                >
                  <span className="flex items-start gap-2 text-[13px] font-medium">
                    {t && !t.parked ? (
                      <Check className="mt-0.5 size-3.5 shrink-0 text-success" />
                    ) : (
                      <CircleHelp className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                    )}
                    {c.question}
                  </span>
                  {t?.note && (
                    <span className="mt-1 block pl-5.5 text-[11.5px] text-muted-foreground">
                      “{t.note}”
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

/* ----------------------------------------------------------------------------------------- agree */

function Agree({
  e,
  apply,
  pname,
  onProve,
}: {
  e: Engagement;
  apply: Apply;
  pname: (n: number) => string | undefined;
  onProve: () => void;
}) {
  const proposed = proposedActions(e, pname);
  const [text, setText] = useState("");
  const add = (t: string) =>
    apply(
      {
        actions: [...e.actions, { id: newId(), text: t, owner: "", due: "", done: false }],
        ...advance(e, "agree"),
      },
      "Added. Give it an owner and a date.",
    );
  const set = (id: string, patch: Partial<Engagement["actions"][number]>) =>
    apply({ actions: e.actions.map((a) => (a.id === id ? { ...a, ...patch } : a)) });
  const unowned = e.actions.filter((a) => !a.owner.trim() || !a.due).length;
  return (
    <div className="space-y-4">
      <article className="rounded-2xl border border-border bg-card shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        <div className="border-b border-border px-6 pt-5 pb-4">
          <p className="text-[11px] font-semibold tracking-[0.12em] text-primary uppercase">
            Agree
          </p>
          <h2 className="mt-2 text-[21px] leading-snug font-semibold tracking-tight">
            What will we each do next, and by when?
          </h2>
          <p className="mt-2 flex items-start gap-1.5 text-[12.5px] text-muted-foreground">
            <Lock className="mt-0.5 size-3 shrink-0" />
            Interest isn't a next step. Every action needs an owner on their side or ours, and a
            date.
          </p>
        </div>
        <div className="px-6 py-4">
          {e.actions.length ? (
            <ul className="divide-y divide-border">
              {e.actions.map((a) => (
                <li
                  key={a.id}
                  className="grid items-center gap-2 py-2.5 md:grid-cols-[auto_1fr_160px_150px_auto]"
                >
                  <input
                    type="checkbox"
                    aria-label={`Done: ${a.text}`}
                    className="size-4 accent-[var(--color-primary)]"
                    checked={a.done}
                    onChange={(ev) => set(a.id, { done: ev.target.checked })}
                  />
                  <span
                    className={cn("text-[13px]", a.done && "text-muted-foreground line-through")}
                  >
                    {a.text}
                  </span>
                  <Input
                    className="h-8 text-[12.5px]"
                    placeholder="Owner"
                    aria-label={`Owner: ${a.text}`}
                    defaultValue={a.owner}
                    onBlur={(ev) =>
                      ev.target.value !== a.owner && set(a.id, { owner: ev.target.value })
                    }
                  />
                  <Input
                    type="date"
                    className="h-8 text-[12.5px]"
                    aria-label={`Due: ${a.text}`}
                    defaultValue={a.due}
                    onChange={(ev) => set(a.id, { due: ev.target.value })}
                  />
                  <button
                    aria-label={`Remove: ${a.text}`}
                    onClick={() => apply({ actions: e.actions.filter((x) => x.id !== a.id) })}
                    className="text-muted-foreground hover:text-danger"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12.5px] text-muted-foreground">Nothing agreed yet.</p>
          )}
          <div className="mt-3 flex gap-2">
            <Input
              className="h-9"
              placeholder="Add a next step"
              aria-label="New action"
              value={text}
              onChange={(ev) => setText(ev.target.value)}
              onKeyDown={(ev) => {
                if (ev.key === "Enter" && text.trim()) {
                  add(text.trim());
                  setText("");
                }
              }}
            />
            <Button
              variant="outline"
              disabled={!text.trim()}
              onClick={() => {
                add(text.trim());
                setText("");
              }}
            >
              <Plus className="size-4" /> Add
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-6 py-3.5">
          <p className="text-[12px] text-muted-foreground">
            {unowned
              ? `${unowned} ${unowned === 1 ? "action needs" : "actions need"} an owner or a date.`
              : e.actions.length
                ? "Every action has an owner and a date."
                : "Agree at least one next step."}
          </p>
          <Button variant="outline" disabled={!e.actions.length} onClick={onProve}>
            On to the proof <ArrowRight className="size-4" />
          </Button>
        </div>
      </article>
      {proposed.length > 0 && (
        <section>
          <p className="px-1 text-[10.5px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
            The conversation points to
          </p>
          <ul className="mt-2 space-y-1.5">
            {proposed.map((p) => (
              <li
                key={p}
                className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3.5 py-2.5 text-[13px]"
              >
                <span>{p}</span>
                <Button size="sm" variant="outline" onClick={() => add(p)}>
                  <Plus className="size-3.5" /> Agree
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------------- working summary */

export function WorkingSummary({ e, apply }: { e: Engagement; apply: Apply }) {
  const [text, setText] = useState("");
  const [kind, setKind] = useState<FindingKind>("hypothesis");
  const set = (id: string, patch: Partial<Finding>, msg: string) =>
    apply(
      { findings: e.findings.map((f) => (f.id === id ? { ...f, ...patch, edited: true } : f)) },
      msg,
    );
  const group = (k: FindingKind) => e.findings.filter((f) => f.kind === k);
  const ruled = group("ruled-out");
  return (
    <section
      aria-label="Working summary"
      className="rounded-xl border border-border bg-card shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
    >
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-[13.5px] font-semibold">Working summary</h2>
        <span className="text-[11px] text-muted-foreground">Shared understanding so far</span>
      </header>
      <div className="max-h-[56vh] space-y-4 overflow-y-auto px-4 py-3">
        {(["confirmed", "hypothesis", "unknown"] as const).map((k) => (
          <div key={k}>
            <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.08em] uppercase">
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  k === "confirmed" ? "bg-success" : k === "hypothesis" ? "bg-warning" : "bg-info",
                )}
              />
              {k === "hypothesis" ? "Hypotheses" : KIND_LABEL[k]}
              <span className="font-normal text-muted-foreground">{group(k).length}</span>
            </p>
            {group(k).length ? (
              <ul className="mt-1.5 space-y-1.5">
                {group(k).map((f) => (
                  <li key={f.id} className="group text-[12.5px] leading-snug">
                    <div className="flex items-start gap-1.5">
                      <span className="min-w-0 flex-1">
                        {f.text}
                        {f.quote && (
                          <span className="mt-0.5 block text-[11.5px] text-muted-foreground italic">
                            “{f.quote}”
                          </span>
                        )}
                      </span>
                      <span className="flex shrink-0 items-center gap-0.5 opacity-60 group-hover:opacity-100">
                        {k !== "confirmed" && (
                          <button
                            aria-label={`Confirm: ${f.text}`}
                            title="The customer confirmed it"
                            onClick={() => set(f.id, { kind: "confirmed" }, "Confirmed.")}
                            className="rounded p-0.5 hover:bg-success/10 hover:text-success"
                          >
                            <Check className="size-3.5" />
                          </button>
                        )}
                        {k === "hypothesis" && (
                          <button
                            aria-label={`Rule out: ${f.text}`}
                            title="Ruled out"
                            onClick={() => set(f.id, { kind: "ruled-out" }, "Ruled out.")}
                            className="rounded p-0.5 hover:bg-muted"
                          >
                            <X className="size-3.5" />
                          </button>
                        )}
                        <button
                          aria-label={`Remove: ${f.text}`}
                          title="Remove"
                          onClick={() =>
                            apply({ findings: e.findings.filter((x) => x.id !== f.id) }, "Removed.")
                          }
                          className="rounded p-0.5 hover:bg-danger/10 hover:text-danger"
                        >
                          <Trash2 className="size-3" />
                        </button>
                      </span>
                    </div>
                    {f.source !== "customer" && (
                      <span
                        className={cn(
                          "mt-0.5 inline-block text-[10.5px]",
                          f.source === "ai"
                            ? "text-[oklch(0.5_0.15_300)]"
                            : "text-muted-foreground",
                        )}
                      >
                        {f.source === "ai" && <Sparkles className="mr-0.5 inline size-2.5" />}
                        {SOURCE_LABEL[f.source]}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-[12px] text-muted-foreground">None yet.</p>
            )}
          </div>
        ))}
        <div>
          <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.08em] uppercase">
            <ListChecks className="size-3" /> Agreed actions
            <span className="font-normal text-muted-foreground">{e.actions.length}</span>
          </p>
          {e.actions.length ? (
            <ul className="mt-1.5 space-y-1">
              {e.actions.map((a) => (
                <li key={a.id} className="text-[12.5px] leading-snug">
                  <span className={cn(a.done && "text-muted-foreground line-through")}>
                    {a.text}
                  </span>
                  <span className="block text-[11px] text-muted-foreground">
                    {a.owner || "No owner"} ·{" "}
                    {a.due ? new Date(a.due).toLocaleDateString() : "No date"}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-[12px] text-muted-foreground">None yet.</p>
          )}
        </div>
        {ruled.length > 0 && (
          <details>
            <summary className="cursor-pointer text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
              Ruled out {ruled.length}
            </summary>
            <ul className="mt-1.5 space-y-1 text-[12px] text-muted-foreground line-through">
              {ruled.map((f) => (
                <li key={f.id}>{f.text}</li>
              ))}
            </ul>
          </details>
        )}
      </div>
      <footer className="flex gap-1.5 border-t border-border p-3">
        <Select value={kind} onValueChange={(v) => setKind(v as FindingKind)}>
          <SelectTrigger className="h-8 w-[118px] text-[12px]" aria-label="Kind">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="confirmed">Confirmed</SelectItem>
            <SelectItem value="hypothesis">Hypothesis</SelectItem>
            <SelectItem value="unknown">Unknown</SelectItem>
          </SelectContent>
        </Select>
        <Input
          className="h-8 text-[12px]"
          placeholder="Add a finding"
          aria-label="New finding"
          value={text}
          onChange={(ev) => setText(ev.target.value)}
          onKeyDown={(ev) => {
            if (ev.key !== "Enter" || !text.trim()) return;
            apply(
              {
                findings: [
                  ...e.findings,
                  {
                    id: newId(),
                    text: text.trim(),
                    kind,
                    source: kind === "confirmed" ? "customer" : "presenter",
                    edited: true,
                    at: new Date().toISOString(),
                  },
                ],
              },
              "Added to the summary.",
            );
            setText("");
          }}
        />
      </footer>
    </section>
  );
}

/* ---------------------------------------------------------------------------------------- assist */

function Assist({
  e,
  apply,
  onPick,
}: {
  e: Engagement;
  apply: Apply;
  onPick: (id: string) => void;
}) {
  const status = useQuery(assistStatusQuery);
  const [notes, setNotes] = useState("");
  const run = useMutation({
    mutationFn: useServerFn(assistEngagement),
    onError: (err: Error) => toast.error(err.message),
  });
  const r = run.data;
  const adopted = new Set(e.findings.map((f) => f.text));
  return (
    <section
      aria-label="Foundry assist"
      className="rounded-xl border border-[oklch(0.85_0.06_300)] bg-[oklch(0.985_0.01_300)] p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-[13.5px] font-semibold">
          <Sparkles className="size-4 text-[oklch(0.5_0.15_300)]" /> Foundry assist
        </h2>
        <span className="text-[10.5px] text-muted-foreground">Optional · presenter only</span>
      </div>
      {status.data && !status.data.configured ? (
        <p className="mt-2 text-[12px] text-muted-foreground">
          Not connected. Set <code>AZURE_OPENAI_ENDPOINT</code> to a Microsoft Foundry model and
          give the app's identity the Cognitive Services OpenAI User role. Everything else works
          without it.
        </p>
      ) : (
        <>
          <Textarea
            className="mt-2.5 bg-card text-[12.5px]"
            rows={3}
            aria-label="What you're hearing"
            placeholder="What are you hearing? Type rough notes; they aren't saved."
            value={notes}
            onChange={(ev) => setNotes(ev.target.value)}
          />
          <Button
            size="sm"
            className="mt-2 w-full"
            variant="outline"
            disabled={run.isPending}
            onClick={() => run.mutate({ data: { id: e.id, mode: "next", notes } })}
          >
            <Sparkles className="size-3.5" />
            {run.isPending ? "Thinking…" : "Suggest what to ask next"}
          </Button>
          {r && (
            <div className="mt-3 space-y-3 text-[12.5px]">
              {r.listenFor && (
                <p className="rounded-md bg-card px-3 py-2">
                  <span className="font-medium">Listen for: </span>
                  {r.listenFor}
                </p>
              )}
              {r.suggestions.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                    Ask next
                  </p>
                  <ul className="mt-1 space-y-1">
                    {r.suggestions.map((s) => (
                      <li key={s.card}>
                        <button
                          onClick={() => onPick(s.card)}
                          className="w-full rounded-md bg-card px-3 py-2 text-left hover:ring-1 hover:ring-primary/30"
                        >
                          <span className="block font-medium">
                            {CARD_BY_ID.get(s.card)?.question}
                          </span>
                          <span className="block text-[11.5px] text-muted-foreground">
                            {s.because}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {r.hypotheses.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                    Possible hypotheses
                  </p>
                  <ul className="mt-1 space-y-1">
                    {r.hypotheses.map((h) => (
                      <li key={h.text} className="rounded-md bg-card px-3 py-2">
                        <span className="block">{h.text}</span>
                        <span className="block text-[11.5px] text-muted-foreground">
                          {h.because}
                        </span>
                        <button
                          disabled={adopted.has(h.text)}
                          onClick={() =>
                            apply(
                              {
                                findings: [
                                  ...e.findings,
                                  {
                                    id: newId(),
                                    text: h.text,
                                    kind: "hypothesis",
                                    source: "ai",
                                    at: new Date().toISOString(),
                                  },
                                ],
                              },
                              "Added as a hypothesis, labelled as an AI suggestion.",
                            )
                          }
                          className="mt-1 text-[11.5px] font-medium text-primary hover:underline disabled:text-muted-foreground disabled:no-underline"
                        >
                          {adopted.has(h.text) ? "Added" : "Add as a hypothesis to test"}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
          <p className="mt-3 text-[10.5px] leading-snug text-muted-foreground">
            {status.data?.model ?? "gpt-4.1"} on Microsoft Foundry, grounded in this engagement, the
            question cards and the catalog. Suggestions only: nothing is added until you accept it.
          </p>
        </>
      )}
    </section>
  );
}
