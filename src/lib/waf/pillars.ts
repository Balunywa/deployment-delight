import type { Pillar } from "./types";

type PillarGuide = {
  pillar: Pillar;
  summary: string;
  principles: { title: string; body: string }[];
  tradeoffs: string[];
  checklist: { id: string; title: string; learn: string }[];
  learn: string;
};

const WAF = "https://learn.microsoft.com/azure/well-architected";

export const PILLAR_GUIDES: PillarGuide[] = [
  {
    pillar: "reliability",
    summary:
      "Reliability is the workload's ability to meet availability and recovery targets through simplicity, redundancy, tested recovery, and continuous health measurement.",
    principles: [
      {
        title: "Design for business targets",
        body: "Translate critical flows into availability, RTO, and RPO targets before choosing services or recovery patterns.",
      },
      {
        title: "Design for failure",
        body: "Assume component, dependency, zone, and regional failures; reduce blast radius and automate recovery where practical.",
      },
      {
        title: "Validate recovery",
        body: "Use tests, drills, and health models to prove that the design recovers within stated targets.",
      },
    ],
    tradeoffs: [
      "Higher redundancy improves availability but increases cost, operational complexity, and data consistency challenges.",
      "Simplicity can improve reliability, but may limit feature richness or advanced scale patterns.",
      "Aggressive recovery targets often require active/active designs and more automation.",
    ],
    checklist: [
      {
        id: "RE:01",
        title: "Focus your workload design on simplicity and efficiency.",
        learn: `${WAF}/reliability/simplify`,
      },
      {
        id: "RE:02",
        title: "Identify and rate user and system flows.",
        learn: `${WAF}/reliability/identify-flows`,
      },
      {
        id: "RE:03",
        title: "Use failure mode analysis (FMA) to identify potential failures in your workload.",
        learn: `${WAF}/reliability/failure-mode-analysis`,
      },
      {
        id: "RE:04",
        title: "Define reliability and recovery targets for your workload.",
        learn: `${WAF}/reliability/metrics`,
      },
      {
        id: "RE:05",
        title: "Add redundancy at different levels, especially for critical flows.",
        learn: `${WAF}/reliability/redundancy`,
      },
      {
        id: "RE:06",
        title:
          "Implement a timely and reliable scaling strategy at the application, data, and infrastructure levels.",
        learn: `${WAF}/reliability/scaling`,
      },
      {
        id: "RE:07",
        title:
          "Strengthen the resiliency of your workload by implementing self-preservation and self-healing measures.",
        learn: `${WAF}/reliability/self-preservation`,
      },
      {
        id: "RE:08",
        title:
          "Test for resiliency and availability scenarios by applying the principles of chaos engineering.",
        learn: `${WAF}/reliability/reliability-test`,
      },
      {
        id: "RE:09",
        title: "Implement structured, tested, and documented disaster recovery (DR) plans.",
        learn: `${WAF}/reliability/disaster-recovery`,
      },
      {
        id: "RE:10",
        title:
          "Continuously measure and track system health using uptime and reliability indicators.",
        learn: `${WAF}/reliability/monitoring`,
      },
    ],
    learn: `${WAF}/reliability/checklist`,
  },
  {
    pillar: "security",
    summary:
      "Security protects confidentiality, integrity, and availability through Zero Trust, segmentation, identity-first access, encryption, hardening, monitoring, and tested response.",
    principles: [
      {
        title: "Apply Zero Trust",
        body: "Verify explicitly, use least privilege, and assume breach across identities, networks, data, and operations.",
      },
      {
        title: "Protect data and secrets",
        body: "Classify data, encrypt appropriately, isolate access paths, and protect secrets with managed platforms.",
      },
      {
        title: "Continuously improve posture",
        body: "Use baselines, threat detection, secure development, testing, and incident response to sustain security.",
      },
    ],
    tradeoffs: [
      "More isolation can increase operational complexity and latency.",
      "Customer-managed encryption can improve control but adds rotation, availability, and access-management responsibilities.",
      "Security telemetry improves detection but can increase cost and privacy review needs.",
    ],
    checklist: [
      {
        id: "SE:01",
        title: "Establish a security baseline.",
        learn: `${WAF}/security/establish-baseline`,
      },
      {
        id: "SE:02",
        title:
          "Align secure development lifecycle (SDL) throughout the software development lifecycle.",
        learn: `${WAF}/security/secure-development-lifecycle`,
      },
      {
        id: "SE:03",
        title: "Classify and consistently apply sensitivity and information type labels.",
        learn: `${WAF}/security/data-classification`,
      },
      {
        id: "SE:04",
        title: "Create intentional segmentation and perimeters.",
        learn: `${WAF}/security/segmentation`,
      },
      {
        id: "SE:05",
        title: "Implement strict, conditional, and auditable identity and access management (IAM).",
        learn: `${WAF}/security/identity-access`,
      },
      {
        id: "SE:06",
        title: "Isolate, filter, and control network traffic.",
        learn: `${WAF}/security/networking`,
      },
      {
        id: "SE:07",
        title: "Encrypt data by using modern, industry-standard methods.",
        learn: `${WAF}/security/encryption`,
      },
      {
        id: "SE:08",
        title: "Harden all workload components.",
        learn: `${WAF}/security/harden-resources`,
      },
      {
        id: "SE:09",
        title: "Protect application secrets.",
        learn: `${WAF}/security/application-secrets`,
      },
      {
        id: "SE:10",
        title: "Implement a holistic monitoring strategy.",
        learn: `${WAF}/security/monitor-threats`,
      },
      {
        id: "SE:11",
        title: "Establish a comprehensive testing regimen.",
        learn: `${WAF}/security/test`,
      },
      {
        id: "SE:12",
        title: "Define and test effective incident response procedures.",
        learn: `${WAF}/security/incident-response`,
      },
    ],
    learn: `${WAF}/security/checklist`,
  },
  {
    pillar: "cost",
    summary:
      "Cost Optimization balances workload value, requirements, and spending through cost models, guardrails, data review, environment strategy, and continuous optimization.",
    principles: [
      {
        title: "Make cost visible",
        body: "Collect daily cost data, forecast trends, alert on deviations, and assign accountability.",
      },
      {
        title: "Align spend to value",
        body: "Prioritize production, critical flows, and requirements while using deliberate tradeoffs for non-production.",
      },
      {
        title: "Optimize continuously",
        body: "Review rates, tiers, scaling, data, code, and personnel effort as the workload evolves.",
      },
    ],
    tradeoffs: [
      "Reducing redundancy lowers cost but can weaken reliability and recovery.",
      "Lower tiers can be appropriate for non-production but may omit security, private access, or availability features.",
      "Aggressive telemetry and retention improve operations but can become a major cost driver.",
    ],
    checklist: [
      {
        id: "CO:01",
        title: "Create a culture of financial responsibility.",
        learn: `${WAF}/cost-optimization/create-culture-financial-responsibility`,
      },
      {
        id: "CO:02",
        title: "Create and maintain a cost model.",
        learn: `${WAF}/cost-optimization/cost-model`,
      },
      {
        id: "CO:03",
        title: "Collect and review cost data.",
        learn: `${WAF}/cost-optimization/collect-review-cost-data`,
      },
      {
        id: "CO:04",
        title: "Set spending guardrails.",
        learn: `${WAF}/cost-optimization/set-spending-guardrails`,
      },
      {
        id: "CO:05",
        title: "Get the best rates from providers.",
        learn: `${WAF}/cost-optimization/get-best-rates`,
      },
      {
        id: "CO:06",
        title: "Align usage to billing increments.",
        learn: `${WAF}/cost-optimization/align-usage-to-billing-increments`,
      },
      {
        id: "CO:07",
        title: "Optimize component costs.",
        learn: `${WAF}/cost-optimization/optimize-component-costs`,
      },
      {
        id: "CO:08",
        title: "Optimize environment costs.",
        learn: `${WAF}/cost-optimization/optimize-environment-costs`,
      },
      {
        id: "CO:09",
        title: "Optimize flow costs.",
        learn: `${WAF}/cost-optimization/optimize-flow-costs`,
      },
      {
        id: "CO:10",
        title: "Optimize data costs.",
        learn: `${WAF}/cost-optimization/optimize-data-costs`,
      },
      {
        id: "CO:11",
        title: "Optimize code costs.",
        learn: `${WAF}/cost-optimization/optimize-code-costs`,
      },
      {
        id: "CO:12",
        title: "Optimize scaling costs.",
        learn: `${WAF}/cost-optimization/optimize-scaling-costs`,
      },
      {
        id: "CO:13",
        title: "Optimize personnel time.",
        learn: `${WAF}/cost-optimization/optimize-personnel-time`,
      },
      {
        id: "CO:14",
        title: "Consolidate resources and responsibility.",
        learn: `${WAF}/cost-optimization/consolidation`,
      },
    ],
    learn: `${WAF}/cost-optimization/checklist`,
  },
  {
    pillar: "operations",
    summary:
      "Operational Excellence builds repeatable, reliable, and safe delivery through DevOps culture, standardized operations, IaC, observability, testing, automation, and safe deployments.",
    principles: [
      {
        title: "Standardize how teams work",
        body: "Define practices, roles, operations tasks, development processes, tools, and source-control patterns.",
      },
      {
        title: "Automate with quality gates",
        body: "Use IaC and workload supply chains that test, promote, and govern changes across environments.",
      },
      {
        title: "Learn from operations",
        body: "Use telemetry, incidents, and tests to improve the workload and operating model.",
      },
    ],
    tradeoffs: [
      "More gates and progressive exposure reduce deployment risk but can slow delivery.",
      "Automation reduces toil but needs the same security, reliability, and maintenance discipline as application code.",
      "Comprehensive observability improves response but adds cost and noise if signals are not curated.",
    ],
    checklist: [
      {
        id: "OE:01",
        title: "Define your standard practices to develop and operate your workload.",
        learn: `${WAF}/operational-excellence/devops-culture`,
      },
      {
        id: "OE:02",
        title:
          "Use standardization as a way to make routine, ad-hoc, and emergency operations consistent and predictable.",
        learn: `${WAF}/operational-excellence/formalize-operations-tasks`,
      },
      {
        id: "OE:03",
        title: "Formalize processes across the full software development lifecycle.",
        learn: `${WAF}/operational-excellence/formalize-development-practices`,
      },
      {
        id: "OE:04",
        title: "Enhance software development and quality assurance.",
        learn: `${WAF}/operational-excellence/tools-processes`,
      },
      {
        id: "OE:05",
        title:
          "Use a standardized infrastructure as code (IaC) approach to prepare resources and configurations.",
        learn: `${WAF}/operational-excellence/infrastructure-as-code-design`,
      },
      {
        id: "OE:06",
        title: "Build a workload supply chain that drives changes.",
        learn: `${WAF}/operational-excellence/workload-supply-chain`,
      },
      {
        id: "OE:07",
        title: "Design a monitoring stack.",
        learn: `${WAF}/operational-excellence/observability`,
      },
      {
        id: "OE:08",
        title: "Establish a clear, structured incident management process.",
        learn: `${WAF}/operational-excellence/incident-response`,
      },
      {
        id: "OE:09",
        title: "Enhance the quality of your workload.",
        learn: `${WAF}/operational-excellence/testing`,
      },
      {
        id: "OE:10",
        title: "Design automation to be reliable, secure, and maintainable.",
        learn: `${WAF}/operational-excellence/enable-automation`,
      },
      {
        id: "OE:11",
        title: "Clearly define your workload's safe deployment practices.",
        learn: `${WAF}/operational-excellence/safe-deployments`,
      },
    ],
    learn: `${WAF}/operational-excellence/checklist`,
  },
  {
    pillar: "performance",
    summary:
      "Performance Efficiency keeps the workload responsive as demand changes through targets, capacity planning, service selection, measurement, scale units, testing, and ongoing optimization.",
    principles: [
      {
        title: "Define measurable targets",
        body: "Set numerical targets for critical flows and use them to guide service, tier, and scaling choices.",
      },
      {
        title: "Scale deliberately",
        body: "Plan capacity, partition data and work, and use scale units to avoid bottlenecks and service limits.",
      },
      {
        title: "Optimize continuously",
        body: "Measure baselines, test production-like scenarios, and improve deteriorating components over time.",
      },
    ],
    tradeoffs: [
      "Overprovisioning can improve headroom but increases cost and hides inefficient design.",
      "Aggressive caching and partitioning improve latency but add consistency and invalidation complexity.",
      "Performance testing improves confidence but needs representative data and environments.",
    ],
    checklist: [
      {
        id: "PE:01",
        title: "Define performance targets.",
        learn: `${WAF}/performance-efficiency/performance-targets`,
      },
      {
        id: "PE:02",
        title: "Conduct capacity planning.",
        learn: `${WAF}/performance-efficiency/capacity-planning`,
      },
      {
        id: "PE:03",
        title: "Select the right services.",
        learn: `${WAF}/performance-efficiency/select-services`,
      },
      {
        id: "PE:04",
        title: "Establish consistent performance measurement.",
        learn: `${WAF}/performance-efficiency/monitoring`,
      },
      {
        id: "PE:05",
        title: "Optimize scaling and partitioning.",
        learn: `${WAF}/performance-efficiency/scale-partition`,
      },
      {
        id: "PE:06",
        title:
          "Optimize your workload's performance by regularly testing in a production-like environment.",
        learn: `${WAF}/performance-efficiency/performance-test`,
      },
      {
        id: "PE:07",
        title: "Optimize code and infrastructure.",
        learn: `${WAF}/performance-efficiency/optimize-code-infrastructure`,
      },
      {
        id: "PE:08",
        title: "Optimize data usage.",
        learn: `${WAF}/performance-efficiency/optimize-data-performance`,
      },
      {
        id: "PE:09",
        title: "Prioritize the performance of critical flows.",
        learn: `${WAF}/performance-efficiency/prioritize-critical-flows`,
      },
      {
        id: "PE:10",
        title: "Optimize operational tasks.",
        learn: `${WAF}/performance-efficiency/optimize-operational-tasks`,
      },
      {
        id: "PE:11",
        title: "Respond to live performance issues.",
        learn: `${WAF}/performance-efficiency/respond-live-performance-issues`,
      },
      {
        id: "PE:12",
        title: "Continuously optimize performance.",
        learn: `${WAF}/performance-efficiency/continuous-performance-optimize`,
      },
    ],
    learn: `${WAF}/performance-efficiency/checklist`,
  },
];
