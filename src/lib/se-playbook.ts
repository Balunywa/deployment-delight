export type ConversationId =
  "ubiquitous-innovation" | "amplify-intelligence" | "modernize" | "data-ai-platform";

export type Conversation = {
  id: ConversationId;
  title: string;
  tagline: string;
  opportunity: string;
  whyNow: string;
  differentiation: string;
  outcomes: { title: string; question: string; description: string }[];
  decisionMakers: string[];
  metrics: string[];
  hook: string;
  discovery: { outcome: string; questions: string[] }[];
  signals: string[];
  personas: {
    audience: string;
    focus: string[];
    pains: string[];
    solution: string[];
    value: string[];
  }[];
  objections: { hear: string; respond: string; proof: string }[];
  compete: { competitor: string; points: string[] }[];
  scenarios: { title: string; summary: string }[];
  workshop: { name: string; outcome: string; modules: string[] };
  /** Words that, in MSX opportunity names, solution areas or milestone workloads, point to this conversation. Derived from products/services the slides name for this conversation. */
  msxTerms: string[];
};

export const CONVERSATIONS: Conversation[] = [
  {
    // slide 18
    id: "ubiquitous-innovation",
    title: "Ubiquitous Innovation",
    tagline: "Build Secure Agents and Software Faster with AI that Knows Your Business",
    opportunity:
      "Most AI initiatives are not delivering the expected value. Fragmented tools, pilot-to-production gap, and agent sprawl are stalling AI from reaching real business outcomes.",
    whyNow:
      "AI agents are the next workforce. The first-mover advantage will be irreversible. Companies that do not build a secure agentic SDLC now will fall behind those that deploy agents across every workflow with speed, safety, and scale.",
    differentiation:
      "Microsoft is the only platform that moves AI from experiment to production with a repeatable way to build, deploy, and govern agents across their most important workflows. Code, build, and run on any model, with 11,000+ models and 1,400+ MCP tools.",
    outcomes: [
      // slide 18
      {
        title: "Deliver real business impact with Agents",
        question:
          "Which business processes are you trying to transform with agents, and how far have you gotten?",
        description:
          "Deliver measurable business outcomes with AI agents that use your business intelligence from day one, continuously optimize, and scale impact across workflows.",
      },
      {
        title: "Build agents and software at the speed of AI",
        question: "How are your developers using AI?",
        description:
          "Ship production-ready agents and software faster by matching the right model to each task and connecting every workflow from idea to production — with built-in quality, context, control, and trust.",
      },
      {
        title: "Secure every agent from code to runtime",
        question:
          "Where are you catching security issues today — early in the development or after code is shipped?",
        description:
          "Scale trusted AI faster with built-in observability, security, and governance — teams move fast while every agent stays trusted across Microsoft platforms.",
      },
    ],
    decisionMakers: [
      // slide 18
      "CIO",
      "CTO",
      "CDO",
      "BDM",
      "Engineering DMs",
      "Devs as influencers",
      "CISO",
    ],
    metrics: [
      // slide 18
      "Model Revenue (Foundry + Anthropic) & Copilot credits consumed revenue",
      "Agent MAA (Hosted Agents, Agent Service, ACA/AKS)",
      "GitHub Seat Adds (GHCP, GHE, GHAS, Code Quality)",
      "GitHub AI Credits (UBB ACR)",
      "Agent 365 governance & policy adoption",
      "GitHub Advanced Security Seat adds + Defender for Cloud penetration",
    ],
    // slide 19
    hook: "Frontier transformation empowers every employee to become an AI-powered maker — building, deploying, and governing intelligent agents. Agents turn enterprise knowledge into measurable business impact, working side by side with people to move from idea to production at scale.",
    discovery: [
      // slide 19
      {
        outcome: "Deliver real business impact with Agents",
        questions: [
          "Which business processes are you trying to transform with agents, and how far have you gotten?",
          "How are you equipping everyone on your team to transform high-value work through agents?",
          "How are you identifying and moving successful agents to production for the whole company?",
        ],
      },
      {
        outcome: "Build agents and software at the speed of AI",
        questions: [
          "How are your developers actually using AI today?",
          "Are you using agents anywhere in your SDLC today — if so, what are you using and how well is it working?",
          "Do you see challenges on speed, cost, or accuracy in any use case — if so, what is in the way?",
        ],
      },
      {
        outcome: "Secure every agent from code to runtime",
        questions: [
          "Where are you catching security issues today — early in the development or after code is shipped?",
          "How comfortable are you with the reliability and security of your apps and agents?",
          "What tools are you relying on today for security - and where are the gaps?",
        ],
      },
    ],
    signals: [
      // slides 20, 22, 26-29
      "Teams need to ship faster, but fragmented tooling and a pilot-to-production gap stall delivery",
      "AI generates code faster than teams can review, validate, and ship",
      "Connecting business context to code output is hard across disconnected tools",
      "AI innovation creates risk at scale without guardrails built in",
      "Agent scale creates new reliability, security, and governance risk",
      "Pilots are everywhere, but few become business results",
      "Copilot gives generic answers",
      "Our agents do not understand our business context",
      "Two agents give conflicting answers",
      "Executives cannot verify outputs are grounded",
    ],
    personas: [
      // slide 21
      {
        audience: "BDM / LoB leader",
        focus: [
          "Deliver measurable business outcomes",
          "Target the highest-value workflows",
          "Move from pilots to real impact",
        ],
        pains: [
          "Most AI initiatives aren't delivering value",
          "Agents give generic, ungrounded answers",
          "Teams not building the right scenarios",
          "Value locked in disconnected pilots",
        ],
        solution: [
          "Meaningful agents grounded in your business",
          "Foundry and Copilot Studio built agents in the flow of work",
          "Microsoft IQ grounds agents in your data",
          "Industry BOM and reference architectures",
        ],
        value: [
          "Up to 3x return, like AI leaders",
          "36% better answer quality",
          "Measurable impact across workflows",
        ],
      },
      {
        audience: "CTO",
        focus: [
          "Build and scale agents that drive impact",
          "Match the right model to each task",
          "Operationalize agents into production",
        ],
        pains: [
          "Pilot-to-production gap stalls value",
          "Fragmented tools and agent sprawl",
          "Generic AI not grounded in the business",
          "Hard to scale from one agent to many across and within business areas",
        ],
        solution: [
          "One platform from code to agent to outcome",
          "Foundry + Copilot Studio + GitHub",
          "11,000+ models, 1,400+ connectors",
          "Frontier Accelerate + FDE / CAF services",
        ],
        value: [
          "Repeatable build-deploy-govern model",
          "Faster path from idea to production",
          "Scale impact from one agent to many",
        ],
      },
      {
        audience: "Engineering DM, Devs",
        focus: [
          "Ship agents and software faster",
          "Embed AI across the dev lifecycle",
          "Connect business context to the SDLC",
        ],
        pains: [
          "Point assistants stop at the editor",
          "Toolchain sprawl and integration effort",
          "Slow path from idea to production",
          "Friction and risk across the SDLC",
        ],
        solution: [
          "Build at the speed of AI with GitHub + Foundry",
          "46% of new code already AI-generated",
          "180M developers building on GitHub",
          "Agents grounded in Microsoft IQ",
        ],
        value: [
          "48% faster time to market",
          "55% faster task completion",
          "36% better answer quality with IQ",
        ],
      },
      {
        audience: "CIO / CISO",
        focus: [
          "Scale agents across the enterprise",
          "Govern and observe agents at scale",
          "Secure agents from code to runtime",
        ],
        pains: [
          "Risk scaling faster than governance",
          "Shadow AI and ungoverned agent sprawl",
          "No central inventory or audit trail",
          "Compliance and sovereignty exposure",
        ],
        solution: [
          "Govern end-to-end with Agent 365 + security stack",
          "Agent 365 inventory, policy, audit trail",
          "GitHub Advanced Security + Defender for Cloud",
          "100+ certifications; Entra Agent ID",
        ],
        value: [
          "30% faster threat remediation",
          "117% 3-year ROI on security layer",
          "Every agent trusted from day one",
        ],
      },
    ],
    objections: [
      // slide 22
      {
        hear: "Our AI pilots never make it to production.",
        respond:
          "Microsoft moves AI from experiment to production with one governed platform — Foundry + Copilot Studio + Agent 365 — so agents go from prototype to operating at scale, not stuck in pilot.",
        proof: "Up to 48% faster time to market; Frontier Firms see 3x higher returns.",
      },
      {
        hear: "How do we govern dozens of agents safely?",
        respond:
          "Agent 365 gives central inventory, policy enforcement, and a full audit trail — governance no competitor offers end to end.",
        proof: "30% faster threat remediation; 117% 3-year ROI on the governance layer.",
      },
      {
        hear: "We tried AI on our own data, but the accuracy is not yet good / not consistent.",
        respond:
          "AI needs deeper understanding of the business context to be accurate. Microsoft IQ grounds every agent in your data and business context — not generic responses — with security and governance built in.",
        proof:
          "36% better answer quality grounded in your business; 1.6M companies trust the security stack.",
      },
      {
        hear: "Why Microsoft over Google, AWS, Anthropic or OpenAI?",
        respond:
          "One platform, one identity, one governance layer — code, agents, and governance unified, while competitors require stitching multiple procurement tracks and services.",
        proof:
          "1,400+ connectors and Entra Agent ID from code to production; 11,000+ models on one platform.",
      },
      {
        hear: "We already use point coding assistants — why change?",
        respond:
          "Assistants stop at the editor; agent platforms stop at the prototype. Only Microsoft connects code → agent → business outcome on one AI-native platform.",
        proof: "55% faster task completion; 46% of new code AI-generated across 180M developers.",
      },
    ],
    compete: [
      // slides 23-25
      {
        competitor: "Google",
        points: [
          "Fully integrated stack: TPUs → Gemini → Agentic layer for scale & cost advantage.",
          "Vertically locked — AI is Gemini-centric; approximately 200 models, no OpenAI.",
          "Unified governance — Fabric + Foundry + Agent 365 + Security under one Entra + Purview + Defender boundary.",
          "Open ecosystem — 11,000+ models and 1,400+ connectors.",
        ],
      },
      {
        competitor: "OpenAI / AWS",
        points: [
          "Frontier intelligence: GPT + reasoning + multimodal.",
          "Locked to OpenAI models — no choice of model for each job means weaker ROI.",
          "On Azure, GPT inherits Entra + Purview governance & identity the raw API and Bedrock cannot.",
          "Native governance vs AgentCore's 7-service assembly — Foundry GA vs Bedrock Managed Agents preview.",
        ],
      },
      {
        competitor: "Anthropic",
        points: [
          "Safety & reliability: Claude + Constitutional AI.",
          "Locked to Anthropic models — no choice of model for each job means weaker ROI.",
          "Better together: Claude on Foundry inherits Entra identity, Purview compliance, Defender.",
          "GitHub adds orchestration, CodeQL, SDLC governance — model choice under one license.",
        ],
      },
    ],
    scenarios: [
      // slides 26-29
      {
        title: "Operationalize LoB agentic solutions grounded in enterprise context",
        summary:
          "Lead with the business outcome, not the technology. Position Microsoft IQ as the differentiator — agents grounded in your data and business context, not generic AI responses.",
      },
      {
        title: "Govern and scale agents across the enterprise",
        summary:
          "Position Agent 365 as the unique Microsoft capability no competitor has — central agent inventory, policy enforcement, and full audit trail. Shift the conversation from experimenting to operating.",
      },
      {
        title: "Standardize the Agentic Development Platform (build → review → deploy → operate)",
        summary:
          "Win with platform standardization — one governed system for code, CI/CD, packages, and security across every team and org. Sell workflow automation, not just code completion.",
      },
      {
        title: "Ship and operate highly resilient and secure agents and software",
        summary:
          "Catch vulnerabilities where they are introduced — in the IDE and pull request, before they ever reach production. Close the loop to the cloud and connect code findings to runtime cloud risk.",
      },
    ],
    workshop: {
      // slide 91
      name: "Technical Workshop – Ubiquitous Innovation",
      outcome:
        "Participants learn to ground agents in real enterprise context, establish a governed agent operating model, and raise code quality, security, and resiliency.",
      modules: [
        "Operationalize LoB agentic solutions grounded in enterprise context",
        "Secure and scale agents across the enterprise",
        "Standardize the Agentic Development Platform (build → review → deploy → operate)",
        "Leverage agents from idea to production",
        "Ship and operate highly resilient and secure agents and software",
      ],
    },
    msxTerms: [
      // slides 18, 20, 21, 26-29, 91
      "agent 365",
      "agent service",
      "agents",
      "aks",
      "azure ai foundry",
      "azure sre agent",
      "codeql",
      "copilot studio",
      "defender for cloud",
      "foundry",
      "github",
      "github advanced security",
      "github copilot",
      "github enterprise",
      "microsoft iq",
      "rayfin",
    ],
  },
  {
    // slide 36
    id: "amplify-intelligence",
    title: "Amplify your Intelligence",
    tagline:
      "With Microsoft IQ, Differentiate Through Your People, Your Data, and Your IQ That Every Agent Can Use",
    opportunity:
      "AI is advancing fast, but accuracy, speed to achieve, and trusting the outcome, combined with the cost of tokens, are stalling AI adoption at scale.",
    whyNow:
      "Most agents fail not because the model is weak, but because they are fed by data connectors that are slow, brittle, and blind to your business. The winners build a living context layer that understands their people, work, and knowledge.",
    differentiation:
      "Microsoft IQ connects people, data, workflows, and web context to help build Customer IQ, a real-time foundation for every agent, enabling accuracy through compounding context, faster decisions, and reduced AI token usage.",
    outcomes: [
      // slide 36
      {
        title: "Deliver faster with shared intelligence",
        question:
          "Where do you see duplication and rework slowing down your AI solutions from reaching production at scale?",
        description:
          "Accelerate AI development with reusable agent tools and shared intelligence, reduce costs and eliminate duplication and rework.",
      },
      {
        title: "More accurate: Ground Agents in business context that compounds",
        question: "As your data grows, how are you ensuring your agents stay accurate?",
        description:
          "Deliver accurate, consistent, and actionable results, grounded in your complete business context across how people work, business data and the Web.",
      },
      {
        title: "Trusted intelligence that drives action",
        question:
          "What would need to be true for you to fully trust an AI agent to take action in your core business processes?",
        description:
          "Connect agents securely to your systems, data, and workflows so they reason and act with business context you can trust.",
      },
    ],
    decisionMakers: [
      // slide 36
      "Chief AI Officer",
      "Head of AI Transformation",
      "CIO",
      "CTO",
      "CDO",
      "Enterprise Architect",
      "CAIO",
    ],
    metrics: [
      // slide 36
      "Multi-IQ adoption — customers with 2+ IQs activated",
      "Foundry IQ active knowledge bases ACR",
      "Work IQ API monthly active users",
      "Fabric IQ semantic models & ontologies deployed (TBC)",
      "WebIQ (ACR)",
    ],
    // slide 37
    hook: "To become a Frontier company, your AI must activate your unique company intelligence. Copilots and agents need a shared understanding of your data, of how work gets done, of your enterprise knowledge and the Web. This is your IQ - what turns AI from demos into systems that run the business with consistency and trust.",
    discovery: [
      // slide 37
      {
        outcome: "Deliver faster with shared intelligence",
        questions: [
          "Where do you see duplication and rework slowing down your AI solutions from reaching production at scale?",
          "Where are your teams still rebuilding the same AI capabilities - and what is preventing reuse of context across projects?",
          "How are you optimizing your token usage and costs?",
        ],
      },
      {
        outcome: "More accurate: Ground Agents in business context that compounds",
        questions: [
          "As your AI usage scales and data grows, how are you ensuring your agents stay accurate?",
          "How confident are you that your agents truly understand how your organization operates?",
          "When an agent completes a task, how does it make other agents better?",
        ],
      },
      {
        outcome: "Trusted intelligence that drives action",
        questions: [
          "What would need to be true for you to fully trust an AI agent to take action in your core business processes—and what is missing today?",
          "Where have you held back from deploying an agent because you couldn’t trust it to act on its own?",
          "How confident are you that your AI agents are leading to accurate, well-reasoned answers and actions?",
        ],
      },
    ],
    signals: [
      // slides 38, 39, 44, 45
      "Data is siloed with no shared semantic foundation",
      "Enterprise data is trapped in legacy or operational databases",
      "Teams can't ship or build agents fast enough and need a developer platform",
      "Our agents do not understand our business",
      "Our AI pilots stall and never scale",
      "M365 data can be accessed via APIs, so you do not need Work IQ",
      "Our AI token costs are spiraling",
      "Agents give generic answers",
      "Signals fragmented across systems",
      "Every team rebuilds connectors from scratch",
      "Responses too slow / burning tokens",
    ],
    personas: [
      // slide 38
      {
        audience: "CIO",
        focus: [
          "Enterprise AI governance & strategy",
          "Accelerate AI adoption at scale",
          "Create shared context across siloed data, platform and systems",
        ],
        pains: [
          "Fragmented AI/data across Enterprise",
          "Duplicate effort & increasing costs",
          "Integration cost and challenges",
          "Lack of governed and reusable context",
        ],
        solution: [
          "Compound value & govern as AI adoption grows",
          "Work IQ unifies data, people & AI",
          "Enterprise-scale context (600+ TB)",
          "Govern & secure with Entra, Purview",
        ],
        value: ["80% fewer tokens", "Faster, safer AI deployment", "Lower integration costs"],
      },
      {
        audience: "CTO",
        focus: [
          "Accelerate AI development velocity",
          "Build agents with real context",
          "Reduce model customization costs",
        ],
        pains: [
          "Manual data gathering for every agent",
          "Time-to-value measured in months",
          "Developers waste effort on integrations",
          "Performance issues at scale",
        ],
        solution: [
          "Accelerate agent deployment with shared intelligence",
          "Fabric IQ pre-indexes enterprise data",
          "2X more output per second",
          "No slow integrations needed",
        ],
        value: [
          "Innovation agility (agents 2X faster)",
          "2X throughput with Work IQ APIs",
          "Eliminate duplicated engineering",
        ],
      },
      {
        audience: "CDO",
        focus: [
          "Make data accessible for AI",
          "Govern enterprise data at scale",
          "Build AI-ready data architecture",
        ],
        pains: [
          "70%+ enterprise data locked in silos",
          "No unified access layer for agents",
          "Complex, risky modernization",
          "Data spread across SQL, NoSQL, cloud",
        ],
        solution: [
          "Build your IQ, context across people, business & knowledge",
          "Open, intelligent, scalable platform",
          "Governance across Data & AI",
          "Leverage existing PowerBI Semantic model to build enterprise Ontology",
        ],
        value: [
          "Enterprise data consumable by AI",
          "Open standards - Freedom to use any analytics engine",
          "Faster time to value leveraging existing investments",
        ],
      },
      {
        audience: "CDAI",
        focus: [
          "Drive organizational AI transformation",
          "Enable faster business decisions",
          "Amplify business impact from AI",
        ],
        pains: [
          "Fragmented intelligence prevents action",
          "Agents reason over raw data (quality)",
          "Rebuild intelligence for each use case",
          "Slow decision cycles",
        ],
        solution: [
          "Accelerate agent deployment with shared intelligence",
          "Unified intelligence across agents & apps",
          "Accurate, consistent results",
          "Continuous learning at scale",
        ],
        value: [
          "Coordinated decisions across enterprise",
          "36% higher answer quality",
          "Faster decision cycles",
          "Compounding intelligence",
        ],
      },
    ],
    objections: [
      // slide 39
      {
        hear: "Our agents don’t understand our business.",
        respond:
          "Microsoft IQ unifies Work IQ, Fabric IQ, Foundry IQ, and Web IQ into one governed layer every agent reasons over.",
        proof: "36% better answer quality; 600+ TB enterprise context.",
      },
      {
        hear: "Our AI pilots stall and never scale.",
        respond: "Build once on Microsoft IQ; every new agent inherits your context on day one.",
        proof: "400K+ orgs' semantic models; intelligence compounds with adoption.",
      },
      {
        hear: "Why Microsoft over Google or AWS?",
        respond:
          "Only Microsoft unifies people, work, data, knowledge, and the web into one governed IQ layer.",
        proof: "Web IQ sub-165ms grounding; 1B+ M365 signals.",
      },
      {
        hear: "M365 data can be accessed via APIs, so you don’t need Work IQ.",
        respond:
          "Interop APIs can provide access to data. Work IQ reasons over relationships, workflows, priorities, and business context, building a persistent intelligence layer with memory, governance, and real-time signals.",
        proof: "600+ TB enterprise context; up to 80% fewer tokens + 2x throughput.",
      },
      {
        hear: "Our AI token costs are spiraling.",
        respond: "Ground once and reuse everywhere — Work IQ APIs cut token usage dramatically.",
        proof: "Up to 80% fewer tokens; 2x throughput.",
      },
    ],
    compete: [
      // slides 40-43
      {
        competitor: "Google",
        points: [
          "Fully integrated stack: TPUs → Gemini → Agentic layer for scale & cost advantage.",
          "No unified intelligence layer — grounding returns AI summaries, 30% factuality gap, no raw results.",
          "Lead native 1P Fabric + Foundry + M365 — open & interoperable at every layer.",
          "Microsoft IQ grounds agents in 1B+ signals for +36% answers.",
        ],
      },
      {
        competitor: "AWS / OpenAI",
        points: [
          "No unified enterprise context — agents cannot reach M365 signals.",
          "AgentCore = 7 services to assemble one agent — governance partner-bolted.",
          "Microsoft IQ wraps GPT with 600+ TB of governed context.",
          "One control plane — 11,000+ models, 1,400+ connectors to the M365/Copilot estate.",
        ],
      },
      {
        competitor: "Databricks",
        points: [
          "Genie Ontology still centers on Databricks data — no native work signals, no web grounding, no FedRAMP.",
          "Microsoft IQ spans four layers: work + data + AI infra + web.",
          "Agent 365 + Entra deliver agent identity with FedRAMP and compliance natively.",
          "Fabric IQ + Power BI deliver governed semantics inside EA bundles.",
        ],
      },
      {
        competitor: "Palantir",
        points: [
          "Ontology-driven agents collaborate, critique, and refine through iterative loops, but every workflow and learned insight is locked inside Foundry's closed stack.",
          "Open agent orchestration your team owns — IQ Suite + Azure AI Agent Service ships governed multi-agent workflows without lock-in.",
          "Enterprise intelligence without FDEs or >$500K ACV.",
          "600+ TB of org signals via Microsoft IQ power every agent.",
        ],
      },
    ],
    scenarios: [
      // slides 44-45
      {
        title: "Ground Agents in business context that compounds",
        summary:
          "Lead with one unified intelligence layer and connect Work IQ, Fabric IQ, Foundry IQ and Web IQ as the connective tissue. Ground once, reuse everywhere so each interaction compounds, not resets.",
      },
      {
        title: "Trust intelligence that drives action",
        summary:
          "Tie outcomes to the metric the team owns — speed, cost, Customer experience so quality is measurable and trusted. Ensure observability and governance travels with the data.",
      },
      {
        title: "Deliver faster with shared intelligence",
        summary:
          "Lead with shared, real-time intelligence — agents and people work from one living context that improves, not resets, with every deployment. Cut rework and hand-offs.",
      },
    ],
    workshop: {
      // slide 90
      name: "Technical Workshop- Amplify",
      outcome:
        "Technical teams design and deliver integrated Microsoft IQ solutions that unify work context, business data, and enterprise knowledge into a single intelligence layer.",
      modules: [
        "Build your IQ — context across people, business & knowledge",
        "Ground AI in shared business meaning",
        "Deliver decisions your business can trust (Quality)",
        "Compound value & govern as AI adoption grows",
        "Accelerate agent deployment with shared intelligence",
        "Real-time work awareness with Work IQ",
      ],
    },
    msxTerms: [
      // slides 36, 38, 44, 45, 90
      "agent 365",
      "copilot studio",
      "fabric iq",
      "foundry",
      "foundry iq",
      "microsoft 365 copilot",
      "microsoft entra",
      "microsoft foundry",
      "microsoft iq",
      "microsoft purview",
      "power bi",
      "semantic models",
      "web iq",
      "work iq",
    ],
  },
  {
    // slide 52
    id: "modernize",
    title: "Modernize with Confidence",
    tagline: "Modernize Infrastructure, Applications and Data to Unlock AI at Enterprise Scale",
    opportunity:
      "Most companies are stuck trying to fund AI while still paying to keep old systems alive. Their data is scattered across SQL Server on-prem, open-source databases, SAP, VMware, Oracle, and mainframes, and AI agents cannot reach it.",
    whyNow:
      "Customers must get AI-ready at speed while facing rising security threats from bad actors weaponizing AI, mounting risk from end-of-support software, and the soaring cost of running on-premises infrastructure.",
    differentiation:
      "We are the only secure end-to-end agentic modernization platform. Agentic code upgrades cut months to days or hours. SQL runs best on Azure. Frontier Accelerate brings the Cloud Acceleration Factory to execute modernizations at no cost to customers.",
    outcomes: [
      // slide 52
      {
        title: "Modernize faster with Agentic AI",
        question: "How ready are your infrastructure, apps and data to power AI agents today?",
        description:
          "Modernize legacy apps, infrastructure, and data to Azure securely, starting with SQL, at zero cost through Cloud Acceleration Factory with agentic AI tooling that compresses months of effort into hours.",
      },
      {
        title: "Innovate with a modern, AI-ready platform",
        question: "How quickly are your teams able to deliver a new application?",
        description:
          "Build new apps on an open, intelligent, global application & database platform unlocking new products, services, and revenue.",
      },
      {
        title: "Operate with Confidence & Trust",
        question:
          "How are you addressing regulatory compliance, sovereign requirements, and security threats?",
        description:
          "Operate a secure, sovereign platform with control over data, compliance, and resilience.",
      },
    ],
    decisionMakers: [
      // slide 52
      "CIO",
      "CTO",
      "CDO",
      "Dev DMs",
      "Developer",
      "Data Prof.",
      "CISO",
    ],
    metrics: [
      // slide 52
      "SQL Server Core to Azure Database (Azure SQL & OSS DB)",
      "Agentic modernization wins (Apps, Infra, Databases) using Agentic tooling",
      "Velocity gains from Frontier Accelerate for Azure + Cloud Adoption Framework",
      "NoSQL & OSS DB share growth",
      "Modern app platform share growth (containers and serverless)",
      "Sovereign Public & Sovereign Private customer wins",
      "Security penetration to modernization projects",
    ],
    // slide 53
    hook: "Frontier transformation starts with platform modernization. Customers need modern apps, connected data, and trusted infrastructure for AI to deliver measurable business impact; as AI Agents will need to take actions on operational applications and databases.",
    discovery: [
      // slide 53
      {
        outcome: "Modernize faster with Agentic AI",
        questions: [
          "How ready are your core applications and data to support AI agents? What will happen if you decide to agentize these business processes?",
          "Your SQL Server <annuity | renewal> is coming up, do you know how you can leverage the investment you are already making to modernize the platform for security and AI?",
          "How are your workloads like SAP, Oracle, Mainframe, and VMware integrated in and supporting your AI strategy?",
        ],
      },
      {
        outcome: "Innovate with a modern, AI-ready Platform",
        questions: [
          "What's slowing down your ability to build and launch new apps & digital experiences?",
          "How are you making your data consumable and available to your applications?",
          "How are performance, latency, scale, or real-time data access impacting user experiences?",
        ],
      },
      {
        outcome: "Operate with Confidence & Trust",
        questions: [
          "How are you preparing your applications and databases to against new AI-powered threats?",
          "How are data residency, resiliency and compliance requirements impacting your cloud and AI strategy?",
          "Where do you feel you have the most operational or governance risk today?",
        ],
      },
    ],
    signals: [
      // slide 54
      "Data from core business apps is inaccessible to AI",
      "Transactional database modernization is risky and complex",
      "Teams lack the skills to build AI-ready applications at scale",
      "AI-driven security risks raise the urgency for a unified security solution while retiring legacy systems",
      "CIO/CISO needing to respond to board on cyber risk of current apps, legacy on-prem environments",
      "Regulatory requirements constrain cloud and AI adoption",
      "Sovereignty concerns: data residency, foreign government access, operational control",
      "Customer concerned with End of Support of hardware or software",
      "Database sprawl and licensing burden inflating TCO",
      "AI funding pressure vs. legacy IT spend",
    ],
    personas: [
      // slide 55
      {
        audience: "CIO + CTO",
        focus: [
          "TCO optimization & AI readiness",
          "Enterprise modernization at scale",
          "SQL & database migration to Azure",
        ],
        pains: [
          "On-prem and licensing costs keep inflating our TCO",
          "Modernization takes too long and the refactoring costs hurt",
          "I can't fund AI when legacy IT keeps draining my budget",
        ],
        solution: [
          "Modernize faster with Agentic AI",
          "Frontier Accelerate with Cloud Acceleration Factory – 70% less time at zero cost",
          "Agentic code upgrades cut months to days",
          "SQL runs best on Azure – up to 5x faster than AWS RDS",
        ],
        value: [
          "Up to 60% reduction in administrative overhead",
          "4x faster modernization with agentic AI tooling",
          "Accelerated AI transformation readiness",
        ],
      },
      {
        audience: "CDO + Data Professionals",
        focus: [
          "Data accessibility for AI agents",
          "Database platform modernization",
          "AI-ready data architecture",
        ],
        pains: [
          "Over 70%+ of our enterprise data trapped in operational databases, inaccessible to AI",
          "Modernizing transactional database still feels too risky & complex",
          "Our data scattered across SQL Server on-prem, OSS DBs, SAP",
        ],
        solution: [
          "Innovate with a modern, AI-ready platform",
          "Open, intelligent, globally scalable database platform",
          "AI-ready by design",
          "SQL Server Core to Azure Database migration path",
        ],
        value: [
          "Make enterprise data consumable & available for AI agents",
          "Unlock new products, services & revenue streams",
          "Flexibility with NoSQL & open-source database support",
        ],
      },
      {
        audience: "CTO + Dev DMs, Developers",
        focus: [
          "New application development",
          "Modern app architecture & containers",
          "Developer productivity & skilling",
        ],
        pains: [
          "My teams lack skills to build AI-ready applications at scale",
          "Performance, latency & real-time data access impacting user experiences",
          "Our legacy app architectures limit innovation velocity",
        ],
        solution: [
          "Innovate with a modern, AI-ready platform",
          "Any app, any architecture – 65% improvement in scale",
          "Modern app platform (containers & serverless)",
          "Free self-paced/expert-driven skilling & 1P services",
        ],
        value: [
          "65% improvement in scale, performance & stability",
          "Build AI-native apps at enterprise speed",
          "Innovation agility, faster build-to-prod",
        ],
      },
      {
        audience: "CIO + CISO",
        focus: [
          "Regulatory compliance & sovereignty",
          "Data residency & operational resilience",
          "Enterprise security posture",
        ],
        pains: [
          "AI security risks demand unified protection we don't have yet",
          "GDPR, NIS2 and DORA requirements keep constraining our cloud adoption",
          "We can't resolve data residency, foreign access and sovereignty concerns",
        ],
        solution: [
          "Operate with Confidence & Trust",
          "Sovereign & resilient by design (60+ regions)",
          "Secure by default – 100T threat signals analyzed daily",
          "Built-in availability, zone redundancy, geo-replication",
        ],
        value: [
          "Sovereign, trusted & resilient operations",
          "Control over data, compliance & resilience",
          "Secure all workloads with unified security",
        ],
      },
    ],
    objections: [
      // slide 56
      {
        hear: "Modernizing our production estate is too risky and disruptive.",
        respond:
          "Lead with agentic, application-centric modernization with human-in-the-loop control native to GitHub issues and PRs — you modernize whole apps, not servers, with your people in control.",
        proof:
          "Up to 70% less migration time, >50% less effort to upgrade apps; 500K+ lines modernized in weeks.",
      },
      {
        hear: "This will take months or years we don’t have.",
        respond:
          "Reframe to days. Autonomous AI agents compress legacy upgrades, and Azure Copilot completes SQL Server migrations in days, not months.",
        proof: "Months-to-hours .NET & Java upgrades; SQL Server migrations in days, not months.",
      },
      {
        hear: "We don’t have the skills or capacity to do this.",
        respond:
          "Do-it-with-you: Microsoft Cloud Acceleration Factory implements modernization at no cost while upskilling your team — in the tools your developers already use.",
        proof:
          "Cloud Acceleration Factory at no cost; 180M+ GitHub developers, 76% on Visual Studio.",
      },
      {
        hear: "We can’t fund modernization and AI at the same time.",
        respond:
          "Modernization is the cost takeout that funds AI — retire the legacy footprint, sprawl, and licensing burden to free the budget for what’s next.",
        proof:
          "Up to 76% cost savings; 58% lower cost & 65% better perf, Azure PostgreSQL vs. on-prem.",
      },
      {
        hear: "Why Azure over AWS or GCP?",
        respond:
          "Performance and economics head-to-head — plus the only cloud doing application-centric migration, operated by a leading security vendor.",
        proof:
          "SQL up to 5x faster; 51% faster & 39% cheaper than AWS EC2; SAP 33% vs. AWS 22% / GCP 12%.",
      },
      {
        hear: "For regulated industries, the biggest risk is managing compliance, audit, and security on legacy infrastructure at scale.",
        respond:
          "Start by acknowledging their concern and ask for clarification. Reframe by explaining that Azure does not remove control; it codifies and enforces it.",
        proof:
          "Azure has one of the largest compliance portfolios in the world, addressing global, industry, government, and regional requirements. Certifications include FedRAMP High, HIPAA, GDPR, PCI DSS, ISO 27001, and SOC 2.",
      },
    ],
    compete: [
      // slide 57
      {
        competitor: "AWS",
        points: [
          "AWS Transform + Migration Acceleration Program.",
          "AI-led rehosting through AWS Transform, aggressive MAP migration funding, and a dedicated sovereign region in Germany.",
          "Azure SQL Managed Instance delivers up to 5x faster performance.",
          "Only E2E agentic modernization solution that integrates IT and developer workflows.",
          "Cloud Accelerate Factory enables zero-cost modernization.",
        ],
      },
      {
        competitor: "GCP",
        points: [
          "Gemini agentic migration + RaMP incentives.",
          "Google starts higher in the stack, pitches a partnership for AI transformation to seize Bigquery+Gemini and expand to migrate the full customer estate.",
          "Azure delivers end-to-end application aware modernization, not just migration.",
          "Sovereign and resilient by design, with built-in availability, zone redundancy, and geo-replication.",
        ],
      },
    ],
    scenarios: [
      // slides 58-60, 93
      {
        title: "Agentic App & Database Modernization",
        summary:
          "Modernize apps + data together — drive portfolio-scale end-to-end modernization, not isolated workloads or lift-and-shift. Make agentic the default for AI-driven discovery, refactoring, and optimization at scale.",
      },
      {
        title: "Modernize mission-critical workloads: SAP, VMware, Mainframe",
        summary:
          "Target mission-critical transformation triggers: VMware, SAP, Mainframe, Windows Server and .NET Apps. Extend and innovate core systems with Fabric + AI, PaaS/containers, and AI-driven patterns.",
      },
      {
        title: "Build new Apps with Modern DBs",
        summary:
          "Identify strategic priorities that define what the customer is building. Create awareness of Azure global-scale, low-latency DB options that can flex to demanding workloads.",
      },
      {
        title: "Build sovereign, trusted, and resilient operations",
        summary:
          "Position sovereignty, security, and resilience as built-in across public, private, and national partner clouds. Lead with consultative risk and continuity discovery before platform or workload decisions.",
      },
      {
        title: "Secure all workloads with Defender",
        summary:
          "Position Microsoft Defender for Cloud as delivering unified code to cloud visibility and threat protection across clouds. Position Defender for Cloud as the security layer that scales with Foundry + AOAI adoption.",
      },
      {
        title: "Use Capacity Planning as a Strategy for Conversations",
        summary:
          "Upgrading to v6/v7 can unblock deals where older VMs are constrained or retiring. For most customer workloads, Azure's latest VMs unlock improved compute-per-dollar efficiency compared to prior VM generations.",
      },
    ],
    workshop: {
      // slide 88
      name: "Technical Workshop – Modernize with Confidence",
      outcome:
        "Participants learn how to modernize legacy environments, reduce operational complexity, improve scalability, and strengthen governance.",
      modules: [
        "Agentic App & Database Modernization",
        "Modernize mission-critical workloads: SAP VMware Oracle",
        "Build new Apps with Modern DBs",
        "Build sovereign, trusted, and resilient operations",
        "Secure all workloads with Defender",
      ],
    },
    msxTerms: [
      // slides 52, 54, 58-60, 88, 93
      "aks",
      "app service",
      "arc",
      "azure arc",
      "azure databases",
      "azure iaas",
      "azure local",
      "azure paas",
      "azure red hat openshift",
      "azure sql",
      "azure virtual desktop",
      "confidential compute",
      "containers",
      "cosmos db",
      "defender for cloud",
      "hdinsight",
      "linux",
      "mainframe",
      "migrate",
      "oracle",
      "postgresql",
      "sap",
      "sql server",
      "vmware",
      "windows server",
    ],
  },
  {
    // slide 67
    id: "data-ai-platform",
    title: "A Unified, Governed Data and AI Platform",
    tagline: "Establish a Unified, Trusted Data and AI Foundation for Your Frontier Transformation",
    opportunity:
      "Organizations struggle to scale AI due to fragmented data, AI, and governance across disconnected systems — slowing adoption and increasing cost, risk, and complexity.",
    whyNow:
      "Demand for AI use cases is already here, while customers' data and AI platform foundation is not - creating immediate cost, risk, and missed value.",
    differentiation:
      "Microsoft is the only platform providing an end-to-end foundation to become Frontier — delivering speed with a virtual data lake and no data duplication, greater choice through multi-model and open standards, simplified operations, and enterprise-grade trust.",
    outcomes: [
      // slide 67
      {
        title: "Unify your Data and AI Platform",
        question: "Can your AI discover and safely access all the data of your organization?",
        description:
          "Bring your data, applications, and AI together on a unified foundation — save costs and ensure no silos, no seams, no starting over.",
      },
      {
        title: "Build a Foundation for Enterprise Intelligence",
        question: "How are you enabling your AI with business context?",
        description:
          "Build and manage your enterprise IQ—on a unified platform that delivers trusted context for every app, agent, and decision.",
      },
      {
        title: "Achieve AI and Data Trust that Drives Adoption",
        question: "How are you securing and observing your agents?",
        description:
          "Secure and govern your entire data and AI estate end-to-end — so confidence in your controls becomes confidence to move faster.",
      },
    ],
    decisionMakers: [
      // slide 67
      "CDO",
      "CAIO",
      "CIO",
      "CISO",
    ],
    metrics: [
      // slide 67
      "Grow $100K/month Fabric customers",
      "Segment specific thresholds TBD",
      "# customers > Fabric IQ semantic models & ontologies deployed",
      "# customers > $ Foundry IQ + Web IQ",
      "Purview coverage across the data & AI estate",
      "Agents governed via Agent 365 + Entra Agent ID",
    ],
    // slide 68
    hook: "To become a Frontier company, you need a unified, trusted data and AI foundation — one that turns fragmented estates into a governed platform powering production-ready agents.",
    discovery: [
      // slide 68
      {
        outcome: "Unify your Data and AI Platform",
        questions: [
          "Can your AI discover and safely access all the data of your organization? If not, what are the challenges?",
          "Is your data estate currently fragmented? If yes, how is this fragmentation impacting your ability to scale your AI from POCs to production?",
        ],
      },
      {
        outcome: "Build a Foundation for Enterprise Intelligence",
        questions: [
          "How are you avoiding risks of hallucination and expensive use of AI tokens to decipher context?",
          "How are you enabling your AI with complete context across your data, your organization’s flow of work, and relevant external context?",
          "How do you ensure your AI agents are using determinism where it’s needed?",
        ],
      },
      {
        outcome: "Achieve AI and Data Trust that Drives Adoption",
        questions: [
          "How do you govern who can see what data — and does that extend to what your AI agents can access and do?",
          "How are you securing and observing your agents for auditing and compliance?",
          "How are you operationalizing safeguards and controls for your agents?",
        ],
      },
    ],
    signals: [
      // slide 69
      "Agents reason over raw tables",
      "Connector sprawl and bespoke integration projects",
      "No shared semantic foundation across the enterprise",
      "Low accuracy on AI use cases / users getting different answers to the same question",
      "Agent sprawl without centralized identity, governance, observability, or cost management",
      "Avg 12 disparate tools to secure the data estate",
      "Data estates fragmented across clouds, apps, and data types",
      "Data that exists in the organization is not yet accessible for AI use cases",
      "Lock-in concerns on the data platform or model vendor",
      "Engineers spend most time moving and reconciling data, not building",
    ],
    personas: [
      // slide 70
      {
        audience: "CIO + CTO",
        focus: [
          "Enterprise data & AI platform consolidation",
          "AI transformation strategy & ROI",
          "TCO reduction through platform unification",
        ],
        pains: [
          "Data sprawl across siloed tools, inefficient agent workflows inflates token costs and slows AI initiatives",
          "We can't operationalize AI because our data estate is fragmented",
          "Managing multiple analytics vendors drains budget and talent",
        ],
        solution: [
          "Unify and Govern your Data & AI with Microsoft Fabric and Foundry",
          "OneLake eliminates data duplication",
          "SaaS Data Platform for analytics, data engineering, data science & AI in Fabric",
          "AI Platform with Model Router, built-in evaluation tools, e2e Agent mgmt. in Foundry",
        ],
        value: [
          "Reduction in data and AI platform TCO through consolidation",
          "Accelerated time-to-AI-value with a unified, governed foundation",
          "Simplified vendor management & licensing",
        ],
      },
      {
        audience: "CDO + Data Professionals",
        focus: [
          "Data governance & quality at scale",
          "Unified analytics & BI",
          "AI-ready data pipelines",
        ],
        pains: [
          "Data is scattered across warehouses, lakes & lakehouses with no unified governance",
          "Data quality issues erode trust and block AI adoption",
          "Teams spend 80% of time on data prep, not insights",
        ],
        solution: [
          "Govern & democratize with Fabric + Onelake Catalog",
          "Unified governance with Microsoft Purview integration across OneLake",
          "Real-time analytics, data warehousing & data science in one platform",
          "Copilot-assisted data transformation & natural language analytics",
        ],
        value: [
          "Single source of truth with end-to-end data lineage & governance",
          "80% faster time-to-insight with unified data workflows",
          "Trusted, AI-ready data accessible to all business users",
        ],
      },
      {
        audience: "CAIO + Solution Architects",
        focus: ["Building AI-powered applications and agents", "AI model development & deployment"],
        pains: [
          "Building production AI apps requires stitching together too many tools",
          "No standardized way to ground AI models on enterprise data",
          "Prompt engineering, RAG, and fine-tuning workflows are fragmented",
          "Increasing token costs, agent optimization",
        ],
        solution: [
          "Build and optimize AI apps and agents with Foundry",
          "Model catalog with 11,000+ models – open & frontier",
          "Model Router, built-in evaluation tools, Agent Optimizer in Foundry",
          "Enterprise context with grounding on OneLake",
        ],
        value: [
          "Run agents your way — model choice & deployment flexibility",
          "Enable continuous agent optimization for cost & performance",
          "Production-grade AI apps grounded on enterprise data",
        ],
      },
      {
        audience: "CIO + CISO",
        focus: [
          "AI governance & responsible AI",
          "Data security & access control",
          "Regulatory compliance for AI workloads",
        ],
        pains: [
          "AI introduces new risks – hallucinations, data leakage, shadow AI",
          "We lack unified policies to govern who accesses what data across AI & analytics",
          "Compliance requirements demand auditability we don't have",
        ],
        solution: [
          "Operate with unified AI governance & security",
          "AI Gateway for run-time policy enforcement across agents, tools, MCP servers, A2A",
          "Entra ID, observability, built-in responsible AI controls in Foundry",
          "Fabric security with row/column-level access, sensitivity labels & Purview",
        ],
        value: [
          "Single chokepoint where all traffic is inspected, routed, and governed",
          "Responsible AI at scale with built-in guardrails",
          "Zero-trust data access across analytics & AI workloads",
          "Regulatory readiness for EU AI Act, GDPR & industry mandates",
        ],
      },
    ],
    objections: [
      // slide 71
      {
        hear: "Cost and ROI of Fabric are unclear",
        respond:
          "Fabric reduces TCO by consolidating multiple platforms, unifying data for AI, delivering price/perf engines, integrating experiences in flow of work, and scaling data workloads with AI.",
        proof: "Evidence stories for cost reduction and operational efficiencies.",
      },
      {
        hear: "We’ve already invested in AWS/GCP/ Snowflake or Databricks.",
        respond:
          "You can complement your existing data estate with Fabric to activate unified intelligence, trust, and consumption capabilities. Snowflake and Databricks can write/read data to/from OneLake.",
        proof: "Evidence stories of surround/complement wins for AWS/GCP/Snowflake.",
      },
      {
        hear: "Fabric is not fully enterprise ready.",
        respond:
          "Fabric inherits the enterprise-grade fundamentals from Microsoft Azure and the Microsoft Security platforms used by Microsoft's global scale operations.",
        proof:
          "Fabric's leader amongst leaders positioning in analyst reports and Enterprise customer evidence stories.",
      },
      {
        hear: "Foundry will lock me into proprietary technology, limiting my ability to innovate",
        respond:
          "Foundry is built for choice and flexibility. Customers can use Hosted Agents, support open-source agent frameworks, and build with Microsoft Agent Framework.",
        proof:
          "Foundry Hosted Agents docs: BYO code, Microsoft Agent Framework, OSS frameworks, Responses API, and broad model catalog including open models.",
      },
      {
        hear: "Foundry is not production ready, and lacks features I can find with other hyperscalers",
        respond:
          "Foundry is designed for enterprise production AI with Azure-backed SLAs where services are generally available, plus clear controls to distinguish and govern use of GA versus Preview capabilities.",
        proof:
          "Gartner MQ for AI Application Development Platforms: Microsoft Leader / furthest for Completeness of Vision; Azure SLAs for GA services; GA vs Preview controls.",
      },
    ],
    compete: [
      // slides 72-75
      {
        competitor: "AWS",
        points: [
          "AWS has the strongest infrastructure scale, but fragmented services needing customers to stitch multiple disparate products.",
          "AWS do not have an integrated data platform.",
          "AWS do not have the M365 integration moat of Fabric + Foundry.",
          "Governance is fragmented in the AWS data and AI offerings.",
          "Azure Databricks and Snowflake on Azure have native OneLake integrations.",
        ],
      },
      {
        competitor: "Palantir",
        points: [
          "Ontology-led transformation with FDE Bootcamps delivering fast time-to-value.",
          "Proprietary stack creates lock-in; FDE economics require ACV >$500K.",
          "Open, governed data unification via Fabric + Purview + Databricks.",
          "Agent Factory + Control Plane replace bespoke FDE model — capability building, not vendor dependency.",
        ],
      },
      {
        competitor: "Google",
        points: [
          "Radical simplicity: highlighting AI with Gemini + BigQuery.",
          "Vertically locked — AI is Gemini-centric; BigQuery's proprietary format shuts out other engines.",
          "No unified intelligence layer.",
          "Lead native 1P Fabric + Foundry + M365 — open & interoperable at every layer.",
        ],
      },
      {
        competitor: "OpenAI / AWS",
        points: [
          "No unified enterprise context — agents cannot reach M365 signals.",
          "AgentCore = 7 services to assemble one agent.",
          "On Azure, GPT inherits Entra + Purview governance & identity the raw API and Bedrock cannot.",
          "One control plane — 11,000+ models, 1,400+ connectors to the M365/Copilot estate.",
        ],
      },
      {
        competitor: "Anthropic",
        points: [
          "Claude Code delivers models, not systems.",
          "No FedRAMP, no private endpoints, no agent identity.",
          "Better together: Claude on Foundry inherits Entra identity, Purview compliance, Defender.",
          "Foundry IQ wraps Claude with +36% answer quality.",
        ],
      },
    ],
    scenarios: [
      // slides 76-79
      {
        title: "Unify your Data Estate for AI",
        summary:
          "Unify and govern your data estate for your AI without disrupting your current data estate and by modernizing incrementally with your use cases. Create an open and interoperable data foundation for AI.",
      },
      {
        title: "Run agents your way — model choice & deployment flexibility",
        summary:
          "Position Foundry/Azure as the best platform for custom agents with flexibility, speed, and control. For OSS-leaning customers, position Foundry as the secure enterprise-ready platform to deploy OSS models.",
      },
      {
        title: "Turn your data into real-time business intelligence",
        summary:
          "Fabric Real-Time Intelligence lets you act on live data in dashboards and AI agents without managing separate streaming infrastructure.",
      },
      {
        title: "Build business context your AI can use",
        summary:
          "Make every AI Agent enterprise grade through compounding existing investments in M365, Foundry, and Fabric. Activate Power BI semantic models as the governed intelligence layer for Copilot and custom agents.",
      },
      {
        title: "Govern your AI and Data on a platform you trust",
        summary:
          "Frame governance, observability, and safety as built in, not bolted on. Position AI Gateway as the chokepoint where traffic is inspected, routed, and governed.",
      },
      {
        title: "Continuously optimize cost and performance",
        summary:
          "Position Foundry as a fully integrated agent platform with built-in evaluation and Agent Optimizer. Position APIM AI Gateway for centralized token cost management and GenAI FinOps.",
      },
    ],
    workshop: {
      // slide 89
      name: "Technical Workshop – Build a Unified Governed and AI Platform",
      outcome:
        "Participants learn how to govern their data for AI, ground Copilot and agents in trusted enterprise data, and run agents in production with predictability, stability, and cost discipline.",
      modules: [
        "Unify your Data Estate for AI",
        "Run agents on your terms — across any model and environment",
        "Turn your data into real-time operational and business intelligence",
        "Build business context your AI can use",
        "Govern your AI and Data on a platform you trust",
        "Continuously optimize cost and performance",
      ],
    },
    msxTerms: [
      // slides 67, 69, 76-79, 89
      "agent 365",
      "ai gateway",
      "apim ai gateway",
      "azure databricks",
      "azure integration services",
      "databricks",
      "delta",
      "fabric",
      "fabric iq",
      "fabric rti",
      "foundry",
      "foundry iq",
      "iceberg",
      "microsoft iq",
      "onelake",
      "power bi",
      "purview",
      "snowflake",
      "web iq",
    ],
  },
];

export const GTM_DISCOVERY: string[] = [
  // slide 11
  "How is your business?",
  "What are your priorities?",
  "How are you thinking about leveraging AI to support your priorities?",
  "How do you think that this will impact your industry?",
  "Are there other considerations (regulatory, sovereign, etc.)?",
];

export const PREP_TASKS: { task: string; covers: string[] }[] = [
  // slides 17, 35, 51, 66
  {
    task: "KNOW YOUR CUSTOMER",
    covers: [
      "Customer Snapshot",
      "Key Stakeholders",
      "Current Microsoft Relationship",
      "Customer AI Strategy",
      "Customer Modernization Strategy",
    ],
  },
  {
    task: "UNDERSTAND AI MATURITY, MODERNIZATION MATURITY, DATA ESTATE, AND OPPORTUNITIES",
    covers: [
      "AI Maturity Assessment",
      "Modernization Maturity Assessment",
      "Frontier Transformation outcome",
      "Pipeline analysis",
      "Technical & Commercial context",
      "Data Estate Assessment",
      "Data estate challenges",
      "Agent Platform Governance strategy & tools",
      "Token cost management and optimization challenges",
      "Data and AI platform integration status",
    ],
  },
  {
    task: "COMPETITIVE LANDSCAPE",
    covers: [
      "Current cloud position & direction",
      "Competitor counter-narrative",
      "Top Microsoft differentiators & red flags",
    ],
  },
  {
    task: "TAILOR THE VALUE PROP",
    covers: [
      "Relevant Discovery Questions",
      "Discovery Questions",
      "Hooks based on customer pinpoints",
      "Scenarios to go deeper",
    ],
  },
  {
    task: "MEETING STRATEGY & TALK TRACK",
    covers: [
      "Meeting Structure (open, discover, propose)",
      "What to Listen For",
      "What to leave behind",
      "Links to assets might need",
    ],
  },
];

export const HIGH_VALUE_ACTIVITIES: {
  name: string;
  definition: string;
}[] = [
  // slides 101, 107
  {
    name: "Assessment",
    definition:
      "Discovery-led technical evaluation used to understand a customer’s landscape, identify pain points and blockers, and build a prioritized modernization path leveraging Azure services.",
  },
  {
    name: "RFP/RFI",
    definition:
      "A process of translating customer requirements into a clear, compliant, and differentiated solution proposal that demonstrates business value and technical fit.",
  },
  {
    name: "Technical Workshop",
    definition:
      "A structured, interactive session focused on deepening technical understanding, enabling skills, or working through specific scenarios related to a solution, platform, or workload.",
  },
  { name: "Workshop", definition: "" },
  {
    name: "Solution Whiteboarding",
    definition:
      "A collaborative process of visually mapping a customer’s business challenges, architecture, and proposed solution to align stakeholders and validate the approach before implementation.",
  },
  {
    name: "Architecture Design Session",
    definition:
      "A structured, collaborative workshop between the customer and Solution Engineers to design, validate, and document a target-end architecture that meets the customer’s business and technical requirements.",
  },
  {
    name: "Demo",
    definition:
      "A live or guided demonstration of a solution’s capabilities designed to show how the technology works in practice and how it meets a customer’s specific technical and business requirements.",
  },
  {
    name: "L300+ Demo",
    definition: "L300+ goes into deeper technical features of services and capabilities.",
  },
  {
    name: "Rapid Prototyping",
    definition:
      "A practice of quickly building and testing an early version of a solution to validate ideas, gather feedback, and refine the design before full-scale deployment.",
  },
  {
    name: "POC/Pilot",
    definition:
      "A time-bound, controlled implementation used to validate that a solution can technically meet defined success criteria in a real or near-real customer environment before full commitment or scale-out.",
  },
  {
    name: "Technical Close/Win Plan",
    definition:
      "A structured, mutual plan that defines all technical requirements, validations, milestones, and decision criteria that must be met for a deal to be successfully approved and won from a technical standpoint.",
  },
  {
    name: "Blocker Escalation",
    definition:
      "A structured elevation of a technical constraint, risk, or unresolved dependency that prevents a solution from meeting required design, validation, security, performance, or compliance criteria, and cannot be resolved within the delivery or solution team’s authority.",
  },
  {
    name: "Consumption Plan",
    definition:
      "A customer-aligned plan that defines how Azure services will be actively used over time to drive forecastable Azure Consumed Revenue, translating solution deployment into measurable, sustained consumption.",
  },
];

export const COMMITMENT_CRITERIA: string[] = [
  // slide 111
  "Customer Sponsor has agreed to outcome",
  "Milestone Date and value are confirmed with customer",
  "Delivery and customer resources, and required budget are available",
  "Customer contact ready and briefed on next steps",
];

export const HANDOFF_STEPS: string[] = [
  // slide 110
  "STU (Specialist/SE) adds #RTC (Ready to Commit) to the milestone title.",
  "STU and CSU conduct handoff conversations.",
  "STU removes #RTC from the milestone title, flips to Committed and transition ownership to CSU.",
];

export const TCP_GUIDANCE: string[] = [
  // slide 110
  "Create the TCP upon milestone creation, update regularly and finish after tech wins.",
  "TCP outlines the plan to secure customer agreement on Production milestone details.",
  "TCP is not required for other milestone types.",
  "For multi-workload Production milestones, the Pod Lead SE consolidates all SE inputs into one TCP.",
  "CSAM & CSA lead ongoing delivery activities after transition.",
  "STU/CSU alignment within 7 days prior to ownership transition.",
];

export const MSX_NOTES_PRACTICE: string[] = [
  // slide 116
  "Specificity: Avoid vague terms like follow-up or discuss.",
  "Customer-Centric: Tie every note to a business outcome or technical milestone.",
  "Actionable: Include next steps with owners and deadlines.",
  "Aligned: Reflect orchestration with Specialist, CSU, and partners.",
  "Header Section: Opportunity Name, Customer Name, Solution Area, Date of Meeting.",
  "Meeting Summary: Key Discussion Points, Customer Priorities & Pain Points.",
  "Action Items: Owner | Task | Due Date.",
  "MSX Milestone Updates: Current Stage, Next Steps, Risks & Mitigation.",
  "Attachments/Links: Related Docs, Loop Workspace.",
];

export const KNOW_THE_TECHNOLOGY: string[] = [
  // slide 117
  "Speak their criteria: security, compliance, cost, risk — not features.",
  "Lead with interoperability & open standards to defuse lock-in fears.",
  "Arm an internal champion to advocate to the board.",
  "Play the long game on the roadmap. If not approved today, get to the next review cycle.",
  "Keep a living current-state architecture map; refresh it quarterly.",
  "Tiered rhythm: daily roadmap skim, weekly deep-dive, monthly lab or cert.",
  "Act as authoritative Microsoft resource and provide official Azure roadmap often.",
  "Read usage telemetry — Azure spend, M365 & Copilot adoption, security posture.",
  "Map who owns the approved-tech list and how items get added/removed.",
  "Know the competition (AWS, GCP, Salesforce) and where Microsoft wins.",
];

export const STAGE_GUIDE: {
  stage: string;
  challenges: string[];
  actions: string[];
}[] = [
  // slide 114
  {
    stage: "Listen & Consult",
    challenges: [
      "Qualification Clutter: Pipeline clogged with low-quality or unready opportunities.",
      "Undefined Qualification Criteria: A lack of clear criteria for what makes an opportunity qualified leads to inconsistency.",
      "Insufficient Customer Insights: In this early phase, you may not have enough insight into the customer’s business.",
    ],
    actions: [
      "Follow Strict Qualification Criteria: Use BANT (Budget, Authority, Need, Timeline) to re-qualify.",
      "Nurture or Disqualify Early: If an opportunity isn’t ready or fully qualified, don’t let it stagnate in the pipe.",
      "Focus on High-Quality Opportunity: Spend time on the right leads, not just any leads.",
      "Deep Listening: Practice active listening. Understand the customer’s industry, business model, and possible challenges before the first meeting.",
    ],
  },
  {
    stage: "Inspire & Design",
    challenges: [
      "Maintaining Momentum: Qualified deals can stall in this stage if the excitement fades or if next steps aren’t clear.",
      "Solution Misalignment: Misalignment can occur from inadequate discovery or from assuming one-size-fits-all.",
      "SE Orchestration: Coordinating multiple team members and ensuring everyone presents a unified vision can be challenging.",
    ],
    actions: [
      "Align on Customer’s Vision: Re-confirm and refine the customer’s needs.",
      "Collaborate as One Team: Internally, break down silos to co-develop the solution and act in unity.",
      "Inspire with Value: Paint the picture of business value and outcomes.",
      "Manage and monitor engagement: Keep tight control of the deal’s progress.",
    ],
  },
  {
    stage: "Empower & Achieve",
    challenges: [
      "Complex Stakeholder Management: Deals often involve many stakeholders on the customer side.",
      "Formal Approvals and Process Hurdles: Large deals often go through formal processes including security reviews, architecture assessments, and legal reviews.",
      "Proving Technical Value: Demonstrate that the Azure solution meets all technical requirements.",
    ],
    actions: [
      "Provide Robust Proof of Concept: Conduct a well-defined proof of concept or pilot implementation on Azure that tackles a key part of the customer’s use case.",
      "Quantify Business Impact: Co-develop a strong business case for the solution with SE.",
      "Map and Tackle Stakeholder Requirement: Perform a stakeholder analysis and ensure every influencer’s criteria is addressed.",
    ],
  },
  {
    stage: "Realize Value",
    challenges: [
      "STU to CSU Handoff Gaps: A frequent challenge is the handoff between the sales team and the Customer Success team.",
      "Delivering on Expectation: The customer’s excitement drops if onboarding is rocky.",
      "Cross-Team Coordination: Implementation often involves multiple parties.",
    ],
    actions: [
      "Seamless Handoff: Treat the STU-to-CSU handoff as a critical project milestone, not an afterthought.",
      "Preserve and Fulfill Promises: The sales team should convey all customer expectations and promises made to the delivery teams.",
      "Close Deployment Collaboration: Maintain a collaborative partnership throughout the deployment.",
    ],
  },
];

export const WORKSHOP_VS_POC: {
  name: string;
  definition: string;
  when: string;
}[] = [
  // slides 83-87
  {
    name: "Technical Workshop",
    definition:
      "Workshop results in a working MVP or pilot that uses customer data in a sandbox environment or customer tenant and accelerates the customer technical decision.",
    when: "Workshops may or may not be executed directly after a Solution Envisioning session.",
  },
  {
    name: "Live Technical Demo",
    definition:
      "Pre-built tenants — the same environments used for Live hosted demos — aligned to each conversation and its components.",
    when: "Stages 2 | Envisioning → Workshop.",
  },
  {
    name: "Architecture/Whiteboarding",
    definition:
      "Whiteboarding Architecture design using Reference Architectures. Goal is to create deployable Bicep/ARM templates from those Whiteboards.",
    when: "Stage 2 | Technical Workshop.",
  },
  {
    name: "Rapid Prototyping",
    definition: "Rapidly build working prototypes in a sandbox environment.",
    when: "Stages 2–3 | Workshop → Prototype.",
  },
  {
    name: "Hands-on Keyboard POC/Pilot",
    definition:
      "The deepest technical engagement where Tech Seller/Partner co-build alongside the customer’s engineering team in a hands-on environment.",
    when: "Stage 3 | POC/Pilot.",
  },
  {
    name: "Gold Solution Accelerators",
    definition:
      "Production-grade, fully validated solution templates that provide a proven starting point for common AI workloads and architectures.",
    when: "Stage 3 | POC/ Pilot.",
  },
  {
    name: "POC Accelerators",
    definition:
      "Ready-to-deploy proof-of-concept kits with pre-configured environments, sample data, and guided scenarios that fast-track technical validation.",
    when: "Stage 3 | POC/ Pilot.",
  },
  {
    name: "Cloud Accelerate Framework",
    definition:
      "A structured methodology and toolset for planning, executing, and measuring cloud adoption milestones with governance and cost controls built in.",
    when: "Stage 3 | POC/ Pilot.",
  },
  {
    name: "Partners Solutions",
    definition:
      "Pre-vetted partner implementations and co-sell solutions that extend platform capabilities with industry expertise, custom integrations, and managed services.",
    when: "Stage 3 | POC/ Pilot.",
  },
];

export const PLAYBOOK_SOURCE = "FY27 Cloud + AI Solution Engineers Playbook (September 2026)";
