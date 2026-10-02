-- Removes the made-up demo customers (Metro Energy, NorthGrid… the 24 utilities from db/seed/0001) and everything that
-- only existed for them: their landing zones and runs, delivery units, installs (environments) with their deployments,
-- approvals, drift and compliance, their engagements, and the audit events about them. Customers you add are kept,
-- as are the solution catalog, offerings and your own hosting landing zone.
--
-- The audit log is append-only; its guard is lifted only inside this migration, which runs as one transaction, to
-- remove events about customers that never existed.
create temporary table demo_customers on commit drop as
  select id from public.customers
  where organization_id = '11111111-1111-1111-1111-111111111111'
    and customer_code in (
      'metro-energy', 'north-grid', 'coastal-power', 'cascade-utilities', 'prairie-electric', 'summit-power',
      'harbor-municipal', 'ironwood-energy', 'redstone-coop', 'valley-grid', 'lakeshore-energy', 'copper-ridge',
      'silver-creek', 'western-interconnect', 'bluewater-power', 'granite-state', 'desert-sun',
      'pinecrest-utilities', 'riverbend-power', 'highline-grid', 'meridian-energy', 'stonebridge-electric',
      'orchard-valley', 'tidewater-utilities'
    );

create temporary table demo_environments on commit drop as
  select id from public.environments where customer_id in (select id from demo_customers);
create temporary table demo_foundations on commit drop as
  select id from public.foundations where customer_id in (select id from demo_customers);
create temporary table demo_engagements on commit drop as
  select id from public.engagements
  where customer_id in (select id from demo_customers)
     or id = '44444444-4444-4444-8444-000000000001';
create temporary table demo_resources on commit drop as
  select id::text as id from demo_customers
  union select id::text from demo_environments
  union select id::text from demo_foundations
  union select id::text from demo_engagements
  union select d.id::text from public.deployments d where d.environment_id in (select id from demo_environments);

alter table public.audit_events disable trigger audit_events_no_update;
delete from public.audit_events
  where customer_id in (select id from demo_customers)
     or environment_id in (select id from demo_environments)
     or resource_id in (select id from demo_resources);

delete from public.engagements where id in (select id from demo_engagements);
delete from public.delivery_units
  where customer_id in (select id from demo_customers)
     or foundation_id in (select id from demo_foundations);
-- Cascades to connections, landing zones and their runs, environments, deployments, steps, approvals, drift and
-- compliance checks.
delete from public.customers where id in (select id from demo_customers);
alter table public.audit_events enable trigger audit_events_no_update;
