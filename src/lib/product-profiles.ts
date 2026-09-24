/*
 * Narrative for each product on the Products page: what it does, who owns it and the delivery agenda.
 * Demo content keyed by product name; offerings, installs and versions on the page come from live data.
 */
export type ProductProfile = {
  tagline: string;
  does: string;
  tags: string[];
  owner: { name: string; title: string; location: string; color: string };
  mandate: string;
  agenda: string;
  bio: string;
  /** Shown when the product has fewer than four offerings yet. */
  planned: { kind: string; title: string; body: string; note: string }[];
};

export const PRODUCT_PROFILES: Record<string, ProductProfile> = {
  "Grid Analytics Platform": {
    tagline: "Turn grid telemetry into decisions utilities can act on in real time.",
    does: "Grid Analytics ingests SCADA, AMI and DER telemetry into a streaming analytics platform — load forecasting, outage prediction and asset health for electric utilities, delivered into each utility's own Azure or hosted by GridWorks.",
    tags: [
      "Streaming ingestion",
      "Load forecasting",
      "Outage prediction",
      "Asset health",
      "NERC CIP-ready",
    ],
    owner: {
      name: "Maya Okafor",
      title: "VP Product, Grid Analytics",
      location: "Raleigh, NC",
      color: "#2f7c83",
    },
    mandate:
      "Every utility on the same release, onboarded in days — not a six-month Azure project.",
    agenda:
      "One product definition, deployed per customer through GitHub Actions — private networking, policy and upgrades built in.",
    bio: "Maya ran grid operations software at two investor-owned utilities before leading the platform. She owns the roadmap and the customer delivery model.",
    planned: [],
  },
  "Meter Data Platform": {
    tagline: "Validate, estimate and edit every meter read at AMI scale.",
    does: "Meter Data Platform ingests interval reads from AMI head-ends, runs validation, estimation and editing (VEE), and publishes billing-ready data to the utility's CIS and analytics.",
    tags: [
      "AMI head-end ingestion",
      "VEE",
      "Billing determinants",
      "Event streaming",
      "Data residency",
    ],
    owner: {
      name: "Daniel Reyes",
      title: "Director, Meter Data",
      location: "Austin, TX",
      color: "#c46a26",
    },
    mandate: "Move MDM customers off on-premises hardware refresh cycles and onto Azure.",
    agenda:
      "First offering: Customer Hosted in the utility's Azure, private endpoints only, sized per million meters.",
    bio: "Daniel led MDM implementations for more than 40 utilities. He is turning the on-premises product into offerings customers can onboard to without a services project.",
    planned: [
      {
        kind: "Customer hosted · new setup",
        title: "Customer Hosted MDM",
        body: "A dedicated spoke per utility with Event Hubs and PostgreSQL, sized per million meters.",
        note: "Architecture in review",
      },
      {
        kind: "Enterprise private · existing setup",
        title: "Enterprise Private MDM",
        body: "Plugs into the utility's hub, private DNS and Log Analytics — never replaces them.",
        note: "Planned for Q1",
      },
      {
        kind: "Hosted by GridWorks",
        title: "Hosted MDM",
        body: "Multi-region SaaS for co-ops and municipal utilities without their own Azure.",
        note: "Planned for Q2",
      },
      {
        kind: "Migration",
        title: "Read history migration",
        body: "Bulk import of historical interval reads from on-premises MDM into the new install.",
        note: "Runs once per customer",
      },
    ],
  },
  "Grid Edge Services": {
    tagline: "Run control workloads at the substation, managed from the cloud.",
    does: "Grid Edge orchestrates containerized DER and substation workloads on Azure Local and Arc-enabled Kubernetes, with fleet policy, updates and telemetry managed centrally.",
    tags: [
      "Azure Local",
      "Arc-enabled AKS",
      "DER orchestration",
      "OT segmentation",
      "Offline operation",
    ],
    owner: { name: "Priya Nair", title: "Head of Edge", location: "Denver, CO", color: "#8a5a2b" },
    mandate: "A new substation site is a configuration, not a field project.",
    agenda:
      "The Local landing zone for every utility; Arc policy and GitOps from the same delivery repository.",
    bio: "Priya built the substation automation stack at GridWorks. She owns edge hardware partnerships and the site rollout model.",
    planned: [
      {
        kind: "Local landing zone · Azure Local",
        title: "Substation edge kit",
        body: "A validated Azure Local cluster per site, placed under the utility's Local management group.",
        note: "Pilot with two utilities",
      },
      {
        kind: "Arc-enabled AKS",
        title: "DER orchestration",
        body: "Containerized DER management apps delivered to every site from one definition.",
        note: "Architecture in review",
      },
      {
        kind: "GitOps · Flux",
        title: "Edge fleet updates",
        body: "Ring-based updates across sites, with offline sites catching up when they reconnect.",
        note: "Planned for Q2",
      },
      {
        kind: "Telemetry",
        title: "OT telemetry bridge",
        body: "Secure one-way flow of substation telemetry into Grid Analytics.",
        note: "Planned for Q3",
      },
    ],
  },
};

export function profileFor(name: string, description: string | null): ProductProfile {
  return (
    PRODUCT_PROFILES[name] ?? {
      tagline: description ?? "",
      does: description ?? "",
      tags: [],
      owner: { name: "Product owner", title: "Not assigned", location: "", color: "#2f7c83" },
      mandate: "Define the product once; onboard every customer as configuration.",
      agenda: "Publish the first offering to start onboarding customers.",
      bio: "",
      planned: [],
    }
  );
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
