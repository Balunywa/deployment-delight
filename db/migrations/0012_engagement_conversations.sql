-- Engagements become a conversation navigator: meetings (sessions), the questions asked and the customer's answers
-- (trail), what was learned, labelled confirmed / hypothesis / still unknown / ruled out (findings), and agreed
-- next steps (actions). Stages follow a consulting conversation: understand, explore, illustrate, validate, agree,
-- then prove.
alter table public.engagements
  add column if not exists sessions jsonb not null default '[]'::jsonb,
  add column if not exists trail jsonb not null default '[]'::jsonb,
  add column if not exists findings jsonb not null default '[]'::jsonb,
  add column if not exists actions jsonb not null default '[]'::jsonb;

alter table public.engagements drop constraint if exists engagements_stage_check;
update public.engagements set stage = case stage
  when 'listen' then 'understand' when 'assess' then 'explore' when 'map' then 'illustrate'
  when 'propose' then 'validate' else stage end;
alter table public.engagements alter column stage set default 'understand';
alter table public.engagements add constraint engagements_stage_check
  check (stage in ('understand', 'explore', 'illustrate', 'validate', 'agree', 'prove', 'decided'));

-- The demo engagement, as the conversation it would have been: two meetings with Metro Energy. Demo customers only.
-- @S1 and @S2 are the meeting times; @Dn is a due date n days from now.
with t as (select now() at time zone 'utc' as n),
f as (select
  to_char((select n from t) - interval '13 days', 'YYYY-MM-DD"T"15:00:00"Z"') as s1,
  to_char((select n from t) - interval '3 days', 'YYYY-MM-DD"T"10:00:00"Z"') as s2,
  to_char((select n from t) + interval '5 days', 'YYYY-MM-DD') as d5,
  to_char((select n from t) + interval '7 days', 'YYYY-MM-DD') as d7,
  to_char((select n from t) + interval '11 days', 'YYYY-MM-DD') as d11)
insert into public.engagements (id, organization_id, customer_id, name, stage, owner_name, brief, readiness,
  solution_map, sessions, trail, findings, actions)
select '44444444-4444-4444-8444-000000000001', c.organization_id, c.id,
  'Maintenance work packages in days, not weeks', 'validate', 'Sarah Chen',
  $${
    "signals": ["pilots"],
    "words": "We've had a planning copilot in pilot for six months. Everyone liked the demo; nobody uses it.",
    "outcome": "Planners approve work packages instead of assembling them, and missing permits are found weeks before the job, not the week of it.",
    "workflow": "Substation maintenance work packages. Eight planners build them by hand from work orders, manuals, switching permits and asset history.",
    "whyNow": "Three of the eight planners retire in the next 18 months, and the substation refurbishment programme starts next year.",
    "owner": "Dana Ruiz, VP Maintenance & Reliability",
    "stakeholders": [
      { "name": "Dana Ruiz", "role": "VP Maintenance & Reliability", "audience": "executive" },
      { "name": "Priya Natarajan", "role": "Enterprise architect", "audience": "technical" },
      { "name": "Tom Becker", "role": "Lead planner", "audience": "technical" }
    ],
    "baseline": [
      { "metric": "Days to assemble a work package", "value": "", "unit": "days" }
    ],
    "internal": "Dana has budget for one proof this half. Priya is cautious after the copilot pilot; lead the design session with the approval path, not the demo."
  }$$::jsonb,
  '{}'::jsonb,
  $$[
    { "concept": "workflows", "products": ["33333333-3333-4333-8333-100000000007"], "note": "Agents draft the package; the planner approves." },
    { "concept": "context", "products": ["33333333-3333-4333-8333-100000000009"], "note": "Read the scanned permits, with a confidence score per field." }
  ]$$::jsonb,
  replace(replace($$[
    { "id": "s1", "title": "Discovery: maintenance planning", "at": "@S1", "attendees": "Dana Ruiz, Tom Becker" },
    { "id": "s2", "title": "Architecture design session", "at": "@S2", "attendees": "Priya Natarajan, Metro Energy security architect" }
  ]$$, '@S1', f.s1), '@S2', f.s2)::jsonb,
  replace(replace($$[
    { "card": "u-outcome", "answers": [], "session": "s1", "at": "@S1", "note": "Planners approve work packages instead of assembling them, and missing permits are found weeks before the job, not the week of it." },
    { "card": "u-workflow", "answers": [], "session": "s1", "at": "@S1", "note": "Substation maintenance work packages. Eight planners build them by hand from work orders, manuals, switching permits and asset history." },
    { "card": "x-last-pilot", "answers": ["fit"], "session": "s1", "at": "@S1", "note": "It was a chat window. Planners don't need to chat; they need the package built." },
    { "card": "x-where-time-goes", "answers": ["gather"], "session": "s1", "at": "@S1", "note": "Most of a package is copy and paste from five places. The judgement part is maybe an hour." },
    { "card": "x-human-step", "answers": ["regulated"], "session": "s1", "at": "@S1", "note": "Switching permits are signed by a person. Always." },
    { "card": "u-why-now", "answers": ["people"], "session": "s1", "at": "@S1", "note": "Three of the eight planners retire in the next 18 months, and the substation refurbishment programme starts next year." },
    { "card": "u-owner", "answers": ["funded"], "session": "s1", "at": "@S1", "note": "Dana Ruiz, VP Maintenance & Reliability" },
    { "card": "u-baseline", "answers": ["rough"], "session": "s1", "at": "@S1", "note": "Days to assemble a work package" },
    { "card": "x-data-where", "answers": ["files", "ops"], "session": "s2", "at": "@S2", "note": "Manuals and permits in SharePoint; work orders and asset history in the maintenance system." },
    { "card": "x-hardest-system", "answers": ["onprem"], "session": "s2", "at": "@S2", "note": "The maintenance management system, on-premises." },
    { "card": "x-integration", "answers": ["export"], "session": "s2", "at": "@S2", "note": "A nightly replica to SQL. No write access, and that's fine for now." },
    { "card": "x-documents", "answers": ["docs"], "session": "s2", "at": "@S2", "note": "Permits are scanned PDFs, and about a third of them are handwritten." },
    { "card": "x-approval", "answers": ["tenant", "eval"], "session": "s2", "at": "@S2", "note": "It runs in our tenant, and we can trace what every agent did and why." },
    { "card": "x-access", "answers": ["per-system"], "session": "s2", "at": "@S2", "note": "" },
    { "card": "show:7", "answers": [], "session": "s2", "at": "@S2", "note": "Walked through the plan-approve-execute flow. Priya liked that nothing runs before a person approves the plan." },
    { "card": "show:9", "answers": [], "session": "s2", "at": "@S2", "note": "Showed per-field confidence on a scanned permit." },
    { "card": "x-definitions", "answers": [], "session": "s2", "at": "@S2", "note": "Asset naming differs between the two regions. Come back to it with the data owners.", "parked": true }
  ]$$, '@S1', f.s1), '@S2', f.s2)::jsonb,
  replace(replace($$[
    { "id": "f-01", "kind": "confirmed", "source": "customer", "edited": true, "card": "x-last-pilot", "at": "@S1", "text": "The pilot was built around the model, not the workflow.", "quote": "It was a chat window. Planners don't need to chat; they need the package built." },
    { "id": "f-02", "kind": "hypothesis", "source": "presenter", "card": "x-where-time-goes", "at": "@S1", "text": "Most of the time goes into gathering information, not deciding." },
    { "id": "f-03", "kind": "confirmed", "source": "customer", "card": "x-human-step", "at": "@S1", "text": "Safety and regulatory approvals stay with a person, always.", "quote": "Switching permits are signed by a person. Always." },
    { "id": "f-04", "kind": "confirmed", "source": "customer", "card": "u-why-now", "at": "@S1", "text": "Not enough people to do this work the way it's done today.", "quote": "Three of the eight planners retire in the next 18 months, and the substation refurbishment programme starts next year." },
    { "id": "f-05", "kind": "confirmed", "source": "customer", "card": "u-owner", "at": "@S1", "text": "A business owner can fund the next step." },
    { "id": "f-06", "kind": "hypothesis", "source": "presenter", "card": "u-baseline", "at": "@S1", "text": "The baseline is an estimate." },
    { "id": "f-07", "kind": "confirmed", "source": "customer", "card": "x-data-where", "at": "@S2", "text": "Data is in SharePoint and file shares.", "quote": "Manuals and permits in SharePoint; work orders and asset history in the maintenance system." },
    { "id": "f-08", "kind": "confirmed", "source": "customer", "card": "x-data-where", "at": "@S2", "text": "Data is in operational systems." },
    { "id": "f-09", "kind": "confirmed", "source": "customer", "card": "x-integration", "at": "@S2", "text": "The system can be read through a nightly export or replica.", "quote": "A nightly replica to SQL. No write access, and that's fine for now." },
    { "id": "f-10", "kind": "confirmed", "source": "customer", "card": "x-documents", "at": "@S2", "text": "The knowledge lives mostly in documents.", "quote": "Permits are scanned PDFs, and about a third of them are handwritten." },
    { "id": "f-11", "kind": "confirmed", "source": "customer", "card": "x-approval", "at": "@S2", "text": "Data must stay in the company's own Azure tenant." },
    { "id": "f-12", "kind": "confirmed", "source": "customer", "card": "x-approval", "at": "@S2", "text": "Security needs evaluation and an audit trail for AI.", "quote": "It runs in our tenant, and we can trace what every agent did and why." },
    { "id": "f-13", "kind": "hypothesis", "source": "presenter", "card": "x-access", "at": "@S2", "text": "Agents will need to respect per-system permissions." },
    { "id": "f-14", "kind": "unknown", "source": "presenter", "at": "@S2", "text": "How accurately the handwritten permits can be read." },
    { "id": "f-15", "kind": "hypothesis", "source": "ai", "at": "@S2", "text": "Nightly data is enough to draft a package, but not to confirm parts availability on the day." },
    { "id": "f-16", "kind": "confirmed", "source": "customer", "card": "x-hardest-system", "at": "@S2", "text": "The work depends on an on-premises business system." }
  ]$$, '@S1', f.s1), '@S2', f.s2)::jsonb,
  replace(replace(replace($$[
    { "id": "a-1", "text": "Measure the baseline for two weeks before the proof starts.", "owner": "Tom Becker", "due": "@D11", "done": false },
    { "id": "a-2", "text": "Share 30 recent work packages and their permits, redacted.", "owner": "Tom Becker", "due": "@D7", "done": false },
    { "id": "a-3", "text": "Confirm read access to the maintenance system replica.", "owner": "Priya Natarajan", "due": "@D5", "done": false }
  ]$$, '@D11', f.d11), '@D7', f.d7), '@D5', f.d5)::jsonb
from public.customers c, f
where c.customer_code = 'metro-energy'
on conflict (id) do update set
  name = excluded.name, stage = excluded.stage, owner_name = excluded.owner_name, brief = excluded.brief,
  readiness = excluded.readiness, solution_map = excluded.solution_map, results = '[]'::jsonb, decision = null,
  sessions = excluded.sessions, trail = excluded.trail, findings = excluded.findings, actions = excluded.actions,
  updated_at = now();
