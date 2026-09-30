-- Delivery units: every landing zone, solution and customer is delivered from its own repository, with its own
-- pipeline environments, cloud identities and Terraform state (docs/delivery-isolation-strategy.md). A unit row
-- records the resolved spec vending applies and where its vending request is.
create table public.delivery_units (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null,
  slug text not null,
  name text not null,
  repository text not null,
  product_id uuid references public.products(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  foundation_id uuid references public.foundations(id) on delete set null,
  -- planned: derived from existing data, not requested yet · requested: vending request written ·
  -- vending: pull request open on cd-vending · active: vended · failed · retired
  status text not null default 'planned',
  spec jsonb not null,
  request_path text,
  request_url text,
  requested_by text,
  requested_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint delivery_units_kind_check check (kind in
    ('landing-zone', 'solution', 'customer', 'modules', 'templates', 'vending', 'control-plane')),
  constraint delivery_units_status_check check (status in
    ('planned', 'requested', 'vending', 'active', 'failed', 'retired')),
  unique (organization_id, repository)
);

create index on public.delivery_units (product_id);
create index on public.delivery_units (customer_id);
create index on public.delivery_units (foundation_id);
