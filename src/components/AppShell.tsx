import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Activity,
  Ear,
  Boxes,
  Building2,
  Cog,
  Compass,
  DollarSign,
  GitBranch,
  GitFork,
  Landmark,
  LayoutDashboard,
  PanelLeftClose,
  PanelLeftOpen,
  Layers,
  Plus,
  Rocket,
  ScrollText,
  Search,
  ShieldCheck,
  UserPlus,
} from "lucide-react";
import { type LucideIcon } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { currentUserQuery, customersQuery, organizationQuery } from "@/lib/queries";
import { initials } from "@/lib/solutions";
import { cn } from "@/lib/utils";

type Path =
  | "/"
  | "/engagements"
  | "/products"
  | "/offerings"
  | "/well-architected"
  | "/upgrades"
  | "/foundations"
  | "/delivery"
  | "/onboard"
  | "/customers"
  | "/estate"
  | "/deployments"
  | "/compliance"
  | "/costs"
  | "/audit"
  | "/settings";

type NavItem = { to: Path; label: string; icon: LucideIcon };

/*
 * Navigation mirrors the ISV lifecycle: define the product once, bring customers onto it,
 * then operate the installed base. Labels here are the page titles — keep them identical.
 */
const nav: { label: string; items: NavItem[] }[] = [
  { label: "", items: [{ to: "/", label: "Home", icon: LayoutDashboard }] },
  {
    label: "Engage",
    items: [{ to: "/engagements", label: "Engagements", icon: Ear }],
  },
  {
    label: "Product",
    items: [
      { to: "/products", label: "Solution catalog", icon: Boxes },
      { to: "/offerings", label: "Offerings", icon: Layers },
      { to: "/well-architected", label: "Well-Architected", icon: Compass },
      { to: "/upgrades", label: "Releases", icon: GitBranch },
    ],
  },
  {
    label: "Platform",
    items: [
      { to: "/foundations", label: "Landing zones", icon: Landmark },
      { to: "/delivery", label: "Delivery units", icon: GitFork },
    ],
  },
  {
    label: "Customers",
    items: [
      { to: "/customers", label: "Customers", icon: Building2 },
      { to: "/estate", label: "Installed base", icon: Activity },
    ],
  },
  {
    label: "Operate",
    items: [
      { to: "/deployments", label: "Deployments", icon: Rocket },
      { to: "/compliance", label: "Compliance", icon: ShieldCheck },
      { to: "/costs", label: "Costs", icon: DollarSign },
      { to: "/audit", label: "Audit", icon: ScrollText },
    ],
  },
  { label: "", items: [{ to: "/settings", label: "Settings", icon: Cog }] },
];

const flatNav = nav.flatMap((g) => g.items);

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const org = useQuery(organizationQuery);
  const me = useQuery(currentUserQuery).data;
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [railOverride, setRailOverride] = useState<boolean | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Customer-facing pages (the install page, an engagement recap) have no ISV chrome.
  if (pathname.startsWith("/connect") || pathname.startsWith("/recap")) return <>{children}</>;

  const isvName = org.data?.name ?? "GridWorks";
  const demo = org.data?.demo_mode ?? true;
  const isActive = (to: Path) => (to === "/" ? pathname === "/" : pathname.startsWith(to));
  // Canvas-heavy screens default to an icon rail so the workspace gets the full width.
  const rail =
    railOverride ??
    (pathname.startsWith("/offerings") ||
      pathname.startsWith("/deployments/") ||
      pathname.startsWith("/foundations/"));

  return (
    <div className="flex min-h-screen bg-background">
      <aside
        className={cn(
          "sticky top-0 hidden h-screen shrink-0 flex-col bg-nav transition-[width] lg:flex",
          rail ? "w-14" : "w-56",
        )}
      >
        <div
          className={cn(
            "flex items-center gap-2.5 pt-4 pb-3",
            rail ? "justify-center px-2" : "px-4",
          )}
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-[oklch(0.62_0.16_250)] to-[oklch(0.45_0.17_262)] text-[13px] font-bold text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.25),0_2px_6px_rgb(0_0_0/0.3)]">
            {isvName.slice(0, 1)}
          </span>
          {!rail && (
            <div className="min-w-0">
              <p className="truncate text-[13.5px] font-semibold tracking-tight text-nav-foreground">
                {isvName}
              </p>
              <p className="truncate text-[11px] text-nav-muted">Cloud Delivery</p>
            </div>
          )}
        </div>
        <div className={cn("pb-2", rail ? "px-2" : "px-3")}>
          <Link
            to="/onboard"
            title="Onboard customer"
            className="flex items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2 text-[13px] font-medium text-primary-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.16),0_1px_3px_rgb(0_0_0/0.3)] transition-colors hover:bg-primary/90"
          >
            <Plus className="size-3.5 shrink-0" />
            {!rail && "Onboard customer"}
          </Link>
        </div>
        <nav className="flex-1 overflow-y-auto px-2 py-1">
          {nav.map((group, gi) => (
            <div key={gi} className="mb-3">
              {group.label && !rail && (
                <p className="mb-1.5 px-2.5 text-[10.5px] font-semibold tracking-[0.08em] text-nav-muted/60 uppercase">
                  {group.label}
                </p>
              )}
              {group.label && rail && <span className="mx-2 mb-2 block h-px bg-nav-active" />}
              {group.items.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  title={rail ? item.label : undefined}
                  className={cn(
                    "relative mb-0.5 flex items-center gap-2.5 rounded-md py-[7px] text-[13px] text-nav-muted transition-colors hover:bg-white/[0.06] hover:text-nav-foreground",
                    rail ? "justify-center px-0" : "px-2.5",
                    isActive(item.to) &&
                      "bg-white/[0.09] font-medium text-nav-foreground before:absolute before:top-1.5 before:bottom-1.5 before:-left-2 before:w-[3px] before:rounded-full before:bg-[oklch(0.68_0.15_250)]",
                  )}
                >
                  <item.icon
                    className={cn(
                      "size-4 shrink-0",
                      isActive(item.to) ? "opacity-100" : "opacity-70",
                    )}
                  />
                  {!rail && item.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <button
          onClick={() => setRailOverride(!rail)}
          title={rail ? "Expand navigation" : "Collapse navigation"}
          className={cn(
            "mx-2 mb-2 flex items-center gap-2 rounded-md py-1.5 text-[12px] text-nav-muted hover:bg-white/[0.06] hover:text-nav-foreground",
            rail ? "justify-center" : "px-2.5",
          )}
        >
          {rail ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          {!rail && "Collapse"}
        </button>
        {demo && !rail && (
          <div className="mx-3 mb-3 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2.5 text-[11px] leading-snug text-nav-muted">
            <span className="font-medium text-nav-foreground">Demo engine.</span> Customer rollouts
            are simulated. Landing zone deploys and offering test deploys run for real in Azure.
          </div>
        )}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-border/80 bg-card/80 px-4 py-2.5 backdrop-blur-md backdrop-saturate-150 lg:px-6">
          <button
            onClick={() => setPaletteOpen(true)}
            className="flex w-full max-w-sm items-center gap-2 rounded-md border border-border bg-muted/50 px-3 py-1.5 text-left text-[13px] text-muted-foreground transition-colors hover:border-border-strong hover:bg-card"
          >
            <Search className="size-3.5" />
            <span className="flex-1">Jump to a customer, page or action…</span>
            <kbd className="rounded-sm border border-border px-1 font-mono text-[10px]">⌘K</kbd>
          </button>
          <div className="flex items-center gap-2.5 text-xs text-muted-foreground">
            <span className="hidden sm:inline">
              {me ? [me.name, me.role].filter(Boolean).join(" · ") : ""}
            </span>
            <span className="grid size-7 place-items-center rounded-full bg-secondary text-[11px] font-semibold text-secondary-foreground">
              {me ? initials(me.name) : ""}
            </span>
          </div>
        </header>

        <nav className="flex gap-1 overflow-x-auto border-b border-border bg-card px-2 py-1.5 lg:hidden">
          {flatNav.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "rounded-sm px-2.5 py-1.5 text-xs whitespace-nowrap text-muted-foreground",
                isActive(item.to) && "bg-accent text-accent-foreground",
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <main className="min-w-0 flex-1 px-4 py-6 lg:px-8">{children}</main>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}

function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const navigate = useNavigate();
  const customers = useQuery({ ...customersQuery, enabled: open });
  const go = (fn: () => void) => {
    onOpenChange(false);
    fn();
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search customers, pages and actions…" />
      <CommandList>
        <CommandEmpty>No matches.</CommandEmpty>
        <CommandGroup heading="Actions">
          <CommandItem onSelect={() => go(() => navigate({ to: "/onboard" }))}>
            <UserPlus className="size-4" /> Onboard a customer
          </CommandItem>
          <CommandItem onSelect={() => go(() => navigate({ to: "/upgrades" }))}>
            <GitBranch className="size-4" /> Roll out a release
          </CommandItem>
        </CommandGroup>
        <CommandGroup heading="Customers">
          {(customers.data ?? []).map((c) => (
            <CommandItem
              key={c.id}
              value={`${c.name} ${c.customer_code}`}
              onSelect={() =>
                go(() => navigate({ to: "/customers/$customerId", params: { customerId: c.id } }))
              }
            >
              <Building2 className="size-4" /> {c.name}
              <CommandShortcut>{c.customer_code}</CommandShortcut>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Pages">
          {flatNav.map((item) => (
            <CommandItem key={item.to} onSelect={() => go(() => navigate({ to: item.to }))}>
              <item.icon className="size-4" /> {item.label}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
