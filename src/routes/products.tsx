import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";

import { ServiceIcon } from "@/components/architecture/ServiceIcon";
import { EmptyState } from "@/components/Primitives";
import { SERVICE_BY_ID } from "@/lib/catalog";
import {
  BUSINESS_LINES,
  type BusinessLine,
  PRODUCTS,
  PRODUCT_BY_NAME,
  modelOf,
} from "@/lib/product-catalog";
import { offeringsQuery, productsQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/products")({
  head: () => ({
    meta: [
      { title: "Products · Cloud Delivery" },
      {
        name: "description",
        content:
          "The software services the ISV sells, by business line, and the ways each is delivered on Azure.",
      },
      { property: "og:title", content: "Products · Cloud Delivery" },
      {
        property: "og:description",
        content: "Products are what customers buy; offerings are how each is delivered on Azure.",
      },
    ],
  }),
  component: Products,
});

const INK = "#1d2b4f";
const ACCENT = "#c46a26";

type Offering = {
  id: string;
  name: string;
  installs: number;
  customers: number;
  version: string | null;
};
type ProductRow = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  customer_count: number;
  offerings: Offering[];
};

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

const order = (name: string) => {
  const i = PRODUCTS.findIndex((p) => p.name === name);
  return i < 0 ? 999 : i;
};

function Products() {
  const products = useQuery(productsQuery);
  const offerings = useQuery(offeringsQuery);
  const list = (products.data ?? []) as unknown as ProductRow[];

  // Azure services per product, from the published architecture of each of its offerings.
  const servicesOf = new Map<string, string[]>();
  for (const o of offerings.data ?? []) {
    const v = ((o.offering_versions ?? []) as { status: string; manifest_json: unknown }[]).find(
      (x) => x.status === "published",
    );
    const mods = ((v?.manifest_json as { modules?: { name: string }[] } | null)?.modules ?? [])
      .map((m) => m.name)
      .filter((id) => {
        const d = SERVICE_BY_ID.get(id);
        return (
          d &&
          !d.locked &&
          ![
            "network-spoke",
            "private-endpoints",
            "resource-group",
            "monitoring",
            "key-vault",
            "defender",
          ].includes(id)
        );
      });
    const cur = servicesOf.get(o.product_id) ?? [];
    servicesOf.set(o.product_id, [...new Set([...cur, ...mods])]);
  }

  const installs = list.reduce(
    (s, p) => s + p.offerings.reduce((n, o) => n + Number(o.installs), 0),
    0,
  );
  const lines = BUSINESS_LINES.map((l) => ({
    line: l,
    products: list
      .filter((p) => p.category === l.name)
      .sort((a, b) => order(a.name) - order(b.name)),
  })).filter((x) => x.products.length);
  const other = list.filter((p) => !BUSINESS_LINES.some((l) => l.name === p.category));

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p
            className="text-[11px] font-semibold tracking-[0.16em] uppercase"
            style={{ color: ACCENT }}
          >
            Product catalog
          </p>
          <h1 className="mt-1 text-[26px] font-bold" style={{ color: INK }}>
            What we sell
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            A product is the software service a customer buys. Each one is offered in one or more
            delivery models — hosted by us, in the customer's Azure, or plugged into their landing
            zone — and every customer is onboarded to an offering as configuration.
          </p>
        </div>
        <dl className="flex gap-6">
          {[
            ["Products", list.length],
            ["Offerings", list.reduce((s, p) => s + p.offerings.length, 0)],
            ["Installs", installs],
          ].map(([k, v]) => (
            <div key={k} className="text-right">
              <dd className="font-mono text-[22px] font-semibold" style={{ color: INK }}>
                {v}
              </dd>
              <dt className="text-[10px] tracking-wider text-muted-foreground uppercase">{k}</dt>
            </div>
          ))}
        </dl>
      </div>

      {(products.isLoading || offerings.isLoading) && <EmptyState title="Loading products…" />}

      {lines.map(({ line, products: ps }, i) => (
        <LineSection key={line.id} index={i} line={line} products={ps} servicesOf={servicesOf} />
      ))}
      {other.length > 0 && (
        <LineSection
          index={lines.length}
          line={{
            id: "other",
            name: "Other products",
            tagline: "",
            lead: { name: "", title: "", color: INK },
          }}
          products={other}
          servicesOf={servicesOf}
        />
      )}
    </div>
  );
}

function LineSection({
  index,
  line,
  products,
  servicesOf,
}: {
  index: number;
  line: BusinessLine;
  products: ProductRow[];
  servicesOf: Map<string, string[]>;
}) {
  const installs = products.reduce(
    (s, p) => s + p.offerings.reduce((n, o) => n + Number(o.installs), 0),
    0,
  );
  return (
    <section
      className="rounded-xl border p-5"
      style={{ background: "#fbf8f1", borderColor: "#e6dcc8" }}
    >
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p
            className="text-[11px] font-semibold tracking-[0.16em] uppercase"
            style={{ color: ACCENT }}
          >
            Business line {String(index + 1).padStart(2, "0")}
          </p>
          <h2 className="mt-0.5 text-[21px] leading-tight font-bold" style={{ color: INK }}>
            {line.name}
          </h2>
          {line.tagline && (
            <p className="mt-0.5 text-[13px] text-[#6b6358] italic">{line.tagline}</p>
          )}
        </div>
        <div className="flex items-center gap-4">
          {line.lead.name && (
            <div
              className="flex items-center gap-2 rounded-full py-1 pr-3 pl-1 text-white"
              style={{ background: INK }}
            >
              <span
                className="grid size-7 place-items-center rounded-full border border-white/70 text-[11px] font-bold"
                style={{ background: line.lead.color }}
              >
                {initials(line.lead.name)}
              </span>
              <span className="text-[11px] leading-tight">
                <b className="block font-semibold">{line.lead.name}</b>
                <span className="text-white/70">{line.lead.title}</span>
              </span>
            </div>
          )}
          <p className="text-right font-mono text-[11px] text-[#8a8070]">
            {products.length} products
            <br />
            {installs} installs
          </p>
        </div>
      </header>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {products.map((p, i) => (
          <ProductCard key={p.id} product={p} index={i} services={servicesOf.get(p.id) ?? []} />
        ))}
      </div>
    </section>
  );
}

function ProductCard({
  product,
  index,
  services,
}: {
  product: ProductRow;
  index: number;
  services: string[];
}) {
  const meta = PRODUCT_BY_NAME.get(product.name);
  const installs = product.offerings.reduce((n, o) => n + Number(o.installs), 0);
  const color = index % 2 === 0 ? "#2f7c83" : ACCENT;
  return (
    <article
      className="flex flex-col rounded-md border bg-white p-4"
      style={{ borderColor: "#e6dcc8", borderLeft: `3px solid ${color}` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[15px] font-bold" style={{ color: INK }}>
            {product.name}
          </p>
          {meta?.audience && (
            <p className="text-[10px] font-semibold tracking-wider text-[#8a8070] uppercase">
              For {meta.audience}
            </p>
          )}
        </div>
        <span
          className={cn(
            "shrink-0 rounded-sm px-1.5 py-0.5 text-[10.5px] font-medium",
            installs ? "bg-[#e7f2f2] text-[#2f7c83]" : "bg-[#f3ecdf] text-[#8a8070]",
          )}
        >
          {installs
            ? `${installs} install${installs === 1 ? "" : "s"} · ${product.customer_count} customer${product.customer_count === 1 ? "" : "s"}`
            : "Ready to onboard"}
        </span>
      </div>
      <p className="mt-2 text-[12.5px] leading-snug text-[#3d3a35]">{product.description}</p>
      {meta?.outcome && (
        <p className="mt-2 text-[12px] text-[#3d3a35]">
          <b className="font-semibold" style={{ color }}>
            Outcome
          </b>{" "}
          {meta.outcome}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {services.map((id) => (
          <span
            key={id}
            className="inline-flex items-center gap-1 rounded-sm border border-[#ece4d4] bg-[#fbf8f1] py-0.5 pr-1.5 pl-0.5 text-[10.5px] text-[#4a463f]"
            title={SERVICE_BY_ID.get(id)?.blurb}
          >
            <ServiceIcon id={id} size="sm" />
            {SERVICE_BY_ID.get(id)?.short}
          </span>
        ))}
      </div>
      <div className="mt-3 border-t border-[#efe8da] pt-2.5">
        <p
          className="mb-1.5 text-[9.5px] font-semibold tracking-[0.14em] uppercase"
          style={{ color: ACCENT }}
        >
          Offered as
        </p>
        <div className="flex flex-wrap gap-1.5">
          {product.offerings.map((o) => (
            <Link
              key={o.id}
              to="/offerings"
              search={{ offering: o.id }}
              className="rounded-sm border px-2 py-1 text-[11px] font-medium transition-colors hover:bg-[#f6f1e7]"
              style={{ borderColor: "#d9ccb4", color: INK }}
              title={`${o.installs} installs · ${o.version ? `v${o.version}` : "not published"}`}
            >
              {modelOf(o.name)}
              <span className="ml-1.5 font-mono text-[10px] text-[#8a8070]">
                {o.version ? `v${o.version}` : "draft"} · {o.installs}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </article>
  );
}
