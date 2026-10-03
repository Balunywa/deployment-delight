/*
 * The SE's accounts: every customer with a TPID, read from its last MSX snapshot. What Microsoft is driving there,
 * what's stuck, milestones committed or not (the SE's job is uncommitted to committed), the conversation to lead
 * with, and one click to the prep.
 */
import { useMutation } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { Pill } from "@/components/Primitives";
import { Button } from "@/components/ui/button";
import { relative } from "@/lib/format";
import type { AccountRow } from "@/lib/prep.functions";
import type { ConversationId } from "@/lib/se-playbook";
import { startDraft } from "@/lib/workspace.functions";

const STAGE_SHORT: Record<string, string> = {
  "Listen & Consult": "L&C",
  "Inspire & Design": "I&D",
  "Empower & Achieve": "E&A",
  "Realize Value": "RV",
  "Manage & Optimize": "M&O",
  "Stage not set": "?",
};

export function Accounts({ rows, loading }: { rows: AccountRow[]; loading: boolean }) {
  const navigate = useNavigate();
  const open = useServerFn(startDraft);
  const prepare = useMutation({
    mutationFn: (r: AccountRow) =>
      open({
        data: {
          customerId: r.id,
          ...(r.leadWith ? { conversation: r.leadWith.id as ConversationId } : {}),
        },
      }),
    onSuccess: (r) =>
      void navigate({
        to: "/engagements/$engagementId",
        params: { engagementId: r.id },
        search: { tab: r.status === "draft" ? "prep" : "overview" },
      }),
    onError: (e: Error) => toast.error(e.message),
  });

  if (loading) return null;
  if (!rows.length)
    return (
      <section
        aria-label="Accounts"
        className="rounded-xl border border-dashed border-border bg-card p-5 text-[13px]"
      >
        <p className="font-medium">No accounts yet</p>
        <p className="mt-0.5 text-muted-foreground">
          Enter a TPID and Cloud Delivery reads MSX and drafts your prep.
        </p>
        <Button asChild size="sm" className="mt-3">
          <Link to="/customers/onboard">Prepare for a customer</Link>
        </Button>
      </section>
    );

  return (
    <section
      aria-label="Accounts"
      className="overflow-x-auto rounded-md border border-border bg-card"
    >
      <table className="w-full text-left text-[13px]">
        <thead className="border-b border-border bg-muted/50 text-[11.5px] text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Account</th>
            <th className="px-3 py-2 font-medium">Opportunities</th>
            <th className="px-3 py-2 font-medium">Microsoft is driving</th>
            <th className="px-3 py-2 font-medium">Milestones</th>
            <th className="px-3 py-2 font-medium">Lead with</th>
            <th className="px-3 py-2 font-medium">MSX</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r.id} className="align-top">
              <td className="px-3 py-2.5">
                <Link
                  to="/customers/$customerId"
                  params={{ customerId: r.id }}
                  className="font-medium hover:underline"
                >
                  {r.name}
                </Link>
                <p className="text-[11.5px] text-muted-foreground">
                  <span className="font-mono">TPID {r.tpid}</span>
                  {[r.industry, r.country].filter(Boolean).length > 0 &&
                    ` · ${[r.industry, r.country].filter(Boolean).join(" · ")}`}
                </p>
              </td>
              <td className="px-3 py-2.5">
                <span className="font-medium">{r.opportunities}</span>
                {r.stages.length > 0 && (
                  <p
                    className="text-[11.5px] text-muted-foreground"
                    title={r.stages.map((s) => `${s.stage}: ${s.count}`).join("\n")}
                  >
                    {r.stages
                      .map((s) => `${STAGE_SHORT[s.stage] ?? s.stage} ${s.count}`)
                      .join(" · ")}
                  </p>
                )}
              </td>
              <td className="px-3 py-2.5">
                {r.inMotion.length ? (
                  <p className="max-w-64 truncate" title={r.inMotion.join(", ")}>
                    {r.inMotion.join(", ")}
                  </p>
                ) : (
                  <span className="text-muted-foreground">No open milestones</span>
                )}
                {r.attention > 0 && <Pill tone="warning">{r.attention} stuck or stale</Pill>}
              </td>
              <td className="px-3 py-2.5 whitespace-nowrap">
                <span className="font-medium">{r.committed}</span>{" "}
                <span className="text-muted-foreground">committed</span>
                <p className="text-[11.5px] text-muted-foreground">
                  {r.uncommitted} uncommitted{r.rtc > 0 && ` · ${r.rtc} #RTC`}
                </p>
              </td>
              <td className="px-3 py-2.5">
                {r.leadWith ? (
                  <span title={r.leadWith.reasons.join("\n")}>{r.leadWith.title}</span>
                ) : (
                  <span className="text-muted-foreground">General discovery</span>
                )}
              </td>
              <td className="px-3 py-2.5 text-[12px] whitespace-nowrap text-muted-foreground">
                {r.fetchedAt ? relative(r.fetchedAt) : "not read"}
                <p>
                  {r.engagements} engagement{r.engagements === 1 ? "" : "s"}
                </p>
              </td>
              <td className="px-3 py-2.5 text-right">
                {r.latestDraft ? (
                  <Button asChild size="sm" variant="outline">
                    <Link
                      to="/engagements/$engagementId"
                      params={{ engagementId: r.latestDraft }}
                      search={{ tab: "prep" }}
                    >
                      Open prep
                    </Link>
                  </Button>
                ) : (
                  <Button size="sm" disabled={prepare.isPending} onClick={() => prepare.mutate(r)}>
                    Prepare
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
