/*
 * What the MSX connector returns for a TPID, and how the browser talks to it. The connector runs on the SE's own PC
 * (public/msx-connector.mjs, beside msx-mcp), so MSX is read as that person; Cloud Delivery's server never sees MSX
 * credentials. What's kept is a short snapshot of the account and its open opportunities, as customer context.
 */
export const CONNECTOR = "http://127.0.0.1:47615";

export type MsxOpportunity = {
  id: string;
  number: string | null;
  name: string;
  stage: string | null;
  solutionArea: string | null;
  salesPlay: string | null;
  closeDate: string | null;
  createdOn: string | null;
  owner: string | null;
  account: string | null;
  description: string | null;
  forecastComments: string | null;
  /** Consumption, Billed… (MSX opportunity type). */
  type?: string | null | undefined;
  /** The Microsoft team that owns it: ATU (account), STU (specialists), CSU (customer success), Other. */
  ownerTeam?: string | null | undefined;
  modifiedOn?: string | null | undefined;
};

/** A milestone on an open opportunity: what the account team is driving, for which workload, and how it's going. */
export type MsxMilestone = {
  id: string;
  number: string | null;
  name: string;
  opportunityId: string | null;
  workload: string | null;
  /** On Track, At Risk, Blocked or Completed. */
  status: string | null;
  /** POC/Pilot, Production, Optimization… */
  category: string | null;
  /** Committed or Uncommitted. */
  commitment: string | null;
  date: string | null;
  owner: string | null;
  ownerTeam: string | null;
  modifiedOn: string | null;
};

export type MsxContact = { name: string; title: string | null };
export type MsxPartner = {
  opportunityId: string | null;
  partner: string | null;
  type: string | null;
  status: string | null;
};

export type MsxSnapshot = {
  tpid: string;
  fetchedAt: string;
  account: {
    id: string;
    name: string;
    industry?: string | null | undefined;
    segment?: string | null | undefined;
    country?: string | null | undefined;
  } | null;
  accounts: number | null;
  /** The Microsoft account team on the top-parent account, when MSX shows it; null when it couldn't be read. */
  team?: { name: string; role: string | null }[] | null | undefined;
  opportunities: MsxOpportunity[];
  /** Absent in snapshots taken before these were read; null when MSX didn't let this person read them. */
  milestones?: MsxMilestone[] | null | undefined;
  contacts?: MsxContact[] | null | undefined;
  partners?: MsxPartner[] | null | undefined;
};

export type ConnectorStatus =
  { state: "off" } | { state: "ready" | "signed-out" | "error"; detail: string | null };

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${CONNECTOR}${path}`, { ...init, cache: "no-store" });
  const body = (await r.json().catch(() => ({}))) as T & { error?: string; code?: string };
  if (!r.ok)
    throw Object.assign(new Error(body.error ?? `MSX connector answered ${r.status}.`), {
      code: body.code ?? null,
    });
  return body;
}

export async function connectorStatus(): Promise<ConnectorStatus> {
  try {
    const s = await call<{ msx: "ready" | "signed-out" | "error"; detail: string | null }>(
      "/status",
    );
    return { state: s.msx, detail: s.detail };
  } catch {
    return { state: "off" };
  }
}

export const connectorSignIn = () =>
  call<{ msx: string }>("/signin", { method: "POST", headers: { "x-cloud-delivery": "1" } });

export const msxCustomer = (tpid: string) =>
  call<MsxSnapshot>(`/customer?tpid=${encodeURIComponent(tpid)}`);

/** The ID an engagement is linked by: the opportunity number SEs recognise, or the record ID. */
export const opportunityKey = (o: MsxOpportunity) => o.number ?? o.id;

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : null);

/** A plain-text summary kept as the customer's MSX context. Only what MSX says; gaps are stated. */
export function snapshotText(s: MsxSnapshot) {
  const lines = [
    `MSX account: ${s.account?.name ?? "not found"} (TPID ${s.tpid})${
      s.accounts != null
        ? `, ${s.accounts} active account${s.accounts === 1 ? "" : "s"} under it`
        : ""
    }.`,
    s.opportunities.length
      ? `${s.opportunities.length} open opportunit${s.opportunities.length === 1 ? "y" : "ies"}:`
      : "No open opportunities.",
  ];
  if (s.team?.length)
    lines.splice(
      1,
      0,
      `Microsoft account team: ${s.team.map((m) => (m.role ? `${m.name} (${m.role})` : m.name)).join(", ")}.`,
    );
  for (const o of s.opportunities) {
    const facts = [
      o.number,
      o.stage,
      o.solutionArea,
      o.salesPlay,
      o.closeDate && `close ${day(o.closeDate)}`,
      o.owner && `owner ${o.owner}`,
    ].filter(Boolean);
    lines.push("", `- ${o.name} (${facts.join(" · ")})`);
    lines.push(o.description ? `  Description: ${o.description}` : "  MSX has no description.");
    if (o.forecastComments) lines.push(`  Forecast comments: ${o.forecastComments}`);
  }
  const open = (s.milestones ?? []).filter((m) => m.status !== "Completed");
  if (open.length) {
    lines.push("", `${open.length} open milestone${open.length === 1 ? "" : "s"}:`);
    for (const m of open.slice(0, 40))
      lines.push(
        `- ${m.name} (${[
          m.workload,
          m.status,
          m.category,
          m.commitment,
          m.date && day(m.date),
          m.owner,
        ]
          .filter(Boolean)
          .join(" · ")})`,
      );
  }
  if (s.partners?.length)
    lines.push(
      "",
      `Co-sell partners: ${[...new Set(s.partners.map((p) => p.partner).filter(Boolean))].join(", ")}.`,
    );
  if (s.contacts?.length)
    lines.push(
      "",
      `Customer contacts in MSX: ${s.contacts
        .slice(0, 20)
        .map((c) => (c.title ? `${c.name} (${c.title})` : c.name))
        .join("; ")}.`,
    );
  return lines.join("\n");
}
