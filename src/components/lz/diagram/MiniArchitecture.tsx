/*
 * The architecture standard in miniature, for side panels: the same rows (outside, Azure services, the hub,
 * landing zones, hybrid band, on-premises), boundaries and Azure icons as the full diagrams, live from the design.
 */
import { type Answers, LANDING_ZONE_LABEL, hasFirewall, hasHub, on } from "@/lib/alz/engine";

import { PALETTE, useDiagramTheme } from "./theme";

const W = 300;
const H = 318;

type Item = { id: string; label: string; icon: string; out?: boolean };

export function MiniArchitecture({ answers: a }: { answers: Answers }) {
  const [theme] = useDiagramTheme();
  const c = PALETTE[theme];
  const hub = hasHub(a);
  const wan = a.connectivity === "virtual_wan";
  const hubItems: Item[] = hub
    ? [
        ...(wan ? [{ id: "hub1", label: "Hub router", icon: "vwan-hub" }] : []),
        {
          id: "fw",
          label: hasFirewall(a) ? a.firewall : "Firewall",
          icon: "firewall",
          out: !hasFirewall(a),
        },
        {
          id: "gw",
          label: on(a.expressRoute) ? "ER gw" : "VPN gw",
          icon: on(a.expressRoute) ? "expressroute" : "vnet-gateway",
          out: !on(a.vpnGateway) && !on(a.expressRoute),
        },
        { id: "bas", label: "Bastion", icon: "bastion", out: !on(a.bastion) },
        { id: "dns", label: "DNS", icon: "dns-zones", out: a.privateDns !== "platform" },
      ]
    : [];
  const services: Item[] = [
    { id: "law", label: "Logs", icon: "log-analytics" },
    { id: "sen", label: "Sentinel", icon: "sentinel", out: a.siem !== "sentinel" },
    { id: "def", label: "Defender", icon: "defender", out: !on(a.defender) },
  ];
  const zones = a.landingZones.map((g) => LANDING_ZONE_LABEL[g]?.title ?? g);
  const gw = hub && (on(a.vpnGateway) || on(a.expressRoute));
  const row = (items: Item[], y: number, x0: number, x1: number) => {
    const step = items.length ? (x1 - x0) / items.length : 0;
    return items.map((it, i) => {
      const cx = x0 + step * (i + 0.5);
      return (
        <g key={it.id} opacity={it.out ? 0.35 : 1}>
          <rect
            x={cx - 24}
            y={y}
            width={48}
            height={40}
            rx={7}
            fill={c.node}
            stroke={c.nodeLine}
            strokeDasharray={it.out ? "3 2" : undefined}
          />
          <image href={`/azure-icons/${it.icon}.svg`} x={cx - 9} y={y + 4} width={18} height={18} />
          <text
            x={cx}
            y={y + 34}
            textAnchor="middle"
            fill={it.out ? c.muted : c.sub}
            fontSize={8.5}
          >
            {it.label}
          </text>
        </g>
      );
    });
  };
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="This design at a glance"
      className="block h-auto w-full rounded-lg"
      style={{ background: c.bg }}
    >
      <rect x={10} y={8} width={70} height={26} rx={6} fill={c.node} stroke={c.nodeLine} />
      <image href="/azure-icons/public-ip.svg" x={15} y={13} width={16} height={16} />
      <text x={35} y={25} fill={c.text} fontSize={9.5} fontWeight={600}>
        Internet
      </text>
      <rect x={8} y={44} width={W - 16} height={196} rx={14} fill={c.azure} stroke={c.azureLine} />
      <text x={W - 16} y={58} textAnchor="end" fill={c.text} fontSize={9} fontWeight={700}>
        Microsoft Azure
      </text>
      {row(services, 64, 20, W - 20)}
      {hub ? (
        <>
          <rect
            x={16}
            y={112}
            width={W - 32}
            height={56}
            rx={9}
            fill={c.zone}
            stroke={c.zoneLine}
            strokeDasharray="5 4"
          />
          <text x={W - 22} y={124} textAnchor="end" fill={c.sub} fontSize={8}>
            {wan ? "Virtual hub" : "Hub"} · {a.hubAddressSpace}
          </text>
          {row(hubItems, 126, 20, W - 20)}
        </>
      ) : (
        <text x={W / 2} y={145} textAnchor="middle" fill={c.muted} fontSize={9.5}>
          No central network
        </text>
      )}
      <rect x={16} y={176} width={W - 32} height={56} rx={9} fill={c.zone} stroke={c.zoneLine} />
      <text x={W - 22} y={188} textAnchor="end" fill={c.sub} fontSize={8}>
        Landing zones
      </text>
      {zones.map((z, i) => {
        const w = (W - 48) / Math.max(zones.length, 1) - 6;
        const x = 24 + i * (w + 6);
        return (
          <g key={z}>
            <rect x={x} y={194} width={w} height={30} rx={6} fill={c.node} stroke={c.nodeLine} />
            <image href="/azure-icons/subscription.svg" x={x + 5} y={201} width={14} height={14} />
            <text x={x + 23} y={212} fill={c.text} fontSize={9} fontWeight={600}>
              {z}
            </text>
          </g>
        );
      })}
      {hub && hasFirewall(a) && a.landingZones.includes("corp") && (
        <path
          d={`M 45 ${34} L 45 100 L 72 100 L 72 126`}
          fill="none"
          stroke="#ef4444"
          strokeWidth={1.4}
          strokeDasharray="4 3"
        />
      )}
      <rect
        x={8}
        y={250}
        width={W - 16}
        height={22}
        rx={6}
        fill={gw ? c.band : "none"}
        stroke={gw ? c.zoneLine : c.muted}
        strokeDasharray={gw ? undefined : "4 3"}
      />
      <text x={16} y={265} fill={gw ? c.text : c.muted} fontSize={9}>
        {gw
          ? [on(a.expressRoute) && "ExpressRoute", on(a.vpnGateway) && "Site-to-site VPN"]
              .filter(Boolean)
              .join(" · ")
          : "No hybrid connection"}
      </text>
      <rect
        x={8}
        y={280}
        width={W - 16}
        height={30}
        rx={8}
        fill="none"
        stroke="#3b82f6"
        strokeOpacity={0.6}
      />
      <image href="/azure-icons/on-premises.svg" x={16} y={287} width={16} height={16} />
      <text x={38} y={299} fill="#60a5fa" fontSize={9}>
        On-premises · {a.onPremRanges.join(", ") || "no ranges"}
      </text>
    </svg>
  );
}
