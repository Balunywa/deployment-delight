/*
 * Small HCL building blocks shared by every service in an offering's Terraform: private endpoints with
 * their DNS, diagnostic settings to Log Analytics, and role assignments for the install's identity.
 */

export type ServiceTf = {
  /** File body for this service (resources, private endpoint, diagnostics, roles). */
  body: string;
  /** Private DNS zones its private endpoints need. */
  zones?: string[];
  /** Subnets it needs in the spoke. */
  subnets?: SubnetKey[];
  /** Resource providers Terraform must register in the subscription. */
  providers?: string[];
  /** Outputs to expose, name → expression. */
  outputs?: Record<string, string>;
};

export type SubnetKey = "aks" | "aca" | "web" | "func" | "apim" | "endpoints" | "appgw";

/** Address plan inside the install's /22 (or larger): fixed slots so re-deploys never renumber. */
export const SUBNETS: Record<
  SubnetKey,
  { name: string; newbits: number; index: number; delegation?: string; udr: boolean }
> = {
  aks: { name: "snet-aks", newbits: 2, index: 0, udr: true },
  aca: {
    name: "snet-aca",
    newbits: 3,
    index: 2,
    delegation: "Microsoft.App/environments",
    udr: true,
  },
  web: {
    name: "snet-web",
    newbits: 4,
    index: 8,
    delegation: "Microsoft.Web/serverFarms",
    udr: true,
  },
  apim: {
    name: "snet-apim",
    newbits: 4,
    index: 9,
    delegation: "Microsoft.Web/serverFarms",
    udr: true,
  },
  func: {
    name: "snet-func",
    newbits: 4,
    index: 10,
    delegation: "Microsoft.App/environments",
    udr: true,
  },
  endpoints: { name: "snet-endpoints", newbits: 3, index: 6, udr: false },
  appgw: { name: "snet-appgw", newbits: 4, index: 14, udr: false },
};

export const DELEGATION_ACTIONS: Record<string, string[]> = {
  "Microsoft.App/environments": ["Microsoft.Network/virtualNetworks/subnets/join/action"],
  "Microsoft.Web/serverFarms": ["Microsoft.Network/virtualNetworks/subnets/action"],
};

/** Private endpoint in the endpoints subnet, registered in the install's DNS mode (local / platform / policy). */
export function pe(
  name: string,
  target: string,
  subresource: string,
  zones: string[],
  /** Extra HCL condition, e.g. when only some SKUs support private endpoints. */
  when = "",
) {
  const slug = name.replace(/_/g, "-");
  return `
resource "azurerm_private_endpoint" "${name}" {
  count               = var.private_endpoints${when ? ` && (${when})` : ""} ? 1 : 0
  name                = "pe-\${local.name}-${slug}"
  location            = var.location
  resource_group_name = local.rg_name
  subnet_id           = local.subnet_ids["snet-endpoints"]
  tags                = local.tags

  private_service_connection {
    name                           = "psc-${slug}"
    private_connection_resource_id = ${target}
    subresource_names              = ["${subresource}"]
    is_manual_connection           = false
  }

  # With the ALZ "Deploy-Private-DNS-Zones" policy the platform registers the record itself.
  dynamic "private_dns_zone_group" {
    for_each = var.private_dns_mode == "policy" ? [] : [1]
    content {
      name                 = "default"
      private_dns_zone_ids = [${zones.map((z) => `local.dns_zone_ids[${JSON.stringify(z)}]`).join(", ")}]
    }
  }

  lifecycle {
    # Azure Policy may add the DNS zone group after creation.
    ignore_changes = [private_dns_zone_group]
  }
}
`;
}

/** Diagnostic setting to the install's Log Analytics workspace. */
export function diag(
  name: string,
  target: string,
  opts: { logs?: string | false; metrics?: string | false } = {},
) {
  const logs = opts.logs === undefined ? "allLogs" : opts.logs;
  const metrics = opts.metrics === undefined ? "AllMetrics" : opts.metrics;
  return `
resource "azurerm_monitor_diagnostic_setting" "${name}" {
  name                       = "diag-to-law"
  target_resource_id         = ${target}
  log_analytics_workspace_id = local.law_id
${logs ? `\n  enabled_log {\n    category_group = "${logs}"\n  }\n` : ""}${metrics ? `\n  enabled_metric {\n    category = "${metrics}"\n  }\n` : ""}}
`;
}

/** Built-in role for the install's managed identity — keyless access, least privilege. */
export function role(name: string, scope: string, roleName: string) {
  return `
resource "azurerm_role_assignment" "${name}" {
  scope                = ${scope}
  role_definition_name = "${roleName}"
  principal_id         = azurerm_user_assigned_identity.app.principal_id
  principal_type       = "ServicePrincipal"
}
`;
}

export const q = (s: string) => JSON.stringify(s);

/**
 * Aligns the `=` of consecutive single-line attributes in the same block, as `terraform fmt` does, so the
 * generated code is what a careful engineer would commit.
 */
export function fmtHcl(src: string) {
  const lines = src.split("\n");
  const attr = /^(\s*)([A-Za-z0-9_"-]+)(\s*)=\s(.*)$/;
  let depth = 0;
  const out = [...lines];
  let group: number[] = [];
  const flush = () => {
    if (group.length > 1) {
      const width = Math.max(...group.map((i) => lines[i]!.match(attr)![2]!.length));
      for (const i of group) {
        const m = lines[i]!.match(attr)!;
        out[i] = `${m[1]}${m[2]!.padEnd(width)} = ${m[4]}`;
      }
    }
    group = [];
  };
  let prevIndent = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const m = line.match(attr);
    const opens = (line.match(/[{[(]/g) ?? []).length - (line.match(/[}\])]/g) ?? []).length;
    if (m && depth === 0 && opens > 0) {
      // A multi-line value ends the group and isn't aligned with it.
      flush();
      depth = opens;
      continue;
    }
    if (m && depth === 0 && (group.length === 0 || m[1]!.length === prevIndent)) {
      group.push(i);
      prevIndent = m[1]!.length;
      continue;
    }
    if (depth > 0) {
      depth += opens;
      if (depth <= 0) depth = 0;
      continue;
    }
    flush();
    if (m) {
      group.push(i);
      prevIndent = m[1]!.length;
    }
  }
  flush();
  return out.join("\n");
}

/** Terraform list literal. */
export const list = (xs: string[]) => `[${xs.map((x) => JSON.stringify(x)).join(", ")}]`;

/** Production value, or dev/test value: `local.prod ? a : b` (just `a` when they're the same). */
export const envSel = (prod: string, dev: string) =>
  prod === dev ? prod : `local.prod ? ${prod} : ${dev}`;

/** HCL boolean literal. */
export const bool = (b: boolean) => (b ? "true" : "false");
