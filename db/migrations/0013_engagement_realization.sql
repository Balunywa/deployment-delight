-- Realize value: the last step after a proof is scaled. What's running in production, the customer's measures at
-- 30, 60 and 90 days against the baseline, the business owner's confirmation, and (internal only) links to the MSX
-- opportunity and milestones the work is tracked under.
alter table public.engagements
  add column if not exists realization jsonb not null default '{}'::jsonb;

alter table public.engagements drop constraint if exists engagements_stage_check;
alter table public.engagements add constraint engagements_stage_check
  check (stage in ('understand', 'explore', 'illustrate', 'validate', 'agree', 'prove', 'realize', 'decided'));
