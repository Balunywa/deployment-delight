-- Team space: customers and engagements shared with a Microsoft Teams team through its SharePoint document library.
-- app_settings keeps which team; sync_state remembers, per record, the file and version last exchanged, so only real
-- changes move and both sides changing the same record is detected.
create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.sync_state (
  kind text not null check (kind in ('customer', 'engagement')),
  local_id uuid not null,
  remote_name text not null,
  etag text,
  local_hash text,
  synced_at timestamptz not null default now(),
  primary key (kind, local_id)
);
