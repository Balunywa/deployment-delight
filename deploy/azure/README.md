# Deploy the Cloud Delivery console to Azure

[![Deploy to Azure](https://aka.ms/deploytoazurebutton)](https://portal.azure.com/#create/Microsoft.Template/uri/https%3A%2F%2Fraw.githubusercontent.com%2FBalunywa%2Fdeployment-delight%2Fmain%2Fdeploy%2Fazure%2Fazuredeploy.json/createUIDefinitionUri/https%3A%2F%2Fraw.githubusercontent.com%2FBalunywa%2Fdeployment-delight%2Fmain%2Fdeploy%2Fazure%2FcreateUiDefinition.json)

If the wizard doesn't load subscriptions or regions, use the [plain template form](https://portal.azure.com/#create/Microsoft.Template/uri/https%3A%2F%2Fraw.githubusercontent.com%2FBalunywa%2Fdeployment-delight%2Fmain%2Fdeploy%2Fazure%2Fazuredeploy.json) instead.

One click stands up the Cloud Delivery console in **any Azure tenant** — your own, or anyone's.
This deploys the console itself, not the Azure services it later provisions for your customers.

## What gets deployed

| Resource                                         | Purpose                                                           |
| ------------------------------------------------ | ----------------------------------------------------------------- |
| App Service (Linux, Node 22)                     | Runs the console from a prebuilt package — no build on the server |
| Azure Database for PostgreSQL Flexible Server 16 | The console's data                                                |
| Application Insights + Log Analytics             | Monitoring                                                        |
| Key Vault (password mode only)                   | Holds the database connection string                              |

A typical deployment takes about 10 minutes. Open the `webAppUrl` output when it finishes; the first
request creates the database and its tables (and loads the demo data, if selected).

## How the app code gets there

1. `.github/workflows/release-app.yml` builds the app on every push to `main` and publishes a
   self-contained `cloud-delivery-app.zip` as the `app-latest` GitHub release.
2. The template sets `WEBSITE_RUN_FROM_PACKAGE` to that release URL, so App Service mounts the zip
   read-only and starts it with `node .output/server/index.mjs`.
3. On first use the app creates its database, applies `db/migrations` and, if selected, `db/seed`
   (`AUTO_MIGRATE=true`, `SEED_DEMO_DATA`). The app's own identity owns the database it creates.

To pick up a new release on a running console, restart the web app.

## Settings and identities

Every setting is known at deployment time, so the template writes them straight into the web app —
no post-deployment script is needed.

| App setting                             | Value                                                                                                                 |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `WEBSITE_RUN_FROM_PACKAGE`              | Release URL of the app package                                                                                        |
| `DATABASE_URL`                          | Managed identity mode: `postgres://<web-app-name>@<server>:5432/cloud_delivery`. Password mode: a Key Vault reference |
| `AZURE_POSTGRES_ENTRA_AUTH`             | `true` in managed identity mode                                                                                       |
| `AUTO_MIGRATE` / `SEED_DEMO_DATA`       | Create the database and tables on first start / load demo data                                                        |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | Monitoring                                                                                                            |

**Managed identity (default, recommended).** The web app gets a system-assigned managed identity, which
is made the PostgreSQL server's Microsoft Entra administrator. The app signs in with short-lived Entra
tokens and password sign-in is turned off, so there is no database password anywhere. No role
assignments are created, so **Contributor** on the resource group is enough to deploy.

**Password (fallback).** The connection string is stored in Key Vault and read through a Key Vault
reference; the web app identity is granted _Key Vault Secrets User_. This needs **Owner** or **User
Access Administrator** on the resource group.

The database only accepts connections from Azure services, over TLS.

## Command line

```sh
az group create -n cloud-delivery-rg -l westus2
az deployment group create -g cloud-delivery-rg -f deploy/azure/main.bicep
```

After editing `main.bicep`, regenerate the template behind the button:

```sh
az bicep build -f deploy/azure/main.bicep --outfile deploy/azure/azuredeploy.json
```

## Requirements

- The template and the app package must be publicly readable. The Azure portal downloads
  `azuredeploy.json`, and App Service downloads the package, without credentials.
- App Service quota for the chosen plan in the chosen region.
