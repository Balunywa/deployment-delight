-- Real offering deployments: an offering version deployed with Terraform, ring by ring (land, then each
-- environment), with the stages, jobs and step logs the pipeline view shows.
create table public.offering_runs (
  id uuid primary key default gen_random_uuid(),
  offering_id uuid not null references public.offerings(id) on delete cascade,
  offering_version_id uuid references public.offering_versions(id) on delete set null,
  version text not null default '',
  action text not null check (action in ('plan', 'deploy', 'destroy')),
  status text not null default 'running'
    check (status in ('running', 'waiting', 'succeeded', 'failed', 'cancelled')),
  started_by text,
  subscription_id text not null,
  region text not null,
  environments text[] not null default '{}',
  settings jsonb not null default '{}'::jsonb,
  stages jsonb not null default '[]'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  approval jsonb,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index on public.offering_runs (offering_id, created_at desc);
