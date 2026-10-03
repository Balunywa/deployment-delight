-- The engagement workspace: an engagement can be a draft while the SE prepares (not started with the customer, no
-- commitment), and carries its point of view, call plans, findings, charter, validation and handoff plans in one
-- document. Customers keep the SE's evidence marks (confirmed, needs validation, contradicted, unknown) on their brief.
alter table public.engagements
  add column if not exists status text not null default 'active',
  add column if not exists workspace jsonb not null default '{}'::jsonb;

alter table public.engagements drop constraint if exists engagements_status_check;
alter table public.engagements add constraint engagements_status_check check (status in ('draft', 'active'));

alter table public.customers
  add column if not exists evidence jsonb not null default '{}'::jsonb;
