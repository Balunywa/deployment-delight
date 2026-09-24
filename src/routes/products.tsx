import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";

import { EmptyState, PageHeader, Panel, Pill } from "@/components/Primitives";
import { currency, titleize } from "@/lib/format";
import { productsQuery } from "@/lib/queries";

export const Route = createFileRoute("/products")({
  head: () => ({
    meta: [
      { title: "Products · Cloud Delivery" },
      {
        name: "description",
        content:
          "Manage the ISV software products whose Azure architecture is productized into deployable offerings.",
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

function Products() {
  const products = useQuery(productsQuery);

  return (
    <>
      <PageHeader
        title="Product Catalog"
        description="The source of truth for your software products. Each product is a piece of ISV software. Its Azure architecture is defined once, then published as offerings that customers can be deployed onto."
      />

      {products.isLoading && <EmptyState title="Loading products…" />}

      <div className="grid gap-4 lg:grid-cols-3">
        {(products.data ?? []).map((product) => {
          const offerings = (product.offerings ?? []) as {
            id: string;
            name: string;
            offering_type: string;
            estimated_monthly_cost_low: number | null;
            estimated_monthly_cost_high: number | null;
          }[];
          return (
            <Panel
              key={product.id}
              title={product.name}
              description={product.description ?? undefined}
              actions={
                <Pill tone={product.status === "active" ? "success" : "neutral"}>
                  {product.status}
                </Pill>
              }
              bodyClassName="p-0"
            >
              <div className="border-b border-border px-4 py-2 text-[11px] tracking-wide text-muted-foreground uppercase">
                {product.category ?? "Uncategorized"} · {offerings.length} offerings
              </div>
              <ul className="divide-y divide-border">
                {offerings.map((offering) => (
                  <li
                    key={offering.id}
                    className="flex items-center justify-between gap-2 px-4 py-2.5"
                  >
                    <div className="min-w-0">
                      <Link
                        to="/offerings"
                        search={{ offering: offering.id }}
                        className="text-sm font-medium hover:underline"
                      >
                        {offering.name}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {titleize(offering.offering_type)}
                      </p>
                    </div>
                    <span className="mono-num shrink-0 text-muted-foreground">
                      {currency(offering.estimated_monthly_cost_low, { compact: true })}–
                      {currency(offering.estimated_monthly_cost_high, { compact: true })}
                    </span>
                  </li>
                ))}
                {!offerings.length && (
                  <li className="px-4 py-5 text-xs text-muted-foreground">
                    No offerings yet. Create one from the Offerings catalog.
                  </li>
                )}
              </ul>
            </Panel>
          );
        })}
      </div>
    </>
  );
}
