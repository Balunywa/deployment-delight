import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";

import { EmptyState } from "@/components/Primitives";
import { LANDING_LABEL, landingOf } from "@/lib/architecture";
import { currency, titleize } from "@/lib/format";
import { type ProductProfile, initials, profileFor } from "@/lib/product-profiles";
import { productsQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/products")({
  head: () => ({
    meta: [
      { title: "Products · Cloud Delivery" },
      {
        name: "description",
        content:
          "The ISV's software products: what each does, who owns it, and the offerings customers are onboarded to.",
      },
      { property: "og:title", content: "Products · Cloud Delivery" },
      {
        property: "og:description",
        content: "ISV software products and the offerings derived from them.",
      },
    ],
  }),
  component: Products,
});

const INK = "#1d2b4f";
const ACCENT = "#c46a26";
const TEAL = "#2f7c83";

type Offering = {
  id: string;
  name: string;
  offering_type: string;
  network_profile: string | null;
  description: string | null;
  estimated_monthly_cost_low: number | null;
  estimated_monthly_cost_high: number | null;
  installs: number;
  customers: number;
  version: string | null;
};

function Products() {
  const products = useQuery(productsQuery);
  const list = products.data ?? [];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <p
          className="text-[11px] font-semibold tracking-[0.16em] uppercase"
          style={{ color: ACCENT }}
        >
          Product catalog
        </p>
        <h1 className="mt-1 text-[26px] font-bold" style={{ color: INK }}>
          Products
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground italic">
          Each product is defined once and published as offerings. Every customer is onboarded to an
          offering as configuration — not a new Azure project.
        </p>
      </div>

      {products.isLoading && <EmptyState title="Loading products…" />}

      {list.map((p, i) => (
        <ProductSlide
          key={p.id}
          index={i}
          total={list.length}
          name={p.name}
          category={p.category}
          profile={profileFor(p.name, p.description)}
          offerings={(p.offerings ?? []) as Offering[]}
          customers={Number(p.customer_count ?? 0)}
        />
      ))}
    </div>
  );
}

function ProductSlide({
  index,
  total,
  name,
  category,
  profile,
  offerings,
  customers,
}: {
  customers: number;
  index: number;
  total: number;
  name: string;
  category: string | null;
  profile: ProductProfile;
  offerings: Offering[];
}) {
  const n = String(index + 1).padStart(2, "0");
  const flip = index % 2 === 1;
  const installs = offerings.reduce((s, o) => s + Number(o.installs), 0);
  const cards = [
    ...offerings.slice(0, 4).map((o) => ({ kind: "live" as const, o })),
    ...profile.planned.slice(0, Math.max(0, 4 - offerings.length)).map((x) => ({
      kind: "planned" as const,
      x,
    })),
  ];
  const owner = (
    <aside
      className="flex flex-col rounded-lg p-5 text-white"
      style={{ background: INK }}
      aria-label={`${profile.owner.name}, product owner`}
    >
      <div className="flex items-center gap-3">
        <span
          className="grid size-12 shrink-0 place-items-center rounded-full border-2 border-white/80 text-[15px] font-bold"
          style={{ background: profile.owner.color }}
        >
          {initials(profile.owner.name)}
        </span>
        <div className="min-w-0">
          <p
            className="text-[9.5px] font-semibold tracking-[0.14em] uppercase"
            style={{ color: "#f0a868" }}
          >
            Product owner
          </p>
          <p className="text-[16px] leading-tight font-bold">{profile.owner.name}</p>
          <p className="text-[11px] text-white/70">
            {profile.owner.title}
            {profile.owner.location ? ` · ${profile.owner.location}` : ""}
          </p>
        </div>
      </div>
      <div className="mt-4 border-t border-white/15 pt-3">
        <p
          className="text-[9.5px] font-semibold tracking-[0.14em] uppercase"
          style={{ color: "#f0a868" }}
        >
          Delivery mandate
        </p>
        <p className="mt-1 text-[13px] leading-snug font-semibold">{profile.mandate}</p>
      </div>
      <div className="mt-3 rounded-md border border-white/10 bg-white/[0.07] p-3">
        <p
          className="text-[9.5px] font-semibold tracking-[0.14em] uppercase"
          style={{ color: "#8fd3d8" }}
        >
          Azure delivery agenda
        </p>
        <p className="mt-1 text-[12px] leading-snug">{profile.agenda}</p>
      </div>
      {profile.bio && (
        <p className="mt-3 text-[11px] leading-relaxed text-white/70">{profile.bio}</p>
      )}
      <div className="mt-auto grid grid-cols-3 gap-2 border-t border-white/15 pt-3 text-center">
        {[
          ["Offerings", offerings.length],
          ["Customers", customers],
          ["Installs", installs],
        ].map(([k, v]) => (
          <div key={k}>
            <p className="font-mono text-[18px] font-semibold">{v}</p>
            <p className="text-[9.5px] tracking-wider text-white/60 uppercase">{k}</p>
          </div>
        ))}
      </div>
    </aside>
  );

  return (
    <section
      className="overflow-hidden rounded-xl border p-6 shadow-sm"
      style={{ background: "#fbf8f1", borderColor: "#e6dcc8" }}
    >
      <header className="flex items-start justify-between gap-4">
        <div>
          <p
            className="text-[11px] font-semibold tracking-[0.16em] uppercase"
            style={{ color: ACCENT }}
          >
            Product {n}
          </p>
          <h2 className="mt-0.5 text-[24px] leading-tight font-bold" style={{ color: INK }}>
            {name}
          </h2>
          <p className="mt-1 text-[13px] text-[#6b6358] italic">{profile.tagline}</p>
        </div>
        <p className="flex items-center gap-2 font-mono text-[12px] text-[#8a8070]">
          {n} / {String(total).padStart(2, "0")}
          <span className="size-2 rounded-full" style={{ background: flip ? ACCENT : TEAL }} />
        </p>
      </header>

      <div
        className={cn(
          "mt-5 grid gap-5",
          flip ? "lg:grid-cols-[minmax(0,1fr)_280px]" : "lg:grid-cols-[280px_minmax(0,1fr)]",
        )}
      >
        {!flip && owner}
        <div className="min-w-0">
          <p
            className="text-[10.5px] font-semibold tracking-[0.14em] uppercase"
            style={{ color: INK }}
          >
            What this product does
          </p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-[#3d3a35]">{profile.does}</p>
          {profile.tags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {profile.tags.map((t) => (
                <span
                  key={t}
                  className="rounded-sm border bg-white px-2.5 py-1 text-[10px] font-semibold tracking-wider uppercase"
                  style={{ borderColor: "#d9ccb4", color: INK }}
                >
                  {t}
                </span>
              ))}
            </div>
          )}

          <div className="mt-5 flex items-baseline justify-between">
            <p
              className="text-[10.5px] font-semibold tracking-[0.14em] uppercase"
              style={{ color: ACCENT }}
            >
              Offerings
            </p>
            {offerings.length > 4 && (
              <Link
                to="/offerings"
                className="text-[11px] font-medium hover:underline"
                style={{ color: TEAL }}
              >
                +{offerings.length - 4} more
              </Link>
            )}
          </div>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            {cards.map((c, i) => {
              const color = i % 2 === 0 ? TEAL : ACCENT;
              const num = String(i + 1).padStart(2, "0");
              if (c.kind === "planned")
                return (
                  <article
                    key={c.x.title}
                    className="flex flex-col rounded-md border border-dashed bg-white/60 p-3.5"
                    style={{ borderColor: "#d9ccb4", borderLeft: `3px solid ${color}` }}
                  >
                    <p className="flex items-center gap-2 text-[9.5px] font-semibold tracking-wider uppercase text-[#8a8070]">
                      <span className="text-[13px] font-bold" style={{ color: ACCENT }}>
                        {num}
                      </span>
                      Planned · {c.x.kind}
                    </p>
                    <p className="mt-1 text-[14px] font-bold" style={{ color: INK }}>
                      {c.x.title}
                    </p>
                    <p className="mt-1 flex-1 text-[12px] leading-snug text-[#5a554d]">
                      {c.x.body}
                    </p>
                    <p
                      className="mt-2 rounded-sm px-2 py-1 text-[10.5px] text-[#6b6358]"
                      style={{ background: "#f3ecdf" }}
                    >
                      <b className="font-semibold" style={{ color }}>
                        STATUS
                      </b>{" "}
                      {c.x.note}
                    </p>
                  </article>
                );
              const o = c.o;
              const landing = LANDING_LABEL[landingOf(o.network_profile)];
              return (
                <Link
                  key={o.id}
                  to="/offerings"
                  search={{ offering: o.id }}
                  className="group flex flex-col rounded-md border bg-white p-3.5 transition-shadow hover:shadow-md"
                  style={{ borderColor: "#e6dcc8", borderLeft: `3px solid ${color}` }}
                >
                  <p className="flex items-center gap-2 text-[9.5px] font-semibold tracking-wider uppercase text-[#8a8070]">
                    <span className="text-[13px] font-bold" style={{ color: ACCENT }}>
                      {num}
                    </span>
                    {titleize(o.offering_type)} · {landing.title}
                  </p>
                  <p
                    className="mt-1 flex items-center gap-1 text-[14px] font-bold"
                    style={{ color: INK }}
                  >
                    {o.name}
                    <ArrowUpRight className="size-3.5 opacity-0 transition-opacity group-hover:opacity-60" />
                  </p>
                  <p className="mt-1 flex-1 text-[12px] leading-snug text-[#5a554d]">
                    {o.description || landing.body}
                  </p>
                  <p
                    className="mt-2 rounded-sm px-2 py-1 text-[10.5px] text-[#4a463f]"
                    style={{ background: i % 2 === 0 ? "#e7f2f2" : "#f8ebdf" }}
                  >
                    <b className="font-semibold" style={{ color }}>
                      LIVE
                    </b>{" "}
                    {o.installs} install{Number(o.installs) === 1 ? "" : "s"} · {o.customers}{" "}
                    customer
                    {Number(o.customers) === 1 ? "" : "s"}
                    {o.version ? ` · v${o.version}` : " · not published"}
                    {o.estimated_monthly_cost_low
                      ? ` · ${currency(o.estimated_monthly_cost_low, { compact: true })}–${currency(o.estimated_monthly_cost_high, { compact: true })}/mo`
                      : ""}
                  </p>
                </Link>
              );
            })}
            {!cards.length && (
              <p className="text-xs text-muted-foreground sm:col-span-2">
                No offerings yet.{" "}
                <Link to="/offerings" search={{ new: true }} className="underline">
                  Create the first one
                </Link>
                .
              </p>
            )}
          </div>
        </div>
        {flip && owner}
      </div>

      <footer
        className="mt-5 flex flex-wrap justify-between gap-2 border-t pt-2.5 text-[10px] font-semibold tracking-[0.14em] uppercase"
        style={{ borderColor: "#e6dcc8", color: "#8a8070" }}
      >
        <span>
          {(category ?? "Product").replace(/_/g, " ")} · {offerings.length} offering
          {offerings.length === 1 ? "" : "s"} · {installs} installs
        </span>
        <span>GridWorks Cloud Delivery | Product catalog</span>
      </footer>
    </section>
  );
}
