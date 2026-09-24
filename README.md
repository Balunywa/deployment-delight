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

1. **Set up your product once.** Pick the Azure services your product needs on a visual canvas and
   choose where it runs. Cloud Delivery creates the infrastructure code (Bicep), the deployment pipeline
   (GitHub Actions or Azure DevOps) and the short list of details you'll need from each customer.
2. **Bring on a customer.** Hosted by you: enter their name and sign-in domain. In their Azure: send
   their admin a link to approve access — their settings are found automatically.
3. **Check, approve, deploy.** Cloud Delivery checks everything first, shows what it will create and
   what it will cost, waits for approval, then deploys.
4. **Keep everyone up to date.** See every customer's version and health in one place. Roll out new
   versions in stages instead of all at once.

## Platform landing zones

Every customer install lands in a platform landing zone — one per Microsoft Entra tenant: your own hosting tenant,
customer tenants you build, and customer landing zones you plug into. The **Landing zones** area is built on
Microsoft's [Azure Landing Zones Library](https://github.com/Azure/Azure-Landing-Zones-Library) (snapshots of pinned
releases in `src/lib/alz/`):

- **A landing zone designer.** An interactive 3D (isometric) view of the tenant: management groups as nested
  plates, subscriptions as slabs, platform resources as blocks and every customer install as its own spoke
  subscription. Switch things on and off — hub-and-spoke or Virtual WAN, Azure Firewall tier, Bastion, VPN and
  ExpressRoute gateways, DDoS protection, private DNS, monitoring, Sentinel, which landing zone groups exist — and
  the picture, the policy set and the Terraform all change with it.
- **Traffic flows.** Hop-by-hop animated paths that exist in the design (users → Online install, Corp egress through
  the firewall, office → Corp over VPN/ExpressRoute, spoke-to-spoke, private endpoint DNS, Bastion, logs to Sentinel),
  each step naming the ALZ policy that enforces it. Paths the design can't support say what's missing and offer the fix.
- **Policy flow.** Pick any management group to see the chain it inherits from and every assignment that reaches it,
  with the real effect. Any assignment can be kept, set to audit only (`DoNotEnforce`) or removed.
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
