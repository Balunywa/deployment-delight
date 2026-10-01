/*
 * Business lines group the solution catalog the way an energy company is organised along its value chain. The
 * catalog itself is in the database (real solutions imported from their repositories; see
 * scripts/gen-energy-catalog.ts).
 */
export type BusinessLine = {
  id: string;
  name: string;
  tagline: string;
};

export const BUSINESS_LINES: BusinessLine[] = [
  {
    id: "upstream",
    name: "Upstream & Resources",
    tagline: "Discover, develop and responsibly operate advantaged oil, gas and mineral resources.",
  },
  {
    id: "midstream",
    name: "Gas, LNG & Midstream",
    tagline:
      "Connect production to markets through integrated gas, LNG and infrastructure positions.",
  },
  {
    id: "chemicals",
    name: "Products & Chemicals",
    tagline:
      "Manufacture and deliver fuels, materials and specialty products customers use every day.",
  },
  {
    id: "power",
    name: "Power & Renewables",
    tagline: "Grow reliable power and lower-carbon energy systems at industrial scale.",
  },
  {
    id: "operations-ai",
    name: "Operations & AI",
    tagline:
      "Agents and copilots for engineering, HSE and back-office work across the value chain.",
  },
  {
    id: "data-rti",
    name: "Data & Real-Time Intelligence",
    tagline: "Data foundations, live telemetry and analytics on Microsoft Fabric.",
  },
];

export const LINE_BY_NAME = new Map(BUSINESS_LINES.map((l) => [l.name, l]));

/** "Pipeline integrity agent · Enterprise Private" → "Enterprise Private". */
export const modelOf = (offeringName: string) => offeringName.split(" · ").at(-1) ?? offeringName;
export const productOf = (offeringName: string) =>
  offeringName.includes(" · ") ? offeringName.split(" · ")[0]! : "";
