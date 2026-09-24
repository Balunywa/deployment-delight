-- The Grid and storage orchestrator Enterprise Private v4.3.0 draft was seeded as a delta (three modules).
-- Make it a full manifest — v4.2.0 with those modules bumped — so release diffs show only real changes.
update public.offering_versions d
set manifest_json = jsonb_set(
      p.manifest_json,
      '{modules}',
      (select jsonb_agg(case m->>'name'
                          when 'postgres' then m || '{"version":"4.1"}'
                          when 'aks' then m || '{"version":"5.4"}'
                          when 'security-baseline' then m || '{"version":"6.1"}'
                          else m end)
         from jsonb_array_elements(p.manifest_json->'modules') m)
    ) || '{"version":"4.3.0"}'::jsonb
from public.offering_versions p
where d.id = '44444444-4444-4444-4444-444444444443'
  and d.status = 'draft'
  and p.offering_id = d.offering_id
  and p.version = '4.2.0'
  and jsonb_array_length(d.manifest_json->'modules') < 5;
