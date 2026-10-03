/*
 * What MSX shows about the account, read with fixed rules (src/lib/msx-signals.ts): the workloads the account team is
 * driving and how they're going, what needs attention, what's already in production, co-sell partners and customer
 * contacts. Each line is MSX's own data; nothing is estimated.
 */
import { AlertTriangle, CheckCircle2, Handshake, Users, Workflow } from "lucide-react";
import type { ReactNode } from "react";

import { Pill } from "@/components/Primitives";
import type { MsxSnapshot } from "@/lib/msx-connector";
import { FLAG_LABEL, fiscal, milestoneFacts, msxSignals, TEAM_LABEL } from "@/lib/msx-signals";

function Block({
  title,
  icon,
  count,
  children,
}: {
  title: string;
  icon: ReactNode;
  count?: number;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="rounded-lg border border-border bg-background/60 p-3">
      <h3 className="flex items-center gap-1.5 text-[12.5px] font-semibold">
        {icon}
        {title}
        {count != null && <span className="font-normal text-muted-foreground">· {count}</span>}
      </h3>
      <div className="mt-1.5 text-[12.5px]">{children}</div>
    </section>
  );
}

const None = ({ children }: { children: ReactNode }) => (
  <p className="text-muted-foreground">{children}</p>
);

export function MsxSignalsPanel({ snap }: { snap: MsxSnapshot }) {
  if (snap.milestones === undefined)
    return (
      <p className="rounded-lg border border-border bg-muted/40 p-3 text-[12.5px] text-muted-foreground">
        This snapshot was taken before Cloud Delivery read milestones, contacts and partners. Look
        the TPID up again to read them.
      </p>
    );
  const s = msxSignals(snap);
  const quarter = fiscal(new Date()).label;
  return (
    <section aria-label="What MSX shows" className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[13px] font-semibold">What MSX shows the account team doing</h2>
        <span className="text-[11.5px] text-muted-foreground">
          {[s.industry, s.segment, s.country].filter(Boolean).join(" · ")}
          {s.ownerTeams.length > 0 &&
            ` · opportunities owned by ${s.ownerTeams
              .map((t) => `${TEAM_LABEL[t.team] ?? t.team} ${t.count}`)
              .join(", ")}`}
        </span>
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Block title="In motion" icon={<Workflow className="size-3.5" />} count={s.inMotion.length}>
          {snap.milestones === null ? (
            <None>MSX didn't let you read milestones for this account.</None>
          ) : s.inMotion.length === 0 ? (
            <None>No open milestones on the open opportunities.</None>
          ) : (
            <ul className="space-y-1.5">
              {s.inMotion.slice(0, 8).map((w) => (
                <li key={w.workload}>
                  <p className="font-medium">
                    {w.workload}{" "}
                    <span className="font-normal text-muted-foreground">
                      · {w.milestones.length} milestone{w.milestones.length === 1 ? "" : "s"}
                      {w.committed > 0 && `, ${w.committed} committed`}
                    </span>
                  </p>
                  <p className="text-muted-foreground">
                    Next: {w.next.name} · {milestoneFacts(w.next)}
                  </p>
                </li>
              ))}
            </ul>
          )}
          {s.thisQuarter.length > 0 && (
            <p className="mt-2 text-[11.5px] text-muted-foreground">
              {s.thisQuarter.length} open milestone{s.thisQuarter.length === 1 ? "" : "s"} dated in{" "}
              {quarter}.
            </p>
          )}
        </Block>

        <Block
          title="Needs attention"
          icon={<AlertTriangle className="size-3.5" />}
          count={s.attention.length}
        >
          {snap.milestones === null ? (
            <None>Not readable.</None>
          ) : s.attention.length === 0 ? (
            <None>Nothing blocked, at risk, past its date or stale.</None>
          ) : (
            <ul className="space-y-1.5">
              {s.attention.slice(0, 6).map((a) => (
                <li key={a.milestone.id}>
                  <div className="flex flex-wrap gap-1">
                    {a.flags.map((f) => (
                      <Pill
                        key={f}
                        tone={f === "blocked" || f === "overdue" ? "danger" : "warning"}
                      >
                        {FLAG_LABEL[f]}
                      </Pill>
                    ))}
                  </div>
                  <p className="mt-0.5">{a.text}</p>
                </li>
              ))}
            </ul>
          )}
        </Block>

        <Block
          title="Already in production"
          icon={<CheckCircle2 className="size-3.5" />}
          count={s.live.length}
        >
          {s.live.length === 0 ? (
            <None>No production milestone completed in the last two years.</None>
          ) : (
            <ul className="space-y-1">
              {s.live.slice(0, 8).map((l) => (
                <li key={l.workload}>
                  <span className="font-medium">{l.workload}</span>{" "}
                  <span className="text-muted-foreground">
                    · completed {l.milestone.date?.slice(0, 10) ?? "no date"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Block>

        <Block
          title="Co-sell partners"
          icon={<Handshake className="size-3.5" />}
          count={s.partners.length}
        >
          {snap.partners === null ? (
            <None>Not readable.</None>
          ) : s.partners.length === 0 ? (
            <None>No accepted or won co-sell referral on the open opportunities.</None>
          ) : (
            <ul className="space-y-1">
              {s.partners.slice(0, 6).map((p) => (
                <li key={p.partner}>
                  <span className="font-medium">{p.partner}</span>
                  {p.opportunities.length > 0 && (
                    <span className="text-muted-foreground">
                      {" "}
                      · {p.opportunities.slice(0, 2).join("; ")}
                      {p.opportunities.length > 2 && ` +${p.opportunities.length - 2}`}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Block>

        <Block
          title="Customer contacts"
          icon={<Users className="size-3.5" />}
          count={s.contacts.length}
        >
          {snap.contacts === null ? (
            <None>Not readable.</None>
          ) : s.contacts.length === 0 ? (
            <None>No contacts with a job title under this TPID.</None>
          ) : (
            <>
              <ul className="grid gap-x-3 gap-y-0.5 sm:grid-cols-2">
                {s.contacts.slice(0, 10).map((c) => (
                  <li key={`${c.name}-${c.title}`} className="truncate">
                    {c.name}
                    {c.title && <span className="text-muted-foreground"> · {c.title}</span>}
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-[11.5px] text-muted-foreground">
                Senior titles first. Who decides isn't in MSX: confirm it in the conversation.
              </p>
            </>
          )}
        </Block>
      </div>
    </section>
  );
}
