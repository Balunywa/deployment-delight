import { Link } from "@tanstack/react-router";

import { type Stage, STAGES, semverCompare } from "@/lib/fleet";
import { type FleetCustomer, type Install, TONE_STYLE } from "@/lib/use-fleet";
import { cn } from "@/lib/utils";

const ENV_ORDER = ["development", "test", "qa", "staging", "production", "disaster_recovery"];
const ENV_SHORT: Record<string, string> = {
  development: "Dev",
  test: "Test",
  qa: "QA",
  staging: "Staging",
  production: "Prod",
  disaster_recovery: "DR",
};

export function VersionCell({ install }: { install?: Install | undefined }) {
  if (!install) return <span className="block h-6 rounded-sm border border-transparent" />;
  const style = TONE_STYLE[install.tone];
  return (
    <span
      title={`${install.name} · ${install.actual ? `v${install.actual}` : "not deployed"} · ${style.label}${
        install.deviations.length ? ` · ${install.deviations.length} customization(s)` : ""
      }`}
      className={cn(
        "relative flex h-6 items-center justify-center rounded-sm border font-mono text-[11px] tabular-nums",
        style.cell,
      )}
    >
      {install.actual ?? "—"}
      {install.deviations.length > 0 && (
        <span className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-info ring-2 ring-card" />
      )}
    </span>
  );
}

export function GridLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
      {(["preferred", "supported", "deprecated", "none"] as const).map((t) => (
        <span key={t} className="flex items-center gap-1.5">
          <span className={cn("size-2.5 rounded-[2px] border", TONE_STYLE[t].cell)} />
          {TONE_STYLE[t].label}
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <span className="size-1.5 rounded-full bg-info" /> Customized
      </span>
    </div>
  );
}

/** Customer × environment matrix: the "one product, N installs" view. */
export function InstallGrid({ customers, limit }: { customers: FleetCustomer[]; limit?: number }) {
  const envTypes = ENV_ORDER.filter((t) =>
    customers.some((c) => c.installs.some((i) => i.environmentType === t)),
  );
  const rows = limit ? customers.slice(0, limit) : customers;
  return (
    <table className="w-full border-separate border-spacing-y-1 text-[13px]">
      <thead>
        <tr className="text-left text-xs text-muted-foreground">
          <th className="pb-1 font-medium">Customer</th>
          <th className="hidden pb-1 font-medium md:table-cell">Offering</th>
          {envTypes.map((t) => (
            <th key={t} className="w-20 pb-1 text-center font-medium">
              {ENV_SHORT[t] ?? t}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((c) => (
          <tr key={c.id} className="group">
            <td className="max-w-0 truncate pr-3">
              <Link
                to="/customers/$customerId"
                params={{ customerId: c.id }}
                className="font-medium hover:underline"
              >
                {c.name}
              </Link>
            </td>
            <td className="hidden max-w-0 truncate pr-3 text-muted-foreground md:table-cell">
              {c.installs[0]?.offeringName ?? "—"}
            </td>
            {envTypes.map((t) => (
              <td key={t} className="px-0.5">
                <VersionCell install={c.installs.find((i) => i.environmentType === t)} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Stacked distribution of production installs by release, colored by release standing. */
export function ReleaseAdoption({ installs }: { installs: Install[] }) {
  const live = installs.filter((i) => i.actual);
  const groups = Object.values(
    live.reduce<Record<string, { version: string; tone: Install["tone"]; n: number }>>((acc, i) => {
      const v = i.actual as string;
      acc[v] = acc[v] ?? { version: v, tone: i.tone, n: 0 };
      acc[v].n += 1;
      return acc;
    }, {}),
  ).sort((a, b) => semverCompare(b.version, a.version));
  const bar: Record<string, string> = {
    preferred: "bg-success",
    supported: "bg-warning",
    deprecated: "bg-danger",
    draft: "bg-muted-foreground",
    none: "bg-muted",
  };

  return (
    <div>
      <div className="flex h-2 overflow-hidden rounded-full bg-muted">
        {groups.map((g) => (
          <span
            key={g.version}
            className={bar[g.tone]}
            style={{ width: `${(g.n / Math.max(live.length, 1)) * 100}%` }}
          />
        ))}
      </div>
      <ul className="mt-3 grid gap-x-6 gap-y-1.5 text-[13px] sm:grid-cols-2">
        {groups.map((g) => (
          <li key={g.version} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <span className={cn("size-2 rounded-full", bar[g.tone])} />
              <span className="mono-num">v{g.version}</span>
              <span className="text-xs text-muted-foreground">{TONE_STYLE[g.tone].label}</span>
            </span>
            <span className="mono-num text-muted-foreground">{g.n}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const STAGE_DOT: Record<Stage, string> = {
  awaiting_access: "bg-muted-foreground",
  ready_to_plan: "bg-info",
  blocked: "bg-danger",
  awaiting_approval: "bg-warning",
  deploying: "bg-info",
  live: "bg-success",
};

export function StageBadge({ stage }: { stage: Stage }) {
  const s = STAGES.find((x) => x.id === stage);
  return (
    <span className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap text-foreground">
      <span className={cn("size-1.5 rounded-full", STAGE_DOT[stage])} />
      {s?.label}
    </span>
  );
}

/** Onboarding pipeline across every customer that is not live yet. */
export function OnboardingPipeline({ customers }: { customers: FleetCustomer[] }) {
  const stages = STAGES.filter((s) => s.id !== "live");
  const liveCount = customers.filter((c) => c.stage === "live").length;
  return (
    <div className="grid gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-3 xl:grid-cols-6">
      {stages.map((s) => {
        const inStage = customers.filter((c) => c.stage === s.id);
        return (
          <div key={s.id} className="flex min-h-36 flex-col bg-card p-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="flex items-center gap-1.5 text-xs font-medium">
                <span className={cn("size-1.5 rounded-full", STAGE_DOT[s.id])} />
                {s.label}
              </span>
              <span className="mono-num text-lg leading-none font-semibold">{inStage.length}</span>
            </div>
            <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{s.hint}</p>
            <ul className="mt-2 space-y-1">
              {inStage.slice(0, 4).map((c) => (
                <li key={c.id} className="truncate text-[13px]">
                  <Link
                    to="/customers/$customerId"
                    params={{ customerId: c.id }}
                    className="hover:underline"
                  >
                    {c.name}
                  </Link>
                </li>
              ))}
              {inStage.length > 4 && (
                <li className="text-xs text-muted-foreground">+{inStage.length - 4} more</li>
              )}
            </ul>
          </div>
        );
      })}
      <div className="flex min-h-36 flex-col bg-card p-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="flex items-center gap-1.5 text-xs font-medium">
            <span className="size-1.5 rounded-full bg-success" />
            Live
          </span>
          <span className="mono-num text-lg leading-none font-semibold text-success">
            {liveCount}
          </span>
        </div>
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
          Running your product in their Azure
        </p>
        <Link to="/estate" className="mt-auto text-xs font-medium text-primary hover:underline">
          Installed base →
        </Link>
      </div>
    </div>
  );
}
