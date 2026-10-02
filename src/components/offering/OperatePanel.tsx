/*
 * Operate: how each install is run once it's live. Azure SRE Agent is the design's operating partner. The release
 * briefs it with the design, it investigates alerts and checks for drift against that design, and what it learns
 * goes back to the design as issues. Everything here is computed from the design and generated into the release.
 */
import { BookOpen, Download, ExternalLink, FileText, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";

import { ServiceIcon } from "@/components/architecture/ServiceIcon";
import { Button } from "@/components/ui/button";
import type { Architecture } from "@/lib/architecture";
import { SERVICE_BY_ID, withDefaults } from "@/lib/catalog";
import { srePack, sreSettings } from "@/lib/offering/sre-agent";
import { cn } from "@/lib/utils";
import { applyFix, review as reviewWaf } from "@/lib/waf";

import { ServiceWaf } from "./WafReview";
import { WorkloadStory } from "./WorkloadStory";

const SRE_DOCS = "https://learn.microsoft.com/azure/sre-agent";

function save(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function OperatePanel({
  name,
  version,
  arch,
  set,
}: {
  name: string;
  version: string;
  arch: Architecture;
  set: (a: Partial<Architecture>) => void;
}) {
  const current = arch.selected.find((s) => s.id === "sre-agent");
  const add = (agent: string) =>
    set({ selected: [...arch.selected, withDefaults("sre-agent", { agent })] });

  if (!current)
    return (
      <div className="mx-auto max-w-5xl space-y-5 p-4 lg:p-6">
        <section
          aria-label="Operate with Azure SRE Agent"
          className="rounded-2xl border border-border bg-card p-6"
        >
          <div className="flex items-start gap-4">
            <ServiceIcon id="sre-agent" />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold tracking-[0.1em] text-primary uppercase">
                Operate
              </p>
              <h2 className="mt-1 text-[20px] font-semibold tracking-tight">
                Who runs each install once it's live?
              </h2>
              <p className="mt-1.5 max-w-3xl text-[13px] text-muted-foreground">
                Add Azure SRE Agent and every production install gets an agent that already knows
                this design: the flows, the roles, the availability target and the risks you
                accepted. It investigates alerts against that design, checks for drift every
                morning, and sends design-level findings back to you as issues for the next release.
              </p>
            </div>
          </div>
          <ol className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["The release briefs it", "The pipeline uploads the design after every deploy."],
              ["Alerts become investigations", "Azure Monitor alerts reach it with no setup."],
              [
                "Mitigations wait for a person",
                "Review mode: an administrator approves each change.",
              ],
              ["Findings come back to you", "As issues on the offering's repository."],
            ].map(([t, b], i) => (
              <li key={t} className="rounded-xl border border-border bg-background p-3.5">
                <span className="grid size-6 place-items-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                  {i + 1}
                </span>
                <p className="mt-2 text-[13px] font-semibold">{t}</p>
                <p className="mt-0.5 text-[12px] text-muted-foreground">{b}</p>
              </li>
            ))}
          </ol>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Button onClick={() => add("New agent per install")}>Add Azure SRE Agent</Button>
            <Button variant="outline" onClick={() => add("Customer's existing agent")}>
              Use the customer's existing agent
            </Button>
            <a
              href={`${SRE_DOCS}/overview`}
              target="_blank"
              rel="noreferrer"
              className="ml-1 inline-flex items-center gap-1 text-[12.5px] text-primary hover:underline"
            >
              <ExternalLink className="size-3.5" /> What Azure SRE Agent is
            </a>
          </div>
          <p className="mt-3 text-[12px] text-muted-foreground">
            Cost: a new agent has an always-on charge of 4 Azure Agent Units an hour, about $292 a
            month in US regions, from creation until it's deleted, plus usage up to a monthly cap.
            The customer's existing agent adds no always-on charge.
          </p>
        </section>
      </div>
    );

  return <Configured name={name} version={version} arch={arch} set={set} />;
}

function Configured({
  name,
  version,
  arch,
  set,
}: {
  name: string;
  version: string;
  arch: Architecture;
  set: (a: Partial<Architecture>) => void;
}) {
  const sel = arch.selected.find((s) => s.id === "sre-agent")!;
  const def = SERVICE_BY_ID.get("sre-agent")!;
  const o = sreSettings(sel.settings);
  const waf = useMemo(() => reviewWaf(arch), [arch]);
  const pack = useMemo(() => srePack(name, version, arch), [name, version, arch]);
  const [open, setOpen] = useState<string | null>(pack[0]?.path ?? null);
  const file = pack.find((f) => f.path === open);
  const change = (key: string, value: string) =>
    set({
      selected: arch.selected.map((s) =>
        s.id === "sre-agent" ? { ...s, settings: { ...s.settings, [key]: value } } : s,
      ),
    });
  const access = [
    ...(o.existing
      ? []
      : [
          [
            "Monitoring Contributor",
            "the subscription",
            "Acknowledge and close the alerts it investigates.",
          ],
        ]),
    ["Reader", "the install's resource group", "See every resource and its configuration."],
    ["Log Analytics Reader", "the install's resource group", "Query the install's logs."],
    ["Monitoring Reader", "the install's resource group", "Read metrics and alerts."],
    ...(o.high
      ? [
          [
            "Contributor",
            "the install's resource group",
            "Make approved changes with its own identity.",
          ],
        ]
      : []),
  ] as const;
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");

  return (
    <div className="grid items-start gap-5 p-4 lg:grid-cols-[360px_minmax(0,1fr)] lg:p-6">
      <div className="space-y-4 lg:sticky lg:top-4">
        <section
          aria-label="SRE Agent settings"
          className="rounded-xl border border-border bg-card p-4"
        >
          <div className="flex items-center gap-2.5">
            <ServiceIcon id="sre-agent" size="sm" />
            <p className="text-[14px] font-semibold">Azure SRE Agent</p>
          </div>
          <div className="mt-3 space-y-3">
            {def.options.map((opt) => (
              <div key={opt.key}>
                <p className="text-[11.5px] font-medium text-muted-foreground">{opt.label}</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {opt.choices.map((c) => (
                    <button
                      key={c}
                      onClick={() => change(opt.key, c)}
                      aria-pressed={sel.settings[opt.key] === c}
                      className={cn(
                        "rounded-md border px-2 py-1 text-[12px]",
                        sel.settings[opt.key] === c
                          ? "border-primary bg-primary/[0.07] font-medium text-primary"
                          : "border-border text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {c}
                    </button>
                  ))}
                </div>
                {opt.notes?.[sel.settings[opt.key] ?? ""] && (
                  <p className="mt-1 text-[11.5px] leading-snug text-muted-foreground">
                    {opt.notes[sel.settings[opt.key]!]}
                  </p>
                )}
              </div>
            ))}
          </div>
          <p className="mt-4 border-t border-border pt-3 text-[12px]">
            {o.existing ? (
              "No new always-on charge: the customer's agent covers this install too."
            ) : (
              <>
                About <b>$292 a month</b> per production install, always on, plus usage up to{" "}
                {sel.settings["usageCap"] ?? "1,000 AAU"} (${(o.cap / 10).toLocaleString()} at
                $0.10/AAU).
                {o.devAgent ? " Dev/test installs get one too." : " None on dev/test installs."}
              </>
            )}
          </p>
        </section>

        <section
          aria-label="What it can do on each install"
          className="rounded-xl border border-border bg-card p-4"
        >
          <p className="flex items-center gap-1.5 text-[13px] font-semibold">
            <ShieldCheck className="size-4 text-primary" /> What it can do on each install
          </p>
          <ul className="mt-2 space-y-1.5 text-[12px]">
            {access.map(([role, scope, why]) => (
              <li key={role}>
                <span className="font-medium">{role}</span>{" "}
                <span className="text-muted-foreground">
                  on {scope}. {why}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11.5px] text-muted-foreground">
            {o.existing
              ? "Onboarding asks each customer for their agent and its identity."
              : "Onboarding asks each customer for the Entra group made SRE Agent Administrator, the people who approve its actions."}
          </p>
        </section>

        <ServiceWaf
          service="sre-agent"
          review={waf}
          onFix={(f) => f.fix && set(applyFix(arch, f.fix, f.service))}
        />
        <Button
          variant="ghost"
          size="sm"
          className="w-full text-muted-foreground"
          onClick={() => set({ selected: arch.selected.filter((s) => s.id !== "sre-agent") })}
        >
          Remove SRE Agent from the design
        </Button>
      </div>

      <div className="min-w-0 space-y-5">
        <section aria-label="How it operates the install" className="space-y-2">
          <h2 className="text-[15px] font-semibold">How it operates each install</h2>
          <p className="text-[12.5px] text-muted-foreground">
            Computed from the design and these settings. Step through it, or download it for the
            design review.
          </p>
          <WorkloadStory arch={arch} lens="operate" />
        </section>

        <section aria-label="What it knows" className="rounded-xl border border-border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
            <div>
              <h2 className="flex items-center gap-1.5 text-[14px] font-semibold">
                <BookOpen className="size-4 text-primary" /> What it knows about this design
              </h2>
              <p className="text-[12px] text-muted-foreground">
                Generated into the release under <code className="font-mono">sre-agent/</code>. The
                pipeline uploads it after every deploy, so the agent is always briefed on the
                release that's running.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                save(
                  pack.map((f) => `# ===== ${f.path} =====\n${f.content}`).join("\n\n"),
                  `${slug}-sre-agent-pack.txt`,
                )
              }
            >
              <Download className="size-3.5" /> Download the pack
            </Button>
          </div>
          <div className="grid md:grid-cols-[260px_minmax(0,1fr)]">
            <ul className="border-b border-border p-2 md:border-r md:border-b-0">
              {pack.map((f) => (
                <li key={f.path}>
                  <button
                    onClick={() => setOpen(f.path)}
                    aria-current={open === f.path ? "true" : undefined}
                    className={cn(
                      "w-full rounded-md px-2.5 py-2 text-left",
                      open === f.path ? "bg-primary/[0.07]" : "hover:bg-muted/60",
                    )}
                  >
                    <span className="flex items-center gap-1.5 font-mono text-[11.5px]">
                      <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                      {f.path.replace("sre-agent/", "")}
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                      {f.purpose}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <pre className="max-h-[520px] min-w-0 overflow-auto p-4 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap">
              {file?.content}
            </pre>
          </div>
        </section>

        <section
          aria-label="Not automated yet"
          className="rounded-xl border border-dashed border-border p-4 text-[12.5px]"
        >
          <p className="font-semibold">Not automated yet</p>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-muted-foreground">
            <li>
              The GitHub connector: point it at the offering's repository in the agent so findings
              become issues. Terraform can't set connectors today.
            </li>
            <li>
              PagerDuty or ServiceNow instead of Azure Monitor alerts: connect it in the agent; only
              one incident platform is active at a time.
            </li>
            <li>
              Reading the agent's investigations back into Cloud Delivery. Its data-plane API is in
              preview and needs SRE Agent Reader on each customer's agent.
            </li>
          </ul>
          <a
            href="https://sre.azure.com"
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-primary hover:underline"
          >
            <ExternalLink className="size-3.5" /> Open the SRE Agent portal
          </a>
        </section>
      </div>
    </div>
  );
}
