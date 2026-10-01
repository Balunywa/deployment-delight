-- GridWorks demo dataset. Applied by `npm run db:seed` on an empty database.
-- ============ SEED: GridWorks demo dataset ============
insert into public.organizations (id, name, slug, portal_title, support_url, primary_color, secondary_color)
values ('11111111-1111-1111-1111-111111111111','GridWorks','gridworks','GridWorks Cloud Deployment Portal','https://support.gridworks.example','oklch(0.55 0.15 250)','oklch(0.45 0.09 230)');

-- The solution catalog is real Microsoft energy solutions (0005_product_catalog.sql). Customers start with
-- no installs: onboarding a customer onto a published solution creates them.

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

-- Most utilities have no Azure of their own: GridWorks hosts a dedicated environment for them in its own tenant.
update public.customers set azure_model = 'isv_hosted'
where customer_code in ('bluewater-power','copper-ridge','granite-state','highline-grid','ironwood-energy',
  'lakeshore-energy','orchard-valley','pinecrest-utilities','prairie-electric','redstone-coop','riverbend-power',
  'stonebridge-electric','tidewater-utilities');

update public.customer_connections k set
  connection_type = 'new_subscription',
  tenant_id = '11111111-aaaa-4bbb-8ccc-gridworks000',
  subscription_id = 'sub-gridworks-hosted-' || c.customer_code,
  management_group_id = 'mg-gridworks-hosted',
  credential_reference = 'managed-identity://gridworks-delivery',
  metadata_json = jsonb_build_object('hostedBy', 'isv', 'federatedIdentity', false)
from public.customers c
where c.id = k.customer_id and c.azure_model = 'isv_hosted';

-- audit trail
insert into public.audit_events (organization_id, customer_id, environment_id, actor_name, event_type, resource_type, resource_id, metadata_json, timestamp)
values
('11111111-1111-1111-1111-111111111111',null,null,'Sarah Chen','policy_pack.published','policy_pack','GridWorks ISV security baseline 6.0','{}'::jsonb, now() - interval '21 days');
