# Cloud Delivery

**Give every customer their own environment on Azure — in your Azure or theirs, without a new cloud project each time.**

Cloud Delivery is for software companies that deliver their product on Azure. Today every new customer
usually means weeks of custom cloud work: network design, security reviews, new infrastructure scripts
and pipelines. Cloud Delivery lets you do that work once.

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

## What's in this repo

| Folder                   | What it is                                                                   |
| ------------------------ | ---------------------------------------------------------------------------- |
| `src/`                   | The Cloud Delivery app (TanStack Start + React)                              |
| `db/`                    | Database schema and demo data (PostgreSQL)                                   |
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
