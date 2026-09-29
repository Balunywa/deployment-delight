-- Solution catalog: products are published by named owners (SEs, CSAs, partners), carry a maturity level
-- that says how far they can be trusted, and are found by search and facets rather than business lines.
alter table public.products
  add column owners jsonb not null default '[]'::jsonb,
  add column maturity text not null default 'community',
  add column tags text[] not null default '{}',
  add column audience text,
  add column outcome text,
  add column source_url text,
  add column support_url text,
  add column license_attested boolean not null default false,
  add column submitted_by text,
  add column owner_confirmed_at timestamptz,
  add column validated_at timestamptz,
  add column updated_at timestamptz not null default now();

alter table public.products
  add constraint products_maturity_check check (maturity in ('community', 'validated', 'featured')),
  add constraint products_owners_is_array check (jsonb_typeof(owners) = 'array');

create index products_owners_idx on public.products using gin (owners jsonb_path_ops);
create index products_tags_idx on public.products using gin (tags);
