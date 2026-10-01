import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  ArrowLeft,
  Award,
  Check,
  ExternalLink,
  GitCommit,
  LifeBuoy,
  Mail,
  Plus,
  Rocket,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ServiceIcon } from "@/components/architecture/ServiceIcon";
import { MaturityBadge, OwnerAvatar } from "@/components/catalog/Badges";
import {
  Benefits,
  DeployWithConfidence,
  HowItWorks,
  SectionNav,
  type StoryModel,
} from "@/components/catalog/SolutionStory";
import { UnitCard } from "@/components/delivery/UnitCard";
import { EmptyState, Pill } from "@/components/Primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fromManifest, sourceFromManifest } from "@/lib/architecture";
import { SERVICE_BY_ID } from "@/lib/catalog";
import { relative, shortDate } from "@/lib/format";
import { modelOf } from "@/lib/product-catalog";
import { benefits } from "@/lib/solution-story";
import { currentUserQuery, solutionQuery } from "@/lib/queries";
import {
  IAC_LABEL,
  MATURITY,
  type Maturity,
  OWNER_REVIEW_DAYS,
  OWNER_ROLES,
  type Owner,
  PLUMBING,
  asMaturity,
  isOwner,
  ownerConfirmationDue,
  ownersOf,
  runsIn,
} from "@/lib/solutions";
import { confirmOwnership, setFeatured, updateOwners } from "@/lib/solutions.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/products/$productId")({
  head: () => ({ meta: [{ title: "Solution · Cloud Delivery" }] }),
  component: SolutionPage,
});

type Check = { id: string; level: string; title: string; detail: string };
const rec = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const EVENT_LABEL: Record<string, string> = {
  "product.submitted": "submitted this solution",
  "catalog.source_imported": "imported the source",
  "product.ownership_confirmed": "confirmed ownership",
  "product.owners_changed": "changed the owners",
  "product.featured": "featured it",
  "product.unfeatured": "removed it from featured",
};

function SolutionPage() {
  const { productId } = Route.useParams();
  const queryClient = useQueryClient();
  const solution = useQuery(solutionQuery(productId));
  const me = useQuery(currentUserQuery).data;
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["solution", productId] });
    void queryClient.invalidateQueries({ queryKey: ["products"] });
  };
  const confirm = useMutation({
    mutationFn: useServerFn(confirmOwnership),
    onSuccess: () => {
      toast.success(`Ownership confirmed for another ${OWNER_REVIEW_DAYS} days.`);
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const feature = useMutation({
    mutationFn: useServerFn(setFeatured),
    onSuccess: (r: { maturity: string }) => {
      toast.success(r.maturity === "featured" ? "Solution featured." : "No longer featured.");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (solution.isLoading) return <EmptyState title="Loading solution…" />;
  if (!solution.data)
    return (
      <EmptyState
        title="Solution not found"
        description={solution.error?.message ?? "It may have been removed."}
      />
    );

  const { product: p, offerings, activity } = solution.data;
  const owners = ownersOf(p.owners);
  const maturity = asMaturity(p.maturity);
  const mine = isOwner(owners, me);
  const due = ownerConfirmationDue(p.owner_confirmed_at);
  const contact = owners.find((o) => o.email);

  const latest = offerings.map((o) => {
    const published = o.versions.find((v) => v.status === "published");
    const newest = o.versions[0];
    const manifest = rec((published ?? newest)?.manifest_json);
    const importChecks = (
      Array.isArray(rec(rec(newest?.manifest_json)["catalogImport"])["checks"])
        ? rec(rec(newest?.manifest_json)["catalogImport"])["checks"]
        : []
    ) as Check[];
    return { o, published, newest, manifest, importChecks };
  });
  const services = [
    ...new Set(
      latest.flatMap(({ manifest }) =>
        ((manifest["modules"] ?? []) as { name: string }[]).map((m) => m.name),
      ),
    ),
  ].filter((id) => SERVICE_BY_ID.has(id));
  const source = latest
    .map(({ newest }) => sourceFromManifest(newest?.manifest_json))
    .find(Boolean);
  const blockers = latest.flatMap(({ importChecks }) =>
    importChecks.filter((c) => c.level === "blocking"),
  );
  const deployable = latest.find((x) => x.published);
  const models: StoryModel[] = latest
    .filter(({ manifest }) => Array.isArray(manifest["modules"]))
    .map(({ o, published, newest, manifest }) => ({
      id: o.id,
      name: modelOf(o.name),
      version: (published ?? newest)?.version ?? null,
      published: !!published,
      arch: fromManifest(o, manifest),
    }));
  const story = benefits({
    product: p,
    services,
    models: latest.map(({ o }) => ({
      name: modelOf(o.name),
      runsIn: runsIn(o.offering_type),
      installs: o.installs,
    })),
  });

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <Link
        to="/products"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" /> Solution catalog
      </Link>

      <header
        id="overview"
        className="flex scroll-mt-20 flex-wrap items-start justify-between gap-4"
      >
        <div className="min-w-0 max-w-3xl">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[24px] leading-tight font-bold">{p.name}</h1>
            <MaturityBadge maturity={maturity} />
          </div>
          <p className="mt-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
            {p.category ?? "Other"}
            {p.audience && ` · For ${p.audience}`}
          </p>
          <p className="mt-2 text-sm">{p.description}</p>
          {p.outcome && (
            <p className="mt-1.5 text-sm">
              <b className="font-semibold text-primary">Outcome</b> {p.outcome}
            </p>
          )}
          {p.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {p.tags.map((t) => (
                <span key={t} className="rounded-full bg-muted px-2 py-0.5 text-[11px]">
                  #{t}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {contact && (
            <Button asChild variant="outline">
              <a href={`mailto:${contact.email}?subject=${encodeURIComponent(p.name)}`}>
                <Mail className="size-4" /> Contact owner
              </a>
            </Button>
          )}
          {deployable ? (
            <Button asChild>
              <Link to="/onboard" search={{ product: p.id, offering: deployable.o.id }}>
                <Rocket className="size-4" /> Deploy to a customer
              </Link>
            </Button>
          ) : (
            <Button disabled title="Publish an offering that passes review first">
              <Rocket className="size-4" /> Not deployable yet
            </Button>
          )}
        </div>
      </header>

      <SectionNav />

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-5">
          <Benefits items={story} />
          <HowItWorks models={models} productName={p.name} />
          <Section
            id="models"
            title="Delivery models"
            sub="Each is a versioned offering with its own architecture review. Customers are deployed to a published version."
          >
            <table className="w-full text-left text-xs">
              <thead className="text-[11px] text-muted-foreground">
                <tr>
                  <th className="py-1.5 font-medium">Model</th>
                  <th className="py-1.5 font-medium">Runs in</th>
                  <th className="py-1.5 font-medium">Version</th>
                  <th className="py-1.5 font-medium">Deployments</th>
                  <th />
                </tr>
              </thead>
              <tbody className="divide-y">
                {latest.map(({ o, published, newest, importChecks }) => {
                  const failing = importChecks.filter((c) => c.level === "blocking").length;
                  return (
                    <tr key={o.id}>
                      <td className="py-2 font-medium">{modelOf(o.name)}</td>
                      <td className="py-2 text-muted-foreground">{runsIn(o.offering_type)}</td>
                      <td className="py-2">
                        {published ? (
                          <Pill tone="success">v{published.version} published</Pill>
                        ) : newest ? (
                          <Pill tone={failing ? "danger" : "warning"}>
                            v{newest.version} draft{failing ? ` · ${failing} blocking` : ""}
                          </Pill>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="py-2 font-mono">{o.installs}</td>
                      <td className="py-2 text-right whitespace-nowrap">
                        <Link
                          to="/offerings"
                          search={{ offering: o.id, view: published ? "architecture" : "review" }}
                          className="text-primary hover:underline"
                        >
                          {published ? "Architecture" : "Review"}
                        </Link>
                        {published && (
                          <>
                            {" · "}
                            <Link
                              to="/onboard"
                              search={{ product: p.id, offering: o.id }}
                              className="text-primary hover:underline"
                            >
                              Deploy
                            </Link>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Section>

          {blockers.length > 0 && (
            <Section
              title="What's blocking publication"
              sub="Found when the source was inspected. Fix these in the repository or the offering, then publish."
            >
              <ul className="space-y-2">
                {blockers.map((c, i) => (
                  <li key={`${c.id}${i}`} className="flex gap-2 text-xs">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-danger" />
                    <span>
                      <b className="font-medium">{c.title}</b>
                      <span className="block text-muted-foreground">{c.detail}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <DeployWithConfidence
            productId={p.id}
            models={models}
            source={
              source
                ? { repository: source.repository, iac: IAC_LABEL[source.iac] ?? source.iac }
                : null
            }
          />

          <Section title="What it's built from" sub="Azure services across its delivery models.">
            <div className="flex flex-wrap gap-1.5">
              {services.map((id) => (
                <span
                  key={id}
                  title={SERVICE_BY_ID.get(id)?.blurb}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md border py-1 pr-2 pl-1 text-xs",
                    PLUMBING.has(id) ? "text-muted-foreground" : "bg-card",
                  )}
                >
                  <ServiceIcon id={id} size="sm" />
                  {SERVICE_BY_ID.get(id)?.name}
                </span>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Greyed services are platform guardrails every solution gets: identity, network,
              private endpoints, monitoring and policy.
            </p>
          </Section>

          <Section title="Activity">
            {activity.length ? (
              <ul className="space-y-1.5 text-xs">
                {activity.map((a, i) => (
                  <li key={i} className="flex justify-between gap-3">
                    <span>
                      <b className="font-medium">{a.actor_name}</b>{" "}
                      <span className="text-muted-foreground">
                        {EVENT_LABEL[a.event_type] ?? a.event_type.replace(/[._]/g, " ")}
                      </span>
                    </span>
                    <span className="text-muted-foreground">{relative(a.timestamp)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">No catalog activity recorded yet.</p>
            )}
          </Section>
        </div>

        <aside className="space-y-4">
          <UnitCard link={{ productId: p.id }} />
          <OwnersCard
            productId={p.id}
            owners={owners}
            mine={mine}
            due={due}
            confirmedAt={p.owner_confirmed_at}
            onConfirm={() => confirm.mutate({ data: { productId: p.id } })}
            confirming={confirm.isPending}
            onSaved={refresh}
          />

          <Card title="Trust">
            <ol className="space-y-2">
              {(["community", "validated", "featured"] as Maturity[]).map((m) => {
                const reached = MATURITY[m].rank <= MATURITY[maturity].rank;
                return (
                  <li key={m} className="flex gap-2">
                    <span
                      className={cn(
                        "mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border",
                        reached ? "border-success bg-success text-white" : "border-border",
                      )}
                    >
                      {reached && <Check className="size-2.5" />}
                    </span>
                    <span className="text-xs">
                      <b className={cn("font-medium", !reached && "text-muted-foreground")}>
                        {MATURITY[m].label}
                      </b>
                      <span className="block text-[11px] text-muted-foreground">
                        {MATURITY[m].body}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ol>
            {MATURITY[maturity].next && (
              <p className="mt-3 rounded-md bg-muted/60 p-2 text-[11px]">
                <b className="font-medium">Next:</b> {MATURITY[maturity].next}
              </p>
            )}
            {p.validated_at && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                Last validated {shortDate(p.validated_at)}
              </p>
            )}
            {!mine && maturity !== "community" && (
              <Button
                size="sm"
                variant="outline"
                className="mt-3 w-full"
                disabled={feature.isPending}
                onClick={() =>
                  feature.mutate({
                    data: { productId: p.id, featured: maturity !== "featured" },
                  })
                }
              >
                <Award className="size-3.5" />
                {maturity === "featured" ? "Remove from featured" : "Feature this solution"}
              </Button>
            )}
          </Card>

          <Card title="Source">
            {source ? (
              <dl className="space-y-1.5 text-xs">
                <Row k="Repository">
                  <a
                    href={source.repository}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 break-all text-primary hover:underline"
                  >
                    {source.repository.replace(/^https:\/\/github\.com\//, "")}
                    <ExternalLink className="size-3 shrink-0" />
                  </a>
                </Row>
                {source.revision && (
                  <Row k="Pinned">
                    <span className="inline-flex items-center gap-1 font-mono">
                      <GitCommit className="size-3" />
                      {source.revision.slice(0, 12)}
                    </span>
                  </Row>
                )}
                <Row k="Deploys with">{IAC_LABEL[source.iac] ?? source.iac}</Row>
                <Row k="License">
                  {source.license?.status === "attested" ? (
                    <span className="inline-flex items-center gap-1 text-success">
                      <ShieldCheck className="size-3" /> Rights attested
                      {source.license.attestedBy ? ` by ${source.license.attestedBy}` : ""}
                    </span>
                  ) : source.license?.identifier ? (
                    source.license.identifier
                  ) : (
                    <span className="text-danger">Unresolved</span>
                  )}
                </Row>
              </dl>
            ) : (
              <p className="text-xs text-muted-foreground">
                Built in the platform designer. Infrastructure code is generated from the
                architecture.
              </p>
            )}
            {p.support_url && (
              <a
                href={p.support_url}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <LifeBuoy className="size-3.5" /> Get support
              </a>
            )}
          </Card>
        </aside>
      </div>
    </div>
  );
}

function OwnersCard({
  productId,
  owners,
  mine,
  due,
  confirmedAt,
  onConfirm,
  confirming,
  onSaved,
}: {
  productId: string;
  owners: Owner[];
  mine: boolean;
  due: boolean;
  confirmedAt: string | null;
  onConfirm: () => void;
  confirming: boolean;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState<Owner[] | null>(null);
  const { data: me } = useQuery(currentUserQuery);
  const orphaned = owners.length === 0;
  const save = useMutation({
    mutationFn: useServerFn(updateOwners),
    onSuccess: () => {
      toast.success("Owners updated.");
      setEditing(null);
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const set = (i: number, patch: Partial<Owner>) =>
    setEditing((list) => list?.map((o, j) => (j === i ? { ...o, ...patch } : o)) ?? null);

  return (
    <Card
      title="Owners"
      action={
        mine && !editing ? (
          <button
            className="text-[11px] text-primary hover:underline"
            onClick={() => setEditing(owners.map((o) => ({ ...o })))}
          >
            Edit
          </button>
        ) : null
      }
    >
      {editing ? (
        <div className="space-y-2">
          {editing.map((o, i) => (
            <div key={i} className="space-y-1 rounded-md border p-2">
              <div className="flex gap-1.5">
                <Input
                  className="h-7 text-xs"
                  placeholder="Name"
                  value={o.name}
                  onChange={(e) => set(i, { name: e.target.value })}
                />
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7"
                  aria-label="Remove owner"
                  disabled={editing.length === 1}
                  onClick={() => setEditing(editing.filter((_, j) => j !== i))}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
              <Input
                className="h-7 text-xs"
                placeholder="Email"
                value={o.email}
                onChange={(e) => set(i, { email: e.target.value })}
              />
              <div className="flex gap-1.5">
                <Select value={o.role || "Other"} onValueChange={(role) => set(i, { role })}>
                  <SelectTrigger className="h-7 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {OWNER_ROLES.map((r) => (
                      <SelectItem key={r} value={r}>
                        {r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  className="h-7 text-xs"
                  placeholder="Team"
                  value={o.team}
                  onChange={(e) => set(i, { team: e.target.value })}
                />
              </div>
            </div>
          ))}
          <Button
            size="sm"
            variant="outline"
            className="w-full"
            onClick={() => setEditing([...editing, { name: "", email: "", role: "CSA", team: "" }])}
          >
            <Plus className="size-3.5" /> Add owner
          </Button>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" className="flex-1" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="flex-1"
              disabled={save.isPending || editing.some((o) => o.name.trim().length < 2)}
              onClick={() => save.mutate({ data: { productId, owners: editing } })}
            >
              Save
            </Button>
          </div>
        </div>
      ) : (
        <>
          <ul className="space-y-2.5">
            {owners.map((o) => (
              <li key={`${o.email}${o.name}`} className="flex items-center gap-2.5">
                <OwnerAvatar owner={o} size={30} />
                <div className="min-w-0 text-xs">
                  <p className="font-medium">{o.name}</p>
                  <p className="truncate text-muted-foreground">
                    {[o.role, o.team].filter(Boolean).join(" · ")}
                  </p>
                  {o.email && (
                    <a href={`mailto:${o.email}`} className="truncate text-primary hover:underline">
                      {o.email}
                    </a>
                  )}
                </div>
              </li>
            ))}
            {orphaned && (
              <li className="space-y-2 text-xs">
                <p className="text-danger">No owner on record, so nobody is answering for it.</p>
                {me && (
                  <Button size="sm" className="w-full" onClick={() => setEditing([{ ...me }])}>
                    <Plus className="size-3.5" /> Adopt this solution
                  </Button>
                )}
              </li>
            )}
          </ul>
          {owners.length === 1 && owners[0]?.role !== "Sample" && (
            <p className="mt-3 flex items-center gap-1.5 text-[11px] text-warning">
              <AlertTriangle className="size-3.5" /> Single owner. Add a backup.
            </p>
          )}
          {!orphaned && (
            <div
              className={cn(
                "mt-3 rounded-md p-2 text-[11px]",
                due ? "bg-warning/10 text-warning" : "bg-muted/60 text-muted-foreground",
              )}
            >
              {due
                ? `Owner confirmation overdue. Owners confirm every ${OWNER_REVIEW_DAYS} days.`
                : `Confirmed ${relative(confirmedAt)}. Next confirmation due within ${OWNER_REVIEW_DAYS} days.`}
            </div>
          )}
          {mine && (
            <Button
              size="sm"
              variant={due ? "default" : "outline"}
              className="mt-2 w-full"
              disabled={confirming}
              onClick={onConfirm}
            >
              <Check className="size-3.5" /> I still own this
            </Button>
          )}
        </>
      )}
    </Card>
  );
}

function Section({
  id,
  title,
  sub,
  children,
}: {
  id?: string;
  title: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-20 rounded-md border bg-card p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Card({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-md border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[86px_1fr] gap-2">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}
