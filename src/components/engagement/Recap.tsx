/*
 * The customer-safe recap. It renders only what getRecap returns, and getRecap never sends hypotheses, presenter
 * notes, fit scoring or internal notes: they aren't hidden here, they were never sent.
 */
import { CalendarDays, Check, CircleHelp, MessageSquareQuote, Target } from "lucide-react";
import type { ReactNode } from "react";

import type { Recap } from "@/lib/engagements.functions";
import { cn } from "@/lib/utils";

function Section({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-border pt-6">
      <h2 className="flex items-center gap-2 text-[13px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">
        {icon}
        {title}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

const date = (s: string) =>
  new Date(s).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });

export function RecapDocument({ recap: r, className }: { recap: Recap; className?: string }) {
  const last = r.sessions.at(-1);
  return (
    <article
      className={cn("space-y-7 rounded-2xl border border-border bg-card p-8 md:p-10", className)}
    >
      <header>
        <p className="text-[12px] font-semibold tracking-[0.14em] text-primary uppercase">
          {r.customer ?? "Recap"}
        </p>
        <h1 className="mt-2 text-[28px] leading-tight font-bold tracking-tight">{r.name}</h1>
        {last && (
          <p className="mt-2 text-[13px] text-muted-foreground">
            After{" "}
            {r.sessions.length > 1 ? `${r.sessions.length} conversations` : "our conversation"},
            most recently “{last.title}” on {date(last.at)}
          </p>
        )}
      </header>

      {r.words && (
        <blockquote className="rounded-xl bg-muted/50 px-6 py-5 text-[17px] leading-relaxed">
          <MessageSquareQuote className="mb-2 size-5 text-primary" />“{r.words}”
        </blockquote>
      )}

      {(r.outcome || r.workflow || r.whyNow) && (
        <Section icon={<Target className="size-4" />} title="What you want to change">
          <dl className="grid gap-4 text-[14px] md:grid-cols-3">
            {[
              ["The outcome", r.outcome],
              ["The work", r.workflow],
              ["Why now", r.whyNow],
            ]
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k}>
                  <dt className="text-[12px] font-medium text-muted-foreground">{k}</dt>
                  <dd className="mt-1 leading-relaxed">{v}</dd>
                </div>
              ))}
          </dl>
          {r.owner && (
            <p className="mt-4 text-[13px] text-muted-foreground">
              Owned by <span className="font-medium text-foreground">{r.owner}</span>
            </p>
          )}
        </Section>
      )}

      <Section icon={<Check className="size-4" />} title="What we heard">
        {r.confirmed.length ? (
          <ul className="space-y-3">
            {r.confirmed.map((c) => (
              <li key={c.text} className="flex gap-3 text-[14px] leading-relaxed">
                <Check className="mt-1 size-4 shrink-0 text-success" />
                <span>
                  {c.text}
                  {c.quote && (
                    <span className="mt-0.5 block text-[13px] text-muted-foreground italic">
                      “{c.quote}”
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-muted-foreground">Nothing confirmed yet.</p>
        )}
      </Section>

      {r.open.length > 0 && (
        <Section icon={<CircleHelp className="size-4" />} title="What we still need to find out">
          <ul className="list-disc space-y-1.5 pl-5 text-[14px]">
            {r.open.map((o) => (
              <li key={o}>{o}</li>
            ))}
          </ul>
        </Section>
      )}

      {r.shown.length > 0 && (
        <Section icon={<Target className="size-4" />} title="Examples we looked at">
          <ul className="grid gap-3 md:grid-cols-2">
            {r.shown.map((p) => (
              <li key={p.id} className="rounded-lg border border-border p-4">
                <p className="text-[14px] font-semibold">{p.name}</p>
                {p.outcome && <p className="mt-1 text-[13px] text-muted-foreground">{p.outcome}</p>}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {r.success && (
        <Section icon={<Target className="size-4" />} title="How you'll know it worked">
          <p className="text-[14px] leading-relaxed">{r.success}</p>
        </Section>
      )}

      <Section icon={<CalendarDays className="size-4" />} title="Agreed next steps">
        {r.actions.length ? (
          <table className="w-full text-left text-[14px]">
            <thead className="text-[12px] text-muted-foreground">
              <tr>
                <th className="pb-2 font-medium">Step</th>
                <th className="pb-2 font-medium">Owner</th>
                <th className="pb-2 font-medium">By</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {r.actions.map((a) => (
                <tr key={a.text}>
                  <td className={cn("py-2.5 pr-4", a.done && "text-muted-foreground line-through")}>
                    {a.text}
                  </td>
                  <td className="py-2.5 pr-4 whitespace-nowrap">{a.owner || "To agree"}</td>
                  <td className="py-2.5 whitespace-nowrap">{a.due ? date(a.due) : "To agree"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-[13px] text-muted-foreground">To agree.</p>
        )}
      </Section>

      <p className="border-t border-border pt-5 text-[12px] text-muted-foreground">
        This recap only includes what you confirmed. Anything we're still testing with you isn't
        here yet.
      </p>
    </article>
  );
}
