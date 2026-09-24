-- Platform landing zones ("foundations"): one per Microsoft Entra tenant.
-- A foundation is either built and managed by Cloud Delivery from the Azure Landing Zones (ALZ) Library
-- (the ISV's own hosting tenant, or a customer tenant that is new to Azure), or an existing customer ALZ
-- that is discovered and consumed read-only.
create table public.foundations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete cascade,
  name text not null,
  tenant_id text,
  mode text not null default 'managed' check (mode in ('managed', 'existing')),
  library_ref text not null,
  deployed_ref text,
  answers jsonb not null default '{}'::jsonb,
  discovered jsonb not null default '{}'::jsonb,
  status text not null default 'draft',
  last_deployed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on public.foundations (organization_id);
create unique index foundations_one_per_customer on public.foundations (customer_id) where customer_id is not null;
create unique index foundations_one_isv on public.foundations (organization_id) where customer_id is null;
