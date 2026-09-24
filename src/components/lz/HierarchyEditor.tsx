/*
 * Editing the hierarchy on the canvas: add management groups (on an ALZ policy set or inherit-only) and
 * subscriptions, with Microsoft's guidance shown where it matters.
 */
import { Lightbulb } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { Answers, CustomArchetype, MgNode } from "@/lib/alz/engine";
import { WORKLOADS } from "@/lib/alz/workloads";
import { cn } from "@/lib/utils";

export type Adding = { kind: "group" | "subscription"; parent: string } | null;

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30) || "group";

const ARCHETYPES: { value: CustomArchetype; label: string; body: string }[] = [
  {
    value: "inherit",
    label: "Inherit only",
    body: "No extra policy — only what its parents assign. Use it to separate access or ownership.",
  },
  {
    value: "corp",
    label: "Corp policy set",
    body: "Connected to the hub; public endpoints and hybrid networking denied.",
  },
  {
    value: "online",
    label: "Online policy set",
    body: "Internet-facing; no extra network restrictions.",
  },
  {
    value: "sandbox",
    label: "Sandbox policy set",
    body: "Isolated experimentation; blocks hub peering and hybrid connectivity.",
  },
  { value: "local", label: "Local policy set", body: "Azure Local clusters and their workloads." },
];

function Bulb({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex gap-1.5 rounded-sm border border-[#f3d27a] bg-[#fff8e1] px-2 py-1.5 text-[11.5px] text-[#5c4400]">
      <Lightbulb className="mt-px size-3.5 shrink-0 text-[#c08b00]" />
      <span>{children}</span>
    </p>
  );
}

function uniqueId(base: string, tree: MgNode[], answers: Answers) {
  const taken = new Set([
    ...tree.map((n) => n.libraryId),
    ...answers.customGroups.map((c) => c.id),
  ]);
  let id = /^[a-z]/.test(base) ? base : `g-${base}`;
  for (let i = 2; taken.has(id); i++) id = `${base}-${i}`;
  return id;
}

export function AddDialog({
  adding,
  onClose,
  tree,
  answers,
  set,
}: {
  adding: Adding;
  onClose: () => void;
  tree: MgNode[];
  answers: Answers;
  set: (p: Partial<Answers>) => void;
}) {
  const [name, setName] = useState("");
  const [parent, setParent] = useState("landingzones");
  const [archetype, setArchetype] = useState<CustomArchetype>("inherit");
  const [workload, setWorkload] = useState("");
  const [env, setEnv] = useState("prod");
  useEffect(() => {
    if (!adding) return;
    setName("");
    setParent(adding.parent);
    setWorkload("");
    const p = tree.find((n) => n.libraryId === adding.parent);
    setArchetype(
      p && ["corp", "online", "local", "sandbox"].includes(p.archetype) ? "inherit" : "corp",
    );
    setEnv(answers.environments.includes("prod") ? "prod" : (answers.environments[0] ?? "prod"));
  }, [adding, tree, answers.environments]);

  const parentNode = tree.find((n) => n.libraryId === parent);
  const depth = (parentNode?.depth ?? 0) + 1;
  const envLike = /\b(prod|production|non-?prod|dev|test|qa|uat|staging|development)\b/i.test(name);
  const groupTargets = tree.filter((n) => !["decommissioned"].includes(n.libraryId));

  const addGroup = () => {
    const id = uniqueId(slug(name), tree, answers);
    set({
      customGroups: [...answers.customGroups, { id, name: name.trim(), parent, archetype }],
      ...(workload ? { workloads: [...answers.workloads, { group: id, id: workload }] } : {}),
    });
    onClose();
  };
  const addEnvironmentSplit = () => {
    const prod = uniqueId(`${parent}-prod`, tree, answers);
    const nonprod = uniqueId(`${parent}-nonprod`, tree, answers);
    set({
      customGroups: [
        ...answers.customGroups,
        { id: prod, name: "Prod", parent, archetype: "inherit" },
        { id: nonprod, name: "Non-prod", parent, archetype: "inherit" },
      ],
    });
    onClose();
  };
  const addSubscription = () => {
    const id = `${parent}-${slug(name)}-${env}`.slice(0, 60);
    set({
      extraSubscriptions: [
        ...answers.extraSubscriptions.filter((x) => x.id !== id),
        { id, name: name.trim(), group: parent, environment: env },
      ],
    });
    onClose();
  };

  return (
    <Dialog open={!!adding} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        {adding?.kind === "group" ? (
          <>
            <DialogHeader>
              <DialogTitle>Add a management group</DialogTitle>
              <DialogDescription>
                A new archetype for workloads whose policy or access must differ — for example a
                confidential Corp, a regulated product, or a workload platform like AKS.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <label className="block text-[12px] font-medium">
                Name
                <Input
                  className="mt-1"
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Confidential, AKS platform, Regulated"
                />
              </label>
              <label className="block text-[12px] font-medium">
                Under
                <select
                  className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-[13px]"
                  value={parent}
                  onChange={(e) => setParent(e.target.value)}
                >
                  {groupTargets.map((n) => (
                    <option key={n.id} value={n.libraryId}>
                      {"· ".repeat(n.depth)}
                      {n.displayName}
                    </option>
                  ))}
                </select>
              </label>
              <div>
                <p className="text-[12px] font-medium">Policy</p>
                <div className="mt-1 grid gap-1.5">
                  {ARCHETYPES.map((a) => (
                    <button
                      key={a.value}
                      onClick={() => setArchetype(a.value)}
                      className={cn(
                        "rounded-md border px-2.5 py-1.5 text-left",
                        archetype === a.value
                          ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                          : "border-border hover:border-border-strong",
                      )}
                    >
                      <span className="block text-[12.5px] font-semibold">{a.label}</span>
                      <span className="block text-[11.5px] text-muted-foreground">{a.body}</span>
                    </button>
                  ))}
                </div>
              </div>
              <label className="block text-[12px] font-medium">
                Workload landing zone (optional)
                <select
                  className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-[13px]"
                  value={workload}
                  onChange={(e) => setWorkload(e.target.value)}
                >
                  <option value="">None</option>
                  {WORKLOADS.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </label>
              {envLike ? (
                <Bulb>
                  <b>Microsoft recommends against this.</b> CAF: "Don't create management groups for
                  production, testing, and development environments." Give each environment its own
                  subscription in the same group instead — that's what the Environments setting
                  does.
                </Bulb>
              ) : (
                <Bulb>
                  Create a group only when policy or access must differ (CAF: tailor the ALZ
                  architecture). Keep the hierarchy to three or four levels.
                </Bulb>
              )}
              {depth > 6 && (
                <p className="text-[12px] text-danger">
                  Azure allows six levels of management groups below the root.
                </p>
              )}
            </div>
            <DialogFooter className="gap-2 sm:justify-between">
              {["corp", "online", "landingzones"].includes(parent) ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={addEnvironmentSplit}
                  title="Adds Prod and Non-prod groups (inherit only)"
                >
                  Split by environment instead (not recommended)
                </Button>
              ) : (
                <span />
              )}
              <Button disabled={!name.trim() || depth > 6} onClick={addGroup}>
                Add group
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Add a subscription</DialogTitle>
              <DialogDescription>
                Customer installs get their subscriptions automatically when they're onboarded — one
                per environment. Add a subscription here for things you run yourself, like shared
                services, CI/CD tooling or a product control plane.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <label className="block text-[12px] font-medium">
                Name
                <Input
                  className="mt-1"
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Shared services, Product control plane"
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-[12px] font-medium">
                  Environment
                  <select
                    className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-[13px]"
                    value={env}
                    onChange={(e) => setEnv(e.target.value)}
                  >
                    {[...new Set([...answers.environments, "shared"])].map((e) => (
                      <option key={e}>{e}</option>
                    ))}
                  </select>
                </label>
                <label className="block text-[12px] font-medium">
                  Management group
                  <select
                    className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-[13px]"
                    value={parent}
                    onChange={(e) => setParent(e.target.value)}
                  >
                    {tree.map((n) => (
                      <option key={n.id} value={n.libraryId}>
                        {"· ".repeat(n.depth)}
                        {n.displayName}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <Bulb>
                CAF: give each environment its own subscription so policy, access and blast radius
                stay separate. The subscription inherits every policy of the group it's placed in.
              </Bulb>
            </div>
            <DialogFooter>
              <Button disabled={!name.trim()} onClick={addSubscription}>
                Add subscription
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
