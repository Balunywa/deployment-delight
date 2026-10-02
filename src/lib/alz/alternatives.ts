/* Design alternatives worth comparing side by side: each flips one decision that changes how traffic flows. */
import { type Answers, hasFirewall, hasHub, on } from "./engine";

export function alternativesFor(a: Answers): { id: string; label: string; answers: Answers }[] {
  const out: { id: string; label: string; answers: Answers }[] = [];
  if (hasHub(a))
    out.push(
      hasFirewall(a)
        ? {
            id: "no-firewall",
            label: "Without Azure Firewall",
            answers: { ...a, firewall: "none" },
          }
        : {
            id: "firewall",
            label: "With Azure Firewall Standard",
            answers: { ...a, firewall: "Standard" },
          },
    );
  if (a.connectivity === "hub_and_spoke")
    out.push({
      id: "vwan",
      label: "As Virtual WAN",
      answers: { ...a, connectivity: "virtual_wan" },
    });
  if (a.connectivity === "virtual_wan")
    out.push({
      id: "hub",
      label: "As hub and spoke",
      answers: { ...a, connectivity: "hub_and_spoke" },
    });
  if (hasHub(a) && !on(a.vpnGateway) && !on(a.expressRoute))
    out.push({ id: "vpn", label: "With a VPN gateway", answers: { ...a, vpnGateway: "yes" } });
  if (hasHub(a) && on(a.vpnGateway) && !on(a.expressRoute))
    out.push({
      id: "er",
      label: "With ExpressRoute instead of VPN",
      answers: { ...a, vpnGateway: "no", expressRoute: "yes" },
    });
  if (hasHub(a))
    out.push(
      a.privateDns === "platform"
        ? {
            id: "no-dns",
            label: "Without platform private DNS",
            answers: { ...a, privateDns: "none" },
          }
        : {
            id: "dns",
            label: "With platform private DNS",
            answers: { ...a, privateDns: "platform" },
          },
    );
  return out;
}
