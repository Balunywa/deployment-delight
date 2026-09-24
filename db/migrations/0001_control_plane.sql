-- Control-plane schema for Azure Database for PostgreSQL Flexible Server (PostgreSQL 14+).
-- Applied by scripts/db.mjs; each file in db/migrations runs once, in order.
-- ============ ENUMS ============
create type public.offering_type as enum ('saas_connected','customer_hosted','enterprise_private','regulated','edge','sandbox');
create type public.version_status as enum ('draft','testing','published','deprecated','retired');
create type public.environment_type as enum ('development','test','qa','staging','production','disaster_recovery');
create type public.deployment_type as enum ('initial','upgrade','configuration_change','repair','drift_remediation','decommission');
create type public.deployment_status as enum ('DRAFT','VALIDATING','VALIDATION_FAILED','READY','AWAITING_APPROVAL','PLANNING','PLAN_FAILED','AWAITING_PLAN_APPROVAL','QUEUED','DEPLOYING','SUCCEEDED','FAILED','REQUIRES_REMEDIATION','CANCELLED');
create type public.step_status as enum ('pending','running','succeeded','failed','skipped');
create type public.approval_status as enum ('pending','approved','rejected','expired');
create type public.severity as enum ('low','medium','high','critical');
create type public.connection_type as enum ('existing_subscription','new_subscription','existing_resource_group','lighthouse','managed_application','federated_identity');

-- ============ CORE ============
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  logo_url text,
  portal_title text,
  support_url text,
  primary_color text default 'oklch(0.55 0.15 250)',
  secondary_color text default 'oklch(0.45 0.09 230)',
  demo_mode boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null,
  role text not null default 'onboarding_engineer',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  category text,
  status text not null default 'active',
  created_at timestamptz not null default now()
);

create table public.offerings (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  name text not null,
  description text,
  offering_type public.offering_type not null,
  deployment_boundary text not null default 'subscription',
  network_profile text,
  security_profile text,
  supported_regions text[] not null default '{}',
  estimated_monthly_cost_low numeric,
  estimated_monthly_cost_high numeric,
  status text not null default 'active',
  created_at timestamptz not null default now()
);

create table public.offering_versions (
  id uuid primary key default gen_random_uuid(),
  offering_id uuid not null references public.offerings(id) on delete cascade,
  version text not null,
  status public.version_status not null default 'draft',
  manifest_json jsonb not null default '{}'::jsonb,
  release_notes text,
  ai_generated boolean not null default false,
  created_by text,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  unique (offering_id, version)
);

create table public.infrastructure_modules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  module_type text not null,
  provider text not null default 'bicep',
  source text,
  version text not null,
  input_schema_json jsonb not null default '{}'::jsonb,
  output_schema_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.policy_packs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  version text not null,
  description text,
  policy_manifest_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  customer_code text not null,
  tenant_id text,
  industry text,
  azure_model text not null default 'existing_enterprise_alz',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  unique (organization_id, customer_code)
);

create table public.customer_connections (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  connection_type public.connection_type not null,
  tenant_id text,
  subscription_id text,
  management_group_id text,
  resource_group_id text,
  lighthouse_delegation_id text,
  credential_reference text,
  status text not null default 'unvalidated',
  last_validated_at timestamptz,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.environments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  offering_id uuid not null references public.offerings(id),
  desired_offering_version_id uuid references public.offering_versions(id),
  actual_offering_version_id uuid references public.offering_versions(id),
  name text not null,
  environment_type public.environment_type not null,
  region text not null,
  secondary_region text,
  deployment_boundary text not null default 'subscription',
  status text not null default 'healthy',
  compliance_score numeric not null default 100,
  monthly_cost_estimate numeric,
  configuration_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.deployments (
  id uuid primary key default gen_random_uuid(),
  environment_id uuid not null references public.environments(id) on delete cascade,
  deployment_type public.deployment_type not null default 'initial',
  desired_version text,
  previous_version text,
  status public.deployment_status not null default 'DRAFT',
  mode text not null default 'demo',
  requested_by text,
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  correlation_id text not null default gen_random_uuid()::text,
  plan_json jsonb not null default '{}'::jsonb,
  preflight_json jsonb not null default '{}'::jsonb,
  result_json jsonb not null default '{}'::jsonb
);

create table public.deployment_steps (
  id uuid primary key default gen_random_uuid(),
  deployment_id uuid not null references public.deployments(id) on delete cascade,
  sequence int not null,
  name text not null,
  module_name text,
  status public.step_status not null default 'pending',
  started_at timestamptz,
  completed_at timestamptz,
  log_text text,
  error_json jsonb
);

create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  deployment_id uuid not null references public.deployments(id) on delete cascade,
  approval_type text not null,
  requested_from text,
  status public.approval_status not null default 'pending',
  comments text,
  decided_by text,
  requested_at timestamptz not null default now(),
  decided_at timestamptz
);

create table public.drift_findings (
  id uuid primary key default gen_random_uuid(),
  environment_id uuid not null references public.environments(id) on delete cascade,
  resource_id text not null,
  category text not null,
  expected_json jsonb not null default '{}'::jsonb,
  actual_json jsonb not null default '{}'::jsonb,
  severity public.severity not null default 'medium',
  status text not null default 'open',
  recommended_remediation text,
  detected_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table public.compliance_checks (
  id uuid primary key default gen_random_uuid(),
  environment_id uuid not null references public.environments(id) on delete cascade,
  policy_pack_id uuid references public.policy_packs(id),
  control_name text not null,
  control_key text not null,
  result text not null default 'PASS',
  evidence_json jsonb not null default '{}'::jsonb,
  evaluated_at timestamptz not null default now()
);

create table public.upgrade_waves (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  offering_version_id uuid references public.offering_versions(id),
  name text not null,
  sequence int not null default 1,
  status text not null default 'planned',
  environment_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  environment_id uuid references public.environments(id) on delete set null,
  actor_id text,
  actor_name text,
  event_type text not null,
  resource_type text,
  resource_id text,
  previous_value jsonb,
  new_value jsonb,
  correlation_id text,
  result text default 'success',
  metadata_json jsonb not null default '{}'::jsonb,
  timestamp timestamptz not null default now()
);

create index on public.environments (customer_id);
create index on public.deployments (environment_id, requested_at desc);
create index on public.deployment_steps (deployment_id, sequence);
create index on public.compliance_checks (environment_id);
create index on public.drift_findings (environment_id);
create index on public.audit_events (organization_id, timestamp desc);

-- ============ AUDIT: append-only ============
create or replace function public.audit_events_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'audit_events is append-only';
end $$;

create trigger audit_events_no_update before update or delete on public.audit_events
  for each row execute function public.audit_events_append_only();
