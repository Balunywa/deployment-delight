-- 0015 removed the demo customers by their seeded codes. Proof deploys made before the duplicate-customer fix created
-- copies with a numbered code (metro-energy-2, metro-energy-3…); remove those and what was made for them too.
create temporary table demo_customers on commit drop as
  select id from public.customers
  where organization_id = '11111111-1111-1111-1111-111111111111'
    and customer_code ~ ('^(metro-energy|north-grid|coastal-power|cascade-utilities|prairie-electric|summit-power|'
      || 'harbor-municipal|ironwood-energy|redstone-coop|valley-grid|lakeshore-energy|copper-ridge|silver-creek|'
      || 'western-interconnect|bluewater-power|granite-state|desert-sun|pinecrest-utilities|riverbend-power|'
      || 'highline-grid|meridian-energy|stonebridge-electric|orchard-valley|tidewater-utilities)-[0-9]+$');

create temporary table demo_environments on commit drop as
  select id from public.environments where customer_id in (select id from demo_customers);
create temporary table demo_foundations on commit drop as
  select id from public.foundations where customer_id in (select id from demo_customers);
create temporary table demo_engagements on commit drop as
  select id from public.engagements where customer_id in (select id from demo_customers);
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
delete from public.customers where id in (select id from demo_customers);
alter table public.audit_events enable trigger audit_events_no_update;
