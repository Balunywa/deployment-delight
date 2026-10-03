/*
 * Onboard a customer, step A of the journey: resolve the customer. Look the TPID up in MSX (through the MSX connector
 * on the SE's PC) and in Cloud Delivery, see the account hierarchy, the account team, which sources are available,
 * and the engagements that already exist. Confirm the customer ("Save customer draft"), then continue an engagement
 * or prepare discovery for a new one, which opens the engagement workspace (context, point of view, call plan,
 * findings, create). MSX stays the record. (Putting a customer onto a deployment is Deployment onboarding.)
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, Check, CircleAlert, Search, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Pill } from "@/components/Primitives";
import { MsxConnect } from "@/components/customer/MsxConnect";
import { useConnector } from "@/components/customer/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { relative } from "@/lib/format";
import { type MsxSnapshot, msxCustomer, opportunityKey } from "@/lib/msx-connector";
import { findCustomersByTpid, getCustomerProfile, upsertCustomerByTpid } from "@/lib/msx.functions";
import { getPrepAssist, saveMsxSnapshot } from "@/lib/prep.functions";
import { cn } from "@/lib/utils";
import { listCustomerEngagements, startDraft } from "@/lib/workspace.functions";

type Search = { tpid?: string; customer?: string };

export const Route = createFileRoute("/customers/onboard")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    ...(typeof s["tpid"] === "string" && /^\d{3,12}$/.test(s["tpid"]) ? { tpid: s["tpid"] } : {}),
    ...(typeof s["customer"] === "string" && /^[0-9a-f-]{36}$/.test(s["customer"])
      ? { customer: s["customer"] }
      : {}),
  }),
  head: () => ({
    meta: [
      { title: "Onboard customer · Cloud Delivery" },
      {
        name: "description",
        content:
          "Resolve the customer by TPID, see what MSX and Cloud Delivery hold, and prepare a purposeful first conversation.",
      },
    ],
  }),
  component: OnboardCustomer,
});

const JOURNEY = [
  "Resolve the customer",
  "Understand the context",
  "Shape the point of view",
  "Prepare the conversation",
  "Confirm findings and create",
];

const ago = (iso: string) => relative(iso);

function OnboardCustomer() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/customers/onboard" });
  const queryClient = useQueryClient();
  const [tpid, setTpid] = useState(search.tpid ?? "");
  const [name, setName] = useState<string | null>(null);
  const term = search.tpid ?? "";
  const valid = /^\d{3,12}$/.test(term);
  const conn = useConnector();

  // Opened from a customer (or the workspace): resolve their TPID.
  const loadProfile = useServerFn(getCustomerProfile);
  const profile = useQuery({
    queryKey: ["customer-profile", search.customer],
    queryFn: () => loadProfile({ data: { id: search.customer! } }),
    enabled: !!search.customer,
  });
  useEffect(() => {
    if (!search.tpid && profile.data?.tpid) {
      setTpid(profile.data.tpid);
      void navigate({
        search: (s: Search) => ({ ...s, tpid: profile.data!.tpid! }),
        replace: true,
      });
    }
  }, [profile.data, search.tpid, navigate]);

  const find = useServerFn(findCustomersByTpid);
  const existing = useQuery({
    queryKey: ["find-customer", term],
    queryFn: () => find({ data: { q: term } }),
    enabled: valid,
  });
  const found = existing.data?.find((c) => c.tpid === term) ?? null;
  const msx = useQuery<MsxSnapshot, Error>({
    queryKey: ["msx-customer", term],
    queryFn: () => msxCustomer(term),
    enabled: valid && conn.data?.state === "ready",
    retry: false,
    staleTime: 5 * 60_000,
  });
  const customerId = search.customer ?? found?.id ?? null;
  const listEngagements = useServerFn(listCustomerEngagements);
  const engagements = useQuery({
    queryKey: ["customer-engagements", customerId],
    queryFn: () => listEngagements({ data: { customerId: customerId! } }),
    enabled: !!customerId,
  });
  const assist = useQuery({ queryKey: ["prep-assist"], queryFn: useServerFn(getPrepAssist) });

  // What we have for this TPID: live from MSX, else the last snapshot kept on the profile.
  const stored = [...(found?.context ?? profile.data?.context ?? [])]
    .reverse()
    .find((x) => x.msx)?.msx;
  const snap: MsxSnapshot | null = msx.data ?? stored ?? null;
  const live = !!msx.data;

  const upsert = useServerFn(upsertCustomerByTpid);
  const save = useServerFn(saveMsxSnapshot);
  const confirm = useMutation({
    mutationFn: async () => {
      const id =
        found?.id ??
        (
          await upsert({
            data: {
              tpid: term,
              name: (name ?? snap?.account?.name ?? "").trim(),
              ...(snap?.account ? { accountName: snap.account.name } : {}),
            },
          })
        ).customer.id;
      if (msx.data) await save({ data: { customerId: id, snapshot: msx.data } });
      return id;
    },
    onSuccess: (id) => {
      toast.success("Customer saved. Continue an engagement, or prepare a new one.");
      void queryClient.invalidateQueries({ queryKey: ["find-customer", term] });
      void navigate({ search: (s: Search) => ({ ...s, customer: id }) });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const [choice, setChoice] = useState<string>("");
  const open = useServerFn(startDraft);
  const prepare = useMutation({
    mutationFn: async () => {
      const o = snap?.opportunities.find((x) => opportunityKey(x) === choice);
      return open({
        data: {
          customerId: customerId!,
          ...(choice && choice !== "proactive" ? { opportunityId: choice } : {}),
          ...(o ? { opportunityName: o.name.slice(0, 200) } : {}),
        },
      });
    },
    onSuccess: (r) => {
      if (!r.created) toast.info("That already exists. Opening it.");
      void navigate({
        to: "/engagements/$engagementId",
        params: { engagementId: r.id },
        search: { tab: r.status === "draft" ? "context" : "overview" },
      });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const confirmed = !!search.customer;
  const finalName = name ?? found?.name ?? snap?.account?.name ?? "";
  const linked = new Set((engagements.data ?? []).map((x) => x.msx_opportunity_id).filter(Boolean));

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="max-w-3xl">
        <h1 className="text-[22px] font-semibold">Onboard a customer</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Understand the customer well enough to lead a useful first conversation. MSX stays the
          record; Cloud Delivery keeps the TPID, a dated MSX snapshot and what you learn.
        </p>
      </div>

      <ol aria-label="Journey" className="grid gap-2 sm:grid-cols-5">
        {JOURNEY.map((s, i) => (
          <li
            key={s}
            aria-current={i === 0 ? "step" : undefined}
            className={cn(
              "flex items-center gap-2 rounded-lg border px-3 py-2 text-[12.5px]",
              i === 0
                ? "border-primary bg-primary/5 font-semibold"
                : "border-border text-muted-foreground",
            )}
          >
            <span
              className={cn(
                "grid size-5 shrink-0 place-items-center rounded-full text-[11px]",
                i === 0 && confirmed ? "bg-success text-white" : "bg-muted text-muted-foreground",
              )}
            >
              {i === 0 && confirmed ? <Check className="size-3" /> : String.fromCharCode(65 + i)}
            </span>
            {s}
          </li>
        ))}
      </ol>

      <form
        className="flex max-w-xl items-end gap-2"
        onSubmit={(ev) => {
          ev.preventDefault();
          setName(null);
          void navigate({ search: { tpid: tpid.trim() } });
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
              autoFocus={!search.tpid}
            />
          </div>
        </div>
        <Button type="submit" disabled={!/^\d{3,12}$/.test(tpid)}>
          Look up
        </Button>
      </form>

      <MsxConnect />

      {valid && (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            <section aria-label="In MSX" className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-[13px] font-semibold">In MSX</h2>
                {snap && (
                  <span className="text-[11.5px] text-muted-foreground">
                    {live ? "Read just now" : `Snapshot from ${ago(snap.fetchedAt)}`}
                  </span>
                )}
              </div>
              {msx.isLoading ? (
                <p className="mt-1 text-[12.5px] text-muted-foreground">Reading MSX…</p>
              ) : msx.error ? (
                <p className="mt-1 flex items-start gap-1.5 text-[12.5px] text-danger">
                  <CircleAlert className="mt-0.5 size-3.5" /> {msx.error.message} Your TPID is kept;
                  try again, or continue without MSX.
                </p>
              ) : snap?.account ? (
                <div className="mt-1 space-y-1.5 text-[12.5px]">
                  <p className="text-[15px] font-medium">{snap.account.name}</p>
                  <p className="text-muted-foreground">
                    TPID {snap.tpid}
                    {snap.accounts != null &&
                      ` · ${snap.accounts} active account${snap.accounts === 1 ? "" : "s"} (parent and subsidiaries)`}
                    {` · ${snap.opportunities.length} open opportunit${snap.opportunities.length === 1 ? "y" : "ies"}`}
                  </p>
                  {snap.team && snap.team.length > 0 && (
                    <div>
                      <p className="mt-1 flex items-center gap-1 font-medium">
                        <Users className="size-3.5" /> Microsoft account team
                      </p>
                      <ul className="mt-0.5 grid gap-x-3 sm:grid-cols-2">
                        {snap.team.slice(0, 8).map((m) => (
                          <li key={`${m.name}-${m.role}`} className="truncate text-foreground/85">
                            {m.name}
                            {m.role && <span className="text-muted-foreground"> · {m.role}</span>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {snap.team === null && (
                    <p className="text-[11.5px] text-muted-foreground">
                      Account team not visible to you in MSX.
                    </p>
                  )}
                </div>
              ) : conn.data?.state !== "ready" ? (
                <p className="mt-1 text-[12.5px] text-muted-foreground">
                  {conn.data?.state === "signed-out"
                    ? "Not read yet: sign in to MSX above."
                    : "Not read: MSX isn't connected on this PC."}{" "}
                  You can still continue and pull from MSX later.
                </p>
              ) : (
                <p className="mt-1 text-[12.5px] text-muted-foreground">
                  MSX has no account with TPID {term} that you can see. Check the TPID.
                </p>
              )}
            </section>

            <section
              aria-label="In Cloud Delivery"
              className="rounded-xl border border-border bg-card p-4"
            >
              <h2 className="text-[13px] font-semibold">In Cloud Delivery</h2>
              {existing.isLoading ? (
                <p className="mt-1 text-[12.5px] text-muted-foreground">Searching…</p>
              ) : found ? (
                <p className="mt-1 text-[12.5px]">
                  Already onboarded as <span className="font-medium">{found.name}</span> ·{" "}
                  {found.engagements} engagement{found.engagements === 1 ? "" : "s"}. No duplicate
                  is created.
                </p>
              ) : (
                <div className="mt-1 space-y-2">
                  <p className="text-[12.5px] text-muted-foreground">
                    New to Cloud Delivery. A profile is created with this TPID.
                  </p>
                  <div className="space-y-1">
                    <Label htmlFor="customer-name" className="text-xs">
                      Name the team uses
                    </Label>
                    <Input
                      id="customer-name"
                      value={finalName}
                      placeholder="e.g. ExxonMobil"
                      onChange={(ev) => setName(ev.target.value)}
                    />
                  </div>
                </div>
              )}
              <ul aria-label="Sources" className="mt-3 space-y-0.5 text-[12px]">
                <li className="flex items-center gap-1.5">
                  {snap ? (
                    <Check className="size-3 text-success" />
                  ) : (
                    <CircleAlert className="size-3 text-warning" />
                  )}
                  MSX:{" "}
                  {live ? "read now" : snap ? `snapshot ${ago(snap.fetchedAt)}` : "not available"}
                </li>
                <li className="flex items-center gap-1.5">
                  {(found?.context ?? []).some((x) => !x.msx) ? (
                    <Check className="size-3 text-success" />
                  ) : (
                    <CircleAlert className="size-3 text-warning" />
                  )}
                  Notes, emails, transcripts: {(found?.context ?? []).filter((x) => !x.msx).length}
                </li>
                <li className="flex items-center gap-1.5">
                  <Check className="size-3 text-muted-foreground" />
                  Earlier engagements: {found?.engagements ?? 0}
                </li>
                <li className="flex items-center gap-1.5">
                  <Check className="size-3 text-muted-foreground" />
                  AI drafting: {assist.data?.configured ? "available" : "not configured"}
                </li>
              </ul>
              {!confirmed && (
                <div className="mt-3 flex justify-end">
                  <Button
                    disabled={
                      confirm.isPending ||
                      existing.isLoading ||
                      msx.isFetching ||
                      (!found && finalName.trim().length < 2)
                    }
                    onClick={() => confirm.mutate()}
                  >
                    {found ? "This is the customer: continue" : "Save customer draft"}
                  </Button>
                </div>
              )}
            </section>
          </div>
        </>
      )}

      {confirmed && !valid && profile.data && (
        <p className="rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-[12.5px]">
          <span className="font-medium">{profile.data.name}</span> has no TPID yet, so there's
          nothing to read from MSX. Add the TPID above to pull the account and its opportunities, or
          continue without it.
        </p>
      )}

      {confirmed && customerId && (
        <div className="grid gap-3 lg:grid-cols-2">
          <section
            aria-label="Continue an engagement"
            className="rounded-xl border border-border bg-card p-4"
          >
            <h2 className="text-[13px] font-semibold">Continue an engagement</h2>
            {engagements.data?.length ? (
              <ul className="mt-2 space-y-1.5">
                {engagements.data.map((x) => (
                  <li key={x.id}>
                    <Link
                      to="/engagements/$engagementId"
                      params={{ engagementId: x.id }}
                      className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 hover:border-primary"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-medium">{x.name}</span>
                        <span className="text-[11.5px] text-muted-foreground">
                          {x.msx_opportunity_id ? `MSX ${x.msx_opportunity_id}` : "Proactive"} ·
                          updated {ago(x.updated_at)}
                        </span>
                      </span>
                      <span className="flex items-center gap-2">
                        <Pill tone={x.status === "draft" ? "warning" : "primary"}>
                          {x.status === "draft" ? "Preparing" : "Active"}
                        </Pill>
                        <ArrowRight className="size-4 text-muted-foreground" />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-[12.5px] text-muted-foreground">
                None yet for this customer.
              </p>
            )}
          </section>

          <section
            aria-label="Start a new engagement"
            className="rounded-xl border border-primary/30 bg-primary/[0.03] p-4"
          >
            <h2 className="text-[13px] font-semibold">Start a new engagement</h2>
            <p className="text-[12px] text-muted-foreground">
              Under an MSX opportunity, or proactive. It opens as a draft: you're preparing, nothing
              is committed.
            </p>
            <fieldset className="mt-2 space-y-1.5" aria-label="Which opportunity">
              {snap?.opportunities.map((o) => {
                const key = opportunityKey(o);
                const taken = linked.has(key);
                return (
                  <label
                    key={o.id}
                    className={cn(
                      "flex cursor-pointer gap-2.5 rounded-lg border px-3 py-2",
                      choice === key ? "border-primary bg-primary/5" : "border-border bg-card",
                    )}
                  >
                    <input
                      type="radio"
                      name="opp"
                      className="mt-1"
                      checked={choice === key}
                      onChange={() => setChoice(key)}
                    />
                    <span className="min-w-0 text-[12.5px]">
                      <span className="block font-medium">{o.name}</span>
                      <span className="block text-muted-foreground">
                        {[o.number, o.stage, o.solutionArea, o.owner && `owner ${o.owner}`]
                          .filter(Boolean)
                          .join(" · ")}
                        {taken && " · has an engagement (continues it)"}
                      </span>
                      <span className="mt-0.5 line-clamp-2 block text-foreground/80">
                        {o.description ?? "MSX has no description for this opportunity."}
                      </span>
                    </span>
                  </label>
                );
              })}
              <label
                className={cn(
                  "flex cursor-pointer gap-2.5 rounded-lg border px-3 py-2",
                  choice === "proactive" ? "border-primary bg-primary/5" : "border-border bg-card",
                )}
              >
                <input
                  type="radio"
                  name="opp"
                  className="mt-1"
                  checked={choice === "proactive"}
                  onChange={() => setChoice("proactive")}
                />
                <span className="text-[12.5px]">
                  <span className="block font-medium">Proactive: no opportunity yet</span>
                  <span className="block text-muted-foreground">
                    Link an MSX opportunity later, from the engagement.
                  </span>
                </span>
              </label>
            </fieldset>
            <div className="mt-3 flex justify-end">
              <Button disabled={!choice || prepare.isPending} onClick={() => prepare.mutate()}>
                Prepare discovery <ArrowRight className="size-4" />
              </Button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
