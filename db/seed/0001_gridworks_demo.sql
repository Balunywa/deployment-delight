-- GridWorks demo dataset. Applied by `npm run db:seed` on an empty database.
-- ============ SEED: GridWorks demo dataset ============
insert into public.organizations (id, name, slug, portal_title, support_url, primary_color, secondary_color)
values ('11111111-1111-1111-1111-111111111111','GridWorks','gridworks','GridWorks Cloud Deployment Portal','https://support.gridworks.example','oklch(0.55 0.15 250)','oklch(0.45 0.09 230)');

insert into public.products (id, organization_id, name, description, category) values
('22222222-2222-2222-2222-222222222221','11111111-1111-1111-1111-111111111111','Grid Analytics Platform','Real-time grid telemetry, analytics and forecasting for utilities.','Analytics'),
('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','Meter Data Platform','MDM ingestion and validation for AMI meter data.','Data Platform'),
('22222222-2222-2222-2222-222222222223','11111111-1111-1111-1111-111111111111','Grid Edge Services','Edge orchestration for substation and DER workloads.','Edge');

insert into public.offerings (id, product_id, name, description, offering_type, deployment_boundary, network_profile, security_profile, supported_regions, estimated_monthly_cost_low, estimated_monthly_cost_high) values
('33333333-3333-3333-3333-333333333331','22222222-2222-2222-2222-222222222221','SaaS Connected','Best for customers consuming the ISV-hosted service with a light connector footprint.','saas_connected','resource-group','isv-hosted','standard','{eastus2,centralus,westeurope}',1800,3200),
('33333333-3333-3333-3333-333333333332','22222222-2222-2222-2222-222222222221','Customer Hosted','Deploy the application into a customer-owned Azure subscription with public-safe defaults.','customer_hosted','subscription','dedicated-spoke','standard','{eastus2,centralus,westeurope}',6400,9100),
('33333333-3333-3333-3333-333333333333','22222222-2222-2222-2222-222222222221','Enterprise Private','Private networking, customer hub connectivity, private endpoints, centralized identity and logging.','enterprise_private','subscription','customer-hub','hardened','{eastus2,centralus}',14200,17900),
('33333333-3333-3333-3333-333333333334','22222222-2222-2222-2222-222222222221','Regulated','Enterprise Private plus customer-managed keys, extended retention, Defender and stricter policy.','regulated','subscription','customer-hub','utility-critical','{eastus2,centralus}',19800,24500),
('33333333-3333-3333-3333-333333333335','22222222-2222-2222-2222-222222222221','Sandbox','Lower-cost non-production deployment for evaluation and integration testing.','sandbox','existing-resource-group','dedicated-spoke','baseline','{eastus2,centralus}',900,1600);

insert into public.offering_versions (id, offering_id, version, status, release_notes, created_by, published_at, manifest_json) values
('44444444-4444-4444-4444-444444444439','33333333-3333-3333-3333-333333333333','3.9.0','deprecated','Baseline Enterprise Private release.','Sarah Chen', now() - interval '400 days',
 '{"name":"grid-analytics-enterprise-private","version":"3.9.0","network":{"publicAccess":false,"privateEndpoints":true},"modules":[{"name":"resource-group","version":"1.8"},{"name":"network-spoke","version":"2.7"},{"name":"key-vault","version":"2.4"},{"name":"aks","version":"4.6"},{"name":"postgres","version":"3.2"},{"name":"monitoring","version":"3.8"},{"name":"security-baseline","version":"5.1"}]}'::jsonb),
('44444444-4444-4444-4444-444444444441','33333333-3333-3333-3333-333333333333','4.1.0','published','AKS baseline refresh, Event Hubs premium support.','Sarah Chen', now() - interval '180 days',
 '{"name":"grid-analytics-enterprise-private","version":"4.1.0","network":{"publicAccess":false,"privateEndpoints":true},"modules":[{"name":"resource-group","version":"2.0"},{"name":"network-spoke","version":"3.0"},{"name":"key-vault","version":"3.0"},{"name":"aks","version":"5.0"},{"name":"postgres","version":"3.9"},{"name":"event-hubs","version":"2.3"},{"name":"storage","version":"3.4"},{"name":"monitoring","version":"4.0"},{"name":"security-baseline","version":"5.8"}]}'::jsonb),
('44444444-4444-4444-4444-444444444442','33333333-3333-3333-3333-333333333333','4.2.0','published','PostgreSQL module updated to 4.0. AKS baseline updated. New security policy pack 6.0. TLS 1.3 required. Monitoring agent updated.','Sarah Chen', now() - interval '21 days',
 '{"name":"grid-analytics-enterprise-private","version":"4.2.0","boundary":{"allowed":["subscription","resource-group"]},"network":{"publicAccess":false,"privateEndpoints":true,"modes":["customer-hub","dedicated-spoke"]},"identity":{"managedIdentity":true},"observability":{"diagnosticsRequired":true,"customerWorkspaceSupported":true},"modules":[{"name":"resource-group","version":"2.0"},{"name":"network-spoke","version":"3.1"},{"name":"key-vault","version":"3.0"},{"name":"aks","version":"5.2"},{"name":"postgres","version":"4.0","settings":{"highAvailability":"zone-redundant","publicAccess":false}},{"name":"event-hubs","version":"2.4"},{"name":"storage","version":"3.5"},{"name":"monitoring","version":"4.2"},{"name":"security-baseline","version":"6.0"}]}'::jsonb),
('44444444-4444-4444-4444-444444444452','33333333-3333-3333-3333-333333333334','4.2.0','published','Regulated profile aligned to Enterprise Private 4.2 with CMK and 730-day retention.','Sarah Chen', now() - interval '20 days',
 '{"name":"grid-analytics-regulated","version":"4.2.0","security":{"customerManagedKeys":true,"defender":true,"retentionDays":730},"modules":[{"name":"resource-group","version":"2.0"},{"name":"network-spoke","version":"3.1"},{"name":"key-vault","version":"3.0"},{"name":"aks","version":"5.2"},{"name":"postgres","version":"4.0"},{"name":"event-hubs","version":"2.4"},{"name":"storage","version":"3.5"},{"name":"monitoring","version":"4.2"},{"name":"security-baseline","version":"6.0"},{"name":"defender","version":"2.1"}]}'::jsonb),
('44444444-4444-4444-4444-444444444462','33333333-3333-3333-3333-333333333332','4.2.0','published','Customer Hosted aligned to 4.2 module set.','Sarah Chen', now() - interval '19 days',
 '{"name":"grid-analytics-customer-hosted","version":"4.2.0","modules":[{"name":"resource-group","version":"2.0"},{"name":"network-spoke","version":"3.1"},{"name":"aks","version":"5.2"},{"name":"postgres","version":"4.0"},{"name":"monitoring","version":"4.2"}]}'::jsonb),
('44444444-4444-4444-4444-444444444472','33333333-3333-3333-3333-333333333331','4.2.0','published','SaaS Connected connector footprint 4.2.','Sarah Chen', now() - interval '19 days',
 '{"name":"grid-analytics-saas-connected","version":"4.2.0","modules":[{"name":"resource-group","version":"2.0"},{"name":"key-vault","version":"3.0"},{"name":"private-endpoint","version":"3.5"},{"name":"monitoring","version":"4.2"}]}'::jsonb),
('44444444-4444-4444-4444-444444444482','33333333-3333-3333-3333-333333333335','4.2.0','published','Sandbox profile 4.2.','Sarah Chen', now() - interval '19 days',
 '{"name":"grid-analytics-sandbox","version":"4.2.0","modules":[{"name":"resource-group","version":"2.0"},{"name":"aks","version":"5.2"},{"name":"postgres","version":"4.0"}]}'::jsonb),
('44444444-4444-4444-4444-444444444443','33333333-3333-3333-3333-333333333333','4.3.0','draft','Draft: AVM module refresh, Postgres 16 default, Defender CSPM plan update.','Sarah Chen', null,
 '{"name":"grid-analytics-enterprise-private","version":"4.3.0","modules":[{"name":"postgres","version":"4.1"},{"name":"aks","version":"5.4"},{"name":"security-baseline","version":"6.1"}]}'::jsonb);

insert into public.infrastructure_modules (organization_id, name, module_type, provider, source, version) values
('11111111-1111-1111-1111-111111111111','resource-group','resource_group','bicep','br:mcr.microsoft.com/bicep/avm/res/resources/resource-group','2.0'),
('11111111-1111-1111-1111-111111111111','network-spoke','network','bicep','br:mcr.microsoft.com/bicep/avm/res/network/virtual-network','3.1'),
('11111111-1111-1111-1111-111111111111','key-vault','key_vault','bicep','br:mcr.microsoft.com/bicep/avm/res/key-vault/vault','3.0'),
('11111111-1111-1111-1111-111111111111','aks','aks','bicep','br:mcr.microsoft.com/bicep/avm/res/container-service/managed-cluster','5.2'),
('11111111-1111-1111-1111-111111111111','postgres','postgres','bicep','br:mcr.microsoft.com/bicep/avm/res/db-for-postgre-sql/flexible-server','4.0'),
('11111111-1111-1111-1111-111111111111','event-hubs','event_hubs','bicep','br:mcr.microsoft.com/bicep/avm/res/event-hub/namespace','2.4'),
('11111111-1111-1111-1111-111111111111','storage','storage','bicep','br:mcr.microsoft.com/bicep/avm/res/storage/storage-account','3.5'),
('11111111-1111-1111-1111-111111111111','monitoring','monitoring','bicep','br:mcr.microsoft.com/bicep/avm/res/operational-insights/workspace','4.2'),
('11111111-1111-1111-1111-111111111111','private-endpoints','private_endpoint','bicep','br:mcr.microsoft.com/bicep/avm/res/network/private-endpoint','3.5'),
('11111111-1111-1111-1111-111111111111','security-baseline','policy','terraform','registry.terraform.io/Azure/security-baseline/azurerm','6.0'),
('11111111-1111-1111-1111-111111111111','defender','defender','terraform','registry.terraform.io/Azure/defender/azurerm','2.1'),
('11111111-1111-1111-1111-111111111111','budget','budget','bicep','br:mcr.microsoft.com/bicep/avm/res/consumption/budget','1.4');

insert into public.policy_packs (id, organization_id, name, version, description, policy_manifest_json) values
('55555555-5555-5555-5555-555555555551','11111111-1111-1111-1111-111111111111','Microsoft recommended baseline','2.4','Azure Landing Zone recommended policy assignments.','{"assignments":18}'::jsonb),
('55555555-5555-5555-5555-555555555552','11111111-1111-1111-1111-111111111111','GridWorks ISV security baseline','6.0','ISV product security controls required by every offering.','{"assignments":12}'::jsonb),
('55555555-5555-5555-5555-555555555553','11111111-1111-1111-1111-111111111111','Enterprise private baseline','3.2','Private networking and private endpoint enforcement.','{"assignments":9}'::jsonb),
('55555555-5555-5555-5555-555555555554','11111111-1111-1111-1111-111111111111','Utility critical infrastructure baseline','1.6','Additional controls for regulated utility workloads.','{"assignments":14}'::jsonb);

-- 24 customers
insert into public.customers (organization_id, name, customer_code, tenant_id, industry, azure_model) values
('11111111-1111-1111-1111-111111111111','Metro Energy','metro-energy','8f21ba01-1a55-4d3f-9c18-2b1f0a4e7c11','Electric Utility','existing_enterprise_alz'),
('11111111-1111-1111-1111-111111111111','NorthGrid','north-grid','1c92ee02-2b66-4e4f-8d29-3c2f1b5f8d22','Transmission','existing_enterprise_alz'),
('11111111-1111-1111-1111-111111111111','Coastal Power','coastal-power','2da03f03-3c77-4f5f-7e3a-4d3f2c6a9e33','Generation','existing_enterprise_alz'),
('11111111-1111-1111-1111-111111111111','Cascade Utilities','cascade-utilities','3eb14004-4d88-405f-6f4b-5e403d7b0f44','Electric Utility','existing_enterprise_alz'),
('11111111-1111-1111-1111-111111111111','Prairie Electric','prairie-electric','4fc25105-5e99-416f-5a5c-6f514e8c1055','Cooperative','greenfield'),
('11111111-1111-1111-1111-111111111111','Summit Power & Light','summit-power','50d36206-6faa-427f-4b6d-70625f9d2166','Electric Utility','existing_enterprise_alz'),
('11111111-1111-1111-1111-111111111111','Harbor Municipal Utility','harbor-municipal','61e47307-70bb-438f-3c7e-81736aae3277','Municipal','greenfield'),
('11111111-1111-1111-1111-111111111111','Ironwood Energy','ironwood-energy','72f58408-81cc-449f-2d8f-92847bbf4388','Generation','existing_enterprise_alz'),
('11111111-1111-1111-1111-111111111111','Redstone Cooperative','redstone-coop','83069509-92dd-45af-1e90-a3958ccf5499','Cooperative','existing_enterprise_alz'),
('11111111-1111-1111-1111-111111111111','Valley Grid Services','valley-grid','9417a60a-a3ee-46bf-0fa1-b4a69dd0650a','Grid Services','existing_enterprise_alz'),
('11111111-1111-1111-1111-111111111111','Lakeshore Energy','lakeshore-energy','a528b70b-b4ff-47cf-10b2-c5b70ae1761b','Electric Utility','existing_enterprise_alz'),
('11111111-1111-1111-1111-111111111111','Copper Ridge Power','copper-ridge','b639c80c-c500-48df-21c3-d6c81bf2872c','Generation','existing_enterprise_alz'),
('11111111-1111-1111-1111-111111111111','Silver Creek Utility','silver-creek','c74ad90d-d611-49ef-32d4-e7d92c038a3d','Municipal','existing_enterprise_alz'),
('11111111-1111-1111-1111-111111111111','Western Interconnect','western-interconnect','d85bea0e-e722-4aff-43e5-f8ea3d149b4e','Transmission','existing_enterprise_alz'),
('11111111-1111-1111-1111-111111111111','Bluewater Power','bluewater-power','e96cfb0f-f833-4b0f-54f6-09fb4e25ac5f','Electric Utility','existing_enterprise_alz'),
('11111111-1111-1111-1111-111111111111','Granite State Energy','granite-state','fa7d0c10-0944-4c1f-65a7-1a0c5f36bd60','Electric Utility','greenfield'),
('11111111-1111-1111-1111-111111111111','Desert Sun Electric','desert-sun','0b8e1d11-1a55-4d2f-76b8-2b1d6047ce71','Renewables','existing_enterprise_alz'),
('11111111-1111-1111-1111-111111111111','Pinecrest Utilities','pinecrest-utilities','1c9f2e12-2b66-4e3f-87c9-3c2e7158df82','Cooperative','existing_enterprise_alz'),
('11111111-1111-1111-1111-111111111111','Riverbend Power','riverbend-power','2da03f13-3c77-4f4f-98da-4d3f8269e093','Generation','existing_enterprise_alz'),
('11111111-1111-1111-1111-111111111111','Highline Grid','highline-grid','3eb14014-4d88-4050-a9eb-5e40937af0a4','Transmission','existing_enterprise_alz'),
('11111111-1111-1111-1111-111111111111','Meridian Energy Group','meridian-energy','4fc25115-5e99-4161-baf0-6f51a48b01b5','Holding Company','existing_enterprise_alz'),
('11111111-1111-1111-1111-111111111111','Stonebridge Electric','stonebridge-electric','50d36216-6faa-4272-cb01-7062b59c12c6','Electric Utility','existing_enterprise_alz'),
('11111111-1111-1111-1111-111111111111','Orchard Valley Co-op','orchard-valley','61e47317-70bb-4383-dc12-8173c6ad23d7','Cooperative','existing_enterprise_alz'),
('11111111-1111-1111-1111-111111111111','Tidewater Utilities','tidewater-utilities','72f58418-81cc-4494-ed23-9284d7be34e8','Municipal','existing_enterprise_alz');

-- connections
insert into public.customer_connections (customer_id, connection_type, tenant_id, subscription_id, management_group_id, credential_reference, status, last_validated_at, metadata_json)
select c.id,
  case when c.azure_model = 'greenfield' then 'new_subscription'::public.connection_type else 'existing_subscription'::public.connection_type end,
  c.tenant_id,
  'sub-' || c.customer_code,
  case when c.azure_model = 'greenfield' then 'mg-gridworks-vending' else 'mg-' || c.customer_code || '-corp' end,
  'kv://gridworks-platform-kv/secrets/oidc-' || c.customer_code,
  'validated', now() - interval '2 days',
  jsonb_build_object('federatedIdentity', true, 'lighthouse', c.azure_model = 'existing_enterprise_alz')
from public.customers c;

-- environments: PROD for everyone, plus DEV/TEST for the first 8 customers
with ranked as (
  select c.id, c.customer_code, row_number() over (order by c.created_at, c.name) as rn from public.customers c
)
insert into public.environments (customer_id, offering_id, desired_offering_version_id, actual_offering_version_id, name, environment_type, region, secondary_region, status, compliance_score, monthly_cost_estimate, configuration_json)
select r.id,
  (case when r.rn % 8 = 3 then '33333333-3333-3333-3333-333333333334' when r.rn % 8 = 5 then '33333333-3333-3333-3333-333333333332' else '33333333-3333-3333-3333-333333333333' end)::uuid,
  (case when r.rn % 8 = 3 then '44444444-4444-4444-4444-444444444452' when r.rn % 8 = 5 then '44444444-4444-4444-4444-444444444462' else '44444444-4444-4444-4444-444444444442' end)::uuid,
  (case
    when r.rn in (3,13) then '44444444-4444-4444-4444-444444444439'
    when r.rn in (2,7,11,19) then '44444444-4444-4444-4444-444444444441'
    when r.rn % 8 = 3 then '44444444-4444-4444-4444-444444444452'
    when r.rn % 8 = 5 then '44444444-4444-4444-4444-444444444462'
    else '44444444-4444-4444-4444-444444444442' end)::uuid,
  'PROD','production',
  case when r.rn % 2 = 0 then 'eastus2' else 'centralus' end,
  case when r.rn % 2 = 0 then 'centralus' else 'eastus2' end,
  case when r.rn in (3,13) then 'attention_required' else 'healthy' end,
  case when r.rn = 3 then 91 when r.rn = 13 then 94 when r.rn in (2,7,11,19) then 98 else 100 end,
  case when r.rn % 8 = 3 then 21400 when r.rn % 8 = 5 then 7600 else 14380 end,
  jsonb_build_object('network', jsonb_build_object('mode','existing-customer-hub','privateEndpoints',true,'publicAccess',false),
                     'observability', jsonb_build_object('useCustomerWorkspace', true))
from ranked r;

with ranked as (
  select c.id, row_number() over (order by c.created_at, c.name) as rn from public.customers c
)
insert into public.environments (customer_id, offering_id, desired_offering_version_id, actual_offering_version_id, name, environment_type, region, status, compliance_score, monthly_cost_estimate)
select r.id, '33333333-3333-3333-3333-333333333335'::uuid,'44444444-4444-4444-4444-444444444482'::uuid,'44444444-4444-4444-4444-444444444482'::uuid, e.n, e.t::public.environment_type,'eastus2','healthy',100, 1200
from ranked r cross join (values ('DEV','development'),('TEST','test')) as e(n,t)
where r.rn <= 8;

-- compliance checks for every environment
insert into public.compliance_checks (environment_id, policy_pack_id, control_name, control_key, result, evidence_json)
select e.id, '55555555-5555-5555-5555-555555555552'::uuid, c.name, c.key,
  case when e.compliance_score < 100 and c.key = 'required_tags' then 'FAIL'
       when e.compliance_score < 95 and c.key = 'required_diagnostics' then 'FAIL'
       else 'PASS' end,
  jsonb_build_object('checkedAt', now(), 'scope', 'sub-' || e.id)
from public.environments e
cross join (values
  ('Private PostgreSQL access','private_postgres'),
  ('Storage public access disabled','storage_public_access'),
  ('Required diagnostic settings','required_diagnostics'),
  ('Defender for Cloud enabled','defender_enabled'),
  ('Approved region','approved_region'),
  ('Required tags','required_tags'),
  ('TLS 1.2 minimum','tls_minimum'),
  ('Customer-managed keys','cmk')
) as c(name,key);

-- deployment history: initial deployment for each production environment
insert into public.deployments (environment_id, deployment_type, desired_version, status, mode, requested_by, requested_at, started_at, completed_at, plan_json, result_json)
select e.id, 'initial', ov.version, 'SUCCEEDED', 'demo', 'Mike Alvarez',
  now() - (interval '1 day' * (30 + random()*200)), now() - (interval '1 day' * (30 + random()*200)), now() - (interval '1 day' * (29 + random()*200)),
  jsonb_build_object('create', 14, 'useExisting', 3, 'policy', 12, 'rbac', 4),
  jsonb_build_object('outcome','succeeded')
from public.environments e join public.offering_versions ov on ov.id = e.actual_offering_version_id
where e.environment_type = 'production';

-- steps for those deployments
insert into public.deployment_steps (deployment_id, sequence, name, module_name, status, started_at, completed_at, log_text)
select d.id, s.seq, s.name, s.module, 'succeeded', d.started_at, d.completed_at,
  s.name || ' completed successfully. (demo mode: no Azure calls made)'
from public.deployments d
cross join (values
  (1,'Resource Group','resource-group'),
  (2,'Network integration','network-spoke'),
  (3,'Key Vault','key-vault'),
  (4,'PostgreSQL','postgres'),
  (5,'AKS','aks'),
  (6,'Event Hubs','event-hubs'),
  (7,'Monitoring','monitoring'),
  (8,'Policy validation','security-baseline')
) as s(seq,name,module);

-- one failed deployment (Coastal Power upgrade attempt)
with env as (
  select e.id from public.environments e join public.customers c on c.id = e.customer_id
  where c.customer_code = 'coastal-power' and e.environment_type = 'production' limit 1
), dep as (
  insert into public.deployments (environment_id, deployment_type, desired_version, previous_version, status, mode, requested_by, requested_at, started_at, completed_at, result_json)
  select env.id, 'upgrade','4.2.0','3.9.0','FAILED','demo','Mike Alvarez', now() - interval '6 days', now() - interval '6 days', now() - interval '6 days' + interval '22 minutes',
    jsonb_build_object('outcome','failed','failedStep','PostgreSQL','message','Azure Policy denied deployment: public network access must be disabled on Microsoft.DBforPostgreSQL/flexibleServers')
  from env returning id
)
insert into public.deployment_steps (deployment_id, sequence, name, module_name, status, started_at, completed_at, log_text, error_json)
select dep.id, s.seq, s.name, s.module, s.st::public.step_status, now() - interval '6 days', now() - interval '6 days' + interval '10 minutes', s.log,
  case when s.st = 'failed' then jsonb_build_object('code','RequestDisallowedByPolicy','target','postgres') else null end
from dep cross join (values
  (1,'Resource Group','resource-group','succeeded','Resource group ready.'),
  (2,'Network integration','network-spoke','succeeded','Spoke peered to customer hub.'),
  (3,'Key Vault','key-vault','succeeded','Key Vault deployed with private endpoint.'),
  (4,'PostgreSQL','postgres','failed','RequestDisallowedByPolicy: public network access must be disabled.'),
  (5,'AKS','aks','skipped','Skipped after upstream failure.'),
  (6,'Event Hubs','event-hubs','skipped','Skipped after upstream failure.'),
  (7,'Monitoring','monitoring','skipped','Skipped after upstream failure.'),
  (8,'Policy validation','security-baseline','skipped','Skipped after upstream failure.')
) as s(seq,name,module,st,log);

-- one pending production approval (NorthGrid upgrade 4.1 -> 4.2)
with env as (
  select e.id from public.environments e join public.customers c on c.id = e.customer_id
  where c.customer_code = 'north-grid' and e.environment_type = 'production' limit 1
), dep as (
  insert into public.deployments (environment_id, deployment_type, desired_version, previous_version, status, mode, requested_by, requested_at, plan_json, preflight_json)
  select env.id,'upgrade','4.2.0','4.1.0','AWAITING_APPROVAL','demo','Mike Alvarez', now() - interval '4 hours',
    jsonb_build_object(
      'create', jsonb_build_array('PostgreSQL Flexible Server (module 4.0)','Private Endpoint','Event Hub Namespace'),
      'useExisting', jsonb_build_array('Virtual Network','Log Analytics Workspace','Private DNS Resolver'),
      'policyAssignments', 12, 'roleAssignments', 4,
      'estimatedMonthlyCost', jsonb_build_object('low',14200,'high',17900),
      'warnings', 2, 'blockers', 0),
    jsonb_build_object('pass',17,'warning',2,'blocking',0)
  from env returning id
)
insert into public.approvals (deployment_id, approval_type, requested_from, status, requested_at)
select dep.id, 'production_deployment','Security Approver','pending', now() - interval '4 hours' from dep;

-- drift findings
insert into public.drift_findings (environment_id, resource_id, category, expected_json, actual_json, severity, recommended_remediation, detected_at)
select e.id, '/subscriptions/sub-north-grid/resourceGroups/rg-grid-prod/providers/Microsoft.DBforPostgreSQL/flexibleServers/pg-grid-prod','network',
  '{"publicNetworkAccess":"Disabled"}'::jsonb,'{"publicNetworkAccess":"Enabled"}'::jsonb,'high',
  'Re-apply network-spoke@3.1 and postgres@4.0 to disable public network access.', now() - interval '2 days'
from public.environments e join public.customers c on c.id = e.customer_id
where c.customer_code = 'north-grid' and e.environment_type = 'production';

insert into public.drift_findings (environment_id, resource_id, category, expected_json, actual_json, severity, recommended_remediation, detected_at)
select e.id, '/subscriptions/sub-coastal-power/resourceGroups/rg-grid-prod/providers/Microsoft.Storage/storageAccounts/stgridprod','observability',
  '{"diagnosticSettings":["send-to-customer-law"]}'::jsonb,'{"diagnosticSettings":[]}'::jsonb,'medium',
  'Re-apply monitoring@4.2 to restore required diagnostic settings.', now() - interval '5 days'
from public.environments e join public.customers c on c.id = e.customer_id
where c.customer_code = 'coastal-power' and e.environment_type = 'production';

-- audit trail
insert into public.audit_events (organization_id, customer_id, environment_id, actor_name, event_type, resource_type, resource_id, metadata_json, timestamp)
values
('11111111-1111-1111-1111-111111111111',null,null,'Sarah Chen','offering_version.published','offering_version','4.2.0','{"offering":"Enterprise Private"}'::jsonb, now() - interval '21 days'),
('11111111-1111-1111-1111-111111111111',null,null,'Sarah Chen','policy_pack.published','policy_pack','GridWorks ISV security baseline 6.0','{}'::jsonb, now() - interval '21 days');

insert into public.audit_events (organization_id, customer_id, environment_id, actor_name, event_type, resource_type, resource_id, metadata_json, timestamp)
select '11111111-1111-1111-1111-111111111111'::uuid, c.id, e.id, 'Mike Alvarez','deployment.plan_generated','deployment', d.correlation_id,
  jsonb_build_object('customer', c.name, 'environment', e.name), d.requested_at
from public.deployments d
join public.environments e on e.id = d.environment_id
join public.customers c on c.id = e.customer_id;
