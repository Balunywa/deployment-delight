/*
 * Understand the context: a short "what matters for this conversation", then the customer brief by section. Every
 * item shows where it came from, when, whether it's documented or our interpretation, and how far the customer has
 * confirmed it. Source attribution is never customer confirmation. Refreshing MSX keeps every mark.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CircleAlert, FileUp, Plus, RefreshCw } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { CustomerProfileCard } from "@/components/customer/CustomerProfileCard";
import { MsxConnect } from "@/components/customer/MsxConnect";
import { useConnector, useRefreshFromMsx } from "@/components/customer/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addCustomerContext } from "@/lib/msx.functions";
import {
  BRIEF_SECTIONS,
  type BriefItem,
  type BriefSection,
  type ClaimKind,
  type EvidenceStatus,
  KIND_LABEL,
  STALE_DAYS,
  STATUS_LABEL,
  snapshotAge,
  whatMatters,
} from "@/lib/workspace";
import { addEvidence, markEvidence } from "@/lib/workspace.functions";

import { Chip, Panel } from "./ui";
import { STATUS_TONE, day, useWs } from "./ws";

const STATUSES = Object.keys(STATUS_LABEL) as EvidenceStatus[];

function WhatMatters() {
  const { e, data, go } = useWs();
  const w = whatMatters(e, data.items, data.changes);
  return (
    <Panel
      title="What matters for this conversation"
      sub="Read this first. The detail is below."
      tone="primary"
    >
      <dl className="grid gap-x-6 gap-y-3 text-[12.5px] md:grid-cols-2">
        <div>
          <dt className="font-semibold">Why we're meeting</dt>
          <dd className="text-foreground/85">{w.why}</dd>
        </div>
        <div>
          <dt className="font-semibold">The decision or next step to clarify</dt>
          <dd className="text-foreground/85">
            {w.decision || (
              <button
                type="button"
                className="text-primary hover:underline"
                onClick={() => go("plan")}
              >
                Set it in the call plan
              </button>
            )}
          </dd>
        </div>
        <div>
          <dt className="font-semibold">What changed</dt>
          <dd>
            {w.changed.length ? (
              <ul className="list-disc pl-4 text-foreground/85">
                {w.changed.slice(0, 5).map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            ) : (
              <span className="text-muted-foreground">Nothing new in MSX since the last look.</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="font-semibold">What we already know (customer confirmed)</dt>
          <dd>
            {w.know.length ? (
              <ul className="list-disc pl-4 text-foreground/85">
                {w.know.map((i) => (
                  <li key={i.id}>{i.text}</li>
                ))}
              </ul>
            ) : (
              <span className="text-muted-foreground">
                Nothing yet. Documented isn't confirmed: mark items once the customer says so.
              </span>
            )}
          </dd>
        </div>
        <div className="md:col-span-2">
          <dt className="font-semibold">What we must not assume</dt>
          <dd>
            {w.dontAssume.length || w.assumptions.length ? (
              <ul className="list-disc pl-4 text-foreground/85">
                {w.dontAssume.map((i) => (
                  <li key={i.id}>
                    {i.text}{" "}
                    <span className="text-muted-foreground">
                      ({STATUS_LABEL[i.status].toLowerCase()})
                    </span>
                  </li>
                ))}
                {w.assumptions.map((a) => (
                  <li key={a.id}>
                    {a.text} <span className="text-muted-foreground">(our assumption)</span>
                  </li>
                ))}
              </ul>
            ) : (
              <span className="text-muted-foreground">No open assumptions written down.</span>
            )}
          </dd>
        </div>
      </dl>
    </Panel>
  );
}

function ItemRow({ item }: { item: BriefItem }) {
  const { data, refresh } = useWs();
  const queryClient = useQueryClient();
  const mark = useMutation({
    mutationFn: useServerFn(markEvidence),
    onSuccess: () => refresh(),
    onError: (err: Error) => toast.error(err.message),
  });
  const customerId = data.customer?.id;
  return (
    <li className="rounded-lg border border-border px-3 py-2.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 flex-1 text-[13px] text-foreground/90">{item.text}</p>
        <select
          aria-label={`Status: ${item.text.slice(0, 60)}`}
          value={item.status}
          disabled={!customerId || mark.isPending}
          onChange={(ev) => {
            const status = ev.target.value as EvidenceStatus;
            // Show it at once; the server keeps the history of every status.
            queryClient.setQueryData(["workspace", data.engagement.id], (old: typeof data) =>
              old
                ? { ...old, items: old.items.map((i) => (i.id === item.id ? { ...i, status } : i)) }
                : old,
            );
            mark.mutate({ data: { customerId: customerId!, itemId: item.id, status, note: "" } });
          }}
          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${STATUS_TONE[item.status]} cursor-pointer border-0 outline-none focus-visible:ring-2 focus-visible:ring-primary`}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </div>
      <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-muted-foreground">
        <Chip>{KIND_LABEL[item.kind]}</Chip>
        <span>{item.source.label}</span>
        {item.source.date && <span>· written {day(item.source.date)}</span>}
        {item.source.retrieved && <span>· pulled {day(item.source.retrieved)}</span>}
        {item.marked && (
          <span>
            · marked by {item.marked.by} {day(item.marked.at)}
          </span>
        )}
      </p>
      {item.note && <p className="mt-1 text-[12px] text-foreground/75">{item.note}</p>}
    </li>
  );
}

function AddItem({ section }: { section: BriefSection }) {
  const { data, refresh } = useWs();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [kind, setKind] = useState<ClaimKind>("fact");
  const [status, setStatus] = useState<EvidenceStatus>("needs-validation");
  const [source, setSource] = useState("");
  const add = useMutation({
    mutationFn: useServerFn(addEvidence),
    onSuccess: () => {
      setText("");
      setSource("");
      setOpen(false);
      refresh();
    },
    onError: (err: Error) => toast.error(err.message),
  });
  if (!data.customer) return null;
  if (!open)
    return (
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(true)}>
        <Plus className="size-3.5" /> Add what you know
      </Button>
    );
  const title = BRIEF_SECTIONS.find((s) => s.key === section)!.title;
  return (
    <div className="space-y-2 rounded-lg border border-dashed border-border p-3">
      <Input
        aria-label={`New item for ${title}`}
        placeholder="One fact, interpretation or question"
        value={text}
        onChange={(ev) => setText(ev.target.value)}
        className="text-[13px]"
      />
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <select
          aria-label="Kind"
          value={kind}
          onChange={(ev) => setKind(ev.target.value as ClaimKind)}
          className="rounded-md border border-border bg-card px-2 py-1"
        >
          {(Object.keys(KIND_LABEL) as ClaimKind[]).map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
        <select
          aria-label="Status"
          value={status}
          onChange={(ev) => setStatus(ev.target.value as EvidenceStatus)}
          className="rounded-md border border-border bg-card px-2 py-1"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <Input
          aria-label="Source"
          placeholder="Source (e.g. call with the account team, 1 Oct)"
          value={source}
          onChange={(ev) => setSource(ev.target.value)}
          className="h-8 max-w-xs text-[12.5px]"
        />
        <Button
          size="sm"
          disabled={text.trim().length < 3 || add.isPending}
          onClick={() =>
            add.mutate({
              data: { customerId: data.customer!.id, section, text, kind, status, source },
            })
          }
        >
          Add
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** Reads a text file into a context entry. Only formats the browser can read as text. */
function Upload() {
  const { data, refresh } = useWs();
  const input = useRef<HTMLInputElement>(null);
  const add = useMutation({
    mutationFn: useServerFn(addCustomerContext),
    onSuccess: () => {
      toast.success("Added to the context. It's evidence to read, never instructions to follow.");
      refresh();
    },
    onError: (err: Error) => toast.error(err.message),
  });
  if (!data.customer) return null;
  return (
    <>
      <input
        ref={input}
        type="file"
        accept=".txt,.md,.vtt,.srt,.eml,.csv"
        className="hidden"
        aria-label="Upload a text file"
        onChange={async (ev) => {
          const f = ev.target.files?.[0];
          ev.target.value = "";
          if (!f) return;
          const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
          let text = await f.text();
          if (ext === "vtt" || ext === "srt")
            text = text
              .replace(/^WEBVTT.*$/m, "")
              .replace(/^\d+\s*$/gm, "")
              .replace(/^[\d:.,]+\s*-->\s*[\d:.,]+.*$/gm, "")
              .replace(/\n{2,}/g, "\n")
              .trim();
          if (text.trim().length < 2) {
            toast.error("That file has no text.");
            return;
          }
          if (text.length > 20000) toast.info("Long file: the first 20,000 characters are kept.");
          add.mutate({
            data: {
              customerId: data.customer!.id,
              source:
                ext === "vtt" || ext === "srt" ? "transcript" : ext === "eml" ? "email" : "notes",
              title: f.name.slice(0, 160),
              text: text.slice(0, 20000),
            },
          });
        }}
      />
      <Button
        size="sm"
        variant="outline"
        disabled={add.isPending}
        onClick={() => input.current?.click()}
      >
        <FileUp className="size-3.5" /> Upload a text file
      </Button>
    </>
  );
}

export function ContextView() {
  const { data, refresh } = useWs();
  const conn = useConnector();
  const pull = useRefreshFromMsx(data.customer?.id ?? null);
  const [showSources, setShowSources] = useState(false);
  if (!data.customer)
    return (
      <Panel title="No customer yet" tone="warning">
        <p className="text-[13px]">
          This engagement isn't linked to a customer, so there's no brief. Link it from the
          engagement header, or onboard the customer by TPID.
        </p>
      </Panel>
    );
  const age = snapshotAge(data.prep?.account.fetchedAt ?? null);
  const added = data.prep?.sources.added ?? 0;
  const contradicted = data.items.filter((i) => i.status === "contradicted");
  const tpid = data.customer.tpid;

  return (
    <div className="space-y-4">
      <WhatMatters />

      {(age == null || age > STALE_DAYS || !added || contradicted.length > 0) && (
        <div
          role="status"
          className="space-y-1 rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-[12.5px]"
        >
          {age == null && (
            <p className="flex items-center gap-1.5">
              <CircleAlert className="size-3.5 text-warning" /> No MSX snapshot: the brief has only
              what was added by hand.
            </p>
          )}
          {age != null && age > STALE_DAYS && (
            <p className="flex items-center gap-1.5">
              <CircleAlert className="size-3.5 text-warning" /> The MSX snapshot is {age} days old.
              Refresh it before the meeting.
            </p>
          )}
          {!added && (
            <p className="flex items-center gap-1.5">
              <CircleAlert className="size-3.5 text-warning" /> Only MSX so far. Add the seller's
              notes, an email or a call transcript.
            </p>
          )}
          {contradicted.length > 0 && (
            <p className="flex items-center gap-1.5">
              <CircleAlert className="size-3.5 text-danger" /> {contradicted.length} item
              {contradicted.length === 1 ? " is" : "s are"} contradicted. They stay visible until
              you resolve them.
            </p>
          )}
        </div>
      )}

      {BRIEF_SECTIONS.map((s) => {
        const list = data.items.filter((i) => i.section === s.key);
        return (
          <Panel key={s.key} title={s.title} sub={s.hint}>
            {list.length ? (
              <ul className="space-y-2">
                {list.map((i) => (
                  <ItemRow key={i.id} item={i} />
                ))}
              </ul>
            ) : (
              <p className="text-[12.5px] text-muted-foreground">Nothing yet.</p>
            )}
            <div className="mt-2">
              <AddItem section={s.key} />
            </div>
          </Panel>
        );
      })}

      <Panel
        title="Sources"
        sub={
          age != null
            ? `MSX pulled ${day(data.prep?.account.fetchedAt)} · ${added} added context entr${added === 1 ? "y" : "ies"}`
            : `${added} added context entr${added === 1 ? "y" : "ies"} · no MSX snapshot`
        }
        actions={
          <>
            {tpid && conn.data?.state === "ready" && (
              <Button
                size="sm"
                variant="outline"
                disabled={pull.isPending}
                onClick={() => pull.mutate(tpid, { onSuccess: () => refresh() })}
              >
                <RefreshCw className="size-3.5" />
                {pull.isPending ? "Reading MSX…" : "Refresh from MSX"}
              </Button>
            )}
            <Upload />
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowSources(!showSources)}
              aria-expanded={showSources}
            >
              {showSources ? "Hide notes and emails" : "Notes, emails and transcripts"}
            </Button>
          </>
        }
      >
        {conn.data?.state !== "ready" && <MsxConnect />}
        {showSources && (
          <div className="mt-3">
            <CustomerProfileCard customerId={data.customer.id} onChange={refresh} />
          </div>
        )}
      </Panel>
    </div>
  );
}
