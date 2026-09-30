/*
 * Give a team a role, or assign a policy, right where it applies — and see straight away whether it follows
 * Microsoft's guidance. The checks run on the design as it would be after the change.
 */
import { CheckCircle2, CircleAlert, ExternalLink, Wand2, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { accessChecks } from "@/lib/alz/access-checks";
import type { Answers, MgNode } from "@/lib/alz/engine";
import { ALZ_ROLES, BUILTIN_ROLES, PERSONAS, POLICY_OPTIONS } from "@/lib/alz/governance";
import { cn } from "@/lib/utils";

export type Govern = { kind: "access" | "policy"; scope: string } | null;

export function GovernDialog({
  govern,
  onClose,
  tree,
  answers,
  set,
}: {
  govern: Govern;
  onClose: () => void;
  tree: MgNode[];
  answers: Answers;
  set: (p: Partial<Answers>) => void;
}) {
  const name = (id: string) => tree.find((n) => n.libraryId === id)?.displayName ?? id;
  const scope = govern?.scope ?? "";
  return (
    <Dialog open={!!govern} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        {govern?.kind === "access" && (
          <AccessForm
            scope={scope}
            name={name}
            tree={tree}
            answers={answers}
            set={set}
            onClose={onClose}
          />
        )}
        {govern?.kind === "policy" && (
          <PolicyForm scope={scope} name={name} answers={answers} set={set} onClose={onClose} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function AccessForm({
  scope: initialScope,
  name,
  tree,
  answers,
  set,
  onClose,
}: {
  scope: string;
  name: (id: string) => string;
  tree: MgNode[];
  answers: Answers;
  set: (p: Partial<Answers>) => void;
  onClose: () => void;
}) {
  const suggested =
    PERSONAS.find(
      (p) => p.scope === initialScope && !answers.rbac.some((r) => r.persona === p.id),
    ) ??
    PERSONAS.find((p) => p.scope === initialScope) ??
    PERSONAS[0]!;
  const [persona, setPersona] = useState(suggested.id);
  const [role, setRole] = useState(suggested.role);
  const [scope, setScope] = useState(initialScope);
  useEffect(() => {
    setRole(PERSONAS.find((p) => p.id === persona)?.role ?? "Reader");
  }, [persona]);
  const p = PERSONAS.find((x) => x.id === persona)!;
  const current = answers.rbac.find((r) => r.persona === persona);
  const next = useMemo(
    () => ({
      ...answers,
      rbac: [...answers.rbac.filter((r) => r.persona !== persona), { persona, role, scope }],
    }),
    [answers, persona, role, scope],
  );
  // Only what this assignment changes: new or worse findings compared with the design today.
  const before = useMemo(() => accessChecks(answers, tree), [answers, tree]);
  const after = useMemo(() => accessChecks(next, tree), [next, tree]);
  const findings = after.filter(
    (c) =>
      (c.status === "warn" || c.status === "fail") &&
      (c.id === `least:${persona}` ||
        !before.some((b) => b.id === c.id && b.status === c.status && b.title === c.title)),
  );
  const matches = role === p.role && scope === p.scope;
  const here = answers.rbac.filter((r) => r.scope === initialScope);
  const roleBody = ALZ_ROLES[role] ?? BUILTIN_ROLES.find((r) => r.name === role)?.body ?? "";

  return (
    <>
      <DialogHeader>
        <DialogTitle>Give a team access at {name(initialScope)}</DialogTitle>
        <DialogDescription>
          The role goes to the team's Microsoft Entra group and is inherited by everything below.
          Checked against Microsoft's guidance as you choose.
        </DialogDescription>
      </DialogHeader>
      {here.length > 0 && (
        <div className="rounded-md border border-border bg-muted/30 p-2 text-[12px]">
          <p className="mb-1 font-medium">Already assigned here</p>
          {here.map((r) => (
            <p key={r.persona} className="flex items-center justify-between gap-2">
              <span>
                {PERSONAS.find((x) => x.id === r.persona)?.label} · {r.role}
              </span>
              <button
                className="text-[11.5px] text-[#a4262c] hover:underline"
                onClick={() => set({ rbac: answers.rbac.filter((x) => x.persona !== r.persona) })}
              >
                Remove
              </button>
            </p>
          ))}
        </div>
      )}
      <div className="grid gap-3 text-[12.5px]">
        <label className="grid gap-1">
          <span className="font-medium">Team</span>
          <select
            aria-label="Team"
            value={persona}
            onChange={(e) => setPersona(e.target.value)}
            className="h-8 rounded-md border border-input bg-background px-2"
          >
            {PERSONAS.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
                {answers.rbac.some((r) => r.persona === x.id) ? " (has access)" : ""}
              </option>
            ))}
          </select>
          <span className="text-[11.5px] text-muted-foreground">{p.body}</span>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="grid gap-1">
            <span className="font-medium">Role</span>
            <select
              aria-label="Role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="h-8 rounded-md border border-input bg-background px-2"
            >
              <optgroup label="ALZ roles">
                {Object.keys(ALZ_ROLES).map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </optgroup>
              <optgroup label="Built-in roles">
                {BUILTIN_ROLES.map((r) => (
                  <option key={r.name}>{r.name}</option>
                ))}
              </optgroup>
            </select>
          </label>
          <label className="grid gap-1">
            <span className="font-medium">Assigned at</span>
            <select
              aria-label="Assigned at"
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              className="h-8 rounded-md border border-input bg-background px-2"
            >
              {tree.map((n) => (
                <option key={n.id} value={n.libraryId}>
                  {n.displayName}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="text-[11.5px] text-muted-foreground">{roleBody}</p>
        {current && (current.role !== role || current.scope !== scope) && (
          <p className="text-[11.5px] text-muted-foreground">
            Replaces {p.label}'s {current.role} at {name(current.scope)} — one role per team keeps
            access easy to review.
          </p>
        )}
        {matches ? (
          <p className="flex items-center gap-1.5 rounded-md border border-success/40 bg-success/5 px-2 py-1.5 text-[12px]">
            <CheckCircle2 className="size-4 text-success" /> Matches Microsoft's recommendation for{" "}
            {p.label.toLowerCase()}.
          </p>
        ) : (
          <div className="space-y-1.5">
            {findings.map((c) => (
              <div
                key={c.id}
                className={cn(
                  "rounded-md border px-2 py-1.5 text-[12px]",
                  c.status === "fail"
                    ? "border-[#a4262c]/40 bg-[#fde7e9]"
                    : "border-warning/40 bg-warning/5",
                )}
              >
                <p className="flex items-center gap-1.5 font-medium">
                  {c.status === "fail" ? (
                    <XCircle className="size-4 text-[#a4262c]" />
                  ) : (
                    <CircleAlert className="size-4 text-warning" />
                  )}
                  {c.title}
                </p>
                <p className="mt-0.5 text-[11.5px] text-muted-foreground">{c.detail}</p>
                <a
                  href={c.source.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                >
                  {c.source.label} <ExternalLink className="size-3" />
                </a>
              </div>
            ))}
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setRole(p.role);
                setScope(tree.some((n) => n.libraryId === p.scope) ? p.scope : initialScope);
              }}
            >
              <Wand2 className="size-3.5" /> Use Microsoft's recommendation: {p.role} at{" "}
              {name(p.scope)}
            </Button>
          </div>
        )}
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          onClick={() => {
            set({ rbac: next.rbac });
            onClose();
          }}
        >
          {findings.some((c) => c.status === "fail") ? "Assign anyway" : "Assign"}
        </Button>
      </DialogFooter>
    </>
  );
}

function PolicyForm({
  scope,
  name,
  answers,
  set,
  onClose,
}: {
  scope: string;
  name: (id: string) => string;
  answers: Answers;
  set: (p: Partial<Answers>) => void;
  onClose: () => void;
}) {
  const categories = [...new Set(POLICY_OPTIONS.map((o) => o.category))];
  return (
    <>
      <DialogHeader>
        <DialogTitle>Assign policy at {name(scope)}</DialogTitle>
        <DialogDescription>
          Official Azure built-ins and compliance frameworks, on top of the ALZ policies already
          here. Everything below {name(scope)} inherits them.
        </DialogDescription>
      </DialogHeader>
      <div className="max-h-[55vh] space-y-3 overflow-y-auto pr-1">
        {categories.map((cat) => (
          <div key={cat}>
            <p className="mb-1 text-[10.5px] font-semibold tracking-wider text-muted-foreground uppercase">
              {cat}
            </p>
            <ul className="space-y-1.5">
              {POLICY_OPTIONS.filter((o) => o.category === cat).map((o) => {
                const here = answers.policyAdds.some((a) => a.id === o.id && a.scope === scope);
                const elsewhere = answers.policyAdds.find(
                  (a) => a.id === o.id && a.scope !== scope,
                );
                return (
                  <li key={o.id} className="rounded-md border border-border p-2 text-[12px]">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium">{o.name}</p>
                        <p className="text-[11.5px] text-muted-foreground">{o.body}</p>
                      </div>
                      <Switch
                        aria-label={`Assign ${o.name} here`}
                        checked={here}
                        onCheckedChange={(v) =>
                          set({
                            policyAdds: v
                              ? [
                                  ...answers.policyAdds.filter((a) => a.id !== o.id),
                                  { id: o.id, scope },
                                ]
                              : answers.policyAdds.filter(
                                  (a) => !(a.id === o.id && a.scope === scope),
                                ),
                          })
                        }
                      />
                    </div>
                    {elsewhere && !here && (
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Assigned at {name(elsewhere.scope)} today; turning it on moves it here.
                      </p>
                    )}
                    {o.scope !== scope && (
                      <p className="mt-1 text-[11px] text-warning">
                        Microsoft recommends {name(o.scope)}. {o.why}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      <DialogFooter>
        <Button onClick={onClose}>Done</Button>
      </DialogFooter>
    </>
  );
}
