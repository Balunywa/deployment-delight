-- Demo platform landing zones.
-- GridWorks' own hosting tenant: built from the ALZ Library, deployed on an older release (upgrade available).
insert into public.foundations (organization_id, customer_id, name, tenant_id, mode, library_ref, deployed_ref, answers, status, last_deployed_at)
values ('11111111-1111-1111-1111-111111111111', null, 'GridWorks hosting tenant', '11111111-aaaa-4bbb-8ccc-gridworks000', 'managed',
  'platform/alz/2025.09.3', 'platform/alz/2025.09.3',
  '{"intermediateRootId":"gridworks","intermediateRootName":"GridWorks","primaryRegion":"eastus2","connectivity":"hub_and_spoke","ddosPlan":"no","privateDns":"platform","monitoring":"azure_monitor","siem":"sentinel","securityContactEmail":"secops@gridworks.example"}'::jsonb,
  'deployed', now() - interval '64 days');

-- A customer that is new to Azure: GridWorks builds their foundation first.
insert into public.foundations (organization_id, customer_id, name, tenant_id, mode, library_ref, answers, status)
select '11111111-1111-1111-1111-111111111111', c.id, c.name || ' tenant', c.tenant_id, 'managed', 'platform/alz/2026.08.1',
  jsonb_build_object('intermediateRootId', split_part(c.customer_code, '-', 1), 'intermediateRootName', c.name, 'primaryRegion', 'centralus',
    'connectivity', 'none', 'ddosPlan', 'no', 'privateDns', 'none', 'monitoring', 'azure_monitor', 'siem', 'other',
    'securityContactEmail', 'it@' || c.customer_code || '.example'),
  'draft'
from public.customers c where c.azure_model = 'greenfield';

-- Customers with their own enterprise landing zone: discovered, consumed as-is.
insert into public.foundations (organization_id, customer_id, name, tenant_id, mode, library_ref, answers, discovered, status)
select '11111111-1111-1111-1111-111111111111', c.id, c.name || ' landing zone', c.tenant_id, 'existing', 'platform/alz/2026.01.3',
  jsonb_build_object('intermediateRootId', split_part(c.customer_code, '-', 1), 'intermediateRootName', c.name, 'primaryRegion', 'eastus2',
    'connectivity', 'hub_and_spoke', 'ddosPlan', 'yes', 'privateDns', 'platform', 'monitoring', 'azure_monitor', 'siem', 'sentinel', 'securityContactEmail', ''),
  jsonb_build_object('source', 'Azure Resource Graph (demo)', 'managementGroups', 11, 'followsReference', true,
    'targetManagementGroup', split_part(c.customer_code, '-', 1) || '-corp'),
  'discovered'
from public.customers c where c.azure_model = 'existing_enterprise_alz';
