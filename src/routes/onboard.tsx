import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Check, Copy, ExternalLink, Mail, UserCog } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { ArchitectureCanvas } from "@/components/architecture/ArchitectureCanvas";
import { ServiceIcon } from "@/components/architecture/ServiceIcon";
import { Pill } from "@/components/Primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CONNECTION_LABEL, LANDING_LABEL, fromManifest } from "@/lib/architecture";
import { SERVICE_BY_ID, inputsFor, monthlyEstimate } from "@/lib/catalog";
import { discoverPlatform } from "@/lib/discovery";
import { createDeployment, onboardCustomer } from "@/lib/factory.functions";
import { semverCompare } from "@/lib/fleet";
import { currency, titleize } from "@/lib/format";
import { offeringsQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/onboard")({
  head: () => ({
    meta: [
      { title: "Onboard customer · Cloud Delivery" },
      {
        name: "description",
        content:
          "Onboard a customer onto a published offering: pick the offering, bind the customer's Azure, plan and deploy.",
      },
      { property: "og:title", content: "Onboard customer · Cloud Delivery" },
      {
        property: "og:description",
        content: "Customer onboarding is configuration, not a project.",
      },
    ],
  }),
  component: Onboard,
});

const STEPS = ["Customer & offering", "Environments", "Where it runs", "Review"] as const;
type Env = "development" | "test" | "qa" | "staging" | "production";

function Onboard() {
  const offerings = useQuery(offeringsQuery);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);
  const [customer, setCustomer] = useState({
    name: "Metro Energy",
    code: "metro-energy-2",
    industry: "Electric utility",
  });
  const [offeringId, setOfferingId] = useState<string>("");
  const [envs, setEnvs] = useState<Env[]>(["production"]);
  const [region, setRegion] = useState("eastus2");
  const [access, setAccess] = useState<"customer_link" | "engineer">("engineer");
  const [connection, setConnection] = useState("federated_identity");
  const [tenantId, setTenantId] = useState("8f1c2b64-9a71-4c2e-9d55-7c3e1a0b4d21");
  const [managementGroupId, setManagementGroupId] = useState("mg-metro-landingzones-corp");
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [created, setCreated] = useState<{
    customerId: string;
    environments: { id: string; name: string; environment_type: string }[];
    version: string;
  } | null>(null);

  const published = (offerings.data ?? [])
    .map((o) => {
      const v = (
        (o.offering_versions ?? []) as {
          id: string;
          version: string;
          status: string;
          manifest_json: unknown;
        }[]
      )
        .filter((x) => x.status === "published")
        .sort((a, b) => semverCompare(b.version, a.version))[0];
      return v ? { offering: o, version: v, arch: fromManifest(o, v.manifest_json) } : null;
    })
    .filter((x): x is NonNullable<typeof x> => !!x);
  const pick =
    published.find((p) => p.offering.id === offeringId) ??
    published.find((p) => p.offering.offering_type === "enterprise_private");
  const arch = useMemo(
    () => (pick ? { ...pick.arch, topology: { ...pick.arch.topology, regions: [region] } } : null),
    [pick, region],
  );
  const required = arch ? inputsFor(arch.selected, arch.topology) : [];
  const hub = arch?.topology.landing === "existing-customer-hub";
  const hosted = arch?.topology.landing === "isv-hosted";
  const discovered = discoverPlatform(customer.code, inputs["subscriptionId"] ?? "2f8a7d11");
  const value = (k: string) =>
    inputs[k] ??
    (k === "subscriptionId"
      ? hosted
        ? `sub-gridworks-hosted-${customer.code}`
        : "2f8a7d11-4c39-4f85-b1de-93c7f6a52e10"
      : k === "customerSignInDomain"
        ? `${customer.code}.example`
        : (discovered[k]?.[0] ?? ""));
  const monthly = arch ? monthlyEstimate(arch.selected) : 0;
  const quote = envs.reduce((s, e) => s + (e === "production" ? monthly : monthly * 0.3), 0);

  const onboard = useMutation({
    mutationFn: useServerFn(onboardCustomer),
    onSuccess: (r) => {
      setCreated(r as typeof created);
      void queryClient.invalidateQueries({ queryKey: ["customers"] });
      void queryClient.invalidateQueries({ queryKey: ["estate"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const plan = useMutation({
    mutationFn: useServerFn(createDeployment),
    onSuccess: (r: { deploymentId: string }) => {
      void queryClient.invalidateQueries({ queryKey: ["deployments"] });
      void navigate({ to: "/deployments/$deploymentId", params: { deploymentId: r.deploymentId } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!pick || !arch) return <p className="text-sm text-muted-foreground">Loading offerings…</p>;

  const submit = () => {
    const bound = Object.fromEntries(required.map((i) => [i.key, value(i.key)]));
    if (hosted) {
      onboard.mutate({
        data: {
          name: customer.name,
          customerCode: customer.code,
          industry: customer.industry,
          accessMethod: "engineer",
          subscriptionId: value("subscriptionId"),
          managementGroupId: "mg-gridworks-hosted",
          azureModel: "isv_hosted",
          connectionType: "new_subscription",
          offeringId: pick.offering.id,
          region,
          environments: envs,
          inputs: bound,
          network: {
            mode: "isv-hosted",
            privateEndpoints: arch.topology.privateEndpoints,
            publicAccess: arch.topology.publicAccess,
          },
          observability: { useCustomerWorkspace: false },
        },
      });
      return;
    }
    onboard.mutate({
      data: {
        name: customer.name,
        customerCode: customer.code,
        industry: customer.industry,
        accessMethod: access,
        ...(access === "engineer"
          ? {
              tenantId,
              subscriptionId: value("subscriptionId"),
              ...(managementGroupId ? { managementGroupId } : {}),
            }
          : {}),
        azureModel: hub ? "existing_enterprise_alz" : "greenfield",
        connectionType: connection as "federated_identity",
        offeringId: pick.offering.id,
        region,
        environments: envs,
        inputs: access === "engineer" ? bound : {},
        network: {
          mode: hub ? "existing-customer-hub" : "dedicated-spoke",
          ...(access === "engineer" && hub ? { vnetId: value("vnetId") } : {}),
          privateEndpoints: arch.topology.privateEndpoints,
          publicAccess: arch.topology.publicAccess,
        },
        observability: {
          useCustomerWorkspace: hub,
          ...(access === "engineer" && hub
            ? { logAnalyticsWorkspaceId: value("logAnalyticsWorkspaceId") }
            : {}),
        },
      },
    });
  };

  const link =
    created && typeof window !== "undefined"
      ? `${window.location.origin}/connect/${created.customerId}`
      : "";
  const prodEnv =
    created?.environments.find((e) => e.environment_type === "production") ??
    created?.environments[0];

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-5">
        <p className="text-xs text-muted-foreground">Customers / Onboard</p>
        <h1 className="text-[22px] font-semibold">Onboard a customer</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Nothing to design — pick a published offering and bind it to the customer's Azure. Same
          architecture, same pipeline, every customer.
        </p>
      </div>

      <ol className="mb-5 flex items-center gap-2 text-[13px]">
        {STEPS.map((label, i) => (
          <li key={label} className="flex items-center gap-2">
            <button
              disabled={i > step || !!created}
              onClick={() => setStep(i)}
              className={cn(
                "flex items-center gap-2",
                i === step
                  ? "font-medium text-foreground"
                  : i < step
                    ? "text-foreground"
                    : "text-muted-foreground",
              )}
            >
              <span
                className={cn(
                  "grid size-5 place-items-center rounded-full border text-[11px]",
                  i < step || created
                    ? "border-success bg-success text-white"
                    : i === step
                      ? "border-primary text-primary"
                      : "border-border",
                )}
              >
                {i < step || created ? <Check className="size-3" /> : i + 1}
              </span>
              {label}
            </button>
            {i < STEPS.length - 1 && <span className="h-px w-8 bg-border" />}
          </li>
        ))}
      </ol>

      {created ? (
        <Done
          access={hosted ? "engineer" : access}
          customerId={created.customerId}
          name={customer.name}
          link={link}
          version={created.version}
          canPlan={(hosted || access === "engineer") && !!prodEnv}
          planning={plan.isPending}
          onPlan={() =>
            prodEnv &&
            plan.mutate({
              data: {
                environmentId: prodEnv.id,
                deploymentType: "initial",
                requestedBy: "Sarah Chen",
              },
            })
          }
        />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0 space-y-4">
            {step === 0 && (
              <>
                <Card title="Customer">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field
                      label="Name"
                      value={customer.name}
                      onChange={(v) => setCustomer({ ...customer, name: v })}
                    />
                    <Field
                      label="Customer code"
                      value={customer.code}
                      onChange={(v) => setCustomer({ ...customer, code: v })}
                      hint="Used in resource names"
                    />
                    <Field
                      label="Industry"
                      value={customer.industry}
                      onChange={(v) => setCustomer({ ...customer, industry: v })}
                    />
                  </div>
                </Card>
                <Card
                  title="Offering"
                  subtitle="Published offerings only. Each one is a fixed, versioned architecture."
                >
                  <div className="grid gap-2 sm:grid-cols-2">
                    {published.map((p) => (
                      <button
                        key={p.offering.id}
                        onClick={() => setOfferingId(p.offering.id)}
                        className={cn(
                          "rounded-md border p-3 text-left transition-colors",
                          p.offering.id === pick.offering.id
                            ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                            : "border-border hover:border-border-strong",
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[13px] font-semibold">{p.offering.name}</p>
                          <span className="font-mono text-[11px] text-muted-foreground">
                            v{p.version.version}
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {LANDING_LABEL[p.arch.topology.landing].title}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-1">
                          {p.arch.selected
                            .filter(
                              (s) =>
                                !SERVICE_BY_ID.get(s.id)?.locked &&
                                s.id !== "private-endpoints" &&
                                s.id !== "network-spoke",
                            )
                            .map((s) => (
                              <span key={s.id} title={SERVICE_BY_ID.get(s.id)?.name}>
                                <ServiceIcon id={s.id} size="sm" />
                              </span>
                            ))}
                        </div>
                      </button>
                    ))}
                  </div>
                </Card>
              </>
            )}

            {step === 1 && (
              <Card
                title="Environments & region"
                subtitle="Each environment is an install of the same architecture."
              >
                <div className="flex flex-wrap gap-2">
                  {(arch.topology.environments as Env[]).map((e) => {
                    const on = envs.includes(e);
                    return (
                      <button
                        key={e}
                        onClick={() => setEnvs(on ? envs.filter((x) => x !== e) : [...envs, e])}
                        className={cn(
                          "flex items-center gap-2 rounded-md border px-3 py-2 text-[13px]",
                          on
                            ? "border-primary bg-primary/5 font-medium"
                            : "border-border text-muted-foreground",
                        )}
                      >
                        <span
                          className={cn(
                            "grid size-4 place-items-center rounded-[3px] border",
                            on ? "border-primary bg-primary text-white" : "border-border-strong",
                          )}
                        >
                          {on && <Check className="size-3" />}
                        </span>
                        {titleize(e)}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-4 max-w-xs">
                  <Label className="text-xs">Primary region</Label>
                  <Select value={region} onValueChange={setRegion}>
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {pick.arch.topology.regions.map((r) => (
                        <SelectItem key={r} value={r}>
                          {r}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </Card>
            )}

            {step === 2 && hosted && (
              <Card
                title={`Runs in your Azure — nothing needed from ${customer.name}'s IT`}
                subtitle="A dedicated environment is created for this customer in your own Azure subscription pool. The customer doesn't need Azure, and no access has to be granted."
              >
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between gap-3 rounded-sm border border-border px-3 py-2">
                    <div>
                      <p className="text-[13px] font-medium">Hosting subscription</p>
                      <p className="font-mono text-[11px] text-muted-foreground">
                        {value("subscriptionId")}
                      </p>
                    </div>
                    <Pill tone="neutral">Created automatically</Pill>
                  </div>
                  <Field
                    label="Customer sign-in domain"
                    value={value("customerSignInDomain")}
                    onChange={(v) => setInputs({ ...inputs, customerSignInDomain: v })}
                    hint="Their users sign in to your product with their own work accounts."
                  />
                </div>
              </Card>
            )}

            {step === 2 && !hosted && (
              <>
                <Card title="How will the customer grant access?">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Choice
                      on={access === "customer_link"}
                      onClick={() => setAccess("customer_link")}
                      icon={<Mail className="size-4" />}
                      title="Send an install link (recommended)"
                      body="Their Azure admin signs in, picks the subscription and approves access. Hub, DNS and workspace are discovered — you never handle their IDs."
                    />
                    <Choice
                      on={access === "engineer"}
                      onClick={() => setAccess("engineer")}
                      icon={<UserCog className="size-4" />}
                      title="I have the details"
                      body="Enter the customer's tenant and platform resources yourself, e.g. from a completed intake form."
                    />
                  </div>
                  <div className="mt-3 max-w-sm">
                    <Label className="text-xs">Access model</Label>
                    <Select value={connection} onValueChange={setConnection}>
                      <SelectTrigger className="mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[
                          "federated_identity",
                          "lighthouse",
                          "managed_application",
                          "existing_subscription",
                        ].map((c) => (
                          <SelectItem key={c} value={c}>
                            {CONNECTION_LABEL[c]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </Card>

                <Card
                  title="Customer bindings"
                  subtitle={`These ${required.length} values are all the architecture needs from ${customer.name}. They were derived from the offering — nothing else is asked.`}
                >
                  <div className="space-y-2.5">
                    {access === "engineer" && (
                      <>
                        <Field
                          label="Entra tenant ID"
                          value={tenantId}
                          onChange={setTenantId}
                          mono
                        />
                        <Field
                          label="Management group (optional)"
                          value={managementGroupId}
                          onChange={setManagementGroupId}
                          hint="Only if the customer granted management-group scope; tenant-level steps are skipped otherwise."
                          mono
                        />
                      </>
                    )}
                    {required.map((i) =>
                      access === "engineer" ? (
                        <Field
                          key={i.key}
                          label={i.label}
                          value={value(i.key)}
                          onChange={(v) => setInputs({ ...inputs, [i.key]: v })}
                          hint={`${i.key} · ${i.help}`}
                          mono
                        />
                      ) : (
                        <div
                          key={i.key}
                          className="flex items-center justify-between gap-3 rounded-sm border border-border px-3 py-2"
                        >
                          <div>
                            <p className="text-[13px] font-medium">{i.label}</p>
                            <p className="text-[11px] text-muted-foreground">{i.help}</p>
                          </div>
                          <Pill tone={i.source === "customer" ? "info" : "neutral"}>
                            {i.from === "Customer platform" || i.key === "subscriptionId"
                              ? "Discovered via link"
                              : i.source === "customer"
                                ? "Customer enters"
                                : "Your team"}
                          </Pill>
                        </div>
                      ),
                    )}
                  </div>
                </Card>
              </>
            )}

            {step === 3 && (
              <Card
                title={`What lands in ${customer.name}'s Azure`}
                subtitle={`${pick.offering.name} v${pick.version.version} · ${envs.length} environment(s) · ${region}`}
              >
                <ArchitectureCanvas
                  selected={arch.selected}
                  topology={arch.topology}
                  bindings={
                    access === "engineer"
                      ? Object.fromEntries(required.map((i) => [i.key, value(i.key)]))
                      : {}
                  }
                  installName={`${customer.code}-prod`}
                  compact
                />
              </Card>
            )}

            <div className="flex justify-between">
              <Button variant="outline" disabled={step === 0} onClick={() => setStep(step - 1)}>
                Back
              </Button>
              {step < STEPS.length - 1 ? (
                <Button disabled={step === 1 && !envs.length} onClick={() => setStep(step + 1)}>
                  Continue
                </Button>
              ) : (
                <Button disabled={onboard.isPending || !envs.length} onClick={submit}>
                  {onboard.isPending
                    ? "Creating…"
                    : access === "customer_link"
                      ? "Create customer & install link"
                      : "Create customer"}
                </Button>
              )}
            </div>
          </div>

          <aside className="h-fit rounded-md border border-border bg-card p-4 lg:sticky lg:top-16">
            <p className="text-[13px] font-semibold">{customer.name || "New customer"}</p>
            <dl className="mt-3 space-y-1.5 text-xs">
              <Row k="Offering" v={`${pick.offering.name} v${pick.version.version}`} />
              <Row k="Runs in" v={LANDING_LABEL[arch.topology.landing].title} />
              <Row k="Environments" v={envs.map(titleize).join(", ") || "—"} />
              <Row k="Region" v={region} />
              <Row k="Resources per install" v={String(arch.selected.length)} />
              <Row k="Customer inputs" v={String(required.length)} />
              <Row
                k="Access"
                v={
                  hosted
                    ? "None needed — runs in your Azure"
                    : access === "customer_link"
                      ? "Install link"
                      : (CONNECTION_LABEL[connection] ?? connection)
                }
              />
            </dl>
            <div className="mt-4 border-t border-border pt-3">
              <p className="text-xs text-muted-foreground">
                {hosted
                  ? "Your Azure cost for this customer (estimate)"
                  : "Quote · customer's Azure bill (estimate)"}
              </p>
              <p className="mt-0.5 font-mono text-lg font-semibold">
                {currency(quote)}
                <span className="text-xs font-normal text-muted-foreground"> / month</span>
              </p>
              <p className="text-[11px] text-muted-foreground">
                List-price estimate from the offering's services; non-production at ~30%.
              </p>
            </div>
            <div className="mt-4 border-t border-border pt-3 text-[11px] text-muted-foreground">
              No per-customer IaC, repository or pipeline is created. This customer runs{" "}
              <Link
                to="/offerings"
                search={{ offering: pick.offering.id, view: "pipeline" }}
                className="text-primary hover:underline"
              >
                the {pick.offering.name} pipeline
              </Link>{" "}
              with their parameters.
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

function Done({
  access,
  customerId,
  name,
  link,
  version,
  canPlan,
  planning,
  onPlan,
}: {
  access: "customer_link" | "engineer";
  customerId: string;
  name: string;
  link: string;
  version: string;
  canPlan: boolean;
  planning: boolean;
  onPlan: () => void;
}) {
  return (
    <div className="max-w-2xl rounded-md border border-border bg-card p-5">
      <p className="flex items-center gap-2 text-[15px] font-semibold">
        <span className="grid size-5 place-items-center rounded-full bg-success text-white">
          <Check className="size-3" />
        </span>
        {name} created on v{version}
      </p>
      {access === "customer_link" ? (
        <>
          <p className="mt-2 text-sm text-muted-foreground">
            Send this link to {name}'s Azure administrator. When they approve access, the customer
            moves to <b>Ready to plan</b> and their platform resources are bound automatically.
          </p>
          <div className="mt-3 flex items-center gap-2 rounded-sm border border-border bg-muted/50 px-3 py-2">
            <code className="min-w-0 flex-1 truncate font-mono text-xs">{link}</code>
            <button
              onClick={() => {
                void navigator.clipboard.writeText(link);
                toast.success("Install link copied");
              }}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Copy link"
            >
              <Copy className="size-3.5" />
            </button>
          </div>
          <div className="mt-4 flex gap-2">
            <a
              href={link}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-sm border border-border px-3 py-1.5 text-[13px] font-medium hover:bg-muted"
            >
              <ExternalLink className="size-3.5" /> Open as customer
            </a>
            <Link
              to="/customers/$customerId"
              params={{ customerId }}
              className="rounded-sm bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground"
            >
              Go to customer
            </Link>
          </div>
        </>
      ) : (
        <>
          <p className="mt-2 text-sm text-muted-foreground">
            Details recorded. Run the checks and generate the production plan — it opens as a
            pipeline run that waits for approval.
          </p>
          <div className="mt-4 flex gap-2">
            <Button disabled={!canPlan || planning} onClick={onPlan}>
              {planning ? "Validating & planning…" : "Validate & plan production"}
            </Button>
            <Link
              to="/customers/$customerId"
              params={{ customerId }}
              className="rounded-sm border border-border px-3 py-1.5 text-[13px] font-medium hover:bg-muted"
            >
              Go to customer
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-md border border-border bg-card p-4">
      <h2 className="text-[13px] font-semibold">{title}</h2>
      {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Choice({
  on,
  onClick,
  icon,
  title,
  body,
}: {
  on: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-md border p-3 text-left transition-colors",
        on
          ? "border-primary bg-primary/5 ring-1 ring-primary/30"
          : "border-border hover:border-border-strong",
      )}
    >
      <p className="flex items-center gap-2 text-[13px] font-semibold">
        {icon}
        {title}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{body}</p>
    </button>
  );
}

function Field({
  label,
  value,
  onChange,
  hint,
  mono,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  mono?: boolean;
}) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn("mt-1", mono && "font-mono text-xs")}
      />
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="truncate text-right font-medium">{v}</dd>
    </div>
  );
}
