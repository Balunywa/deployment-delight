# Deployment Delight

Build an End-to-End Azure ISV Deployment Factory

You are a principal product engineer, Azure platform engineer, security architect, and UX designer working as one team.

Build a production-oriented SaaS product called Azure ISV Deployment Factory.

The product solves this problem:

ISVs frequently have a repeatable Azure-based product, but every downstream customer deployment becomes a separate cloud engineering project. Customer environments end up with different Terraform/Bicep, CI/CD pipelines, network assumptions, security settings, policies, monitoring, resource configurations, and versions. Customer onboarding therefore takes weeks or months, and upgrading 20–100 customer environments becomes difficult.

The product should turn the ISV’s Azure architecture into a versioned product catalog that can be deployed repeatedly into customer Azure environments through a simple branded onboarding experience.

The goal is:

Productize the ISV’s Azure deployment the same way the ISV productized its software.

A customer deployment should feel like ordering a product, not starting an infrastructure project.

⸻

1. CORE PRODUCT CONCEPT

An ISV defines its Azure application architecture once.

Example:

ISV: GridWorks
Product: Grid Analytics Platform
Uses:
- AKS
- Azure Database for PostgreSQL
- Event Hubs
- Storage
- Key Vault
- API Management
- Azure Monitor
- Defender for Cloud
- Private Endpoints

The ISV then turns that architecture into several offerings.

Example:

Grid Analytics - SaaS Connected
Grid Analytics - Customer Hosted
Grid Analytics - Enterprise Private
Grid Analytics - Regulated

Each offering defines:

Azure services
SKUs
network model
security controls
Azure Policy
identity model
observability
backup requirements
DR requirements
deployment topology
CI/CD behavior
supported regions
environment strategy
cost assumptions

When Customer #25 arrives, the ISV should not create another custom architecture.

The onboarding engineer opens the portal, chooses the customer, chooses the offering, supplies customer-specific information, reviews an infrastructure plan, gets approval, and deploys.

The system produces the same governed architecture every time.

⸻

2. IMPORTANT ARCHITECTURAL PRINCIPLE

Do NOT interpret this product as “a UI that creates Azure resources.”

It is a multi-tenant platform engineering control plane.

The hierarchy is:

ISV
 |
 +-- Products
      |
      +-- Offerings
            |
            +-- Offering Versions
                    |
                    +-- Blueprint
                    +-- Azure Modules
                    +-- Policy Pack
                    +-- Pipeline Template
                    +-- Validation Rules
ISV
 |
 +-- Customers
      |
      +-- Environments
            |
            +-- Desired Offering Version
            +-- Actual Offering Version
            +-- Azure Connection
            +-- Deployment History
            +-- Compliance State
            +-- Drift State

The dashboard is merely the user experience over this control plane.

⸻

3. DO NOT FORCE EVERY CUSTOMER INTO A NEW AZURE LANDING ZONE

Support two fundamentally different deployment models.

Mode A — Existing Enterprise Azure

This should be the DEFAULT for large enterprises.

The customer already has:

Management groups
Azure Landing Zones
Hub networking
DNS
Firewall
ExpressRoute
Azure Policy
Security tooling
Logging
Identity
SOC integration

Do NOT attempt to replace any of these.

Instead deploy an ISV application landing zone into an approved subscription or resource group.

The onboarding process should discover and consume customer-provided platform services.

Examples:

Existing subscription
Existing VNet/hub
Existing Log Analytics workspace
Existing private DNS
Existing firewall
Existing Key Vault policy
Existing security requirements

Treat the customer’s platform as authoritative.

⸻

Mode B — Greenfield Azure

For customers without a mature Azure platform, optionally deploy a fuller Azure baseline.

This can include:

Management group placement
Subscription vending
Resource organization
Policy assignments
RBAC
Networking
Private DNS
Logging
Budgets
Defender
Application landing zone

Only perform tenant-level operations when the customer has explicitly authorized them and the connected Azure identity has sufficient permissions.

Never assume tenant-level control.

⸻

4. MICROSOFT ARCHITECTURE PRINCIPLES TO FOLLOW

Use current Microsoft guidance as authoritative architecture input.

Base the platform on these concepts:

* Azure Landing Zones
* Azure application landing zones
* Azure subscription vending
* Azure subscription vending product lines
* Azure Verified Modules
* Bicep and/or Terraform
* Azure Policy
* Microsoft Entra ID
* Managed identities
* Azure Lighthouse
* Azure Managed Applications
* Azure Cost Management
* Azure Monitor
* Defender for Cloud
* GitHub Actions reusable workflows
* Azure DevOps reusable YAML templates

Subscription vending should be treated as a product catalog.

Support concepts equivalent to:

Online
Corp-connected
Tech Platform
Shared Application Portfolio
Sandbox

Do not build the foundation around Azure Deployment Environments. It can be understood as a historical/reference pattern, but the service is in maintenance mode.

Build this platform using durable Azure primitives.

⸻

5. TECHNICAL ARCHITECTURE

Use this logical architecture:

                     USERS
       ISV Admin / Platform Engineer
       Customer Onboarding Engineer
       Security / Network Approver
       Operations Engineer
       Customer Viewer
                       |
                       v
              React Web Application
                       |
                       v
                 Backend API
                       |
       +---------------+---------------+
       |               |               |
       v               v               v
 PostgreSQL      Deployment       Integration
 Control Plane    Orchestrator       Layer
                       |
                       v
                 Job / Queue
                       |
                       v
                IaC Execution
                       |
          +------------+------------+
          |                         |
          v                         v
       GitHub                  Azure DevOps
          |                         |
          +------------+------------+
                       |
                       v
                 Azure ARM APIs
                       |
                       v
               Customer Azure

Recommended Azure runtime architecture:

Frontend:
Azure Static Web Apps
or Azure Container Apps
API:
Azure Container Apps
Deployment Worker:
Azure Container Apps Jobs
or equivalent isolated worker model
Database:
Azure Database for PostgreSQL Flexible Server
Queue:
Azure Service Bus
Secrets:
Azure Key Vault
Identity:
Microsoft Entra ID
Managed Identity
OIDC/workload identity federation
Observability:
Application Insights
Log Analytics
Azure Monitor
Artifacts:
Azure Storage
Optional AI:
Microsoft Foundry

Do not tightly couple core orchestration logic to a particular UI framework.

⸻

6. DATABASE DECISION

Use PostgreSQL, not Cosmos DB, as the primary control-plane database.

The domain is relational:

organization
ISV
product
offering
offering version
customer
environment
Azure connection
deployment
deployment step
approval
policy pack
module
version
drift finding
audit event

However, use PostgreSQL JSONB extensively for flexible architecture manifests.

Production target:

Azure Database for PostgreSQL Flexible Server

Use Microsoft Entra authentication and managed identities wherever practical.

Never store Azure secrets directly in PostgreSQL.

Store only references such as:

key_vault_uri
secret_name
credential_reference
federated_identity_reference

⸻

7. MULTI-TENANCY MODEL

The SaaS must be multi-tenant.

Every relevant object must belong to an organization/ISV boundary.

Example:

organizations
users
organization_memberships
products
offerings
offering_versions
customers
customer_connections
environments
deployments
deployment_steps
approvals
audit_events

Every query must enforce tenant isolation.

Use PostgreSQL row-level security where appropriate in addition to application authorization.

Roles:

Platform Super Admin
ISV Administrator
ISV Platform Engineer
Onboarding Engineer
Security Approver
Network Approver
Customer Administrator
Read Only Auditor

⸻

8. CORE DATABASE MODEL

Implement migrations for at least these entities.

organizations

id
name
slug
logo_url
primary_color
secondary_color
created_at
updated_at

organization_memberships

organization_id
user_id
role
status

products

id
organization_id
name
description
category
status

offerings

id
product_id
name
description
offering_type
deployment_boundary
network_profile
security_profile
status

Example offering types:

saas_connected
customer_hosted
enterprise_private
regulated
edge
sandbox

offering_versions

id
offering_id
version
status
manifest_json
release_notes
created_by
created_at
published_at

Statuses:

draft
testing
published
deprecated
retired

infrastructure_modules

id
organization_id
name
module_type
provider
source
version
input_schema_json
output_schema_json

Module types may include:

subscription
resource_group
network
policy
rbac
monitoring
key_vault
postgres
aks
storage
event_hubs
api_management
container_apps
app_service
private_endpoint
dns
defender
budget

customers

id
organization_id
name
customer_code
tenant_id
industry
status
created_at

customer_connections

id
customer_id
connection_type
tenant_id
subscription_id
management_group_id
resource_group_id
lighthouse_delegation_id
credential_reference
status
last_validated_at
metadata_json

environments

id
customer_id
offering_id
desired_offering_version_id
actual_offering_version_id
name
environment_type
region
secondary_region
deployment_boundary
status
configuration_json
created_at

Environment types:

development
test
qa
staging
production
disaster_recovery

deployments

id
environment_id
deployment_type
desired_version
previous_version
status
requested_by
requested_at
started_at
completed_at
correlation_id
plan_json
result_json

Deployment types:

initial
upgrade
configuration_change
repair
drift_remediation
decommission

deployment_steps

id
deployment_id
sequence
name
module_name
status
started_at
completed_at
log_uri
error_json

approvals

id
deployment_id
approval_type
requested_from
status
comments
requested_at
decided_at

policy_packs

id
organization_id
name
version
description
policy_manifest_json

drift_findings

id
environment_id
resource_id
category
expected_json
actual_json
severity
status
detected_at
resolved_at

audit_events

id
organization_id
customer_id
environment_id
actor_id
event_type
resource_type
resource_id
metadata_json
timestamp

Audit history must be immutable from the UI.

⸻

9. CUSTOMER MANIFEST

Every customer environment should ultimately be representable as a declarative manifest.

Example:

customer:
  name: Metro Energy
  code: metro-energy
  tenantId: customer-tenant-id
product:
  name: Grid Analytics Platform
  offering: enterprise-private
  version: 4.2.0
deployment:
  boundary: subscription
  subscriptionId: subscription-id
  region: eastus2
  environment: production
network:
  mode: existing-customer-hub
  vnetId: existing-vnet-resource-id
  privateEndpoints: true
  publicAccess: false
security:
  profile: utility-critical
  defender: true
  customerManagedKeys: true
observability:
  useCustomerWorkspace: true
  logAnalyticsWorkspaceId: resource-id
services:
  aks:
    enabled: true
    tier: standard
  postgres:
    enabled: true
    highAvailability: zone-redundant
    privateAccess: true
  eventHubs:
    enabled: true
    tier: premium
  storage:
    enabled: true
    replication: ZRS
environments:
  - production

This manifest is the source of desired state.

DO NOT let customer deployments become separate hand-written infrastructure repositories.

⸻

10. VERSIONED BLUEPRINT MODEL

The most important intellectual property in this product is the Blueprint.

A blueprint defines what an ISV customer deployment should look like.

Conceptually:

Blueprint
+ Azure topology
+ infrastructure modules
+ supported options
+ required controls
+ policy pack
+ pipeline
+ validation rules
+ upgrade rules
+ supported regions
+ cost model

An offering references a blueprint version.

Example:

Grid Analytics Enterprise Private
Blueprint version:
4.2
Modules:
network-spoke@3.1
aks-platform@5.2
postgres@4.0
event-hubs@2.4
key-vault@3.0
monitoring@4.2
private-endpoints@3.5
security-baseline@6.0

Customer environments inherit the offering version.

This enables centralized lifecycle management.

⸻

11. BUILD AN “ARCHITECTURE TO PRODUCT” WIZARD

This is an important differentiator.

Allow an ISV architect to create an offering in TWO ways.

Structured mode

They select Azure components manually.

Example:

AKS
PostgreSQL
Storage
Event Hubs
APIM
Key Vault

Then configure:

public/private
HA
DR
network model
backup
logging
security
environment topology

Natural-language mode

Create an AI-assisted textbox:

“Describe your Azure architecture.”

Example input:

Our application runs on AKS and PostgreSQL.
Customers need dedicated subscriptions.
All services must be private.
AKS connects to PostgreSQL using managed identity.
We need Event Hubs Premium for telemetry.
Logs should go to the customer's existing Log Analytics workspace.
We support East US 2 and Central US.
Production needs zone redundancy.
Customers should be able to use their existing hub network.

The AI should convert that into a DRAFT architecture manifest.

Important:

AI NEVER directly provisions Azure resources.

Workflow:

Natural language
       |
       v
AI generated draft blueprint
       |
       v
Deterministic schema validation
       |
       v
Architecture policy validation
       |
       v
Human review
       |
       v
Published offering

The UI must clearly label AI-generated configuration as a draft requiring validation.

⸻

12. AZURE CONNECTION MODES

Support these connection patterns.

Existing subscription

Customer supplies:

tenant
subscription
resource group if relevant

Validate access and perform deployment.

Azure Lighthouse

Allow customers to delegate authorized subscription or resource-group scopes.

Store Lighthouse metadata but never customer credentials.

Azure Managed Application

Support an offering mode where an ISV application is deployed into the customer’s subscription as a Managed Application.

Customer-authorized automation identity

Support cross-tenant application consent/federated identity patterns.

Prefer:

Managed Identity
OIDC federation
short-lived tokens
delegated Azure access

Avoid long-lived client secrets.

New subscription vending

Only expose subscription creation when:

customer selected the option
billing scope is supplied
permissions are verified
management group destination is known

Never assume the platform can create subscriptions.

⸻

13. PREFLIGHT VALIDATION

Before deployment, run a comprehensive preflight.

Check:

Azure authentication
required RBAC
subscription status
management group access
region availability
resource provider registration
Azure Policy conflicts
resource quotas
network CIDR conflicts
DNS requirements
private endpoint requirements
customer hub connectivity
naming constraints
required existing resources
budget configuration
supported SKUs
offering compatibility

Represent validation results as:

PASS
WARNING
BLOCKING

Do not allow deployment if blocking validations exist.

⸻

14. INFRASTRUCTURE-AS-CODE ENGINE

Use IaC rather than generating Azure resources manually from frontend code.

Preferred module strategy:

Azure Verified Modules wherever appropriate.

Support:

Bicep
Terraform

Design a provider abstraction so both can eventually work.

For the MVP, one can be the primary provider, but the domain model must not hard-code itself to one language.

Recommended interface:

InfrastructureProvider
validate()
plan()
apply()
getOutputs()
detectDrift()
destroy()

Every module must expose a versioned input/output contract.

Never permit arbitrary shell commands submitted from the UI.

⸻

15. CENTRALIZED CI/CD

The platform exists partly because customer CI/CD is fragmented.

DO NOT generate a completely bespoke pipeline for every customer.

Create reusable centralized workflows.

Support:

GitHub Actions
Azure DevOps

Use a provider abstraction.

For GitHub, prefer:

Reusable workflows
OIDC to Azure
Environment protections
Approval gates
Artifact retention

Suggested repository structure:

/platform
    /modules
    /policies
    /workflows
/products
    /grid-analytics
       /offerings
       /versions
/customers
    /metro-energy
        /production.yaml
    /north-grid
        /production.yaml

The customer manifest varies.

The pipeline implementation does not.

⸻

16. DEPLOYMENT STATE MACHINE

Implement a real deployment state machine.

Example:

DRAFT
VALIDATING
VALIDATION_FAILED
READY
AWAITING_APPROVAL
PLANNING
PLAN_FAILED
AWAITING_PLAN_APPROVAL
QUEUED
DEPLOYING
SUCCEEDED
FAILED
REQUIRES_REMEDIATION
CANCELLED

Do not pretend infrastructure deployment can always be “rolled back.”

If Azure deployment partially succeeds, record actual state and show remediation options.

Every deployment gets a correlation ID.

Every step is logged.

⸻

17. PLAN BEFORE APPLY

Never go directly from form submission to Azure deployment.

Workflow:

Configure
   |
Validate
   |
Generate Plan
   |
Show Changes
   |
Approval
   |
Deploy

The Plan page should show something similar to:

Customer: Metro Energy
Environment: Production
Offering: Enterprise Private 4.2
CREATE
+ PostgreSQL Flexible Server
+ Private Endpoint
+ Event Hub Namespace
USE EXISTING
= Virtual Network
= Log Analytics Workspace
= Private DNS Resolver
POLICY
+ 12 required policy assignments
RBAC
+ 4 role assignments
ESTIMATED MONTHLY AZURE COST
$14,200 - $17,900
WARNINGS
2
BLOCKERS
0

Require explicit approval for production.

⸻

18. CORE UI

Build a polished enterprise application.

Avoid a generic AI-chat interface.

Primary navigation:

Overview
Products
Offerings
Customers
Deployments
Estate
Compliance
Upgrades
Costs
Audit
Settings

⸻

19. OVERVIEW DASHBOARD

Show:

Customers
Environments
Successful deployments
Failed deployments
Deployments in progress
Outdated environments
Drift detected
Compliance issues
Projected Azure spend
Actual Azure spend where available

Add panels:

Customer Estate

24 Customers
18 current
4 upgrade available
2 attention required

Platform Versions

v4.2   18 customers
v4.1    4 customers
v3.9    2 customers

Deployment Health

Show success rate and recent failures.

Estimated Azure Consumption

Estimate monthly and annual Azure consumption across the deployed estate.

Clearly label estimates as estimates.

⸻

20. PRODUCTS SCREEN

Allow the ISV to manage software products.

Example:

Grid Analytics
Meter Data Platform
Grid Edge Services

Opening a product shows its offerings.

⸻

21. OFFERINGS CATALOG

Cards should resemble a real cloud service catalog.

Example:

SaaS Connected

Best for customers consuming an ISV-hosted SaaS service.

Customer Hosted

Deploy the application into a customer-owned Azure subscription.

Enterprise Private

Private networking, customer enterprise connectivity, private endpoints, centralized identity and logging.

Regulated

Enterprise Private plus stricter security, diagnostics, Defender, encryption, retention and policy controls.

Sandbox

Lower-cost non-production deployment.

Each offering should show:

Current version
Azure components
network pattern
security level
supported regions
estimated monthly cost
number of customer environments

⸻

22. CUSTOMER PAGE

Customer detail page:

Metro Energy
Azure Tenant
xxxxx
Deployment Model
Existing Enterprise ALZ
Environments
DEV
TEST
PROD
Current Platform Version
4.1
Available Version
4.2
Compliance
98%
Drift
2 Findings
Last Deployment
3 days ago
Monthly Azure Cost
$14,380

Tabs:

Overview
Environments
Architecture
Deployments
Compliance
Costs
Audit
Connection

⸻

23. ONBOARD CUSTOMER WIZARD

Create a first-class onboarding experience.

Step 1 — Customer

Customer name
customer code
tenant ID
industry
contact metadata

Step 2 — Azure Model

Ask:

Does this customer already have an enterprise Azure landing zone?

Options:

Yes — deploy into their existing Azure platform
No — create the required Azure baseline

Do not ask nontechnical users questions about management-group architecture unless necessary.

Step 3 — Deployment Boundary

Options:

Existing subscription
New subscription
Existing resource group
Azure Managed Application

Step 4 — Offering

Select:

SaaS Connected
Customer Hosted
Enterprise Private
Regulated
Sandbox

Step 5 — Azure Connection

Validate Azure connectivity.

Step 6 — Networking

For existing enterprise customers allow:

existing VNet
existing hub
subnet
DNS
firewall
private connectivity

Step 7 — Environments

Example:

DEV
TEST
PROD

Step 8 — Cost Preview

Show estimated infrastructure cost.

Step 9 — Preflight

Run all validation.

Step 10 — Plan

Generate deployment plan.

Step 11 — Approval

Step 12 — Deploy

⸻

24. ESTATE MANAGEMENT

This is one of the most important screens.

Create an estate table like:

Customer          Offering             Current   Target   Compliance   Drift
Metro Energy      Enterprise Private    4.2       4.2      100%         None
NorthGrid         Enterprise Private    4.1       4.2       98%         Low
Coastal Power     Regulated             3.9       4.2       91%         High

Filters:

version
offering
region
status
compliance
drift
customer

Allow users to select environments and create a batch upgrade plan.

Do not immediately upgrade them.

Generate upgrade plans first.

⸻

25. PLATFORM UPGRADES

An ISV should be able to publish:

Offering 4.2

with release notes:

PostgreSQL module updated
AKS baseline updated
new security policy pack
TLS requirements changed
monitoring agent updated

Then the system determines:

18 environments already current
4 environments upgrade compatible
2 environments require manual review

The ISV can create a rollout wave:

Wave 1
Internal test customer
Wave 2
3 pilot customers
Wave 3
10 customers
Wave 4
remaining estate

Track rollout status.

⸻

26. DRIFT DETECTION

The platform must compare:

DESIRED STATE
vs
ACTUAL AZURE STATE

Examples:

Public access enabled manually
Required diagnostic settings removed
PostgreSQL SKU changed
Private endpoint deleted
Policy assignment changed
Tag removed

Show:

Expected
Actual
Severity
Detected
Recommended remediation

Allow:

Accept change into desired state
Remediate back to blueprint
Ignore temporarily
Escalate

Every action must create an audit record.

⸻

27. POLICY AND COMPLIANCE

Blueprints should reference versioned policy packs.

Examples:

Microsoft recommended baseline
ISV security baseline
Enterprise private baseline
Utility critical infrastructure baseline
Customer overlay

Do not hard-code industry compliance claims that cannot be validated.

Show individual controls and actual deployment evidence.

Example:

Private PostgreSQL access      PASS
Storage public access          PASS
Required diagnostics           PASS
Defender enabled               PASS
Approved region                PASS
Required tags                  FAIL

Compliance must be evidence driven.

⸻

28. COST / ACR VIEW

Build a FinOps view useful to the ISV and Microsoft account team.

For each offering calculate:

estimated monthly Azure consumption
estimated annual Azure consumption

Across customers calculate:

24 customers
Current estimated monthly Azure consumption:
$312,000
Annualized:
$3.74M

Break down by:

Compute
Database
Networking
Storage
Messaging
Security
Monitoring
AI
Other

Support optional ingestion of actual Azure Cost Management data.

Always distinguish:

ESTIMATED
ACTUAL
FORECAST

Never present an estimate as actual consumption.

⸻

29. AI SHOULD HELP BUILD BLUEPRINTS — NOT CONTROL AZURE

Optional Microsoft Foundry functionality should include:

Architecture Intake

User:

We need AKS, PostgreSQL, Event Hubs and Storage. Everything should be private. Production requires HA. Customers may provide their own hub.

AI generates a draft blueprint.

Explain Deployment

User:

Why is private DNS required here?

AI explains using configuration context.

Deployment Failure Explanation

User:

Why did NorthGrid fail?

AI summarizes logs and points to the failing deployment step.

Estate Questions

User:

Which customers are more than two platform versions behind?

AI translates to a query against the control-plane database.

Never give AI unrestricted Azure deployment authority.

AI suggests.

Deterministic orchestration executes.

⸻

30. SECURITY REQUIREMENTS

Treat this as a control-plane application.

Security requirements are mandatory.

Implement:

Microsoft Entra authentication
role-based authorization
multi-tenant isolation
managed identity
OIDC federation
Key Vault
no stored Azure passwords
no credentials written to logs
immutable audit events
production approval gates
least-privilege Azure access
short-lived authentication where possible
resource-level access enforcement

Sensitive operations must require explicit authorization.

Examples:

Publish blueprint
Deploy production
Delete environment
Change Azure connection
Change policy pack
Approve production plan

⸻

31. AUDITABILITY

Record:

Who
Did what
To which customer
To which environment
When
Previous value
New value
Deployment correlation ID
Result

Example:

09:41
Sarah published Enterprise Private v4.2
10:12
Mike generated Metro Energy PROD upgrade plan
10:21
Jennifer approved deployment
10:22
Deployment started
10:38
Deployment completed

⸻

32. BRANDING

The platform must support white labeling.

Each ISV can configure:

Company name
Logo
Primary accent
Portal title
Support link
Offering names
Terminology

Example customer-facing title:

GridWorks Cloud Deployment Portal

Do not expose implementation terms such as “Terraform module” unnecessarily to customer business users.

Technical users can access advanced details.

⸻

33. UX PHILOSOPHY

The product should feel like:

Azure Portal
+
Stripe onboarding
+
modern SaaS admin console
+
platform engineering portal

But do not copy any proprietary UI directly.

Prioritize:

clear hierarchy
simple forms
progress indicators
deployment timelines
visible validation
safe defaults
architecture summaries
explainable errors

Avoid excessive gradients, floating AI bubbles, marketing cards, or decorative dashboards.

This is an enterprise infrastructure control plane.

⸻

34. DEMO DATA

Seed the application with a fictitious ISV called:

GridWorks

Product:

Grid Analytics Platform

Create four offerings:

SaaS Connected
Customer Hosted
Enterprise Private
Regulated

Create 24 fictitious utility customers.

Distribute platform versions:

18 customers → v4.2
4 customers → v4.1
2 customers → v3.9

Create realistic deployment history.

Include:

successful deployments
one failed deployment
two drift findings
one compliance issue
one pending production approval
four customers with upgrade availability

The resulting dashboard should immediately communicate why the platform is useful.

⸻

35. SAMPLE BLUEPRINT

Create an initial Enterprise Private blueprint:

name: grid-analytics-enterprise-private
version: 4.2.0
boundary:
  allowed:
    - subscription
    - resource-group
network:
  publicAccess: false
  privateEndpoints: true
  modes:
    - customer-hub
    - dedicated-spoke
identity:
  managedIdentity: true
observability:
  diagnosticsRequired: true
  customerWorkspaceSupported: true
modules:
  - name: resource-group
    version: 2.0
  - name: network-spoke
    version: 3.1
  - name: key-vault
    version: 3.0
  - name: aks
    version: 5.2
  - name: postgres
    version: 4.0
    settings:
      highAvailability: zone-redundant
      publicAccess: false
  - name: event-hubs
    version: 2.4
  - name: storage
    version: 3.5
  - name: monitoring
    version: 4.2
  - name: security-baseline
    version: 6.0

⸻

36. API DESIGN

Implement real backend APIs.

Examples:

POST /api/products
POST /api/offerings
POST /api/offerings/{id}/versions
POST /api/blueprints/from-description
POST /api/blueprints/{id}/validate
POST /api/customers
POST /api/customers/{id}/connections
POST /api/environments
POST /api/environments/{id}/preflight
POST /api/environments/{id}/plan
POST /api/deployments
POST /api/deployments/{id}/approve
GET /api/deployments/{id}
GET /api/deployments/{id}/logs
GET /api/estate
GET /api/environments/{id}/drift
POST /api/environments/{id}/drift/remediate
POST /api/upgrades/plan
POST /api/upgrades/rollout
GET /api/costs
GET /api/audit

Use OpenAPI.

Validate every request.

⸻

37. REAL AZURE VS DEMO MODE

The application must support:

DEMO MODE
REAL AZURE MODE

Demo mode must provide realistic state transitions and deployment logs without making Azure calls.

Real Azure mode must use actual Azure APIs/IaC execution.

Make the active mode extremely obvious.

Never display simulated deployments as real Azure deployments.

⸻

38. IMPLEMENTATION STRATEGY

Do not stop after producing frontend screens.

Build the application vertically.

Start with:

Authentication
PostgreSQL schema
Organizations
Products
Offerings
Customers
Environment manifests
Demo deployment engine
Estate dashboard

Then implement:

Azure connection validation
Preflight
IaC planning
Approval workflow
Real deployment worker
Deployment logs
Drift detection
Version upgrades
Cost integration

Then add AI-assisted architecture intake.

The application architecture must support the complete product from day one even if individual Azure adapters are progressively implemented.

⸻

39. IMPORTANT ENGINEERING RULES

Do not:

hard-code demo data into UI components
store secrets in the database
let AI directly execute Azure actions
create unique pipeline logic for every customer
assume every customer permits tenant-level access
assume every customer wants a new landing zone
hide deployment failures
claim automatic rollback when none exists
mix desired and actual state
overwrite published offering versions
silently upgrade customers

Published offering versions are immutable.

Create a new version for changes.

⸻

40. ACCEPTANCE TEST

The completed product should be able to demonstrate this exact scenario.

An ISV has 24 customers.

A platform engineer creates:

Grid Analytics Enterprise Private 4.2

They describe their architecture in natural language.

The platform generates a draft blueprint.

The engineer validates and publishes it.

A new customer called:

Metro Energy

needs deployment.

Metro already has an enterprise Azure landing zone.

The onboarding engineer selects:

Existing Azure Platform
Enterprise Private
Production
East US 2
Existing VNet
Existing Log Analytics Workspace

The system validates Azure access.

Preflight reports:

17 PASS
2 WARNING
0 BLOCKING

The system generates an infrastructure plan.

A security approver approves it.

The deployment is queued.

The central pipeline deploys the platform.

Progress appears live:

Resource Group             complete
Network integration        complete
Key Vault                  complete
PostgreSQL                 complete
AKS                        complete
Event Hubs                 complete
Monitoring                 complete
Policy validation          complete

Metro becomes:

Platform version: 4.2
Status: Healthy
Compliance: 100%
Drift: None

Six weeks later the ISV publishes version 4.3.

The Estate screen identifies which customers can upgrade.

The engineer creates a rollout wave.

No customer-specific IaC is rewritten.

That workflow is the core definition of success.

⸻

41. PRODUCT MESSAGE

The application should reinforce this positioning:

You’ve productized your software. Productize your Azure deployment.

Secondary message:

Turn architecture, governance, deployment, customer onboarding and upgrades into one repeatable lifecycle.

Do NOT position this merely as:

Landing Zone Builder
Terraform Generator
Azure Dashboard
AI Infrastructure Assistant

Those are components.

The product is an:

ISV CUSTOMER DEPLOYMENT FACTORY

It transforms:

ISV Architecture
      ↓
Versioned Offering
      ↓
Customer Configuration
      ↓
Validated Deployment Plan
      ↓
Governed Azure Deployment
      ↓
Lifecycle Management
      ↓
Upgrades + Drift + Compliance

⸻

42. DELIVERABLES

Generate a working application, not static mockups.

Deliver:

React frontend
backend API
PostgreSQL database schema and migrations
seed scripts
authentication and authorization
demo ISV/customer dataset
offering/blueprint engine
customer onboarding workflow
deployment state machine
demo deployment provider
Azure provider interfaces
IaC provider interfaces
GitHub/ADO pipeline provider abstractions
approval workflow
estate management
upgrade management
drift model
compliance model
cost model
audit system
OpenAPI specification
Docker configuration
environment configuration examples
developer README
production deployment README
tests for critical business logic

Keep architecture modular enough to replace the demo Azure adapter with actual ARM/Bicep/Terraform execution without rewriting the application.

Before considering the product finished, verify that every major button performs a real application action against the API/database or is explicitly labeled as unavailable/demo. Do not ship dead UI controls.

Build the initial working product now.

## Development

You need Node.js (or Bun) and a Supabase project. Copy the connection values into `.env`
(`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and the `VITE_`-prefixed
public variants). Optional AI architecture drafting uses any OpenAI-compatible endpoint, e.g. Azure OpenAI:
`AI_CHAT_COMPLETIONS_URL`, `AI_API_KEY`, `AI_MODEL`.

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
