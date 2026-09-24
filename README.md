# Cloud Delivery

**Give every customer their own environment on Azure — in your Azure or theirs, without a new cloud project each time.**

Cloud Delivery is for software companies that deliver their product on Azure. Today every new customer
usually means weeks of custom cloud work: network design, security reviews, new infrastructure scripts
and pipelines. Cloud Delivery lets you do that work once.

[![Deploy to Azure](https://aka.ms/deploytoazurebutton)](https://portal.azure.com/#create/Microsoft.Template/uri/https%3A%2F%2Fraw.githubusercontent.com%2FBalunywa%2Fdeployment-delight%2Fmain%2Fdeploy%2Fazure%2Fazuredeploy.json/createUIDefinitionUri/https%3A%2F%2Fraw.githubusercontent.com%2FBalunywa%2Fdeployment-delight%2Fmain%2Fdeploy%2Fazure%2FcreateUiDefinition.json)

Deploy the Cloud Delivery console into any Azure tenant in one click — see [deploy/azure](deploy/azure/README.md). Product overview: **https://balunywa.github.io/deployment-delight/**

## Two ways to run it

|                        | Hosted in your Azure (most common)                           | In the customer's own Azure                                                              |
| ---------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Who it's for           | Customers who don't use Azure — they just want your software | Customers who need it in their cloud for data, security or contract reasons              |
| Where it runs          | A dedicated subscription per customer, in your Azure         | The customer's subscription                                                              |
| What the customer does | Nothing — their users sign in with their own work accounts   | Their Azure admin reviews what will be installed and approves limited access with a link |
| Their existing Azure   | Not needed                                                   | Used as-is (network, DNS, security, rules), or a secure foundation is set up first       |

Either way, it's the same product setup, the same deployment process and the same updates.

## How it works

0. **Products and offerings.** A product is the software service a customer buys (for example "Pipeline
   integrity agent"), grouped by business line. An offering is that product delivered one way on Azure —
   Hosted by you, Customer Hosted, Enterprise Private (plugged into the customer's landing zone) or
   Regulated — each with its own architecture, landing zone and guardrails. Customers are onboarded to an
   offering. The demo catalog lives in `src/lib/product-catalog.ts`; `bun scripts/gen-product-seed.ts`
   regenerates `db/seed/0005_product_catalog.sql` from it.
1. **Set up your product once.** Pick the Azure services your product needs on a visual canvas and
   choose where it runs. Cloud Delivery creates the infrastructure code (Bicep), the deployment pipeline
   (GitHub Actions or Azure DevOps) and the short list of details you'll need from each customer.
2. **Review before you offer it.** Every new offering or version goes through architecture review before
   it can be published: every offered region runs every service (from Azure's resource provider region
   lists, all 49 public regions), the landing zone group exists in your landing zone design and its
   policies allow the architecture (for example, Corp denies public endpoints), and the guardrails are on.
3. **Bring on a customer.** Pick a published offering, then choose each environment — dev, test, QA, UAT,
   staging, prod — with its region and target: a new subscription, an existing subscription or an
   existing resource group. Placement in the management group hierarchy comes from the landing zone design,
   one subscription per environment in the same group, as the Cloud Adoption Framework recommends. Hosted
   by you: nothing is needed from the customer. In their Azure: send their admin a link to approve access.
4. **Onboarding is a pull request.** Launching adds one file, `installs/<customer>.yaml`, to your delivery
   repository. The same workflow (GitHub Actions by default, or Azure Pipelines) validates and plans every
   environment on the pull request; merging deploys ring by ring, and production waits for its required
   reviewers. Each environment is a GitHub environment with its own OIDC federated credential — no
   secrets. The same workflow runs on new offering releases (upgrades), nightly (drift) and by hand.
   _The demo engine simulates the GitHub calls and Azure deployments._
5. **Keep everyone up to date.** See every customer's version and health in one place. Roll out new
   versions in stages instead of all at once.

## Platform landing zones

Every customer install lands in a platform landing zone — one per Microsoft Entra tenant: your own hosting tenant,
customer tenants you build, and customer landing zones you plug into. The **Landing zones** area is built on
Microsoft's [Azure Landing Zones Library](https://github.com/Azure/Azure-Landing-Zones-Library) (snapshots of pinned
releases in `src/lib/alz/`):

- **A landing zone designer drawn like Microsoft's reference architecture** (Cloud Adoption Framework, hub and
  spoke / Virtual WAN): the management group tree with its subscriptions, then the Management, Security, Identity,
  Connectivity, landing zone (one subscription per customer install) and Sandbox subscriptions, each with the
  governance toolset Microsoft draws (Defender for Cloud, monitoring agent, Update Manager, backup, Service Health
  alerts, activity logs, policy). Everything in Microsoft's reference is always drawn; tick or untick any piece —
  firewall tier, Bastion, VPN and ExpressRoute gateways, DDoS, private DNS, a second hub region, Sentinel,
  Identity, landing zone groups, Defender, Update Manager, backup, alerts — and what's left out is shown dashed.
- **Your own hierarchy, not a fixed template.** Hover any management group to add a group or a subscription under
  it, or remove it (Identity, Security and Decommissioned can be left out — their subscription moves up to
  Platform); rename any group; left-out library groups stay dashed with "+ add back". New groups use a library policy
  set (Corp, Online, Sandbox, Local) or inherit only, and are emitted as archetype overrides in the custom library.
  Added subscriptions are vended with `avm-ptn-alz-sub-vending`. The group where new subscriptions land by default
  (`management_group_hierarchy_settings`) is selectable, with Sandbox recommended.
- **Environments the CAF way.** Dev, test, QA, UAT, prod are subscriptions in the same Corp or Online group — each
  customer install gets one subscription per environment — not separate management groups, following the Cloud
  Adoption Framework's guidance. Splitting by environment is still possible but flagged as not recommended.
- **Workload landing zones.** Attach Microsoft's active workload accelerators to a landing zone group — AKS, App
  Service, Container Apps, API Management, Azure Virtual Desktop, Azure Red Hat OpenShift, Azure VMware Solution, AI
  Landing Zone and SAP — each with its repo, Azure Verified Module and the platform pieces it needs (with a one-click
  fix when the design is missing one). Archived accelerators are not offered.
- **Traffic flows.** Paths that exist in the design (users → Online install, Corp egress through the firewall,
  office → Corp over VPN/ExpressRoute, spoke-to-spoke, private endpoint DNS, Bastion, logs to Sentinel) are
  highlighted hop by hop on the drawing, each step naming the ALZ policy that enforces it. Paths the design can't
  support say what's missing and offer the fix.
- **Policy per management group.** Click a group to see the chain it inherits from and every assignment that
  reaches it, with the real effect. Any assignment can be kept, set to audit only (`DoNotEnforce`) or removed.
- **Access.** Microsoft's recommended roles per team (CAF identity design area and the ALZ custom roles —
  Network-Management, Security-Operations, Application-Owners, Subscription-Owner) with where to assign each, shown
  with a recommendation bulb. Choices become `management_group_role_assignments`; the delivery pipeline's Owner
  assignment carries Microsoft's condition that blocks granting Owner, User Access Administrator or RBAC Administrator.
- **Extra policy.** Official built-ins (Allowed locations, Require a tag on resource groups) and regulatory
  initiatives (NIST SP 800-53 Rev. 5, ISO 27001:2013, CIS Azure Foundations v2.0.0, PCI DSS v4, FedRAMP High) at
  any management group, each with Microsoft's recommended scope.
- **Tenant assessment (brownfield).** Scans a real tenant with Azure Resource Graph — management groups,
  subscriptions, policy and role assignments, networks and platform resources — and maps it onto the standard:
  an alignment score per design area, prioritized gaps (with one-click "add to design"), what the traffic really does
  today, ALZ policy coverage per management group, where each subscription should move, and today's tenant drawn on
  the reference architecture. "Start the design from this tenant" turns the scan into a starting design. The app's
  managed identity needs Reader at the tenant root (`az role assignment create --role Reader --assignee
<webAppPrincipalId> --scope /providers/Microsoft.Management/managementGroups/<tenantId>`); customer tenants delegate
  Reader through Azure Lighthouse. Customer-owned landing zones without a scan use a demo snapshot.
- **Design advisor (Azure OpenAI).** A chat that reasons over the exact design — every management group and its
  assignments, resources, traffic paths, access, installs and the tenant assessment — answers questions, and proposes
  changes as structured patches you apply with one click. Keyless: the web app's identity has Cognitive Services
  OpenAI User on an Azure AI Services account (created by the Deploy to Azure template, `enableAdvisor`).
- Design choices become the customizations Microsoft documents: archetype overrides and a custom architecture
  definition in a small custom library, `policy_assignments_to_modify`, and policy default values wired to the
  outputs of the management and connectivity modules.
- Pinned ALZ Library version per tenant, with a real diff to the next release.
- Generated Terraform for the official Azure Verified Modules (`Azure/avm-ptn-alz` + `Azure/alz` provider,
  `avm-ptn-alz-management`, `avm-ptn-alz-connectivity-hub-and-spoke-vnet` or `avm-ptn-alz-connectivity-virtual-wan`,
  and subscription vending), with each platform module deployed into its own subscription.
- Each offering declares its landing zone (Corp / Online / Local / Sandbox), so every customer subscription is placed
  under the right management group.

`.github/workflows/validate-alz.yml` runs `terraform validate` on the generated configuration and composes it with
Microsoft's `alzlibtool`; the per-management-group assignment counts must match what the app shows.

## What's in this repo

| Folder                   | What it is                                                                   |
| ------------------------ | ---------------------------------------------------------------------------- |
| `src/`                   | The Cloud Delivery app (TanStack Start + React)                              |
| `db/`                    | Database schema and demo data (PostgreSQL)                                   |
| `deploy/azure/`          | One-click deployment of the console (Bicep, ARM template, portal wizard)     |
| `site/`                  | Separate marketing page for prospects — see [site/README.md](site/README.md) |
| `docs/original-brief.md` | The original product brief this was built from                               |

The demo data uses a made-up software company (GridWorks) and made-up utility customers.
Deployments run in **demo mode**: plans and pipeline runs are simulated and no Azure resources are created.

## Development

The control plane runs on **Azure Database for PostgreSQL Flexible Server**. Locally, any PostgreSQL 14+ works.

```sh
cp .env.example .env          # DATABASE_URL, PGSSLMODE=disable for local
docker compose up -d          # local PostgreSQL 16 (optional if you already have one)
npm install
npm run db:seed               # applies db/migrations, then loads the GridWorks demo data into an empty database
npm run dev
```

- `db/migrations/*.sql` — schema, applied once each and in order by `npm run db:migrate` (tracked in `schema_migrations`).
- `db/seed/*.sql` — demo dataset, only applied when the database is empty.
- All reads and writes run server-side through `src/lib/db.server.ts`; the browser never connects to the database.

### Azure Database for PostgreSQL

Use Microsoft Entra authentication (managed identity on Azure Container Apps / App Service, or `az login` locally):

```sh
DATABASE_URL=postgres://<entra-principal>@<server>.postgres.database.azure.com:5432/cloud_delivery
AZURE_POSTGRES_ENTRA_AUTH=true
```

Tokens come from `DefaultAzureCredential` and TLS is enforced for `*.postgres.database.azure.com`. Password authentication also works
by putting the password in `DATABASE_URL` and leaving `AZURE_POSTGRES_ENTRA_AUTH` unset.

### Marketing site

`site/` is a separate static page for prospects (not part of the console). See [site/README.md](site/README.md).

### Build and run

```sh
npm run build                 # Node server output in .output/ (set NITRO_PRESET to target another platform)
npm start
```

Optional AI architecture drafting uses any OpenAI-compatible endpoint, e.g. Azure OpenAI:
`AI_CHAT_COMPLETIONS_URL`, `AI_API_KEY`, `AI_MODEL`.
