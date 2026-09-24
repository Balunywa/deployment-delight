import { queryOptions } from "@tanstack/react-query";

import {
  getCustomer,
  getDeployment,
  getOrganization,
  listAudit,
  listCompliance,
  listCustomers,
  listDeployments,
  listDrift,
  listEstate,
  listModules,
  listOfferings,
  listPolicyPacks,
  listProducts,
  listWaves,
} from "@/lib/data.functions";

export const organizationQuery = queryOptions({
  queryKey: ["organization"],
  queryFn: () => getOrganization(),
});
export const productsQuery = queryOptions({
  queryKey: ["products"],
  queryFn: () => listProducts(),
});
export const offeringsQuery = queryOptions({
  queryKey: ["offerings"],
  queryFn: () => listOfferings(),
});
export const modulesQuery = queryOptions({ queryKey: ["modules"], queryFn: () => listModules() });
export const policyPacksQuery = queryOptions({
  queryKey: ["policy-packs"],
  queryFn: () => listPolicyPacks(),
});
export const estateQuery = queryOptions({ queryKey: ["estate"], queryFn: () => listEstate() });
export const customersQuery = queryOptions({
  queryKey: ["customers"],
  queryFn: () => listCustomers(),
});
export const customerQuery = (customerId: string) =>
  queryOptions({
    queryKey: ["customer", customerId],
    queryFn: () => getCustomer({ data: { customerId } }),
  });
export const deploymentsQuery = queryOptions({
  queryKey: ["deployments"],
  queryFn: () => listDeployments(),
});
export const deploymentQuery = (deploymentId: string) =>
  queryOptions({
    queryKey: ["deployment", deploymentId],
    queryFn: () => getDeployment({ data: { deploymentId } }),
  });
export const complianceQuery = queryOptions({
  queryKey: ["compliance"],
  queryFn: () => listCompliance(),
});
export const driftQuery = queryOptions({ queryKey: ["drift"], queryFn: () => listDrift() });
export const auditQuery = queryOptions({ queryKey: ["audit"], queryFn: () => listAudit() });
export const wavesQuery = queryOptions({ queryKey: ["waves"], queryFn: () => listWaves() });
