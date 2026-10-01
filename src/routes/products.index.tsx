import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowRight, Clock, Mail, PackagePlus, Rocket, Search, X } from "lucide-react";
import { useMemo, useState } from "react";

import { ServiceIcon } from "@/components/architecture/ServiceIcon";
import { MaturityBadge, OwnerLine } from "@/components/catalog/Badges";
import { SubmitSolutionDialog } from "@/components/catalog/SubmitSolution";
import { EmptyState } from "@/components/Primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SERVICE_BY_ID } from "@/lib/catalog";
import { relative } from "@/lib/format";
import { BUSINESS_LINES } from "@/lib/product-catalog";
import { currentUserQuery, offeringsQuery, productsQuery } from "@/lib/queries";
import {
  IAC_LABEL,
  MATURITY,
  type Maturity,
  type Owner,
  PLUMBING,
  RUNS_IN_ORDER,
  asMaturity,
  isOwner,
  ownerConfirmationDue,
  ownersOf,
  runsIn,
} from "@/lib/solutions";
import { cn } from "@/lib/utils";

type Tab = "all" | "mine" | "review";

export const Route = createFileRoute("/products/")({
  validateSearch: (s: Record<string, unknown>): { tab?: Tab; submit?: boolean } => ({
    ...(s["tab"] === "mine" || s["tab"] === "review" ? { tab: s["tab"] } : {}),
    ...(s["submit"] === true || s["submit"] === "true" ? { submit: true } : {}),
  }),
  head: () => ({
    meta: [
      { title: "Solution catalog · Cloud Delivery" },
      {
        name: "description",
        content:
          "Find deployable solutions published by SEs, CSAs and partners, see who owns them and how far they're validated, and share your own.",
      },
      { property: "og:title", content: "Solution catalog · Cloud Delivery" },
      {
        property: "og:description",
        content: "A distribution layer for field-built Azure solutions.",
      },
    ],
  }),
  component: Catalog,
});

type ProductRow = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  maturity: string;
  owners: unknown;
  tags: string[] | null;
  audience: string | null;
  outcome: string | null;
  validated_at: string | null;
  owner_confirmed_at: string | null;
  created_at: string;
  customer_count: number;
  offerings: {
    id: string;
    name: string;
    offering_type: string;
    installs: number;
    version: string | null;
    source?: { iac?: string } | null;
  }[];
};

type Solution = {
  id: string;
  name: string;
  description: string;
  industry: string;
  maturity: Maturity;
  owners: Owner[];
  tags: string[];
  audience: string | null;
  outcome: string | null;
  services: string[];
  iac: string[];
  runsIn: string[];
  installs: number;
  deployable: boolean;
  validatedAt: string | null;
  ownerDue: boolean;
  createdAt: string;
};

type FacetKey = "maturity" | "industry" | "runsIn" | "iac" | "services" | "owner";
type Facets = Record<FacetKey, Set<string>>;
const FACET_KEYS: FacetKey[] = ["maturity", "industry", "runsIn", "iac", "services", "owner"];
const emptyFacets = (): Facets => ({
  maturity: new Set(),
  industry: new Set(),
  runsIn: new Set(),
  iac: new Set(),
  services: new Set(),
  owner: new Set(),
});

const SORTS = {
  deployed: "Most deployed",
  validated: "Recently validated",
  newest: "Newest",
  name: "Name",
} as const;
type Sort = keyof typeof SORTS;

const valuesOf = (s: Solution): Record<FacetKey, string[]> => ({
  maturity: [s.maturity],
  industry: [s.industry],
  runsIn: s.runsIn,
  iac: s.iac,
  services: s.services,
  owner: s.owners.map((o) => o.name),
});

function Catalog() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const products = useQuery(productsQuery);
  const offerings = useQuery(offeringsQuery);
  const me = useQuery(currentUserQuery).data;
  const tab: Tab = search.tab ?? "all";
  const [q, setQ] = useState("");
  const [facets, setFacets] = useState<Facets>(emptyFacets);
  const [sort, setSort] = useState<Sort>("deployed");

  const solutions = useMemo<Solution[]>(() => {
    // Services per product: each offering's published architecture, or its latest draft.
    const servicesOf = new Map<string, Set<string>>();
    for (const o of offerings.data ?? []) {
      const versions = (o.offering_versions ?? []) as {
        status: string;
        created_at: string;
        manifest_json: unknown;
      }[];
      const v =
        versions.find((x) => x.status === "published") ??
        [...versions].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
      const mods = ((v?.manifest_json as { modules?: { name: string }[] } | null)?.modules ?? [])
        .map((m) => m.name)
        .filter((id) => SERVICE_BY_ID.has(id) && !PLUMBING.has(id));
      const set = servicesOf.get(o.product_id) ?? new Set<string>();
      mods.forEach((m) => set.add(m));
      servicesOf.set(o.product_id, set);
    }
    return ((products.data ?? []) as unknown as ProductRow[]).map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description ?? "",
      industry: p.category ?? "Other",
      maturity: asMaturity(p.maturity),
      owners: ownersOf(p.owners),
      tags: p.tags ?? [],
      audience: p.audience,
      outcome: p.outcome,
      services: [...(servicesOf.get(p.id) ?? [])],
      iac: [...new Set(p.offerings.map((o) => o.source?.iac ?? "terraform"))],
      runsIn: [...new Set(p.offerings.map((o) => runsIn(o.offering_type)))],
      installs: p.offerings.reduce((n, o) => n + Number(o.installs), 0),
      deployable: p.offerings.some((o) => !!o.version),
      validatedAt: p.validated_at,
      ownerDue: ownerConfirmationDue(p.owner_confirmed_at),
      createdAt: p.created_at,
    }));
  }, [products.data, offerings.data]);

  const inTab = solutions.filter((s) =>
    tab === "mine"
      ? isOwner(s.owners, me)
      : tab === "review"
        ? s.maturity === "community" && !isOwner(s.owners, me)
        : true,
  );
  const needle = q.trim().toLowerCase();
  const matchesText = (s: Solution) =>
    !needle ||
    [
      s.name,
      s.description,
      s.industry,
      s.audience ?? "",
      s.outcome ?? "",
      ...s.tags,
      ...s.owners.flatMap((o) => [o.name, o.team]),
      ...s.services.map((id) => SERVICE_BY_ID.get(id)?.name ?? id),
    ]
      .join(" ")
      .toLowerCase()
      .includes(needle);
  // A facet's count ignores its own selection, so it shows what ticking that value would return.
  const matches = (s: Solution, except?: FacetKey) =>
    matchesText(s) &&
    FACET_KEYS.every(
      (k) => k === except || !facets[k].size || valuesOf(s)[k].some((v) => facets[k].has(v)),
    );
  const results = inTab
    .filter((s) => matches(s))
    .sort((a, b) => {
      const byMaturity = MATURITY[b.maturity].rank - MATURITY[a.maturity].rank;
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "newest") return b.createdAt.localeCompare(a.createdAt);
      if (sort === "validated")
        return (b.validatedAt ?? "").localeCompare(a.validatedAt ?? "") || byMaturity;
      return byMaturity || b.installs - a.installs || a.name.localeCompare(b.name);
    });
  const count = (key: FacetKey, value: string) =>
    inTab.filter((s) => matches(s, key) && valuesOf(s)[key].includes(value)).length;
  const toggle = (key: FacetKey, value: string) =>
    setFacets((f) => {
      const next = new Set(f[key]);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return { ...f, [key]: next };
    });
  const active = FACET_KEYS.flatMap((k) => [...facets[k]].map((v) => ({ key: k, value: v })));

  const distinct = (pick: (s: Solution) => string[]) => [...new Set(solutions.flatMap(pick))];
  const serviceFreq = new Map<string, number>();
  solutions.forEach((s) =>
    s.services.forEach((id) => serviceFreq.set(id, (serviceFreq.get(id) ?? 0) + 1)),
  );
  const usedIndustries = distinct((s) => [s.industry]);
  const industries = [
    ...BUSINESS_LINES.map((l) => l.name),
    ...usedIndustries.filter((i) => !BUSINESS_LINES.some((l) => l.name === i)),
  ];
  const groups: {
    key: FacetKey;
    label: string;
    values: string[];
    text?: (v: string) => string;
  }[] = [
    {
      key: "maturity",
      label: "Maturity",
      values: ["featured", "validated", "community"],
      text: (v) => MATURITY[v as Maturity].label,
    },
    {
      key: "industry",
      label: "Industry",
      values: industries.filter((i) => usedIndustries.includes(i)),
    },
    { key: "runsIn", label: "Runs in", values: RUNS_IN_ORDER },
    {
      key: "iac",
      label: "Deploys with",
      values: distinct((s) => s.iac).sort(),
      text: (v) => IAC_LABEL[v] ?? v,
    },
    {
      key: "services",
      label: "Azure services",
      values: [...serviceFreq.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 14)
        .map(([id]) => id),
      text: (v) => SERVICE_BY_ID.get(v)?.short ?? v,
    },
    { key: "owner", label: "Owner", values: distinct((s) => s.owners.map((o) => o.name)).sort() },
  ];

  const people = new Set(
    solutions.flatMap((s) => s.owners.filter((o) => o.role !== "Sample").map((o) => o.name)),
  );
  const mineCount = solutions.filter((s) => isOwner(s.owners, me)).length;
  const reviewCount = solutions.filter(
    (s) => s.maturity === "community" && !isOwner(s.owners, me),
  ).length;

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.16em] text-primary uppercase">
            Solution catalog
          </p>
          <h1 className="mt-1 text-[26px] font-bold">Find it, deploy it, or share yours</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Solutions built and owned by SEs, CSAs and partners. Each one goes through the same
            architecture review and landing zone checks before it can be deployed to a customer,
            whether it's Terraform, Bicep or ARM.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-5">
          <dl className="flex gap-6">
            {(
              [
                ["Solutions", solutions.length],
                ["Owners", people.size],
                ["Deployments", solutions.reduce((n, s) => n + s.installs, 0)],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="text-right">
                <dd className="font-mono text-[22px] font-semibold">{v}</dd>
                <dt className="text-[10px] tracking-wider text-muted-foreground uppercase">{k}</dt>
              </div>
            ))}
          </dl>
          <Button onClick={() => navigate({ search: (s) => ({ ...s, submit: true }) })}>
            <PackagePlus className="size-4" /> Submit a solution
          </Button>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute top-3 left-3 size-4 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name, problem, Azure service, owner or tag…"
          className="h-10 pl-9"
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border">
        <nav className="-mb-px flex gap-5 text-[13px]">
          {(
            [
              ["all", "All solutions", solutions.length],
              ["mine", "My solutions", mineCount],
              ["review", "Review queue", reviewCount],
            ] as const
          ).map(([id, label, n]) => (
            <button
              key={id}
              onClick={() =>
                navigate({
                  search: ({ tab: _t, ...rest }) => (id === "all" ? rest : { ...rest, tab: id }),
                })
              }
              className={cn(
                "border-b-2 pb-2 transition-colors",
                tab === id
                  ? "border-primary font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
              <span className="ml-1.5 rounded-full bg-muted px-1.5 text-[10.5px] text-muted-foreground">
                {n}
              </span>
            </button>
          ))}
        </nav>
        <div className="flex items-center gap-2 pb-2 text-xs text-muted-foreground">
          Sort
          <Select value={sort} onValueChange={(v) => setSort(v as Sort)}>
            <SelectTrigger className="h-7 w-44 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(SORTS) as Sort[]).map((k) => (
                <SelectItem key={k} value={k} className="text-xs">
                  {SORTS[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        <aside className="space-y-5">
          {groups.map((g) =>
            g.values.length ? (
              <div key={g.key}>
                <p className="mb-1.5 text-[10.5px] font-semibold tracking-wider text-muted-foreground uppercase">
                  {g.label}
                </p>
                <ul className="space-y-0.5">
                  {g.values.map((v) => {
                    const n = count(g.key, v);
                    const on = facets[g.key].has(v);
                    return (
                      <li key={v}>
                        <button
                          onClick={() => toggle(g.key, v)}
                          disabled={!n && !on}
                          aria-pressed={on}
                          className={cn(
                            "flex w-full items-center gap-2 rounded-sm px-1.5 py-1 text-left text-[12.5px] transition-colors",
                            on ? "bg-primary/10 text-foreground" : "hover:bg-muted",
                            !n && !on && "opacity-40",
                          )}
                        >
                          <span
                            className={cn(
                              "grid size-3.5 shrink-0 place-items-center rounded-[3px] border",
                              on ? "border-primary bg-primary" : "border-border-strong",
                            )}
                          >
                            {on && (
                              <span className="size-1.5 rounded-[1px] bg-primary-foreground" />
                            )}
                          </span>
                          {g.key === "services" && <ServiceIcon id={v} size="sm" />}
                          <span className="min-w-0 flex-1 truncate">{g.text?.(v) ?? v}</span>
                          <span className="font-mono text-[10.5px] text-muted-foreground">{n}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null,
          )}
        </aside>

        <section className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>
              {results.length} of {inTab.length} solution{inTab.length === 1 ? "" : "s"}
            </span>
            {active.map((a) => (
              <button
                key={`${a.key}:${a.value}`}
                onClick={() => toggle(a.key, a.value)}
                className="inline-flex items-center gap-1 rounded-full border bg-card px-2 py-0.5 text-[11px] text-foreground hover:bg-muted"
              >
                {groups.find((g) => g.key === a.key)?.text?.(a.value) ?? a.value}
                <X className="size-3" />
              </button>
            ))}
            {(active.length > 0 || needle) && (
              <button
                className="text-primary hover:underline"
                onClick={() => {
                  setFacets(emptyFacets());
                  setQ("");
                }}
              >
                Clear all
              </button>
            )}
          </div>

          {(products.isLoading || offerings.isLoading) && <EmptyState title="Loading solutions…" />}
          {!products.isLoading && !offerings.isLoading && results.length === 0 && (
            <EmptyState
              title={
                tab === "mine"
                  ? "You don't own any solutions yet"
                  : tab === "review"
                    ? "Nothing waiting for review"
                    : "No solutions match"
              }
              description={
                tab === "mine"
                  ? "Submit something you've built and it shows up here under your name."
                  : "Try removing a filter or searching for an Azure service."
              }
            />
          )}
          <div className="grid gap-3 xl:grid-cols-2">
            {results.map((s) => (
              <SolutionCard key={s.id} s={s} mine={isOwner(s.owners, me)} />
            ))}
          </div>
        </section>
      </div>

      <SubmitSolutionDialog
        open={!!search.submit}
        onOpenChange={(v) => {
          if (!v) void navigate({ search: ({ submit: _s, ...rest }) => rest, replace: true });
        }}
        user={me}
        industries={industries}
        existing={solutions.map((s) => ({ id: s.id, name: s.name, services: s.services }))}
      />
    </div>
  );
}

function SolutionCard({ s, mine }: { s: Solution; mine: boolean }) {
  const contact = s.owners.find((o) => o.email);
  const shown = s.services.slice(0, 6);
  return (
    <article className="group relative flex flex-col rounded-xl border bg-card p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_14px_32px_-18px_rgba(30,64,175,0.45)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            to="/products/$productId"
            params={{ productId: s.id }}
            // The whole card opens the solution page; its buttons sit above this link.
            className="text-[15px] leading-tight font-bold group-hover:text-primary after:absolute after:inset-0 after:rounded-xl after:content-['']"
          >
            {s.name}
          </Link>
          <p className="mt-0.5 text-[10.5px] font-semibold tracking-wider text-muted-foreground uppercase">
            {s.industry}
            {s.audience && ` · For ${s.audience}`}
          </p>
        </div>
        <MaturityBadge maturity={s.maturity} />
      </div>

      <p className="mt-2 line-clamp-2 text-[12.5px] leading-snug text-foreground/85">
        {s.description}
      </p>

      <div className="mt-3 flex items-center justify-between gap-2">
        <OwnerLine owners={s.owners} />
        {mine && (
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
            Yours
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {shown.map((id) => (
          <span
            key={id}
            title={SERVICE_BY_ID.get(id)?.name}
            className="inline-flex items-center gap-1 rounded-sm border bg-muted/40 py-0.5 pr-1.5 pl-0.5 text-[10.5px]"
          >
            <ServiceIcon id={id} size="sm" />
            {SERVICE_BY_ID.get(id)?.short}
          </span>
        ))}
        {s.services.length > shown.length && (
          <span className="text-[10.5px] text-muted-foreground">
            +{s.services.length - shown.length}
          </span>
        )}
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5 text-[10.5px]">
        {s.iac.map((x) => (
          <span key={x} className="rounded-sm bg-secondary px-1.5 py-0.5 font-medium">
            {IAC_LABEL[x] ?? x}
          </span>
        ))}
        {s.runsIn.map((r) => (
          <span key={r} className="rounded-sm border px-1.5 py-0.5 text-muted-foreground">
            {r}
          </span>
        ))}
      </div>

      <div className="relative z-10 mt-auto flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
          {s.ownerDue ? (
            <span className="flex items-center gap-1 text-warning">
              <Clock className="size-3" /> Owner confirmation overdue
            </span>
          ) : s.validatedAt ? (
            `Validated ${relative(s.validatedAt)}`
          ) : (
            "Not validated yet"
          )}
          <span>·</span>
          {s.installs} deployment{s.installs === 1 ? "" : "s"}
        </p>
        <div className="flex gap-1.5">
          {contact ? (
            <Button asChild size="sm" variant="outline" className="h-7 text-xs">
              <a
                href={`mailto:${contact.email}?subject=${encodeURIComponent(s.name)}`}
                title={`Email ${contact.name}`}
              >
                <Mail className="size-3.5" /> Contact
              </a>
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled
              title="No contact email on record"
            >
              <Mail className="size-3.5" /> Contact
            </Button>
          )}
          {s.deployable ? (
            <Button asChild size="sm" variant="outline" className="h-7 text-xs">
              <Link to="/onboard" search={{ product: s.id }}>
                <Rocket className="size-3.5" /> Deploy
              </Link>
            </Button>
          ) : (
            <Button asChild size="sm" variant="secondary" className="h-7 text-xs">
              <Link to="/products/$productId" params={{ productId: s.id }}>
                View checks
              </Link>
            </Button>
          )}
          <Button asChild size="sm" className="h-7 text-xs">
            <Link to="/products/$productId" params={{ productId: s.id }}>
              View solution <ArrowRight className="size-3.5" />
            </Link>
          </Button>
        </div>
      </div>
    </article>
  );
}
