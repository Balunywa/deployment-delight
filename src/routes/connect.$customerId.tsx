import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Check, KeyRound, Loader2, Lock, Search, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { ArchitectureCanvas } from "@/components/architecture/ArchitectureCanvas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fromManifest } from "@/lib/architecture";
import { CUSTOMER_PLATFORM, inputsFor } from "@/lib/catalog";
import { demoSubscriptions, discoverPlatform } from "@/lib/discovery";
import { completeCustomerLink } from "@/lib/factory.functions";
import { customerQuery, organizationQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/connect/$customerId")({
  // ?preview lets the ISV see exactly what the customer's admin will see, even after access was granted.
  validateSearch: (s: Record<string, unknown>): { preview?: boolean } =>
    s["preview"] ? { preview: true } : {},
  head: () => ({
    meta: [
      { title: "Connect your Azure" },
      {
        name: "description",
        content:
          "Review what will be deployed into your Azure subscription and grant scoped, revocable access.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Connect,
});

type EnvRow = {
  environment_type: string;
  region: string;
  offerings: { name: string; offering_type: string; network_profile: string | null } | null;
  desired: { version: string; manifest_json: unknown } | null;
};

function Connect() {
  const { customerId } = Route.useParams();
  const { preview } = Route.useSearch();
  const customer = useQuery(customerQuery(customerId));
  const org = useQuery(organizationQuery);
  const [tenantId, setTenantId] = useState("");
  const [subscription, setSubscription] = useState<string | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [found, setFound] = useState<Record<string, string[]> | null>(null);
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);

  const grant = useMutation({
    mutationFn: useServerFn(completeCustomerLink),
    onSuccess: () => setDone(true),
    onError: (e: Error) => toast.error(e.message),
  });

  const c = customer.data;
  const envs = ((c?.environments ?? []) as unknown as EnvRow[])
    .slice()
    .sort((a) => (a.environment_type === "production" ? -1 : 1));
  const prod = envs[0];
  const arch = useMemo(
    () => (prod?.offerings ? fromManifest(prod.offerings, prod.desired?.manifest_json) : null),
    [prod],
  );
  const isv = org.data?.name ?? "Your vendor";
  const connectionStatus = ((c?.customer_connections ?? []) as { status: string }[])[0]?.status;

  if (customer.isLoading)
    return (
      <Shell isv={isv}>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </Shell>
    );
  if (!c || !arch || !prod)
    return (
      <Shell isv={isv}>
        <p className="text-sm">This install link is not valid.</p>
      </Shell>
    );

  const hub = arch.topology.landing === "existing-customer-hub";
  const extra = inputsFor(arch.selected, arch.topology).filter(
    (i) => i.source === "customer" && i.from !== "Customer platform" && i.key !== "subscriptionId",
  );
  const subs = demoSubscriptions(c.customer_code);
  const needs = hub ? CUSTOMER_PLATFORM.map((p) => p.input) : [];
  const ready = !!tenantId && !!subscription && (!hub || needs.every((k) => chosen[k]));

  if (done || (connectionStatus === "validated" && !preview))
    return (
      <Shell isv={isv}>
        <div className="mx-auto max-w-lg rounded-md border border-border bg-card p-6 text-center">
          <span className="mx-auto grid size-10 place-items-center rounded-full bg-success text-white">
            <Check className="size-5" />
          </span>
          <h1 className="mt-3 text-lg font-semibold">Access granted</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isv} has been notified. They will validate your landing zone and send you a deployment
            plan to approve before anything is created.
          </p>
          <p className="mt-4 text-xs text-muted-foreground">
            You can revoke access at any time by removing the federated credential in your tenant.
          </p>
        </div>
      </Shell>
    );

  const discover = () => {
    setDiscovering(true);
    setTimeout(() => {
      const f = discoverPlatform(c.customer_code, subscription ?? "");
      setFound(f);
      setChosen(Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v[0] ?? ""])));
      setDiscovering(false);
    }, 900);
  };

  return (
    <Shell isv={isv}>
      <div className="mb-6">
        <p className="text-xs text-muted-foreground">Prepared for {c.name}</p>
        <h1 className="mt-0.5 text-[24px] font-semibold">
          Connect your Azure to {isv} {prod.offerings?.name}
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          {isv} deploys the same governed architecture for every customer. Review what will land in
          your subscription, then grant scoped access. Nothing is deployed until you approve a plan.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <section>
          <h2 className="mb-2 text-sm font-semibold">What will be deployed</h2>
          <ArchitectureCanvas
            selected={arch.selected}
            topology={{ ...arch.topology, regions: [prod.region] }}
            bindings={{ ...chosen, ...(subscription ? { subscriptionId: subscription } : {}) }}
            installName={`${c.customer_code}-prod`}
            compact
          />
          <ul className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
            <li className="flex gap-2">
              <Lock className="size-3.5 shrink-0 text-success" /> Private endpoints only — no public
              network access
            </li>
            <li className="flex gap-2">
              <KeyRound className="size-3.5 shrink-0 text-success" /> Managed identity and federated
              credentials — no secrets
            </li>
            <li className="flex gap-2">
              <ShieldCheck className="size-3.5 shrink-0 text-success" /> Your Azure Policy is
              evaluated before every deployment
            </li>
            {hub && (
              <li className="flex gap-2">
                <Check className="size-3.5 shrink-0 text-success" /> Your hub, firewall, DNS and SOC
                workspace are used, never changed
              </li>
            )}
          </ul>
        </section>

        <section className="space-y-4">
          <Step n={1} title="Sign in and choose a subscription" done={!!tenantId && !!subscription}>
            <Label className="text-xs">Entra tenant ID</Label>
            <Input
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
              placeholder="00000000-0000-0000-0000-000000000000"
              className="mt-1 font-mono text-xs"
            />
            <button
              onClick={() => setTenantId("8f1c2b64-9a71-4c2e-9d55-7c3e1a0b4d21")}
              className="mt-1 text-[11px] text-primary hover:underline"
            >
              Sign in with Microsoft (demo)
            </button>
            {tenantId && (
              <div className="mt-3 space-y-1.5">
                <p className="text-xs text-muted-foreground">Subscriptions you can administer</p>
                {subs.map((s) => (
                  <label
                    key={s.id}
                    className={cn(
                      "flex cursor-pointer items-center gap-2 rounded-sm border px-2.5 py-2 text-xs",
                      subscription === s.id ? "border-primary bg-primary/5" : "border-border",
                    )}
                  >
                    <input
                      type="radio"
                      checked={subscription === s.id}
                      onChange={() => setSubscription(s.id)}
                      className="accent-[var(--color-primary)]"
                    />
                    <span className="font-medium">{s.name}</span>
                    <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                      {s.id.slice(0, 8)}…
                    </span>
                  </label>
                ))}
              </div>
            )}
          </Step>

          {hub && (
            <Step
              n={2}
              title="Confirm your platform resources"
              done={!!found && needs.every((k) => chosen[k])}
              disabled={!subscription}
            >
              {!found ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!subscription || discovering}
                  onClick={discover}
                >
                  {discovering ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Search className="size-3.5" />
                  )}
                  {discovering
                    ? "Scanning with Resource Graph…"
                    : "Discover hub, DNS and workspace"}
                </Button>
              ) : (
                <div className="space-y-3">
                  {CUSTOMER_PLATFORM.map((p) => (
                    <div key={p.id}>
                      <p className="text-xs font-medium">{p.name}</p>
                      {(found[p.input] ?? []).map((v) => (
                        <label
                          key={v}
                          className={cn(
                            "mt-1 flex cursor-pointer items-center gap-2 rounded-sm border px-2 py-1.5",
                            chosen[p.input] === v ? "border-primary bg-primary/5" : "border-border",
                          )}
                        >
                          <input
                            type="radio"
                            checked={chosen[p.input] === v}
                            onChange={() => setChosen({ ...chosen, [p.input]: v })}
                            className="accent-[var(--color-primary)]"
                          />
                          <span className="truncate font-mono text-[11px]" title={v}>
                            {v.split("/").slice(-1)[0]}
                          </span>
                        </label>
                      ))}
                    </div>
                  ))}
                  <p className="text-[11px] text-muted-foreground">
                    Demo discovery — in production this is a read-only Resource Graph query.
                  </p>
                </div>
              )}
            </Step>
          )}

          {extra.length > 0 && (
            <Step
              n={hub ? 3 : 2}
              title="A few details"
              done={extra.every((i) => chosen[i.key])}
              disabled={!subscription}
            >
              {extra.map((i) => (
                <div key={i.key} className="mb-2">
                  <Label className="text-xs">{i.label}</Label>
                  <Input
                    value={chosen[i.key] ?? ""}
                    onChange={(e) => setChosen({ ...chosen, [i.key]: e.target.value })}
                    className="mt-1 text-xs"
                  />
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{i.help}</p>
                </div>
              ))}
            </Step>
          )}

          <Step
            n={hub ? (extra.length ? 4 : 3) : extra.length ? 3 : 2}
            title="Grant access"
            disabled={!ready}
          >
            <p className="text-xs text-muted-foreground">
              Creates a federated identity for {isv} with{" "}
              <b className="text-foreground">Contributor</b> on one new resource group and{" "}
              <b className="text-foreground">Reader</b> on the selected subscription. Revocable at
              any time.
            </p>
            <Button
              className="mt-3 w-full"
              disabled={!ready || grant.isPending}
              onClick={() =>
                grant.mutate({
                  data: {
                    customerId,
                    tenantId,
                    subscriptionId: subscription ?? "",
                    inputs: chosen,
                    grantedBy: `${c.name} administrator`,
                  },
                })
              }
            >
              {grant.isPending ? "Granting…" : `Approve access for ${isv}`}
            </Button>
          </Step>
        </section>
      </div>
    </Shell>
  );
}

function Shell({ isv, children }: { isv: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-2.5">
            <span className="grid size-7 place-items-center rounded-sm bg-primary text-[12px] font-bold text-primary-foreground">
              {isv.slice(0, 1)}
            </span>
            <span className="text-sm font-semibold">{isv}</span>
          </div>
          <span className="text-xs text-muted-foreground">
            Secure install · no credentials are shared
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}

function Step({
  n,
  title,
  done,
  disabled,
  children,
}: {
  n: number;
  title: string;
  done?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("rounded-md border border-border bg-card p-4", disabled && "opacity-50")}>
      <p className="mb-2.5 flex items-center gap-2 text-[13px] font-semibold">
        <span
          className={cn(
            "grid size-5 place-items-center rounded-full border text-[11px]",
            done ? "border-success bg-success text-white" : "border-border-strong",
          )}
        >
          {done ? <Check className="size-3" /> : n}
        </span>
        {title}
      </p>
      <fieldset disabled={disabled}>{children}</fieldset>
    </div>
  );
}
