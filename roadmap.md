# Azure ISV Deployment Factory — build roadmap

## Done
- Control-plane schema (organizations, memberships, products, offerings, offering_versions, infrastructure_modules, customers, customer_connections, environments, deployments, deployment_steps, approvals, policy_packs, drift_findings, compliance_checks, upgrade_waves, audit_events) with an append-only audit table (trigger-enforced).
- GridWorks demo dataset: 3 products, 5 offerings, versions 3.9.0/4.1.0/4.2.0 (+4.3.0 draft), 12 modules, 4 policy packs, 24 utility customers, 40 environments, deployment history incl. 1 failure, 1 pending production approval, 2 drift findings, compliance gaps.
- Provider abstractions (`InfrastructureProvider`, `PipelineProvider`) + demo adapter (validate / plan / apply / outputs / drift / destroy), zero Azure calls, everything tagged `mode: demo`.
- Deployment state machine with enforced transitions, correlation IDs, step logs, no pretend rollback.
- Server functions: preflight, connection validation, plan creation, approvals, execution, drift detect/resolve, AI architecture intake + deterministic schema & architecture-policy validation, version create/publish (published versions immutable), onboarding, upgrade classification, rollout waves, branding.
- UI: overview, products, offerings catalog + version history + architecture intake, customers list, customer detail (8 tabs), deployments list + run detail with approvals/plan/preflight/timeline, estate with filters and batch plan generation, compliance, upgrades, costs, audit, settings, onboarding wizard.
- Acceptance path verified: Metro Energy preflight returns 17 PASS / 2 WARNING / 0 BLOCKING.
- UX reframe around the ISV-owned delivery lifecycle (one product definition, N customer installs):
  - Offering designer (`/offerings`): click Azure services from a catalog (`src/lib/catalog.ts`) onto an architecture canvas; the Bicep entry point, CI/CD pipeline (GitHub Actions / Azure DevOps) and customer inputs are generated from it (`src/lib/pipeline.ts`). Saving creates or updates a draft release; published releases stay immutable.
  - The demo engine now plans and applies from the architecture instead of a hardcoded resource list.
  - Onboarding asks only for the inputs the architecture needs, either entered by the engineer or collected through a branded customer install link (`/connect/$customerId`) with platform discovery.
  - Pipeline run view (`/deployments/$deploymentId`): stage → job graph, per-resource status on the architecture, job logs and a what-if style plan.
  - Home, customer page, releases (rings, Preferred/Supported/Deprecated), installed-base grid, ⌘K palette, collapsible nav rail; costs are modelled from each install's architecture.
  - Fixed: rollout waves now set the install's desired release and create the approval gate.
- Standalone, ISV-owned deployment: no Lovable tooling or services; control-plane database moved to Azure Database for PostgreSQL
  (plain SQL migrations + seed in `db/`, server-side `pg` access, Microsoft Entra token auth).

## Open (needs owner decision or external access)
- Real Azure execution mode: Container Apps Job running Bicep/Terraform, per-customer federated identity, GitHub/ADO reusable workflow dispatch. Blocked on an Azure tenant + pipeline credentials; the provider interfaces are already in place.
- Actual cost ingestion from Azure Cost Management (estimates only today).
- Entra sign-in and role enforcement per user: authorization rules are modelled, but sign-in is not wired because no identity provider has been chosen yet.
- OpenAPI document, Docker packaging and unit tests for the state machine / blueprint validation.
