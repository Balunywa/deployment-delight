-- Landing zone designs use more of the designer: the greenfield customer gets a real hub with a firewall and a
-- site-to-site VPN to its control center, so its Corp install (PROD) has somewhere to connect.
update public.foundations
set answers = answers || '{"connectivity":"hub_and_spoke","firewall":"Standard","bastion":"yes","vpnGateway":"yes","expressRoute":"no","privateDns":"platform","identity":"no","logRetentionDays":90}'::jsonb
where mode = 'managed' and customer_id is not null and status = 'draft';

-- GridWorks' hosting tenant: every customer is internet-facing (Online), so no gateways; long log retention.
update public.foundations
set answers = answers || '{"firewall":"Standard","bastion":"yes","vpnGateway":"no","expressRoute":"no","identity":"no","logRetentionDays":180,"landingZones":["corp","online","sandbox"]}'::jsonb
where mode = 'managed' and customer_id is null;
