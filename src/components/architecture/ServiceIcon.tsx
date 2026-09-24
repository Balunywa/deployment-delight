import {
  Activity,
  BrickWall,
  Cable,
  Container,
  Cylinder,
  Database,
  Fingerprint,
  FolderTree,
  Gauge,
  Globe,
  HardDrive,
  KeyRound,
  Layers,
  type LucideIcon,
  MemoryStick,
  Network,
  Radio,
  ScrollText,
  Server,
  Shield,
  Split,
  Wallet,
  Webhook,
  Workflow,
  Zap,
} from "lucide-react";

import { SERVICE_BY_ID, type ServiceDef } from "@/lib/catalog";
import { cn } from "@/lib/utils";

const ICON: Record<string, LucideIcon> = {
  "resource-group": FolderTree,
  "managed-identity": Fingerprint,
  "security-baseline": ScrollText,
  "network-spoke": Network,
  "private-endpoints": Cable,
  "app-gateway": Split,
  "front-door": Globe,
  aks: Container,
  "container-apps": Layers,
  "app-service": Server,
  functions: Zap,
  postgres: Database,
  sql: Cylinder,
  cosmos: Globe,
  storage: HardDrive,
  redis: MemoryStick,
  "event-hubs": Radio,
  "service-bus": Workflow,
  apim: Webhook,
  "key-vault": KeyRound,
  defender: Shield,
  monitoring: Activity,
  "app-insights": Gauge,
  budget: Wallet,
  hub: Network,
  firewall: BrickWall,
  dns: Globe,
  law: Activity,
};

export const CATEGORY_TILE: Record<ServiceDef["category"] | "Customer", string> = {
  Compute: "bg-cat-compute",
  Data: "bg-cat-data",
  Messaging: "bg-cat-messaging",
  Networking: "bg-cat-networking",
  Security: "bg-cat-security",
  Observability: "bg-cat-observability",
  Governance: "bg-cat-governance",
  Customer: "bg-muted-foreground",
};

export function ServiceIcon({ id, size = "md" }: { id: string; size?: "sm" | "md" | "lg" }) {
  const Icon = ICON[id] ?? Server;
  const category = SERVICE_BY_ID.get(id)?.category ?? "Customer";
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-[5px] text-white",
        CATEGORY_TILE[category],
        size === "sm" ? "size-5" : size === "lg" ? "size-9" : "size-7",
      )}
    >
      <Icon
        className={size === "sm" ? "size-3" : size === "lg" ? "size-5" : "size-4"}
        strokeWidth={2}
      />
    </span>
  );
}
