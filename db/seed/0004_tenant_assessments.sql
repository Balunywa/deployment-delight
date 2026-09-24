-- Customer-owned landing zones get a demo tenant snapshot to assess until a live scan replaces it: alternate
-- between a partly-built ALZ (older release, some gaps) and a legacy tenant with no hierarchy.
update public.foundations f
set discovered = f.discovered || jsonb_build_object('variant', case when v.n % 2 = 1 then 'partial-alz' else 'legacy' end)
from (select id, row_number() over (order by name) as n from public.foundations where mode = 'existing') v
where f.id = v.id;
