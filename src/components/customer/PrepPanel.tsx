/*
 * Prep for the next customer conversation: the context map, two or three discovery questions, technical areas to
 * review and similar work by peers, from MSX plus what the SE added. Optionally a model-drafted brief from the same
 * context. Internal only.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ExternalLink, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { useConnector, useRefreshFromMsx } from "@/components/customer/hooks";
import { Button } from "@/components/ui/button";
import { relative } from "@/lib/format";
import { getCustomerProfile } from "@/lib/msx.functions";
import type { Quote } from "@/lib/prep";
import { draftPrep, getCustomerPrep, getPrepAssist } from "@/lib/prep.functions";

function Quotes({ items, empty }: { items: Quote[]; empty: string }) {
  if (!items.length) return <p className="text-[12.5px] text-muted-foreground">{empty}</p>;
  return (
    <ul className="space-y-1.5">
      {items.map((q, i) => (
        <li key={i} className="text-[12.5px]">
          <span className="text-foreground/90">{q.text}</span>{" "}
          <span className="text-[11.5px] whitespace-nowrap text-muted-foreground">({q.from})</span>
        </li>
      ))}
    </ul>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="mb-1 text-[11.5px] font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </h4>
      {children}
    </div>
  );
}

export function PrepPanel({ customerId }: { customerId: string }) {
  const loadPrep = useServerFn(getCustomerPrep);
  const loadProfile = useServerFn(getCustomerProfile);
  const prep = useQuery({
    queryKey: ["customer-prep", customerId],
    queryFn: () => loadPrep({ data: { id: customerId } }),
  });
  const profile = useQuery({
    queryKey: ["customer-profile", customerId],
    queryFn: () => loadProfile({ data: { id: customerId } }),
  });
  const conn = useConnector();
  const refresh = useRefreshFromMsx(customerId);
  const assist = useQuery({ queryKey: ["prep-assist"], queryFn: useServerFn(getPrepAssist) });
  const draft = useMutation({
    mutationFn: useServerFn(draftPrep),
    onError: (e: Error) => toast.error(e.message),
  });

  const p = prep.data;
  if (!p) return null;
  const tpid = profile.data?.tpid;

  return (
    <section aria-label="Prep" className="mb-5 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h2 className="text-[14px] font-semibold">Prep for the conversation</h2>
          <p className="text-[12px] text-muted-foreground">
            {p.sources.msx && p.account.fetchedAt
              ? `MSX as of ${relative(p.account.fetchedAt)}`
              : "No MSX snapshot yet"}
            {` · ${p.sources.added} added context entr${p.sources.added === 1 ? "y" : "ies"}`}.
            Hints to review and questions to test, not a solution. Every quote says where it came
            from.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {tpid && conn.data?.state === "ready" && (
            <Button
              size="sm"
              variant="outline"
              disabled={refresh.isPending}
              onClick={() => refresh.mutate(tpid)}
            >
              <RefreshCw className="size-3.5" />
              {refresh.isPending ? "Reading MSX…" : "Refresh from MSX"}
            </Button>
          )}
          {assist.data?.configured && (
            <Button
              size="sm"
              variant="outline"
              disabled={draft.isPending}
              onClick={() => draft.mutate({ data: { id: customerId } })}
            >
              <Sparkles className="size-3.5" />
              {draft.isPending ? "Drafting…" : "Draft a brief with AI"}
            </Button>
          )}
        </div>
      </div>

      <div className="mt-4 grid gap-5 lg:grid-cols-2">
        <div className="space-y-4" aria-label="Context map" role="group">
          <h3 className="text-[13px] font-semibold">Context map</h3>
          <Block title="Account">
            <p className="text-[12.5px]">
              {p.account.name ?? "Not known yet"}
              {p.account.accounts != null &&
                ` · ${p.account.accounts} active MSX account${p.account.accounts === 1 ? "" : "s"} under the TPID`}
            </p>
          </Block>
          <Block title="Where it came from">
            <Quotes items={p.origin} empty="No open MSX opportunity: a proactive engagement." />
          </Block>
          <Block title="What they want">
            <Quotes items={p.goals} empty="Not stated anywhere yet." />
          </Block>
          <Block title="Why now">
            <Quotes items={p.whyNow} empty="Not stated anywhere yet." />
          </Block>
          <Block title="People">
            <Quotes items={p.people} empty="No sponsor or decision maker named." />
          </Block>
          {p.gaps.length > 0 && (
            <Block title="Unknowns to close">
              <ul className="list-disc space-y-1 pl-4 text-[12.5px] text-foreground/85">
                {p.gaps.map((g) => (
                  <li key={g}>{g}</li>
                ))}
              </ul>
            </Block>
          )}
        </div>

        <div className="space-y-4">
          <div aria-label="Discovery questions" role="group">
            <h3 className="mb-2 text-[13px] font-semibold">Discovery questions</h3>
            <ol className="space-y-2">
              {p.questions.map((q, i) => (
                <li key={i} className="rounded-lg border border-border px-3 py-2">
                  <p className="text-[13px] font-medium">
                    {i + 1}. {q.text}
                  </p>
                  <p className="mt-0.5 text-[11.5px] text-muted-foreground">{q.because}</p>
                </li>
              ))}
            </ol>
          </div>

          <div aria-label="Technical areas" role="group">
            <h3 className="mb-2 text-[13px] font-semibold">Technical areas to review</h3>
            {p.areas.length === 0 ? (
              <p className="text-[12.5px] text-muted-foreground">
                Nothing technical is mentioned yet. Add notes or a transcript and the hints follow.
              </p>
            ) : (
              <ul className="space-y-2">
                {p.areas.slice(0, 5).map((a) => (
                  <li key={a.id} className="rounded-lg border border-border px-3 py-2">
                    <p className="text-[12.5px] font-semibold">
                      {a.label}{" "}
                      <span className="font-normal text-muted-foreground">
                        · mentions {a.matched.join(", ")}
                      </span>
                    </p>
                    <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px]">
                      {a.review.map((r) => (
                        <li key={r.url}>
                          <a
                            href={r.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-primary hover:underline"
                          >
                            {r.title} <ExternalLink className="size-3" />
                          </a>
                        </li>
                      ))}
                    </ul>
                    {a.ask.length > 0 && (
                      <ul className="mt-1 list-disc pl-4 text-[12px] text-foreground/80">
                        {a.ask.map((q) => (
                          <li key={q}>{q}</li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div aria-label="Similar engagements" role="group">
            <h3 className="mb-2 text-[13px] font-semibold">Similar work by peers</h3>
            {p.similar.length === 0 ? (
              <p className="text-[12.5px] text-muted-foreground">
                None yet. This fills in as the team onboards customers with similar context.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {p.similar.map((s) => (
                  <li key={s.customerId} className="text-[12.5px]">
                    <Link
                      to="/customers/$customerId"
                      params={{ customerId: s.customerId }}
                      className="font-medium text-primary hover:underline"
                    >
                      {s.customerName}
                    </Link>
                    {s.engagement && (
                      <>
                        {" · "}
                        <Link
                          to="/engagements/$engagementId"
                          params={{ engagementId: s.engagement.id }}
                          className="hover:underline"
                        >
                          {s.engagement.name}
                        </Link>
                      </>
                    )}
                    <span className="text-muted-foreground"> · shares {s.shared.join(", ")}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {draft.data && (
        <div
          role="group"
          aria-label="AI brief"
          className="mt-5 rounded-lg border border-primary/30 bg-primary/5 p-3"
        >
          <p className="text-[11.5px] text-muted-foreground">
            Drafted by {draft.data.model} from the context above only. Check it before you use it.
          </p>
          <p className="mt-1 text-[13px] whitespace-pre-wrap">{draft.data.summary}</p>
          {draft.data.questions.length > 0 && (
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-[12.5px]">
              {draft.data.questions.map((q, i) => (
                <li key={i}>
                  {q.text} <span className="text-muted-foreground">({q.because})</span>
                </li>
              ))}
            </ol>
          )}
          {draft.data.hints.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-[12.5px]">
              {draft.data.hints.map((h, i) => (
                <li key={i}>
                  <span className="font-medium">{h.area}:</span> {h.why}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
