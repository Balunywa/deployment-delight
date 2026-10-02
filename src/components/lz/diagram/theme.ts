/*
 * The architecture diagram standard, shared by every diagram in the landing zone area: one palette (dark by
 * default, light on request, remembered), Azure's own icons per component, and the outcome colours. The look is
 * the traffic overview's: nested boundaries, icon cards, and one glowing lane per connection.
 */
import { useEffect, useState } from "react";

export type DiagramTheme = "dark" | "light";

export type DiagramColors = {
  bg: string;
  azure: string;
  azureLine: string;
  zone: string;
  zoneLine: string;
  node: string;
  nodeLine: string;
  text: string;
  sub: string;
  muted: string;
  band: string;
  accent: string;
};

export const PALETTE: Record<DiagramTheme, DiagramColors> = {
  dark: {
    bg: "#0f141c",
    azure: "#1a2230",
    azureLine: "#3b4a63",
    zone: "#141b26",
    zoneLine: "#4a5a76",
    node: "#1f2836",
    nodeLine: "#3d4b62",
    text: "#e8eef7",
    sub: "#93a3b8",
    muted: "#5b6a80",
    band: "#1d2636",
    accent: "#4da3ff",
  },
  light: {
    bg: "#f7f9fc",
    azure: "#ffffff",
    azureLine: "#c9d3e1",
    zone: "#f4f7fb",
    zoneLine: "#aab7ca",
    node: "#ffffff",
    nodeLine: "#c9d3e1",
    text: "#152033",
    sub: "#5b6a80",
    muted: "#94a3b8",
    band: "#eef2f8",
    accent: "#0078d4",
  },
};

type Outcome = { mark: string; color: string; label: string };
const OUTCOME_VALUES = {
  reaches: { mark: "✓", color: "#22c55e", label: "Works" },
  "needs-rules": { mark: "!", color: "#f59e0b", label: "Needs a rule" },
  uninspected: { mark: "!", color: "#f59e0b", label: "Not inspected" },
  isolated: { mark: "■", color: "#38bdf8", label: "Isolated by design" },
  blocked: { mark: "✕", color: "#ef4444", label: "Blocked" },
  broken: { mark: "✕", color: "#ef4444", label: "Broken" },
} satisfies Record<string, Outcome>;
export const OUTCOME = OUTCOME_VALUES as typeof OUTCOME_VALUES & Record<string, Outcome>;

/** Azure architecture icons in public/azure-icons, by the ids the scene, map and traffic layouts use. */
const ICONS: Record<string, string> = {
  internet: "public-ip",
  users: "users",
  customers: "users",
  operator: "users",
  operators: "users",
  remote: "vpn-client",
  onprem: "on-premises",
  onprem2: "on-premises",
  hubvnet: "vnet",
  hubvnet2: "vnet",
  hub1: "vwan-hub",
  vhub: "vwan-hub",
  vhub2: "vwan-hub",
  vwan: "virtual-wan",
  sidecar: "vnet",
  firewall: "firewall",
  firewall2: "firewall",
  firewallpolicy: "firewall-policy",
  vpngw: "vnet-gateway",
  vpngw2: "vnet-gateway",
  ergw: "expressroute",
  ergw2: "expressroute",
  bastion: "bastion",
  dnsresolver: "dns-resolver",
  dnszones: "dns-zones",
  ddos: "defender",
  law: "log-analytics",
  dcr: "monitor",
  ama: "monitor",
  dashboards: "monitor",
  sentinel: "sentinel",
  defender: "defender",
  networkwatcher: "network-watcher",
  vm: "vm",
  pe: "private-endpoint",
  nsg: "nsg",
  route: "route-table",
  subnet: "subnet",
  vnet: "vnet",
  appgw: "app-gateway",
  frontdoor: "front-door",
  keyvault: "key-vault",
  sql: "sql-database",
  subscription: "subscription",
  // Workload services (catalog ids), Microsoft's Azure Public Service Icons.
  aks: "aks",
  "container-apps": "container-apps",
  functions: "functions",
  "app-service": "app-service",
  "web-vmss": "vmss",
  "app-vmss": "vmss",
  "container-registry": "container-registry",
  "container-instances": "container-instances",
  storage: "storage",
  cosmos: "cosmos",
  postgres: "postgres",
  "sql-database": "sql-database",
  redis: "redis",
  "ai-foundry": "ai-foundry",
  "ai-search": "ai-search",
  "data-explorer": "data-explorer",
  "iot-hub": "iot-hub",
  databricks: "databricks",
  fabric: "data-explorer",
  adme: "storage",
  "adme-connection": "storage",
  apim: "apim",
  "service-bus": "service-bus",
  "event-hubs": "event-hubs",
  "event-grid": "event-grid",
  "app-configuration": "app-configuration",
  "key-vault": "key-vault",
  "managed-identity": "managed-identity",
  "app-insights": "app-insights",
  // No official SRE Agent icon in the V24 pack; the Azure Monitor icon, always labelled.
  "sre-agent": "monitor",
  monitoring: "log-analytics",
  budget: "budget",
  "resource-group": "resource-group",
  "security-baseline": "policy",
  "network-spoke": "vnet",
  "private-endpoints": "private-endpoint",
  "app-gateway": "app-gateway",
  "front-door": "front-door",
  entra: "entra",
  cicd: "devops",
  dns: "dns-zones",
  hub: "vnet",
};

/** The icon file name (without .svg) for an id; used by the SVG diagrams. */
export function iconName(id: string, fallback = "subscription") {
  return azureIcon(id, fallback).replace("/azure-icons/", "").replace(".svg", "");
}

/** The icon for an id, matching on the id itself or its leading word (e.g. "firewall-2", "spoke:…"). */
export function azureIcon(id: string, fallback = "subscription") {
  const key = id.toLowerCase();
  const name =
    ICONS[key] ??
    ICONS[key.split(/[:\-_.]/)[0] ?? ""] ??
    Object.entries(ICONS).find(([k]) => key.includes(k))?.[1] ??
    fallback;
  return `/azure-icons/${name}.svg`;
}

const KEY = "cd-diagram-theme";
const EVENT = "cd-diagram-theme";

/** The diagram theme, shared by every diagram on the page and remembered between visits. */
export function useDiagramTheme(): [DiagramTheme, (t: DiagramTheme) => void] {
  const [theme, setTheme] = useState<DiagramTheme>("dark");
  useEffect(() => {
    const saved = window.localStorage.getItem(KEY);
    if (saved === "light" || saved === "dark") setTheme(saved);
    const on = (e: Event) => setTheme((e as CustomEvent<DiagramTheme>).detail);
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  const set = (t: DiagramTheme) => {
    window.localStorage.setItem(KEY, t);
    window.dispatchEvent(new CustomEvent(EVENT, { detail: t }));
  };
  return [theme, set];
}
