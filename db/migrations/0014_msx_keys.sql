-- MSX stays the system of record. Cloud Delivery keeps only the keys that link to it, the customer's TPID and the
-- engagement's opportunity, plus its own context: what the team learned that MSX doesn't hold (meeting notes,
-- emails, transcripts, prompts). An engagement is either tracked under an MSX opportunity or proactive.
alter table public.customers add column if not exists tpid text;
alter table public.customers add column if not exists msx_account_name text;
alter table public.customers add column if not exists context jsonb not null default '[]'::jsonb;
create unique index if not exists customers_tpid_idx
  on public.customers (organization_id, tpid) where tpid is not null;

alter table public.engagements add column if not exists origin text not null default 'proactive';
alter table public.engagements drop constraint if exists engagements_origin_check;
alter table public.engagements add constraint engagements_origin_check
  check (origin in ('opportunity', 'proactive'));
alter table public.engagements add column if not exists msx_opportunity_id text;
alter table public.engagements add column if not exists msx_opportunity_name text;
create index if not exists engagements_opportunity_idx
  on public.engagements (organization_id, msx_opportunity_id) where msx_opportunity_id is not null;

-- Engagements that already carry a pasted opportunity link were started from an opportunity.
update public.engagements
  set origin = 'opportunity'
  where coalesce(realization -> 'msx' ->> 'opportunity', '') <> '' and origin = 'proactive';
