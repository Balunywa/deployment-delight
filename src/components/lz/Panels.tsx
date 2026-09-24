/*
 * Side panels for the landing zone designer: Access (Azure RBAC with Microsoft's recommendation per team),
 * extra policies (official built-ins and compliance frameworks), and the AI design advisor.
 */
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Lightbulb, Send, Sparkles, Undo2, Wand2 } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { Pill } from "@/components/Primitives";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { askAdvisor } from "@/lib/advisor.functions";
import type { Answers, MgNode } from "@/lib/alz/engine";
import {
  ALZ_ROLES,
  BUILTIN_ROLES,
  PERSONAS,
  POLICY_OPTIONS,
  type PolicyAdd,
  type RbacAssignment,
  recommendedRbac,
} from "@/lib/alz/governance";
import { cn } from "@/lib/utils";

type Patch = ((p: Partial<Answers>) => void) | undefined;

function Bulb({ children }: { children: ReactNode }) {
  return (
    <p className="mt-1.5 flex gap-1.5 rounded-sm border border-[#f3d27a] bg-[#fff8e1] px-2 py-1.5 text-[11.5px] text-[#5c4400]">
      <Lightbulb className="mt-px size-3.5 shrink-0 text-[#c08b00]" />
      <span>{children}</span>
    </p>
  );
}

const scopeName = (tree: MgNode[], id: string) =>
  tree.find((n) => n.libraryId === id)?.displayName ?? id;

/* ------------------------------------------------------------------- access */

export function AccessPanel({
  tree,
  answers,
  set,
  focusScope,
}: {
  tree: MgNode[];
  answers: Answers;
  set: Patch;
  focusScope?: string | undefined;
}) {
  const groups = tree.map((n) => n.libraryId);
  const hasGroup = (id: string) => groups.includes(id);
  const roles = [...Object.keys(ALZ_ROLES), ...BUILTIN_ROLES.map((r) => r.name)];
  const describe = (role: string) =>
    ALZ_ROLES[role] ?? BUILTIN_ROLES.find((r) => r.name === role)?.body ?? "";
  const personas = focusScope
    ? PERSONAS.filter(
        (p) =>
          p.scope === focusScope ||
          answers.rbac.some((r) => r.persona === p.id && r.scope === focusScope),
      )
    : PERSONAS;
  const update = (persona: string, next: RbacAssignment | null) =>
    set?.({
      rbac: [...answers.rbac.filter((r) => r.persona !== persona), ...(next ? [next] : [])],
    });
  const recommended = recommendedRbac(hasGroup);
  const allRecommended =
    recommended.length === answers.rbac.length &&
    recommended.every((r) =>
      answers.rbac.some((a) => a.persona === r.persona && a.role === r.role && a.scope === r.scope),
    );
  return (
    <div className="space-y-3 p-4">
      {!focusScope && (
        <div>
          <h2 className="text-[14px] font-semibold">Who gets access, and where</h2>
          <p className="text-[12px] text-muted-foreground">
            Roles are assigned to Microsoft Entra groups at management groups, so every customer
            install inherits them. Microsoft's recommendation for each team is shown with a bulb.
          </p>
          {set && (
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              disabled={allRecommended}
              onClick={() => set({ rbac: recommended })}
            >
              <Wand2 className="size-3.5" />
              {allRecommended
                ? "Using Microsoft's recommendation"
                : "Use Microsoft's recommendation"}
            </Button>
          )}
        </div>
      )}
      {personas.map((p) => {
        const cur = answers.rbac.find((r) => r.persona === p.id);
        const isRec = cur && cur.role === p.role && cur.scope === p.scope;
        return (
          <section key={p.id} className="rounded-md border border-border p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[12.5px] font-semibold">{p.label}</p>
                <p className="text-[11.5px] text-muted-foreground">{p.body}</p>
              </div>
              <Switch
                checked={!!cur}
                disabled={!set}
                onCheckedChange={(v) =>
                  update(
                    p.id,
                    v
                      ? { persona: p.id, role: p.role, scope: hasGroup(p.scope) ? p.scope : "alz" }
                      : null,
                  )
                }
              />
            </div>
            {cur && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <label className="text-[10.5px] text-muted-foreground">
                  Role
                  <select
                    className="mt-0.5 h-7 w-full rounded-md border border-input bg-background px-1.5 text-[11.5px]"
                    value={cur.role}
                    disabled={!set}
                    onChange={(e) => update(p.id, { ...cur, role: e.target.value })}
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
                <label className="text-[10.5px] text-muted-foreground">
                  Assigned at
                  <select
                    className="mt-0.5 h-7 w-full rounded-md border border-input bg-background px-1.5 text-[11.5px]"
                    value={cur.scope}
                    disabled={!set}
                    onChange={(e) => update(p.id, { ...cur, scope: e.target.value })}
                  >
                    {tree.map((n) => (
                      <option key={n.id} value={n.libraryId}>
                        {n.displayName}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="col-span-2 text-[11px] text-muted-foreground">{describe(cur.role)}</p>
              </div>
            )}
            {!isRec && (
              <Bulb>
                <b>Recommended:</b> {p.role} at {scopeName(tree, p.scope)}. {p.why}
                {set && (
                  <button
                    className="ml-1 font-medium text-[#0078d4] hover:underline"
                    onClick={() => update(p.id, { persona: p.id, role: p.role, scope: p.scope })}
                  >
                    Use this
                  </button>
                )}
              </Bulb>
            )}
            {isRec && (
              <p className="mt-1.5 text-[11px] text-success">
                ✓ Matches Microsoft's recommendation
              </p>
            )}
          </section>
        );
      })}
      {!roles.length && null}
    </div>
  );
}

/* ----------------------------------------------------------------- policies */

export function PolicyAddsPanel({
  tree,
  answers,
  set,
  scope,
}: {
  tree: MgNode[];
  answers: Answers;
  set: Patch;
  /** Limit to one management group (details panel); otherwise all options with a scope picker. */
  scope?: string | undefined;
}) {
  const toggle = (add: PolicyAdd, on: boolean) =>
    set?.({
      policyAdds: on
        ? [...answers.policyAdds.filter((a) => !(a.id === add.id && a.scope === add.scope)), add]
        : answers.policyAdds.filter((a) => !(a.id === add.id && a.scope === add.scope)),
    });
  const categories = [...new Set(POLICY_OPTIONS.map((o) => o.category))];
  return (
    <div className="space-y-3">
      {categories.map((c) => (
        <div key={c}>
          <p className="mb-1 text-[10.5px] font-semibold tracking-wider text-muted-foreground uppercase">
            {c}
          </p>
          <ul className="space-y-1.5">
            {POLICY_OPTIONS.filter((o) => o.category === c).map((o) => {
              const at = scope ?? answers.policyAdds.find((a) => a.id === o.id)?.scope ?? o.scope;
              const on = answers.policyAdds.some((a) => a.id === o.id && a.scope === at);
              const recommendedHere = o.scope === at;
              return (
                <li
                  key={o.id}
                  className={cn(
                    "rounded-md border p-2.5",
                    on ? "border-primary/40 bg-primary/5" : "border-border",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[12px] font-semibold">
                        {o.name}{" "}
                        <Pill tone="neutral">
                          {o.kind === "initiative" ? "Initiative" : "Policy"}
                        </Pill>
                      </p>
                      <p className="text-[11.5px] text-muted-foreground">{o.body}</p>
                      <p className="font-mono text-[10px] text-muted-foreground">{o.definition}</p>
                    </div>
                    <Switch
                      checked={on}
                      disabled={!set}
                      onCheckedChange={(v) => toggle({ id: o.id, scope: at }, v)}
                    />
                  </div>
                  {!scope && on && (
                    <label className="mt-1.5 block text-[10.5px] text-muted-foreground">
                      Assigned at
                      <select
                        className="mt-0.5 h-7 w-full rounded-md border border-input bg-background px-1.5 text-[11.5px]"
                        value={at}
                        disabled={!set}
                        onChange={(e) =>
                          set?.({
                            policyAdds: [
                              ...answers.policyAdds.filter((a) => a.id !== o.id),
                              { id: o.id, scope: e.target.value },
                            ],
                          })
                        }
                      >
                        {tree.map((n) => (
                          <option key={n.id} value={n.libraryId}>
                            {n.displayName}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {recommendedHere ? (
                    (!scope || !on) && <Bulb>{o.why}</Bulb>
                  ) : (
                    <Bulb>
                      Microsoft's recommended scope is {scopeName(tree, o.scope)}. {o.why}
                    </Bulb>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ advisor */

type Msg = { role: "user" | "assistant"; content: string };

const PATCH_KEYS: Record<string, (v: unknown) => boolean> = {
  connectivity: (v) => ["hub_and_spoke", "virtual_wan", "none"].includes(v as string),
  firewall: (v) => ["Basic", "Standard", "Premium", "none"].includes(v as string),
  privateDns: (v) => ["platform", "none"].includes(v as string),
  monitoring: (v) => ["azure_monitor", "third_party"].includes(v as string),
  siem: (v) => ["sentinel", "other"].includes(v as string),
  logRetentionDays: (v) => typeof v === "number" && v >= 30 && v <= 730,
  secondaryRegion: (v) => typeof v === "string",
  primaryRegion: (v) => typeof v === "string" && !!v,
  landingZones: (v) =>
    Array.isArray(v) && v.every((x) => ["corp", "online", "local", "sandbox"].includes(x)),
  rbac: (v) =>
    Array.isArray(v) &&
    v.every(
      (x) =>
        x &&
        typeof x.persona === "string" &&
        typeof x.role === "string" &&
        typeof x.scope === "string",
    ),
  customGroups: (v) =>
    Array.isArray(v) &&
    v.every(
      (x) =>
        x &&
        /^[a-z][a-z0-9-]{1,40}$/.test(x.id) &&
        typeof x.name === "string" &&
        typeof x.parent === "string" &&
        ["corp", "online", "local", "sandbox", "inherit"].includes(x.archetype),
    ),
  removedGroups: (v) =>
    Array.isArray(v) &&
    v.every((x) =>
      ["management", "connectivity", "identity", "security", "decommissioned"].includes(x),
    ),
  groupNames: (v) => !!v && typeof v === "object" && !Array.isArray(v),
  environments: (v) =>
    Array.isArray(v) &&
    v.length > 0 &&
    v.every((x) => typeof x === "string" && /^[a-z][a-z0-9-]{0,19}$/.test(x)),
  extraSubscriptions: (v) =>
    Array.isArray(v) &&
    v.every(
      (x) =>
        x &&
        typeof x.id === "string" &&
        typeof x.name === "string" &&
        typeof x.group === "string" &&
        typeof x.environment === "string",
    ),
  defaultGroup: (v) => typeof v === "string",
  workloads: (v) =>
    Array.isArray(v) &&
    v.every((x) => x && typeof x.group === "string" && typeof x.id === "string"),
  policyAdds: (v) =>
    Array.isArray(v) &&
    v.every((x) => x && POLICY_OPTIONS.some((o) => o.id === x.id) && typeof x.scope === "string"),
  ...Object.fromEntries(
    [
      "bastion",
      "vpnGateway",
      "expressRoute",
      "ddosPlan",
      "identity",
      "securitySubscription",
      "defender",
      "updateManager",
      "serviceHealth",
      "vmBackup",
    ].map((k) => [k, (v: unknown) => v === "yes" || v === "no"]),
  ),
};

function parsePatch(text: string): { body: string; patch: Partial<Answers> | null } {
  const m = /```design-patch\s*([\s\S]*?)```/.exec(text);
  if (!m) return { body: text, patch: null };
  try {
    const raw = JSON.parse(m[1]!) as Record<string, unknown>;
    const patch = Object.fromEntries(
      Object.entries(raw).filter(([k, v]) => PATCH_KEYS[k]?.(v)),
    ) as Partial<Answers>;
    return { body: text.replace(m[0], "").trim(), patch: Object.keys(patch).length ? patch : null };
  } catch {
    return { body: text.replace(m[0], "").trim(), patch: null };
  }
}

const describePatch = (p: Partial<Answers>) =>
  Object.entries(p).map(([k, v]) =>
    Array.isArray(v)
      ? `${k}: ${v.length} item${v.length === 1 ? "" : "s"}`
      : `${k} → ${String(v === "" ? "none" : v)}`,
  );

const STARTERS = [
  "Review this design against Microsoft's standard. What would you change?",
  "We'll host 80 customers. Is Corp or Online right for them, and why?",
  "Walk me through how traffic from a Corp install reaches the internet.",
  "What's the cheapest design that still passes a security review?",
  "Recommend access for my teams.",
];

export function AdvisorPanel({
  context,
  answers,
  set,
  assessed,
}: {
  context: () => string;
  answers: Answers;
  set: Patch;
  assessed: boolean;
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [applied, setApplied] = useState<Record<number, Answers>>({});
  const end = useRef<HTMLDivElement>(null);
  const ask = useMutation({ mutationFn: useServerFn(askAdvisor) });
  useEffect(() => {
    if (messages.length) end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, ask.isPending]);

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || ask.isPending) return;
    const next: Msg[] = [...messages, { role: "user", content: q }];
    setMessages(next);
    setInput("");
    try {
      const { reply } = await ask.mutateAsync({
        data: { context: context(), messages: next.slice(-12) },
      });
      setMessages([...next, { role: "assistant", content: reply }]);
    } catch (e) {
      setMessages([...next, { role: "assistant", content: `⚠️ ${(e as Error).message}` }]);
    }
  };
  const starters = assessed
    ? [
        "What's missing in this tenant compared with the standard, in priority order?",
        "Plan the migration to the standard in phases.",
        ...STARTERS.slice(0, 3),
      ]
    : STARTERS;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border px-4 py-3">
        <h2 className="flex items-center gap-1.5 text-[14px] font-semibold">
          <Sparkles className="size-4 text-[#8661c5]" /> Design advisor
        </h2>
        <p className="text-[12px] text-muted-foreground">
          Reasons over this exact design — every management group, policy, resource, traffic path
          and install{assessed ? ", plus the tenant scan" : ""}. It proposes changes you can apply.
        </p>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {!messages.length && (
          <div className="space-y-1.5">
            {starters.map((s) => (
              <button
                key={s}
                onClick={() => void send(s)}
                className="block w-full rounded-md border border-border px-3 py-2 text-left text-[12px] hover:border-[#8661c5] hover:bg-[#8661c5]/5"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        {messages.map((m, i) => {
          if (m.role === "user")
            return (
              <p
                key={i}
                className="ml-8 rounded-lg bg-primary px-3 py-2 text-[12.5px] text-primary-foreground"
              >
                {m.content}
              </p>
            );
          const { body, patch } = parsePatch(m.content);
          return (
            <div key={i} className="mr-2 rounded-lg border border-border bg-card px-3 py-2">
              <Markdown text={body} />
              {patch && (
                <div className="mt-2 rounded-md border border-[#8661c5]/40 bg-[#8661c5]/5 p-2.5">
                  <p className="text-[11.5px] font-semibold text-[#5c2e91]">Suggested change</p>
                  <ul className="mt-1 space-y-0.5 font-mono text-[11px]">
                    {describePatch(patch).map((d) => (
                      <li key={d}>{d}</li>
                    ))}
                  </ul>
                  {set &&
                    (applied[i] ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-2 h-7"
                        onClick={() => {
                          set(applied[i]!);
                          setApplied(({ [i]: _, ...rest }) => rest);
                        }}
                      >
                        <Undo2 className="size-3.5" /> Undo
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        className="mt-2 h-7"
                        onClick={() => {
                          setApplied((a) => ({ ...a, [i]: answers }));
                          set(patch);
                        }}
                      >
                        Apply to design
                      </Button>
                    ))}
                </div>
              )}
            </div>
          );
        })}
        {ask.isPending && (
          <p className="text-[12px] text-muted-foreground">Thinking through the design…</p>
        )}
        <div ref={end} />
      </div>
      <form
        className="flex gap-2 border-t border-border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
          }}
          rows={2}
          placeholder="Ask about this design, a change, a customer, routing…"
          className="min-h-0 flex-1 resize-none rounded-md border border-input bg-background px-2.5 py-1.5 text-[12.5px]"
        />
        <Button type="submit" size="sm" disabled={!input.trim() || ask.isPending} aria-label="Send">
          <Send className="size-3.5" />
        </Button>
      </form>
    </div>
  );
}

/** Small, safe Markdown: headings, bullets, numbered lists, bold, inline code, paragraphs. */
export function Markdown({ text }: { text: string }) {
  const inline = (s: string, key: string) =>
    s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) =>
      part.startsWith("**") ? (
        <b key={`${key}-${i}`}>{part.slice(2, -2)}</b>
      ) : part.startsWith("`") ? (
        <code key={`${key}-${i}`} className="rounded bg-muted px-1 font-mono text-[11px]">
          {part.slice(1, -1)}
        </code>
      ) : (
        part
      ),
    );
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const Tag = list.ordered ? "ol" : "ul";
    blocks.push(
      <Tag
        key={blocks.length}
        className={cn(
          "my-1 space-y-0.5 pl-4 text-[12.5px]",
          list.ordered ? "list-decimal" : "list-disc",
        )}
      >
        {list.items.map((it, i) => (
          <li key={i}>{inline(it, `${blocks.length}-${i}`)}</li>
        ))}
      </Tag>,
    );
    list = null;
  };
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*]\s+(.*)/.exec(line);
    const num = /^\s*\d+[.)]\s+(.*)/.exec(line);
    if (bullet || num) {
      const ordered = !!num;
      if (!list || list.ordered !== ordered) {
        flush();
        list = { ordered, items: [] };
      }
      list.items.push((bullet ?? num)![1]!);
      continue;
    }
    flush();
    if (!line.trim()) continue;
    const h = /^#{1,4}\s+(.*)/.exec(line);
    blocks.push(
      h ? (
        <p key={blocks.length} className="mt-2 text-[12.5px] font-semibold first:mt-0">
          {inline(h[1]!, `h${blocks.length}`)}
        </p>
      ) : (
        <p key={blocks.length} className="my-1 text-[12.5px] leading-relaxed">
          {inline(line, `p${blocks.length}`)}
        </p>
      ),
    );
  }
  flush();
  return <div>{blocks}</div>;
}
