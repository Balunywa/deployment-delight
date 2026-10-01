/*
 * The landing zone at a glance: what it is, what it costs, how long it takes to deploy, whether it follows
 * Microsoft's guidance, whether its traffic works, how resilient it is — and everything that needs attention,
 * each with a one-click fix. The one screen none of the native setup tools has.
 */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  CircleDashed,
  Clock,
  DollarSign,
  Network,
  Rocket,
  ShieldCheck,
  Waypoints,
  XCircle,
} from "lucide-react";
import { type ReactNode, useMemo } from "react";

import { Button } from "@/components/ui/button";
import { accessChecks, checkSummary } from "@/lib/alz/access-checks";
import { deployMinutes, estimateCost, FALLBACK_PRICES, money } from "@/lib/alz/cost";
import {
  type AlzLibrary,
  type Answers,
  LATEST_REF,
  type MgNode,
  hasFirewall,
  hasHub,
  on,
  platformResources,
  shortRef,
} from "@/lib/alz/engine";
import { simulateAll, topology } from "@/lib/alz/routing";
import { type SceneExtra, type Spoke } from "@/lib/alz/scene";
import { getPlatformPrices } from "@/lib/prices.functions";
import { AZURE_REGIONS } from "@/lib/regions";
import { cn } from "@/lib/utils";

export type OverviewGo = "design" | "traffic" | "governance" | "deploy" | "code" | "assessment";

type Item = {
  id: string;
  severity: "fail" | "warn" | "info";
  area:
    | "Deploy"
    | "Access"
    | "Identity"
    | "Policy"
    | "Tenant root"
    | "Traffic"
    | "Resilience"
    | "Version";
  title: string;
  detail: string;
  fix?: { label: string; patch: Partial<Answers> } | undefined;
  go?: { label: string; view: OverviewGo; flow?: string } | undefined;
};

export function LandingZoneOverview({
  lib,
  tree,
  answers,
  deployed,
  status,
  libraryRef,
  dirty,
  unsaved,
  pending,
  assessed,
  spokes,
  extras,
  placedCount,
  set,
  go,
  onSave,
}: {
  lib: AlzLibrary;
  tree: MgNode[];
  answers: Answers;
  deployed: Answers | null;
  status: string;
  libraryRef: string;
  dirty: boolean;
  unsaved: number;
  pending: number;
  assessed: number | null;
  spokes: Spoke[];
  extras: SceneExtra[];
  placedCount: number;
  set?: ((p: Partial<Answers>) => void) | undefined;
  go: (view: OverviewGo, flow?: string) => void;
  onSave?: (() => void) | undefined;
}) {
  const getPrices = useServerFn(getPlatformPrices);
  const prices = useQuery({
    queryKey: ["prices", answers.primaryRegion],
    queryFn: () => getPrices({ data: { region: answers.primaryRegion } }),
    staleTime: 6 * 60 * 60 * 1000,
  });
  const p = prices.data ?? FALLBACK_PRICES;
  const cost = useMemo(() => estimateCost(answers, p), [answers, p]);
  const before = useMemo(() => (deployed ? estimateCost(deployed, p).total : null), [deployed, p]);
  const checks = useMemo(() => accessChecks(answers, tree), [answers, tree]);
  const score = checkSummary(checks);
  const flows = useMemo(() => {
    const t = topology(answers, { spokes, extras });
    return simulateAll(t, answers, true).filter((f) => f.available);
  }, [answers, spokes, extras]);
  const byScenario = new Map<string, (typeof flows)[number]>();
  for (const f of flows) {
    const cur = byScenario.get(f.scenario);
    // The worst result per kind of traffic speaks for it.
    const rank = (s: string) =>
      ["broken", "uninspected", "needs-rules", "isolated", "reaches"].indexOf(s);
    if (!cur || rank(f.verdict.status) < rank(cur.verdict.status)) byScenario.set(f.scenario, f);
  }
  const scenarios = [...byScenario.values()];
  const working = scenarios.filter(
    (s) =>
      s.verdict.status === "reaches" ||
      s.verdict.status === "isolated" ||
      s.verdict.status === "needs-rules",
  ).length;
  const minutes = deployMinutes(answers);
  const hub = hasHub(answers);
  const second =
    hub && !!answers.secondaryRegion && answers.secondaryRegion !== answers.primaryRegion;
  const nextRegion =
    AZURE_REGIONS.find(
      (r) =>
        r.name !== answers.primaryRegion &&
        r.geo === AZURE_REGIONS.find((x) => x.name === answers.primaryRegion)?.geo,
    )?.name ?? "centralus";

  /* Everything that needs attention, worst first. */
  const items: Item[] = [];
  if (dirty)
    items.push({
      id: "unsaved",
      severity: "info",
      area: "Deploy",
      title: `${unsaved} unsaved change${unsaved === 1 ? "" : "s"} in the design`,
      detail: "Save them to see the review and the plan.",
    });
  else if (status !== "deployed" || pending)
    items.push({
      id: "deploy",
      severity: "info",
      area: "Deploy",
      title:
        status === "draft"
          ? "Not deployed yet"
          : `${pending} change${pending === 1 ? "" : "s"} waiting to deploy`,
      detail: `Review the changes, run a plan, then apply. About ${minutes} minutes.`,
      go: { label: "Review and deploy", view: "deploy" },
    });
  if (libraryRef !== LATEST_REF)
    items.push({
      id: "version",
      severity: "info",
      area: "Version",
      title: `ALZ ${shortRef(LATEST_REF)} is available`,
      detail: `You're on ${shortRef(libraryRef)}. See exactly what changes in your tenant before you upgrade.`,
      go: { label: "Compare versions", view: "code" },
    });
  for (const c of checks)
    if (c.status === "fail" || c.status === "warn")
      items.push({
        id: `check:${c.id}`,
        severity: c.status,
        area: c.area,
        title: c.title,
        detail: c.detail,
        fix: c.fix,
        go: c.fix ? undefined : { label: "Open governance", view: "governance" },
      });
  for (const s of scenarios)
    if (s.verdict.status === "broken" || s.verdict.status === "uninspected") {
      const gap = [...s.forward, ...s.back].find((h) => h.gap)?.gap;
      items.push({
        id: `traffic:${s.scenario}`,
        severity: s.verdict.status === "broken" ? "fail" : "warn",
        area: "Traffic",
        title: `${s.title}: ${s.verdict.status === "broken" ? "doesn't work" : "uninspected"}`,
        detail: s.verdict.text,
        fix: gap?.fix,
        go: { label: "Follow the packet", view: "traffic", flow: s.scenario },
      });
    }
  if (hub && on(answers.expressRoute) && !on(answers.vpnGateway))
    items.push({
      id: "er-backup",
      severity: "warn",
      area: "Resilience",
      title: "No backup path for ExpressRoute",
      detail:
        "If the circuit fails, on-premises is cut off. A site-to-site VPN is Microsoft's recommended failover.",
      fix: { label: "Add a VPN gateway", patch: { vpnGateway: "yes" } },
    });
  if (hub && !second)
    items.push({
      id: "dr",
      severity: "info",
      area: "Resilience",
      title: "Everything is in one region",
      detail:
        "Zone failures are covered; a regional outage isn't. Disaster recovery needs a hub in a second region.",
      fix: { label: `Add a hub in ${nextRegion}`, patch: { secondaryRegion: nextRegion } },
    });
  const rank = { fail: 0, warn: 1, info: 2 } as const;
  items.sort((x, y) => rank[x.severity] - rank[y.severity]);
  const fixable = items.filter((i) => i.fix);

  const statusText = dirty
    ? "Unsaved changes"
    : status === "deployed"
      ? pending
        ? "Changes to deploy"
        : "Deployed"
      : status === "draft"
        ? "Not deployed yet"
        : "Changes to deploy";
  const resilience = !hub
    ? "No network"
    : second
      ? "Zone-redundant · 2 regions"
      : "Zone-redundant · 1 region";
  const res = platformResources(answers);
  const subs =
    1 + (hub ? 1 : 0) + (on(answers.identity) ? 1 : 0) + (on(answers.securitySubscription) ? 1 : 0);
  const policies = tree.reduce((n, m) => n + m.enforced, 0);

  return (
    <div className="space-y-4">
      {/* The numbers that matter */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        <Kpi
          icon={Rocket}
          label="Status"
          value={statusText}
          tone={dirty || status !== "deployed" || pending ? "warn" : "ok"}
          sub={`ALZ ${shortRef(libraryRef)}${libraryRef !== LATEST_REF ? ` · ${shortRef(LATEST_REF)} available` : " · latest"}`}
          onClick={() => go("deploy")}
        />
        <Kpi
          icon={DollarSign}
          label="Platform cost"
          value={`${money(cost.total)}/mo`}
          sub={
            before !== null && before !== cost.total
              ? `${cost.total > before ? "+" : "−"}${money(Math.abs(cost.total - before))}/mo vs deployed`
              : `${p.live ? "Live" : "List"} prices · ${answers.primaryRegion} · plus usage`
          }
          onClick={() => document.getElementById("cost")?.scrollIntoView({ behavior: "smooth" })}
        />
        <Kpi
          icon={Clock}
          label="First deployment"
          value={`about ${minutes} min`}
          sub={
            hub
              ? on(answers.vpnGateway) || on(answers.expressRoute)
                ? "Gateways take the longest"
                : "Hub and firewall"
              : "Management groups and policy"
          }
        />
        <Kpi
          icon={ShieldCheck}
          label="Microsoft best practices"
          value={`${score.passed} of ${score.scored}`}
          tone={score.fix ? "warn" : "ok"}
          sub={
            score.fix
              ? `${score.fix} to fix · ${score.confirm} to confirm`
              : `${score.confirm} to confirm in the tenant`
          }
          onClick={() => go("governance")}
        />
        <Kpi
          icon={Waypoints}
          label="Traffic"
          value={`${working} of ${scenarios.length} paths work`}
          tone={working < scenarios.length ? "warn" : "ok"}
          sub={`${flows.length} paths across ${new Set(flows.map((f) => f.spoke)).size} spokes`}
          onClick={() => go("traffic")}
        />
        <Kpi
          icon={Network}
          label="Resilience"
          value={resilience}
          tone={second ? "ok" : "neutral"}
          sub={
            hub
              ? on(answers.expressRoute)
                ? on(answers.vpnGateway)
                  ? "ExpressRoute with VPN backup"
                  : "ExpressRoute, no backup"
                : on(answers.vpnGateway)
                  ? "VPN active-active"
                  : "No on-premises link"
              : "—"
          }
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        {/* What needs attention */}
        <section
          className="rounded-md border border-border bg-card"
          aria-label="Needs your attention"
        >
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
            <div>
              <h2 className="text-[14px] font-semibold">Needs your attention</h2>
              <p className="text-[12px] text-muted-foreground">
                From Microsoft's guidance, the traffic simulation and the deployment state. Fixes
                change the design; nothing touches Azure until you deploy.
              </p>
            </div>
            {set && fixable.length > 1 && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  // Design fixes first, then access fixes one at a time — each is computed from the design it's
                  // applied to, so they don't overwrite each other.
                  let a: Answers = { ...answers };
                  for (const i of fixable.filter((x) => !x.id.startsWith("check:")))
                    a = { ...a, ...i.fix!.patch };
                  const done = new Set<string>();
                  for (let k = 0; k < 20; k++) {
                    const n = accessChecks(a, tree).find(
                      (c) =>
                        c.fix && (c.status === "warn" || c.status === "fail") && !done.has(c.id),
                    );
                    if (!n?.fix) break;
                    done.add(n.id);
                    a = { ...a, ...n.fix.patch };
                  }
                  set(a);
                }}
              >
                Apply all {fixable.length} fixes
              </Button>
            )}
          </header>
          {items.length === 0 ? (
            <p className="flex items-center gap-2 px-4 py-6 text-[13px] text-success">
              <CheckCircle2 className="size-5" /> Nothing needs attention. Deployed, on the latest
              ALZ, following Microsoft's guidance.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {items.map((i) => (
                <li
                  key={i.id}
                  className="flex items-start gap-3 px-4 py-3"
                  data-severity={i.severity}
                >
                  {i.severity === "fail" ? (
                    <XCircle className="mt-0.5 size-4 shrink-0 text-[#a4262c]" />
                  ) : i.severity === "warn" ? (
                    <CircleAlert className="mt-0.5 size-4 shrink-0 text-[#c19c00]" />
                  ) : (
                    <CircleDashed className="mt-0.5 size-4 shrink-0 text-[#0f6cbd]" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium">
                      <span className="mr-1.5 rounded bg-muted px-1.5 py-px text-[10.5px] font-semibold text-muted-foreground">
                        {i.area}
                      </span>
                      {i.title}
                    </p>
                    <p className="mt-0.5 text-[12px] text-muted-foreground">{i.detail}</p>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    {i.id === "unsaved" && onSave && (
                      <Button size="sm" onClick={onSave}>
                        Save &amp; review
                      </Button>
                    )}
                    {i.fix && set && (
                      <Button size="sm" variant="outline" onClick={() => set(i.fix!.patch)}>
                        {i.fix.label}
                      </Button>
                    )}
                    {i.go && (
                      <Button size="sm" variant="ghost" onClick={() => go(i.go!.view, i.go!.flow)}>
                        {i.go.label} <ArrowRight className="size-3.5" />
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="space-y-4">
          {/* Setup checklist */}
          <section className="rounded-md border border-border bg-card" aria-label="Setup">
            <h2 className="border-b border-border px-4 py-3 text-[14px] font-semibold">Setup</h2>
            <ol className="space-y-0.5 p-2">
              <Step
                n={1}
                done={assessed !== null}
                title="Assess an existing tenant"
                sub={
                  assessed !== null
                    ? `${assessed}% aligned with the standard`
                    : "Optional — start from what's already there"
                }
                onClick={() => go("assessment")}
              />
              <Step
                n={2}
                done={!dirty}
                title="Design"
                sub={
                  dirty
                    ? `${unsaved} unsaved change${unsaved === 1 ? "" : "s"}`
                    : "Saved · editable any time, never one-shot"
                }
                onClick={() => go("design")}
              />
              <Step
                n={3}
                done={status === "deployed" && !pending && !dirty}
                title="Review, plan and deploy"
                sub={
                  status === "deployed"
                    ? pending
                      ? `${pending} changes to deploy`
                      : "Matches Azure"
                    : `About ${minutes} minutes · a Terraform plan before anything changes`
                }
                onClick={() => go("deploy")}
              />
              <Step
                n={4}
                done={libraryRef === LATEST_REF}
                title="Stay current"
                sub={
                  libraryRef === LATEST_REF
                    ? `On the latest ALZ (${shortRef(LATEST_REF)})`
                    : `Upgrade to ${shortRef(LATEST_REF)} with a preview`
                }
                onClick={() => go("code")}
              />
            </ol>
          </section>
          {/* What it builds */}
          <section
            className="rounded-md border border-border bg-card p-4"
            aria-label="What it builds"
          >
            <h2 className="mb-2 text-[14px] font-semibold">What this builds</h2>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12.5px]">
              <Fact label="Management groups" value={tree.length} />
              <Fact label="Platform subscriptions" value={subs} />
              <Fact label="Policy assignments" value={policies} />
              <Fact label="Platform resources" value={res.length} />
              <Fact label="Customer installs placed" value={placedCount} />
              <Fact label="Hubs" value={hub ? (second ? 2 : 1) : 0} />
            </dl>
          </section>
        </div>
      </div>

      {/* Cost breakdown */}
      <section
        id="cost"
        className="rounded-md border border-border bg-card"
        aria-label="Monthly cost"
      >
        <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-4 py-3">
          <div>
            <h2 className="text-[14px] font-semibold">What the platform costs each month</h2>
            <p className="text-[12px] text-muted-foreground">
              Pay-as-you-go retail prices for {answers.primaryRegion}
              {p.live
                ? `, live from the Azure Retail Prices API (${p.asOf})`
                : ` (list prices from ${p.asOf}; live prices unavailable)`}
              . Only what this landing zone deploys — customer installs are costed per offering.
            </p>
          </div>
          <p className="text-[20px] font-semibold">
            {money(cost.total)}
            <span className="text-[12px] font-normal text-muted-foreground"> / month + usage</span>
          </p>
        </header>
        <table className="w-full text-[12.5px]">
          <tbody className="divide-y divide-border">
            {cost.lines.map((l) => (
              <tr key={l.what}>
                <td className="px-4 py-2 font-medium">{l.what}</td>
                <td className="px-4 py-2 text-muted-foreground">{l.detail}</td>
                <td className="px-4 py-2 text-right font-mono">{money(l.monthly)}</td>
              </tr>
            ))}
            {!cost.lines.length && (
              <tr>
                <td className="px-4 py-3 text-muted-foreground" colSpan={3}>
                  No hourly-billed platform resources — management groups and policy are free.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="border-t border-border px-4 py-2 text-[11.5px] text-muted-foreground">
          <b className="text-foreground">Plus usage:</b>{" "}
          {cost.usage.map((u) => `${u.what} (${u.rate})`).join(" · ")}
        </div>
      </section>
    </div>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  sub,
  tone = "neutral",
  onClick,
}: {
  icon: typeof Rocket;
  label: string;
  value: ReactNode;
  sub: string;
  tone?: "ok" | "warn" | "neutral";
  onClick?: () => void;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      className={cn(
        "rounded-md border border-border bg-card p-3 text-left transition-colors",
        onClick && "hover:border-primary/60",
        tone === "warn" && "border-l-[3px] border-l-[#c19c00]",
        tone === "ok" && "border-l-[3px] border-l-[#107c10]",
      )}
    >
      <p className="flex items-center gap-1.5 text-[11.5px] font-medium text-muted-foreground">
        <Icon className="size-3.5" /> {label}
      </p>
      <p className="mt-1 text-[17px] leading-tight font-semibold">{value}</p>
      <p className="mt-0.5 truncate text-[11px] text-muted-foreground" title={sub}>
        {sub}
      </p>
    </Tag>
  );
}

function Step({
  n,
  done,
  title,
  sub,
  onClick,
}: {
  n: number;
  done: boolean;
  title: string;
  sub: string;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        onClick={onClick}
        className="flex w-full items-start gap-3 rounded-md px-2 py-2 text-left hover:bg-muted/50"
      >
        {done ? (
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" />
        ) : (
          <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border-2 border-primary text-[11px] font-bold text-primary">
            {n}
          </span>
        )}
        <span className="min-w-0">
          <span className="block text-[13px] font-medium">{title}</span>
          <span className="block text-[11.5px] text-muted-foreground">{sub}</span>
        </span>
      </button>
    </li>
  );
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="text-[16px] font-semibold">{value}</dd>
    </div>
  );
}

/** The go/no-go summary next to the review: what it costs, how long it takes, what's still open. */
export function BeforeYouDeploy({
  tree,
  answers,
  deployed,
  spokes,
  extras,
  go,
}: {
  tree: MgNode[];
  answers: Answers;
  deployed: Answers | null;
  spokes: Spoke[];
  extras: SceneExtra[];
  go: (view: OverviewGo, flow?: string) => void;
}) {
  const getPrices = useServerFn(getPlatformPrices);
  const prices = useQuery({
    queryKey: ["prices", answers.primaryRegion],
    queryFn: () => getPrices({ data: { region: answers.primaryRegion } }),
    staleTime: 6 * 60 * 60 * 1000,
  });
  const p = prices.data ?? FALLBACK_PRICES;
  const now = estimateCost(answers, p).total;
  const was = deployed ? estimateCost(deployed, p).total : 0;
  const score = checkSummary(accessChecks(answers, tree));
  const flows = useMemo(
    () =>
      simulateAll(topology(answers, { spokes, extras }), answers, true).filter((f) => f.available),
    [answers, spokes, extras],
  );
  const broken = new Set(flows.filter((f) => f.verdict.status === "broken").map((f) => f.scenario))
    .size;
  const row = (icon: ReactNode, label: string, value: ReactNode, action?: ReactNode) => (
    <li className="flex items-start gap-2.5 py-2">
      {icon}
      <div className="min-w-0 flex-1">
        <p className="text-[11.5px] text-muted-foreground">{label}</p>
        <p className="text-[13.5px] font-semibold">{value}</p>
      </div>
      {action}
    </li>
  );
  return (
    <section className="rounded-md border border-border bg-card p-4" aria-label="Before you deploy">
      <h2 className="text-[14px] font-semibold">Before you deploy</h2>
      <ul className="mt-1 divide-y divide-border">
        {row(
          <DollarSign className="mt-0.5 size-4 text-muted-foreground" />,
          "Monthly platform cost",
          <>
            {money(now)}
            {deployed && now !== was && (
              <span
                className={cn("ml-1.5 text-[12px]", now > was ? "text-[#8a6100]" : "text-success")}
              >
                ({now > was ? "+" : "−"}
                {money(Math.abs(now - was))})
              </span>
            )}
          </>,
        )}
        {row(
          <Clock className="mt-0.5 size-4 text-muted-foreground" />,
          "Deployment time",
          deployed ? "Minutes for most changes" : `About ${deployMinutes(answers)} minutes`,
        )}
        {row(
          <ShieldCheck className="mt-0.5 size-4 text-muted-foreground" />,
          "Microsoft best practices",
          `${score.passed} of ${score.scored} pass`,
          score.fix > 0 && (
            <Button size="sm" variant="ghost" onClick={() => go("governance")}>
              {score.fix} to fix
            </Button>
          ),
        )}
        {row(
          <Waypoints className="mt-0.5 size-4 text-muted-foreground" />,
          "Traffic",
          broken ? `${broken} path${broken === 1 ? "" : "s"} won't work` : "Every path works",
          broken > 0 && (
            <Button size="sm" variant="ghost" onClick={() => go("traffic")}>
              See why
            </Button>
          ),
        )}
      </ul>
      <p className="mt-2 text-[11.5px] text-muted-foreground">
        Nothing changes in Azure until you apply a plan — and the design stays editable after you
        deploy.
      </p>
    </section>
  );
}
