/*
 * Customer onboarding for SE/CSA work, before the first conversation: find the customer by TPID, pull what MSX
 * knows (through the MSX connector on the SE's PC), add what MSX doesn't, then prep and start the engagement under
 * an MSX opportunity or proactively. (Onboarding a customer onto a deployment is /onboard.)
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Check, Search } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { CustomerProfileCard } from "@/components/customer/CustomerProfileCard";
import { MsxConnect } from "@/components/customer/MsxConnect";
import { PrepPanel } from "@/components/customer/PrepPanel";
import { useConnector, useRefreshFromMsx } from "@/components/customer/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createEngagement } from "@/lib/engagements.functions";
import { type MsxSnapshot, msxCustomer, opportunityKey } from "@/lib/msx-connector";
import { findCustomersByTpid, getCustomerProfile, upsertCustomerByTpid } from "@/lib/msx.functions";
import { saveMsxSnapshot } from "@/lib/prep.functions";
import { cn } from "@/lib/utils";

type Step = "find" | "msx" | "context" | "prep";
const STEPS: { id: Step; label: string }[] = [
  { id: "find", label: "Find the customer" },
  { id: "msx", label: "What MSX says" },
  { id: "context", label: "Add context" },
  { id: "prep", label: "Prep and start" },
];
type Search = { step?: Step; tpid?: string; customer?: string; opp?: string };

export const Route = createFileRoute("/customers/onboard")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    ...(STEPS.some((x) => x.id === s["step"]) ? { step: s["step"] as Step } : {}),
    ...(typeof s["tpid"] === "string" && /^\d{3,12}$/.test(s["tpid"]) ? { tpid: s["tpid"] } : {}),
    ...(typeof s["customer"] === "string" && /^[0-9a-f-]{36}$/.test(s["customer"])
      ? { customer: s["customer"] }
      : {}),
    ...(typeof s["opp"] === "string" ? { opp: s["opp"].slice(0, 64) } : {}),
  }),
  head: () => ({
    meta: [
      { title: "Onboard customer · Cloud Delivery" },
      {
        name: "description",
        content:
          "Find the customer by TPID, pull what MSX knows, add what it doesn't, and prepare for the first conversation.",
      },
    ],
  }),
  component: OnboardCustomer,
});

function OnboardCustomer() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/customers/onboard" });
  const step: Step = search.customer ? (search.step ?? "msx") : "find";
  const go = (patch: Search) =>
    void navigate({ search: (s: Search) => ({ ...s, ...patch }), replace: false });

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="max-w-3xl">
          <h1 className="text-[22px] font-semibold">Onboard a customer</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Find the customer by TPID, pull what MSX knows, add what MSX doesn't, and go into the
            first conversation prepared. MSX stays the record; Cloud Delivery keeps the TPID, a
            dated MSX snapshot and your own context.
          </p>
        </div>
      </div>

      <ol aria-label="Steps" className="grid gap-2 sm:grid-cols-4">
        {STEPS.map((s, i) => {
          const at = STEPS.findIndex((x) => x.id === step);
          const done = i < at;
          const reachable = !!search.customer || s.id === "find";
          return (
            <li key={s.id}>
              <button
                disabled={!reachable}
                aria-current={s.id === step ? "step" : undefined}
                onClick={() => go({ step: s.id })}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-[12.5px] transition-colors disabled:opacity-50",
                  s.id === step
                    ? "border-primary bg-primary/5 font-semibold"
                    : "border-border hover:border-border-strong",
                )}
              >
                <span
                  className={cn(
                    "grid size-5 shrink-0 place-items-center rounded-full text-[11px]",
                    done ? "bg-success text-white" : "bg-muted text-muted-foreground",
                  )}
                >
                  {done ? <Check className="size-3" /> : i + 1}
                </span>
                {s.label}
              </button>
            </li>
          );
        })}
      </ol>

      {step === "find" && (
        <FindStep
          initialTpid={search.tpid ?? ""}
          onDone={(customer, tpid) => go({ customer, tpid, step: "msx" })}
        />
      )}
      {step === "msx" && search.customer && (
        <MsxStep
          customerId={search.customer}
          opp={search.opp}
          onPick={(opp) => go({ opp })}
          onNext={() => go({ step: "context" })}
        />
      )}
      {step === "context" && search.customer && (
        <div className="space-y-3">
          <p className="max-w-3xl text-[13px] text-muted-foreground">
            MSX rarely says enough: the seller or specialist may not have written down what the
            customer wants. Add their notes, emails, a call transcript, or what you know in your own
            words. The prep reads all of it.
          </p>
          <CustomerProfileCard customerId={search.customer} />
          <div className="flex justify-end">
            <Button onClick={() => go({ step: "prep" })}>Next: prep</Button>
          </div>
        </div>
      )}
      {step === "prep" && search.customer && (
        <div className="space-y-4">
          <PrepPanel customerId={search.customer} />
          <StartEngagement customerId={search.customer} opp={search.opp} />
        </div>
      )}
    </div>
  );
}

function FindStep({
  initialTpid,
  onDone,
}: {
  initialTpid: string;
  onDone: (customerId: string, tpid: string) => void;
}) {
  const [tpid, setTpid] = useState(initialTpid);
  const [term, setTerm] = useState(initialTpid);
  const [name, setName] = useState<string | null>(null);
  const conn = useConnector();
  const find = useServerFn(findCustomersByTpid);
  const existing = useQuery({
    queryKey: ["find-customer", term],
    queryFn: () => find({ data: { q: term } }),
    enabled: /^\d{3,12}$/.test(term),
  });
  const msx = useQuery<MsxSnapshot, Error>({
    queryKey: ["msx-customer", term],
    queryFn: () => msxCustomer(term),
    enabled: /^\d{3,12}$/.test(term) && conn.data?.state === "ready",
    retry: false,
    staleTime: 5 * 60_000,
  });
  const upsert = useServerFn(upsertCustomerByTpid);
  const save = useServerFn(saveMsxSnapshot);
  const proceed = useMutation({
    mutationFn: async () => {
      const found = existing.data?.find((c) => c.tpid === term);
      const snapshot = msx.data;
      const id = found
        ? found.id
        : (
            await upsert({
              data: {
                tpid: term,
                name: (name ?? snapshot?.account?.name ?? "").trim(),
                ...(snapshot?.account ? { accountName: snapshot.account.name } : {}),
              },
            })
          ).customer.id;
      if (snapshot) await save({ data: { customerId: id, snapshot } });
      return id;
    },
    onSuccess: (id) => onDone(id, term),
    onError: (e: Error) => toast.error(e.message),
  });

  const valid = /^\d{3,12}$/.test(term);
  const found = existing.data?.find((c) => c.tpid === term);
  const suggested = msx.data?.account?.name ?? "";
  const finalName = name ?? suggested;

  return (
    <div className="space-y-4">
      <form
        className="flex max-w-xl items-end gap-2"
        onSubmit={(ev) => {
          ev.preventDefault();
          setTerm(tpid.trim());
          setName(null);
        }}
      >
        <div className="flex-1 space-y-1">
          <Label htmlFor="tpid">TPID</Label>
          <div className="relative">
            <Search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
            <Input
              id="tpid"
              className="pl-8 font-mono"
              inputMode="numeric"
              placeholder="MSX top parent ID"
              value={tpid}
              onChange={(ev) => setTpid(ev.target.value.replace(/\D/g, ""))}
              autoFocus
            />
          </div>
        </div>
        <Button type="submit" disabled={!/^\d{3,12}$/.test(tpid)}>
          Look up
        </Button>
      </form>

      <MsxConnect />

      {valid && (
        <div className="grid gap-3 md:grid-cols-2">
          <div
            role="region"
            aria-label="In MSX"
            className="rounded-xl border border-border bg-card p-4"
          >
            <h2 className="text-[13px] font-semibold">In MSX</h2>
            {conn.data?.state !== "ready" ? (
              <p className="mt-1 text-[12.5px] text-muted-foreground">
                {conn.data?.state === "signed-out"
                  ? "Not read yet: sign in to MSX above."
                  : "Not read: MSX isn't connected on this PC."}{" "}
                You can still continue and pull from MSX later.
              </p>
            ) : msx.isLoading ? (
              <p className="mt-1 text-[12.5px] text-muted-foreground">Reading MSX…</p>
            ) : msx.error ? (
              <p className="mt-1 text-[12.5px] text-danger">{msx.error.message}</p>
            ) : msx.data?.account ? (
              <div className="mt-1 space-y-1 text-[12.5px]">
                <p className="text-[14px] font-medium">{msx.data.account.name}</p>
                <p className="text-muted-foreground">
                  {msx.data.accounts != null && `${msx.data.accounts} active accounts · `}
                  {msx.data.opportunities.length} open opportunit
                  {msx.data.opportunities.length === 1 ? "y" : "ies"}
                </p>
                <ul className="list-disc pl-4 text-foreground/85">
                  {msx.data.opportunities.slice(0, 4).map((o) => (
                    <li key={o.id}>
                      {o.name}
                      {o.stage && <span className="text-muted-foreground"> · {o.stage}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="mt-1 text-[12.5px] text-muted-foreground">
                MSX has no account with TPID {term} that you can see. Check the TPID.
              </p>
            )}
          </div>

          <div
            role="region"
            aria-label="In Cloud Delivery"
            className="rounded-xl border border-border bg-card p-4"
          >
            <h2 className="text-[13px] font-semibold">In Cloud Delivery</h2>
            {existing.isLoading ? (
              <p className="mt-1 text-[12.5px] text-muted-foreground">Searching…</p>
            ) : found ? (
              <p className="mt-1 text-[12.5px]">
                Already onboarded as <span className="font-medium">{found.name}</span> ·{" "}
                {found.engagements} engagement{found.engagements === 1 ? "" : "s"}. Continuing
                reuses this profile.
              </p>
            ) : (
              <div className="mt-1 space-y-2">
                <p className="text-[12.5px] text-muted-foreground">
                  New customer. A profile is created with this TPID.
                </p>
                <div className="space-y-1">
                  <Label htmlFor="customer-name" className="text-xs">
                    Name the team uses
                  </Label>
                  <Input
                    id="customer-name"
                    value={finalName}
                    placeholder={suggested || "e.g. ExxonMobil"}
                    onChange={(ev) => setName(ev.target.value)}
                  />
                </div>
              </div>
            )}
            <div className="mt-3 flex justify-end">
              <Button
                disabled={
                  proceed.isPending ||
                  existing.isLoading ||
                  msx.isFetching ||
                  (!found && finalName.trim().length < 2)
                }
                onClick={() => proceed.mutate()}
              >
                {found ? "Continue with this customer" : "Create profile and continue"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MsxStep({
  customerId,
  opp,
  onPick,
  onNext,
}: {
  customerId: string;
  opp: string | undefined;
  onPick: (opp: string) => void;
  onNext: () => void;
}) {
  const load = useServerFn(getCustomerProfile);
  const profile = useQuery({
    queryKey: ["customer-profile", customerId],
    queryFn: () => load({ data: { id: customerId } }),
  });
  const conn = useConnector();
  const refresh = useRefreshFromMsx(customerId);
  const c = profile.data;
  if (!c) return null;
  const snap = [...(c.context ?? [])].reverse().find((e) => e.msx)?.msx ?? null;
  const picked = opp ?? (snap?.opportunities.length ? undefined : "proactive");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px]">
          <span className="font-semibold">{c.name}</span>
          <span className="text-muted-foreground">
            {" "}
            · TPID {c.tpid}
            {snap?.account && ` · MSX account ${snap.account.name}`}
            {snap && ` · read ${snap.fetchedAt.slice(0, 10)}`}
          </span>
        </p>
        {c.tpid && conn.data?.state === "ready" && (
          <Button
            size="sm"
            variant="outline"
            disabled={refresh.isPending}
            onClick={() => refresh.mutate(c.tpid!)}
          >
            {refresh.isPending ? "Reading MSX…" : snap ? "Refresh from MSX" : "Pull from MSX"}
          </Button>
        )}
      </div>
      {!snap && <MsxConnect />}

      <fieldset className="space-y-2" aria-label="Which opportunity">
        <legend className="mb-1 text-[13px] font-semibold">
          Which opportunity is this engagement for?
        </legend>
        {snap?.opportunities.map((o) => {
          const key = opportunityKey(o);
          return (
            <label
              key={o.id}
              className={cn(
                "flex cursor-pointer gap-3 rounded-lg border px-3 py-2.5",
                picked === key ? "border-primary bg-primary/5" : "border-border",
              )}
            >
              <input
                type="radio"
                name="opp"
                className="mt-1"
                checked={picked === key}
                onChange={() => onPick(key)}
              />
              <span className="min-w-0 text-[12.5px]">
                <span className="block font-medium">{o.name}</span>
                <span className="block text-muted-foreground">
                  {[
                    o.number,
                    o.stage,
                    o.solutionArea,
                    o.salesPlay,
                    o.closeDate && `est. close ${o.closeDate.slice(0, 10)}`,
                    o.owner && `owner ${o.owner}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                <span className="mt-1 line-clamp-3 block text-foreground/85">
                  {o.description ?? "MSX has no description for this opportunity."}
                </span>
              </span>
            </label>
          );
        })}
        <label
          className={cn(
            "flex cursor-pointer gap-3 rounded-lg border px-3 py-2.5",
            picked === "proactive" ? "border-primary bg-primary/5" : "border-border",
          )}
        >
          <input
            type="radio"
            name="opp"
            className="mt-1"
            checked={picked === "proactive"}
            onChange={() => onPick("proactive")}
          />
          <span className="text-[12.5px]">
            <span className="block font-medium">Proactive: no opportunity yet</span>
            <span className="block text-muted-foreground">
              Link an MSX opportunity later, from the engagement.
            </span>
          </span>
        </label>
      </fieldset>
      <div className="flex justify-end">
        <Button disabled={!picked} onClick={onNext}>
          Next: add context
        </Button>
      </div>
    </div>
  );
}

function StartEngagement({ customerId, opp }: { customerId: string; opp: string | undefined }) {
  const navigate = useNavigate();
  const load = useServerFn(getCustomerProfile);
  const profile = useQuery({
    queryKey: ["customer-profile", customerId],
    queryFn: () => load({ data: { id: customerId } }),
  });
  const c = profile.data;
  const snap = c ? ([...(c.context ?? [])].reverse().find((e) => e.msx)?.msx ?? null) : null;
  const o =
    opp && opp !== "proactive"
      ? (snap?.opportunities.find((x) => opportunityKey(x) === opp) ?? null)
      : null;
  const [name, setName] = useState<string | null>(null);
  const start = useMutation({
    mutationFn: useServerFn(createEngagement),
    onSuccess: (r: { id: string; created: boolean }) => {
      if (!r.created) toast.info("That opportunity already has an engagement. Opening it.");
      void navigate({ to: "/engagements/$engagementId", params: { engagementId: r.id } });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  if (!c) return null;
  const finalName = name ?? o?.name ?? `${c.name}: first conversation`;

  return (
    <section
      aria-label="Start the engagement"
      className="rounded-xl border border-border bg-card p-4"
    >
      <h2 className="text-[14px] font-semibold">Start the engagement</h2>
      <p className="text-[12px] text-muted-foreground">
        {o
          ? `Linked to MSX opportunity ${o.number ?? o.id}: ${o.name}.`
          : opp && opp !== "proactive"
            ? `Linked to MSX opportunity ${opp}.`
            : "Proactive: no MSX opportunity yet."}{" "}
        It keeps the conversation, artifacts and deliverables across sessions.
      </p>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <div className="min-w-72 flex-1 space-y-1">
          <Label htmlFor="engagement-name" className="text-xs">
            Engagement
          </Label>
          <Input
            id="engagement-name"
            value={finalName}
            onChange={(ev) => setName(ev.target.value)}
          />
        </div>
        <Button
          disabled={finalName.trim().length < 3 || start.isPending}
          onClick={() =>
            start.mutate({
              data: {
                name: finalName.trim(),
                customerId,
                signals: [],
                words: o?.description?.slice(0, 2000) ?? "",
                ...(opp && opp !== "proactive"
                  ? { opportunityId: opp, ...(o ? { opportunityName: o.name.slice(0, 200) } : {}) }
                  : {}),
              },
            })
          }
        >
          Start the engagement
        </Button>
      </div>
    </section>
  );
}
