-- Engagements: the listening and consulting that comes before solutioning. An SE, CSA or SSP captures the
-- customer's business problem and baseline (Listen), readiness across six concepts (Assess), which accelerators
-- address which priority (Map), the story for each audience (Propose, generated), and the measured result and
-- decision (Prove).
create table if not exists public.engagements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  name text not null,
  stage text not null default 'listen'
    check (stage in ('listen', 'assess', 'map', 'propose', 'prove', 'decided')),
  owner_name text,
  brief jsonb not null default '{}'::jsonb,
  readiness jsonb not null default '{}'::jsonb,
  solution_map jsonb not null default '[]'::jsonb,
  results jsonb not null default '[]'::jsonb,
  decision jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists engagements_org_idx on public.engagements (organization_id, updated_at desc);

-- A typical engagement, mid-way: listened, assessed, mapped. Demo customers only.
insert into public.engagements (id, organization_id, customer_id, name, stage, owner_name, brief, readiness, solution_map)
select '44444444-4444-4444-8444-000000000001', c.organization_id, c.id,
  'Maintenance work packages in days, not weeks', 'map', 'Sarah Chen',
  $${
    "problem": "Planners assemble maintenance work packages by hand from work orders, manuals, permits and asset history. A package takes days, and missing permits or parts are found late.",
    "workflow": "Maintenance work-package preparation",
    "outcome": "Planners review and approve AI-drafted work packages instead of assembling them, with gaps flagged before the job is scheduled.",
    "whyNow": "A turnaround is scheduled next year and the planning team is short-staffed.",
    "owner": "VP Maintenance & Reliability",
    "constraints": "Data must stay in the company's tenant. Permits are approved by people, always.",
    "stakeholders": [
      { "name": "Dana Ruiz", "role": "VP Maintenance & Reliability", "audience": "executive" },
      { "name": "Priya Natarajan", "role": "Enterprise architect", "audience": "technical" },
      { "name": "Tom Becker", "role": "Lead planner", "audience": "technical" }
    ],
    "baseline": [
      { "metric": "Time to assemble a work package", "value": "", "unit": "days" },
      { "metric": "Packages reworked after scheduling", "value": "", "unit": "%" }
    ]
  }$$::jsonb,
  $${
    "workflows": { "status": "blocker", "note": "Pilots exist in a sandbox; nothing runs in the planners' workflow." },
    "context": { "status": "partial", "note": "Asset and permit terms differ between sites." },
    "modernize": { "status": "partial", "note": "The maintenance system is on-premises; read access only." },
    "data": { "status": "partial", "note": "Manuals and permits are in SharePoint; asset history in the maintenance system." },
    "governance": { "status": "ready", "note": "Landing zone and Entra ID in place." },
    "ownership": { "status": "unknown", "note": "" }
  }$$::jsonb,
  $$[
    { "concept": "workflows", "products": ["33333333-3333-4333-8333-100000000007"], "note": "Agents draft the package; the planner approves." },
    { "concept": "context", "products": ["33333333-3333-4333-8333-100000000009"], "note": "Extract fields from permits and work orders with confidence scores." }
  ]$$::jsonb
from public.customers c
where c.customer_code = 'metro-energy'
on conflict (id) do nothing;
