-- Real landing zone deployments: every plan, apply and destroy the app runs with Terraform, with its log.
create table public.foundation_runs (
  id uuid primary key default gen_random_uuid(),
  foundation_id uuid not null references public.foundations(id) on delete cascade,
  action text not null check (action in ('plan', 'apply', 'destroy')),
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed')),
  started_by text,
  targets jsonb not null default '{}'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  log text not null default '',
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index on public.foundation_runs (foundation_id, created_at desc);

-- Where the landing zone is deployed: platform subscription IDs (existing or vended) and the billing scope.
alter table public.foundations add column if not exists deployment jsonb not null default '{}'::jsonb;
