import { Link, useRouterState } from "@tanstack/react-router";
import {
  Activity,
  BadgeCheck,
  Boxes,
  Building2,
  ClipboardList,
  Cog,
  DollarSign,
  LayoutDashboard,
  Layers,
  Rocket,
  ScrollText,
  ShieldCheck,
} from "lucide-react";
import { type LucideIcon } from "lucide-react";
import { type ReactNode } from "react";

import { Pill } from "@/components/Primitives";
import { cn } from "@/lib/utils";

type NavItem = {
  to: "/" | "/estate" | "/customers" | "/deployments" | "/products" | "/offerings" | "/upgrades" | "/compliance" | "/costs" | "/audit" | "/settings";
  label: string;
  icon: LucideIcon;
};

type NavGroup = {
  label: string;
  items: readonly NavItem[];
};

const nav = [
  {
    label: "Inventory",
    items: [
      { to: "/", label: "Overview", icon: LayoutDashboard },
      { to: "/estate", label: "Estate Fleet", icon: Activity },
      { to: "/customers", label: "Customers", icon: Building2 },
      { to: "/deployments", label: "Deployments", icon: Rocket },
    ],
  },
  {
    label: "Catalog",
    items: [
      { to: "/products", label: "Products", icon: Boxes },
      { to: "/offerings", label: "Offerings", icon: Layers },
    ],
  },
  {
    label: "Governance",
    items: [
      { to: "/upgrades", label: "Rollouts", icon: BadgeCheck },
      { to: "/compliance", label: "Compliance", icon: ShieldCheck },
      { to: "/costs", label: "Cost Management", icon: DollarSign },
      { to: "/audit", label: "Audit Logs", icon: ScrollText },
    ],
  },
  {
    label: "System",
    items: [{ to: "/settings", label: "Settings", icon: Cog }],
  },
] as const satisfies readonly NavGroup[];

const mobileNav: readonly NavItem[] = nav.flatMap((group) => [...group.items]);

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-nav-active bg-nav lg:flex">
        <div className="border-b border-nav-active px-4 py-4">
          <p className="text-sm font-semibold text-nav-foreground">GridWorks</p>
          <p className="mt-0.5 text-[11px] text-nav-muted">Cloud Deployment Portal</p>
        </div>
        <nav className="flex-1 overflow-y-auto p-2">
          {nav.map((group) => (
            <div key={group.label} className="mb-4">
              <p className="mb-1 px-2.5 text-[10px] font-bold tracking-wider text-nav-muted uppercase">
                {group.label}
              </p>
              {group.items.map((item) => {
                const active = item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    className={cn(
                      "mb-0.5 flex items-center gap-2.5 rounded-sm px-2.5 py-1.5 text-[13px] text-nav-muted transition-colors hover:bg-nav-active hover:text-nav-foreground",
                      active && "bg-nav-active font-medium text-nav-foreground",
                    )}
                  >
                    <item.icon className="size-4" />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="border-t border-nav-active p-3">
          <Link
            to="/onboard"
            className="flex items-center justify-center gap-2 rounded-sm bg-primary px-3 py-2 text-[13px] font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            <ClipboardList className="size-4" />
            Onboard customer
          </Link>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-border bg-card/95 px-4 py-2.5 backdrop-blur">
          <div className="flex min-w-0 items-center gap-3">
            <span className="text-xs font-medium text-muted-foreground">
              Azure ISV Deployment Factory
            </span>
            <Pill tone="warning">Demo mode — no Azure calls</Pill>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="hidden sm:inline">Sarah Chen · ISV Platform Engineer</span>
            <span className="grid size-7 place-items-center rounded-full bg-secondary text-[11px] font-semibold text-secondary-foreground">
              SC
            </span>
          </div>
        </header>

        <nav className="flex gap-1 overflow-x-auto border-b border-border bg-card px-2 py-1.5 lg:hidden">
          {mobileNav.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="rounded-sm px-2.5 py-1.5 text-xs whitespace-nowrap text-muted-foreground data-[status=active]:bg-accent data-[status=active]:text-accent-foreground"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <main className="min-w-0 flex-1 px-4 py-5 lg:px-6">{children}</main>
      </div>
    </div>
  );
}
