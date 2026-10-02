/*
 * The IP plan: every address range the design uses, laid out so overlaps and wasted space are visible. Hub layouts
 * come from ipplan.ts, which reproduces how the pinned AVM modules carve the hub address space, so what's shown
 * here is what Terraform will create.
 */
import { CircleAlert, Info, Plus, TriangleAlert, X } from "lucide-react";
import { useState } from "react";

import { Pill } from "@/components/Primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AlzLibrary, Answers } from "@/lib/alz/engine";
import {
  type HubUtilization,
  checkIpPlan,
  cidrOverlaps,
  ipPlan,
  parseCidr,
} from "@/lib/alz/ipplan";
import { cn } from "@/lib/utils";

/** Customer install spokes come from the offering's network; this is the offerings' default range. */
const INSTALL_RANGE = "10.60.0.0/19";

const SLICE = [
  "bg-[oklch(0.62_0.15_250)]",
  "bg-[oklch(0.62_0.17_25)]",
  "bg-[oklch(0.7_0.12_25)]",
  "bg-[oklch(0.65_0.14_150)]",
  "bg-[oklch(0.62_0.15_300)]",
  "bg-[oklch(0.7_0.13_80)]",
];

const issueIcon = { error: CircleAlert, warning: TriangleAlert, info: Info } as const;

export function IpPlanPanel({
  answers,
  lib,
  set,
}: {
  answers: Answers;
  lib: AlzLibrary;
  set?: ((patch: Partial<Answers>) => void) | undefined;
}) {
  const plan = ipPlan(answers, lib);
  const issues = checkIpPlan(answers, lib);
  const spokes = plan.blocks.filter((b) => b.kind === "spoke");
  const installClash = [
    ...plan.hubs.map((h) => ({ label: h.label, cidr: h.cidr })),
    ...answers.onPremRanges.map((c) => ({ label: "On-premises", cidr: c })),
  ].filter((r) => parseCidr(r.cidr).ok && cidrOverlaps(r.cidr, INSTALL_RANGE));
  const hasHub = answers.connectivity !== "none";
  const gateway = answers.vpnGateway === "yes" || answers.expressRoute === "yes";

  return (
    <div className="space-y-5">
      {hasHub ? (
        <div className={cn("grid gap-4", answers.secondaryRegion && "md:grid-cols-2")}>
          <RangeField
            label={`Hub address space · ${answers.primaryRegion}`}
            hint={
              answers.connectivity === "virtual_wan"
                ? "Virtual WAN takes two /22s from it: the virtual hub and a sidecar network. /21 or larger."
                : "The hub virtual network is the first /22 of it; keep the rest for growth. /22 or larger."
            }
            value={answers.hubAddressSpace}
            onCommit={set ? (v) => set({ hubAddressSpace: v }) : undefined}
          />
          {answers.secondaryRegion && (
            <RangeField
              label={`Second hub · ${answers.secondaryRegion}`}
              hint="Must not overlap the first hub; the hubs route to each other."
              value={answers.secondaryHubAddressSpace}
              onCommit={set ? (v) => set({ secondaryHubAddressSpace: v }) : undefined}
            />
          )}
        </div>
      ) : (
        <p className="rounded-lg bg-muted/50 px-3.5 py-2.5 text-[12.5px] text-muted-foreground">
          No central network in this design, so there's no hub to plan. Workload networks still
          shouldn't overlap each other or on-premises.
        </p>
      )}

      {plan.hubs.map((h) => (
        <HubMap key={h.id} hub={h} />
      ))}

      <section className="rounded-xl border border-border p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-[13.5px] font-semibold">On-premises ranges</h3>
          <span className="text-[11.5px] text-muted-foreground">
            {gateway
              ? "Reached through the hub gateway."
              : "Reserved now so Azure never overlaps them, even before a gateway exists."}
          </span>
        </div>
        <OnPrem answers={answers} set={set} />
      </section>

      <section className="rounded-xl border border-border p-4">
        <h3 className="text-[13.5px] font-semibold">Workload networks</h3>
        <ul className="mt-2 divide-y divide-border text-[12.5px]">
          <li className="flex flex-wrap items-baseline justify-between gap-2 py-2">
            <span>
              <span className="font-medium">Customer installs</span>
              <span className="block text-[11.5px] text-muted-foreground">
                From each offering's network: {INSTALL_RANGE} by default, one /22 per install.
              </span>
            </span>
            <span className="font-mono">{INSTALL_RANGE}</span>
          </li>
          {spokes.map((s) => (
            <li key={s.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
              <span>
                <span className="font-medium">{s.label}</span>
                <span className="block text-[11.5px] text-muted-foreground">{s.purpose}</span>
              </span>
              <span className="font-mono">{s.cidr}</span>
            </li>
          ))}
          {!spokes.length && (
            <li className="py-2 text-[11.5px] text-muted-foreground">
              Subscriptions you add on the canvas get the next free /24 from 10.100.0.0, skipping
              anything above.
            </li>
          )}
        </ul>
        {installClash.length > 0 && (
          <p className="mt-2 flex gap-2 text-[12px] text-danger">
            <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
            The default install range {INSTALL_RANGE} overlaps{" "}
            {installClash.map((c) => `${c.label} (${c.cidr})`).join(" and ")}. Change that range, or
            set a different network on the offerings.
          </p>
        )}
      </section>

      {issues.length > 0 && (
        <ul className="space-y-2">
          {issues.map((i) => {
            const Icon = issueIcon[i.level];
            return (
              <li
                key={i.text}
                className={cn(
                  "flex flex-wrap items-start justify-between gap-2 rounded-lg border px-3.5 py-2.5 text-[12.5px]",
                  i.level === "error"
                    ? "border-danger/30 bg-danger/[0.05]"
                    : i.level === "warning"
                      ? "border-warning/30 bg-warning/[0.07]"
                      : "border-border bg-muted/40 text-muted-foreground",
                )}
              >
                <span className="flex min-w-0 flex-1 gap-2">
                  <Icon
                    className={cn(
                      "mt-0.5 size-3.5 shrink-0",
                      i.level === "error"
                        ? "text-danger"
                        : i.level === "warning"
                          ? "text-warning"
                          : "",
                    )}
                  />
                  {i.text}
                </span>
                {i.fix && set && (
                  <Button size="sm" variant="outline" className="h-7" onClick={() => set(i.fix!)}>
                    Fix it
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** An address range input that only commits a value when it's a valid CIDR, and says why when it isn't. */
function RangeField({
  label,
  hint,
  value,
  onCommit,
}: {
  label: string;
  hint: string;
  value: string;
  onCommit?: ((v: string) => void) | undefined;
}) {
  const [draft, setDraft] = useState(value);
  const parsed = parseCidr(draft.trim());
  const error = draft.trim() && !parsed.ok ? parsed.error : "";
  return (
    <label className="block">
      <span className="text-[12.5px] font-medium">{label}</span>
      <Input
        className={cn("mt-1.5 font-mono", error && "border-danger")}
        disabled={!onCommit}
        aria-label={label}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          const p = parseCidr(e.target.value.trim());
          if (p.ok && onCommit) onCommit(e.target.value.trim());
        }}
      />
      <span
        className={cn("mt-1 block text-[11.5px]", error ? "text-danger" : "text-muted-foreground")}
      >
        {error
          ? `${error}${!parsed.ok && parsed.aligned ? ` Did you mean ${parsed.aligned}?` : ""}`
          : hint}
      </span>
    </label>
  );
}

function OnPrem({
  answers,
  set,
}: {
  answers: Answers;
  set?: ((patch: Partial<Answers>) => void) | undefined;
}) {
  const [draft, setDraft] = useState("");
  const parsed = parseCidr(draft.trim());
  return (
    <div className="mt-2.5 space-y-2.5">
      <div className="flex flex-wrap gap-1.5">
        {answers.onPremRanges.map((r) => (
          <span
            key={r}
            className="inline-flex items-center gap-1.5 rounded-md border border-warning/40 bg-warning/10 px-2 py-1 font-mono text-[12px]"
          >
            {r}
            {set && (
              <button
                aria-label={`Remove ${r}`}
                onClick={() => set({ onPremRanges: answers.onPremRanges.filter((x) => x !== r) })}
                className="text-muted-foreground hover:text-danger"
              >
                <X className="size-3" />
              </button>
            )}
          </span>
        ))}
        {!answers.onPremRanges.length && (
          <span className="text-[12px] text-muted-foreground">None listed.</span>
        )}
      </div>
      {set && (
        <div className="flex gap-2">
          <Input
            className="h-8 max-w-56 font-mono text-[12.5px]"
            placeholder="e.g. 172.16.0.0/12"
            aria-label="Add an on-premises range"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <Button
            size="sm"
            variant="outline"
            className="h-8"
            disabled={!parsed.ok || answers.onPremRanges.includes(draft.trim())}
            onClick={() => {
              set({ onPremRanges: [...answers.onPremRanges, draft.trim()] });
              setDraft("");
            }}
          >
            <Plus className="size-3.5" /> Add
          </Button>
          {draft.trim() && !parsed.ok && (
            <span className="self-center text-[11.5px] text-danger">
              {parsed.error}
              {parsed.aligned ? ` Did you mean ${parsed.aligned}?` : ""}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** The hub block drawn to scale: each subnet a slice where the module puts it, the rest free. */
function HubMap({ hub }: { hub: HubUtilization }) {
  const block = parseCidr(hub.allocationCidr);
  if (!block.ok) return null;
  const { start, addresses } = block.block;
  const slices = hub.subnets
    .map((s, i) => {
      const p = parseCidr(s.cidr);
      return p.ok
        ? {
            ...s,
            left: ((p.block.start - start) / addresses) * 100,
            width: (p.block.addresses / addresses) * 100,
            color: SLICE[i % SLICE.length]!,
          }
        : null;
    })
    .filter((x): x is NonNullable<typeof x> => !!x);
  return (
    <section className="rounded-xl border border-border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[13.5px] font-semibold">
          {hub.label} <span className="font-normal text-muted-foreground">· {hub.region}</span>
        </h3>
        <span className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <span className="font-mono text-foreground">{hub.allocationCidr}</span> from{" "}
          <span className="font-mono">{hub.cidr}</span>
          <Pill tone={hub.percentUsed > 85 ? "warning" : "neutral"}>
            {Math.round(hub.percentUsed)}% allocated
          </Pill>
        </span>
      </div>
      <div
        role="img"
        aria-label={`Address map of ${hub.allocationCidr}`}
        className="relative mt-3 h-9 overflow-hidden rounded-md border border-border bg-[repeating-linear-gradient(135deg,transparent,transparent_6px,oklch(0.95_0_0)_6px,oklch(0.95_0_0)_12px)]"
      >
        {slices.map((s) => (
          <div
            key={s.key}
            title={`${s.name} ${s.cidr}`}
            className={cn(
              "absolute inset-y-0 border-r border-white/70 text-[10px] leading-9 font-semibold text-white",
              s.color,
            )}
            style={{ left: `${s.left}%`, width: `${s.width}%` }}
          >
            {s.width > 5 && <span className="block truncate px-1">/{s.cidr.split("/")[1]}</span>}
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10.5px] text-muted-foreground">
        <span>{block.block.address}</span>
        <span>{hub.free.toLocaleString()} addresses free in the hub</span>
      </div>
      <ul className="mt-3 grid gap-x-6 gap-y-1.5 text-[12px] md:grid-cols-2">
        {slices.map((s) => (
          <li key={s.key} className="flex items-start gap-2">
            <span className={cn("mt-1 size-2.5 shrink-0 rounded-sm", s.color)} />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-baseline justify-between gap-x-2">
                <span className="font-medium">{s.name}</span>
                <span className="font-mono">{s.cidr}</span>
              </span>
              <span className="block text-[11.5px] text-muted-foreground">
                {s.purpose} {s.usable.toLocaleString()} usable of {s.addresses.toLocaleString()}.
              </span>
            </span>
          </li>
        ))}
      </ul>
      {hub.poolFree > 0 && (
        <p className="mt-3 text-[11.5px] text-muted-foreground">
          {hub.poolFree.toLocaleString()} more addresses in {hub.cidr} stay free for growth.
        </p>
      )}
    </section>
  );
}
