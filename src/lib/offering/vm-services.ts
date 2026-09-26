/*
 * Virtual machine tiers for classic 2-tier and 3-tier architectures: a web tier and an app tier on VM
 * scale sets (Flexible orchestration, zone balanced, autoscaled, health-probed, patched by the platform)
 * and a data tier on virtual machines. Every VM runs as the install's managed identity, signs in with
 * Microsoft Entra ID, ships logs through the Azure Monitor agent, and sits in its own subnet whose NSG only
 * lets the tier above it in.
 */
import { sizing } from "@/lib/skus";

import { type ServiceTf, envSel, q } from "./hcl";

type S = Record<string, string>;

export const IMAGES: Record<
  string,
  { publisher: string; offer: string; sku: string; windows: boolean }
> = {
  "Ubuntu 24.04 LTS": {
    publisher: "Canonical",
    offer: "ubuntu-24_04-lts",
    sku: "server",
    windows: false,
  },
  "Ubuntu 22.04 LTS": {
    publisher: "Canonical",
    offer: "0001-com-ubuntu-server-jammy",
    sku: "22_04-lts-gen2",
    windows: false,
  },
  "RHEL 9": { publisher: "RedHat", offer: "RHEL", sku: "9-lvm-gen2", windows: false },
  "Windows Server 2022": {
    publisher: "MicrosoftWindowsServer",
    offer: "WindowsServer",
    sku: "2022-datacenter-azure-edition",
    windows: true,
  },
  "Windows Server 2025": {
    publisher: "MicrosoftWindowsServer",
    offer: "WindowsServer",
    sku: "2025-datacenter-azure-edition",
    windows: true,
  },
  "SQL Server 2022 Developer on Windows Server 2022": {
    publisher: "MicrosoftSQLServer",
    offer: "sql2022-ws2022",
    sku: "sqldev-gen2",
    windows: true,
  },
  "SQL Server 2022 Standard on Windows Server 2022": {
    publisher: "MicrosoftSQLServer",
    offer: "sql2022-ws2022",
    sku: "standard-gen2",
    windows: true,
  },
};

/** Tier roles: which subnet, what port the tier listens on, and who may call it. */
export const TIERS = {
  web: { subnet: "snet-web-tier", port: 80 },
  app: { subnet: "snet-app-tier", port: 8080 },
  data: { subnet: "snet-data-tier", port: 1433 },
} as const;

const count = (v: string | undefined, d: number) => Number(v?.match(/\d+/)?.[0] ?? d);

// A placeholder web server so load balancer probes pass before the product's own build is rolled out.
const cloudInit = (port: number) =>
  `#cloud-config
write_files:
  - path: /var/www/placeholder/index.html
    content: "<h1>Cloud Delivery</h1><p>Placeholder until the release pipeline deploys the product.</p>"
  - path: /etc/systemd/system/placeholder.service
    content: |
      [Unit]
      Description=Placeholder web server
      After=network.target
      [Service]
      ExecStart=/usr/bin/python3 -m http.server ${port} --directory /var/www/placeholder
      Restart=always
      [Install]
      WantedBy=multi-user.target
runcmd:
  - systemctl daemon-reload
  - systemctl enable --now placeholder.service
`;

const extensions = (windows: boolean, port: number, indent = "  ") =>
  [
    windows
      ? {
          name: "entra-login",
          publisher: "Microsoft.Azure.ActiveDirectory",
          type: "AADLoginForWindows",
          version: "2.0",
        }
      : {
          name: "entra-login",
          publisher: "Microsoft.Azure.ActiveDirectory",
          type: "AADSSHLoginForLinux",
          version: "1.0",
        },
    {
      name: "azure-monitor-agent",
      publisher: "Microsoft.Azure.Monitor",
      type: windows ? "AzureMonitorWindowsAgent" : "AzureMonitorLinuxAgent",
      version: "1.0",
      settings: `jsonencode({ authentication = { managedIdentity = { identifier-name = "mi_res_id", identifier-value = azurerm_user_assigned_identity.app.id } } })`,
    },
    {
      name: "health",
      publisher: "Microsoft.ManagedServices",
      type: windows ? "ApplicationHealthWindows" : "ApplicationHealthLinux",
      version: "1.0",
      settings: `jsonencode({ protocol = "tcp", port = ${port} })`,
    },
  ]
    .map(
      (e) => `${indent}extension {
${indent}  name                               = "${e.name}"
${indent}  publisher                          = "${e.publisher}"
${indent}  type                               = "${e.type}"
${indent}  type_handler_version               = "${e.version}"
${indent}  auto_upgrade_minor_version_enabled = true${e.settings ? `\n${indent}  settings                           = ${e.settings}` : ""}
${indent}}`,
    )
    .join("\n\n");

/** Credentials no one needs to type: SSH key or a generated password, output as sensitive values. */
export const vmCredentials = () => `
# Sign-in is with Microsoft Entra ID; these break-glass credentials are generated, never typed.
resource "tls_private_key" "vm" {
  algorithm = "ED25519"
}

resource "random_password" "vm" {
  length           = 24
  special          = true
  override_special = "!#%*-_=+"
  min_upper        = 2
  min_lower        = 2
  min_numeric      = 2
  min_special      = 2
}

# Operators sign in to the VMs with their Entra accounts.
resource "azurerm_role_assignment" "vm_admin_login" {
  count                = var.vm_admin_group_id != "" ? 1 : 0
  scope                = local.rg_id
  role_definition_name = "Virtual Machine Administrator Login"
  principal_id         = var.vm_admin_group_id
}
`;

function scaleSet(
  tier: "web" | "app",
  id: string,
  s: S,
  opts: { appGateway: boolean; publicWeb: boolean },
): ServiceTf {
  const [size] = sizing(id, s);
  const img = IMAGES[s["os"] ?? "Ubuntu 24.04 LTS"] ?? IMAGES["Ubuntu 24.04 LTS"]!;
  const port = TIERS[tier].port;
  const inst = count(s["instances"], 2);
  const devInst = count(s["devInstances"], 1);
  const max = count(s["maxInstances"], 10);
  const name = `vmss_${tier}`;
  const viaAgw = tier === "web" && opts.appGateway;
  const publicLb = tier === "web" && !opts.appGateway && opts.publicWeb;
  const lb = viaAgw
    ? ""
    : `
${
  publicLb
    ? `resource "azurerm_public_ip" "lb_${tier}" {
  name                = "pip-\${local.name}-lb-${tier}"
  location            = var.location
  resource_group_name = local.rg_name
  allocation_method   = "Static"
  sku                 = "Standard"
  zones               = local.prod ? ["1", "2", "3"] : null
  tags                = local.tags
}
`
    : ""
}
# ${publicLb ? "Public" : "Internal"} Standard load balancer in front of the ${tier} tier.
resource "azurerm_lb" "${tier}" {
  name                = "lbi-\${local.name}-${tier}"
  location            = var.location
  resource_group_name = local.rg_name
  sku                 = "Standard"
  tags                = local.tags

  frontend_ip_configuration {
    name                          = "frontend"${
      publicLb
        ? `
    public_ip_address_id          = azurerm_public_ip.lb_${tier}.id`
        : `
    subnet_id                     = local.subnet_ids["${TIERS[tier].subnet}"]
    private_ip_address_allocation = "Dynamic"
    zones                         = local.prod ? ["1", "2", "3"] : null`
    }
  }
}

resource "azurerm_lb_backend_address_pool" "${tier}" {
  name            = "${tier}"
  loadbalancer_id = azurerm_lb.${tier}.id
}

resource "azurerm_lb_probe" "${tier}" {
  name            = "${tier}"
  loadbalancer_id = azurerm_lb.${tier}.id
  protocol        = "Tcp"
  port            = ${port}
}

resource "azurerm_lb_rule" "${tier}" {
  name                           = "${tier}"
  loadbalancer_id                = azurerm_lb.${tier}.id
  protocol                       = "Tcp"
  frontend_port                  = ${port}
  backend_port                   = ${port}
  frontend_ip_configuration_name = "frontend"
  backend_address_pool_ids       = [azurerm_lb_backend_address_pool.${tier}.id]
  probe_id                       = azurerm_lb_probe.${tier}.id
  disable_outbound_snat          = true
}
`;
  const pools = viaAgw
    ? `application_gateway_backend_address_pool_ids = [for p in azurerm_application_gateway.this.backend_address_pool : p.id if p.name == "app"]`
    : `load_balancer_backend_address_pool_ids = [azurerm_lb_backend_address_pool.${tier}.id]`;
  const linux = !img.windows;
  return {
    subnets: [tier === "web" ? "webtier" : "apptier"],
    outputs: {
      [`${tier}_tier_endpoint`]: viaAgw
        ? "azurerm_public_ip.appgw.ip_address"
        : publicLb
          ? `azurerm_public_ip.lb_${tier}.ip_address`
          : `azurerm_lb.${tier}.frontend_ip_configuration[0].private_ip_address`,
    },
    body: `${lb}
resource "azurerm_orchestrated_virtual_machine_scale_set" "${name}" {
  name                        = "vmss-\${local.name}-${tier}"
  location                    = var.location
  resource_group_name         = local.rg_name
  sku_name                    = ${envSel(q(size!.prod.value), q(size!.dev.value))}
  instances                   = ${envSel(String(inst), String(devInst))}
  platform_fault_domain_count = 1
  zones                       = local.prod ? ["1", "2", "3"] : null
  zone_balance                = local.prod
  tags                        = local.tags

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.app.id]
  }

  source_image_reference {
    publisher = ${q(img.publisher)}
    offer     = ${q(img.offer)}
    sku       = ${q(img.sku)}
    version   = "latest"
  }

  os_profile {${
    linux
      ? `
    custom_data = base64encode(${JSON.stringify(cloudInit(port))})

    linux_configuration {
      admin_username                  = "azureuser"
      computer_name_prefix            = "${tier}"
      disable_password_authentication = true
      patch_mode                      = "AutomaticByPlatform"
      provision_vm_agent              = true

      admin_ssh_key {
        username   = "azureuser"
        public_key = tls_private_key.vm.public_key_openssh
      }
    }`
      : `
    windows_configuration {
      admin_username       = "azureadmin"
      admin_password       = random_password.vm.result
      computer_name_prefix = "${tier}"
      patch_mode           = "AutomaticByPlatform"
      provision_vm_agent   = true
    }`
  }
  }

  os_disk {
    caching              = "ReadWrite"
    storage_account_type = local.prod ? "Premium_LRS" : "StandardSSD_LRS"
  }

  network_interface {
    name    = "nic"
    primary = true

    ip_configuration {
      name      = "ipconfig"
      primary   = true
      subnet_id = local.subnet_ids["${TIERS[tier].subnet}"]
      ${pools}
    }
  }

  # Managed boot diagnostics (no storage account to run).
  boot_diagnostics {}

  automatic_instance_repair {
    enabled      = true
    grace_period = "PT30M"
  }

${extensions(!linux, port)}

  lifecycle {
    # Autoscale owns the instance count after the first deploy.
    ignore_changes = [instances]
  }
}

resource "azurerm_monitor_autoscale_setting" "${tier}" {
  name                = "autoscale-\${local.name}-${tier}"
  location            = var.location
  resource_group_name = local.rg_name
  target_resource_id  = azurerm_orchestrated_virtual_machine_scale_set.${name}.id
  tags                = local.tags

  profile {
    name = "cpu"

    capacity {
      default = ${envSel(String(inst), String(devInst))}
      minimum = ${envSel(String(inst), String(devInst))}
      maximum = ${envSel(String(max), String(Math.max(devInst, 2)))}
    }

    rule {
      metric_trigger {
        metric_name        = "Percentage CPU"
        metric_resource_id = azurerm_orchestrated_virtual_machine_scale_set.${name}.id
        time_grain         = "PT1M"
        statistic          = "Average"
        time_window        = "PT5M"
        time_aggregation   = "Average"
        operator           = "GreaterThan"
        threshold          = 70
      }

      scale_action {
        direction = "Increase"
        type      = "ChangeCount"
        value     = "1"
        cooldown  = "PT5M"
      }
    }

    rule {
      metric_trigger {
        metric_name        = "Percentage CPU"
        metric_resource_id = azurerm_orchestrated_virtual_machine_scale_set.${name}.id
        time_grain         = "PT1M"
        statistic          = "Average"
        time_window        = "PT10M"
        time_aggregation   = "Average"
        operator           = "LessThan"
        threshold          = 25
      }

      scale_action {
        direction = "Decrease"
        type      = "ChangeCount"
        value     = "1"
        cooldown  = "PT10M"
      }
    }
  }
}
`,
  };
}

export const webTier = (s: S, opts: { appGateway: boolean; publicWeb: boolean }) =>
  scaleSet("web", "web-vmss", s, opts);
export const appTier = (s: S) =>
  scaleSet("app", "app-vmss", s, { appGateway: false, publicWeb: false });

/** Data or legacy servers on individual VMs, spread across zones in production, each with a data disk. */
export const dataVms = (s: S): ServiceTf => {
  const [size] = sizing("vm", s);
  const img = IMAGES[s["os"] ?? "Ubuntu 24.04 LTS"] ?? IMAGES["Ubuntu 24.04 LTS"]!;
  const n = count(s["count"], 2);
  const devN = count(s["devCount"], 1);
  const disk = count(s["dataDisk"], 256);
  const linux = !img.windows;
  const res = linux ? "azurerm_linux_virtual_machine" : "azurerm_windows_virtual_machine";
  return {
    subnets: ["datatier"],
    outputs: {
      data_tier_private_ips: "azurerm_network_interface.data[*].private_ip_address",
    },
    body: `
locals {
  data_vm_count = ${envSel(String(n), String(devN))}
}

resource "azurerm_network_interface" "data" {
  count               = local.data_vm_count
  name                = "nic-\${local.name}-data-\${count.index + 1}"
  location            = var.location
  resource_group_name = local.rg_name
  tags                = local.tags

  ip_configuration {
    name                          = "ipconfig"
    subnet_id                     = local.subnet_ids["snet-data-tier"]
    private_ip_address_allocation = "Dynamic"
  }
}

resource "${res}" "data" {
  count                 = local.data_vm_count
  name                  = "vm-\${local.short}-data-\${count.index + 1}"
  computer_name         = "data\${count.index + 1}"
  location              = var.location
  resource_group_name   = local.rg_name
  size                  = ${envSel(q(size!.prod.value), q(size!.dev.value))}
  network_interface_ids = [azurerm_network_interface.data[count.index].id]
  zone                  = local.prod ? tostring((count.index % 3) + 1) : null
  secure_boot_enabled   = true
  vtpm_enabled          = true
  patch_mode            = "AutomaticByPlatform"${
    linux
      ? `
  admin_username                  = "azureuser"
  disable_password_authentication = true`
      : `
  admin_username = "azureadmin"
  admin_password = random_password.vm.result`
  }
  tags = local.tags
${
  linux
    ? `
  admin_ssh_key {
    username   = "azureuser"
    public_key = tls_private_key.vm.public_key_openssh
  }
`
    : ""
}
  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.app.id]
  }

  source_image_reference {
    publisher = ${q(img.publisher)}
    offer     = ${q(img.offer)}
    sku       = ${q(img.sku)}
    version   = "latest"
  }

  os_disk {
    caching              = "ReadWrite"
    storage_account_type = local.prod ? "Premium_LRS" : "StandardSSD_LRS"
  }

  boot_diagnostics {}
}

resource "azurerm_managed_disk" "data" {
  count                = local.data_vm_count
  name                 = "disk-\${local.short}-data-\${count.index + 1}"
  location             = var.location
  resource_group_name  = local.rg_name
  storage_account_type = local.prod ? "Premium_ZRS" : "StandardSSD_LRS"
  create_option        = "Empty"
  disk_size_gb         = ${disk}
  tags                 = local.tags
}

resource "azurerm_virtual_machine_data_disk_attachment" "data" {
  count              = local.data_vm_count
  managed_disk_id    = azurerm_managed_disk.data[count.index].id
  virtual_machine_id = ${res}.data[count.index].id
  lun                = 0
  caching            = "ReadOnly"
}

resource "azurerm_virtual_machine_extension" "data_entra" {
  count                      = local.data_vm_count
  name                       = "entra-login"
  virtual_machine_id         = ${res}.data[count.index].id
  publisher                  = "Microsoft.Azure.ActiveDirectory"
  type                       = "${linux ? "AADSSHLoginForLinux" : "AADLoginForWindows"}"
  type_handler_version       = "${linux ? "1.0" : "2.0"}"
  auto_upgrade_minor_version = true
}

resource "azurerm_virtual_machine_extension" "data_ama" {
  count                      = local.data_vm_count
  name                       = "azure-monitor-agent"
  virtual_machine_id         = ${res}.data[count.index].id
  publisher                  = "Microsoft.Azure.Monitor"
  type                       = "${linux ? "AzureMonitorLinuxAgent" : "AzureMonitorWindowsAgent"}"
  type_handler_version       = "1.0"
  auto_upgrade_minor_version = true
  automatic_upgrade_enabled  = true
  settings                   = jsonencode({ authentication = { managedIdentity = { identifier-name = "mi_res_id", identifier-value = azurerm_user_assigned_identity.app.id } } })
}
`,
  };
};

/**
 * Tier-to-tier NSG rules: the web tier takes traffic from the gateway or load balancer, the app tier only
 * from the web tier, the data tier only from the app tier. Everything else inside the network is denied.
 */
export function tierRules(
  k: "webtier" | "apptier" | "datatier",
  o: { appGateway: boolean; publicWeb: boolean },
) {
  const prefix = (t: "webtier" | "apptier" | "datatier" | "appgw") =>
    ({
      webtier: "cidrsubnet(var.address_space, 4, 6)",
      apptier: "cidrsubnet(var.address_space, 4, 7)",
      datatier: "cidrsubnet(var.address_space, 4, 11)",
      appgw: "cidrsubnet(var.address_space, 4, 14)",
    })[t];
  const rule = (name: string, pri: number, src: string, ports: string[], access = "Allow") => `
  security_rule {
    name                       = "${name}"
    priority                   = ${pri}
    direction                  = "Inbound"
    access                     = "${access}"
    protocol                   = "${ports.length ? "Tcp" : "*"}"
    source_port_range          = "*"
    ${ports.length === 1 ? `destination_port_range     = "${ports[0]}"` : ports.length ? `destination_port_ranges    = ${JSON.stringify(ports).replace(/,/g, ", ")}` : `destination_port_range     = "*"`}
    source_address_prefix      = ${src}
    destination_address_prefix = "*"
  }
`;
  const out: string[] = [rule("AllowLoadBalancerProbes", 100, '"AzureLoadBalancer"', [])];
  if (k === "webtier") {
    if (o.appGateway) out.push(rule("AllowFromAppGateway", 110, prefix("appgw"), ["80", "443"]));
    else if (o.publicWeb) out.push(rule("AllowWebFromInternet", 110, '"Internet"', ["80", "443"]));
    else out.push(rule("AllowWebFromNetwork", 110, '"VirtualNetwork"', ["80", "443"]));
  }
  if (k === "apptier") out.push(rule("AllowFromWebTier", 110, prefix("webtier"), ["8080"]));
  if (k === "datatier")
    out.push(rule("AllowFromAppTier", 110, prefix("apptier"), ["1433", "5432", "3306", "1521"]));
  // Operators reach VMs over Bastion in the hub, signing in with Entra ID.
  out.push(rule("AllowBastionSshRdp", 200, '"VirtualNetwork"', ["22", "3389"]));
  out.push(rule("DenyOtherVnetInbound", 4000, '"VirtualNetwork"', [], "Deny"));
  return out.join("");
}
