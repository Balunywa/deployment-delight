/*
 * The bundled catalog's curated content: what each solution is, in its maintainers' words where they have them
 * (README, docs, official diagrams), and caveats verified against the repository. Inspection (services, IaC,
 * checks) is done by scripts/gen-energy-catalog.ts at a pinned commit; nothing here is invented.
 */
import type { ImportCheck } from "../src/lib/catalog-import.functions";
import type { CuratedStory } from "../src/lib/solution-story";

/** A curated story; diagram paths are resolved to the imported commit. */
export type EntryStory = Omit<CuratedStory, "diagrams"> & {
  diagrams?: { title: string; path: string; caption?: string }[];
};

export type Entry = {
  /** Fixed: ids are derived from it, so it never changes once published. */
  n: number;
  url: string;
  name: string;
  category: string;
  description: string;
  audience: string;
  outcome: string;
  tags: string[];
  /** Release tag to version from; otherwise the commit date. */
  release?: string;
  /** The release before it, imported too, so there's a real upgrade path. */
  previous?: string;
  /** Self-contained platforms can also run in your own Azure, one subscription per customer. */
  hosted?: boolean;
  supportUrl?: string;
  /** Services the code consumes rather than creates (e.g. an existing ADME instance). */
  consumes?: string[];
  caveats?: ImportCheck[];
  story?: EntryStory;
  publish: boolean;
  /** Recommended by the catalog owner: shown first. */
  featured?: boolean;
};

export const ENTRIES: Entry[] = [
  {
    n: 7,
    url: "https://github.com/microsoft/Multi-Agent-Custom-Automation-Engine-Solution-Accelerator",
    name: "Multi-Agent Custom Automation Engine",
    category: "Operations & AI",
    description:
      "Teams of AI agents that plan, carry out and check multi-step business tasks on Microsoft Foundry. A planner drafts the plan, a person approves it, and specialized agents do the work.",
    audience: "Operations, engineering and back-office teams with multi-step, cross-team processes",
    outcome:
      "Cross-team tasks planned and executed by AI agents, with a person approving every plan",
    tags: ["foundry", "agents", "agent-framework", "automation"],
    hosted: true,
    featured: true,
    caveats: [
      {
        id: "quota",
        level: "warning",
        title: "Check Foundry model quota and region first",
        detail:
          "The README asks you to check Azure OpenAI quota before deploying, in a region that offers Foundry models, Azure AI Search and its semantic ranker (for example East US 2 or Sweden Central).",
      },
      {
        id: "responsible-ai",
        level: "warning",
        title: "You own the risk assessment for what the agents do",
        detail:
          "Per the README, assess the risks of the solutions you build with it and comply with applicable laws; see the Agent Service and Agent Framework transparency notes.",
      },
    ],
    story: {
      source: "Project README and diagrams",
      overview: [
        "When dealing with complex organizational tasks, people face coordinating across departments, keeping processes consistent and using resources well. This accelerator lets a user describe a task and have it processed by a group of AI agents, each specialized in a different part of the business.",
        "It runs on Microsoft Foundry and Agent Framework: a planner builds the plan from a team of agents, a person reviews it, and the agents carry it out step by step. Teams ship for contract review, RFP review, content generation and more, and new teams are configured rather than coded. In oil and gas that maps to work such as contract and procurement review, or packaging work for a maintenance turnaround.",
      ],
      benefits: [
        {
          title: "People focus on what matters",
          body: "The agents do the heavy lifting of coordinating activities across the organization, so people spend their time on their specialisms.",
        },
        {
          title: "Generative AI that scales",
          body: "One capability unlocks many use cases, without building one application after another.",
        },
        {
          title: "Efficient, checked automation",
          body: "Analysing, planning and executing complex tasks takes less time, and multi-agent validation keeps the result accurate.",
        },
      ],
      steps: [
        {
          title: "A person describes the task",
          body: "Users work in the web app on App Service, describing what they need in plain language.",
          services: ["app-service"],
        },
        {
          title: "The planner drafts a plan",
          body: "The API on Container Apps runs Agent Framework's Magentic orchestration: the planner picks a team of specialized agents and drafts a step-by-step plan.",
          services: ["container-apps"],
        },
        {
          title: "A person approves it",
          body: "Human in the loop: the plan is shown for review before anything runs.",
          services: [],
        },
        {
          title: "Agents do the work",
          body: "The group chat manager runs the plan step by step. Each agent (for example triage, research or compliance) runs on Foundry Agent Service with Foundry models (GPT-4.1 and o4).",
          services: ["ai-foundry"],
        },
        {
          title: "Grounded in your data and tools",
          body: "Agents retrieve knowledge through Azure AI Search over documents in Storage and Foundry IQ, and call tools through an MCP server on Container Apps.",
          services: ["ai-search", "storage"],
        },
        {
          title: "Every plan is kept",
          body: "Cosmos DB stores current and past plans, steps and results. Container Registry holds the web and API images, built automatically from the source.",
          services: ["cosmos", "container-registry"],
        },
      ],
      diagrams: [
        { title: "Solution architecture", path: "docs/images/readme/architecture.png" },
        {
          title: "How the agents work",
          path: "docs/images/readme/agent_flow.png",
          caption:
            "The Magentic planner builds a plan from teams of agents, a person approves it, and the group chat manager runs it.",
        },
      ],
      scenario: {
        title: "Business scenario",
        body: "Companies maintaining and modernizing their business processes often struggle to coordinate complex tasks across departments. With this accelerator those processes are automated, and every task is coordinated and executed consistently.",
        points: [
          "Coordinating activities across different departments",
          "Time-consuming manual management of complex workflows",
          "Errors from manual coordination",
          "Too few people to meet growing automation demand",
        ],
      },
      deploy: {
        command: "azd up",
        guide: "docs/DeploymentGuide.md",
        prerequisites: [
          "Azure Developer CLI 1.18.0 or later",
          "Permission to create resource groups and resources",
          "Foundry model quota in a supported region",
        ],
      },
    },
    publish: true,
  },
  {
    n: 8,
    url: "https://github.com/microsoft/real-time-intelligence-operations-solution-accelerator",
    name: "Real-Time Intelligence for Operations",
    category: "Data & Real-Time Intelligence",
    description:
      "Live and historical equipment telemetry in Microsoft Fabric: a real-time operations dashboard, anomaly detection with email alerts, and a data agent that answers questions about how assets are running.",
    audience: "Operations, reliability and maintenance teams",
    outcome:
      "Equipment problems spotted as they happen, and answers about operations in plain language",
    tags: ["fabric", "real-time-intelligence", "telemetry", "anomaly-detection"],
    caveats: [
      {
        id: "industry",
        level: "warning",
        title: "Built for manufacturing telemetry",
        detail:
          "The simulator, dashboards and rules model manufacturing assets. The README says it adapts to other industries: connect your sources to Event Hubs and update the KQL queries, Activator rules and agent instructions.",
      },
      {
        id: "fabric",
        level: "warning",
        title: "Needs Microsoft Fabric in the tenant",
        detail:
          "It deploys a Fabric capacity and workspace, so Fabric must be enabled for the tenant; sign in with both azd and the Azure CLI before deploying.",
      },
    ],
    story: {
      source: "Project README and architecture diagram",
      overview: [
        "A complete real-time intelligence platform on Microsoft Fabric: it analyzes live and historical telemetry through interactive dashboards, detects anomalies and sends alerts, and includes an AI data agent for conversational insights.",
        "In oil and gas, connect compressor, pump and pipeline telemetry, or well-pad SCADA, to Event Hubs in place of the simulator. The dashboard tiles, anomaly rules and agent instructions are where you make it yours.",
      ],
      benefits: [
        {
          title: "A live view of every asset",
          body: "A Real-Time Intelligence dashboard shows how assets are performing and individual sensor trends, from Eventhouse.",
        },
        {
          title: "Anomalies raise the alarm",
          body: "Activator watches the stream with anomaly-detection rules and emails the team when one fires.",
        },
        {
          title: "Ask your telemetry questions",
          body: "A Fabric Data Agent answers live operational questions in plain language.",
        },
      ],
      steps: [
        {
          title: "Telemetry streams in",
          body: "A simulator loads 90 days of history and then streams live events into Azure Event Hubs. Your own sources connect here.",
          services: ["event-hubs"],
        },
        {
          title: "Fabric ingests it",
          body: "Fabric Eventstream takes the stream into Eventhouse, a KQL database on OneLake.",
          services: ["fabric"],
        },
        {
          title: "Dashboards update live",
          body: "The Real-Time Dashboard queries Eventhouse for asset performance and sensor trends.",
          services: [],
        },
        {
          title: "Anomalies send alerts",
          body: "Activator applies anomaly-detection rules to the stream and sends an email alert when one fires.",
          services: [],
        },
        {
          title: "Ask in plain language",
          body: "A Fabric Data Agent answers questions over the telemetry in Eventhouse.",
          services: [],
        },
      ],
      diagrams: [{ title: "Architecture", path: "docs/images/readme/solution-architecture.png" }],
      deploy: {
        command: "azd up",
        guide: "docs/DeploymentGuide.md",
        prerequisites: [
          "Microsoft Fabric enabled in the tenant",
          "Azure Developer CLI and Azure CLI, both signed in",
        ],
      },
    },
    publish: true,
  },
  {
    n: 9,
    url: "https://github.com/microsoft/content-processing-solution-accelerator",
    name: "Content Processing",
    category: "Operations & AI",
    description:
      "Extracts structured data from documents (text, images, tables and forms) with Azure AI Content Understanding and Azure OpenAI, maps it to your schemas with confidence scores, and summarizes and gap-checks multi-document cases.",
    audience: "Operations and engineering teams that process document-heavy cases",
    outcome:
      "Documents turned into validated, structured data, with people reviewing only what's uncertain",
    tags: ["foundry", "content-understanding", "documents", "agent-framework"],
    caveats: [
      {
        id: "industry",
        level: "warning",
        title: "Built for insurance claims",
        detail:
          "The sample schemas and workflow are insurance claims; the README lists contract review, invoices and shipment records as other uses. Define your own schemas for energy documents.",
      },
      {
        id: "v2",
        level: "warning",
        title: "Version 2 has breaking changes",
        detail:
          "The README warns of breaking changes in the agentic version; the previous version is on the cps-v1 branch. Deployment also builds the images into Container Registry and runs a post-deploy script.",
      },
    ],
    story: {
      source: "Project README and architecture diagram",
      overview: [
        "The content processing engine handles text, images, tables and graphs with schema-based transformation and confidence scoring. Each document runs through a four-stage pipeline (extract, map, evaluate, save), and a workflow summarizes and gap-checks every document in a case.",
        "In oil and gas, point it at inspection reports, permits, run tickets or equipment datasheets: define a schema and it extracts the fields with a confidence score for each, so people review only what's uncertain.",
      ],
      benefits: [
        {
          title: "Extraction you can trust",
          body: "Every extraction and schema mapping is scored for accuracy, so the uncertain ones are flagged for human validation.",
        },
        {
          title: "Whole cases, not single files",
          body: "Upload many documents to one case; the workflow summarizes them and finds gaps across all of them.",
        },
        {
          title: "Your schemas",
          body: "Schemas define what to extract, so the same engine serves new document types without new code.",
        },
      ],
      steps: [
        {
          title: "Upload the documents",
          body: "Users upload files to a case through the web UI, or call the API; both run on Container Apps.",
          services: ["container-apps"],
        },
        {
          title: "Queued for processing",
          body: "The API queues the work on Storage queues and the content processor picks it up.",
          services: ["storage"],
        },
        {
          title: "Extract and map",
          body: "Azure AI Content Understanding extracts text, tables and images; Azure OpenAI maps them to your schema with confidence scores.",
          services: ["ai-foundry"],
        },
        {
          title: "Summarize and find gaps",
          body: "An Agent Framework workflow summarizes the whole case and finds what's missing across its documents.",
          services: [],
        },
        {
          title: "Results are kept",
          body: "Results go to Blob storage, and task status and history to Cosmos DB; App Configuration and Container Registry support the apps.",
          services: ["cosmos", "app-configuration", "container-registry"],
        },
      ],
      diagrams: [{ title: "Architecture", path: "docs/images/readme/solution-architecture.png" }],
      deploy: { command: "azd up", guide: "docs/DeploymentGuide.md" },
    },
    publish: true,
  },
  {
    n: 10,
    url: "https://github.com/microsoft/Conversation-Knowledge-Mining-Solution-Accelerator",
    name: "Conversation Knowledge Mining",
    category: "Operations & AI",
    description:
      "Mines large volumes of conversations and documents (transcripts, recordings, reports) for entities, topics and relationships, then lets people explore them through chat and an insights dashboard the model plans itself.",
    audience:
      "Analysts, HSE and operations teams working through large volumes of text and recordings",
    outcome: "Patterns and answers from unstructured conversations, without manual review",
    tags: ["foundry", "content-understanding", "knowledge-mining", "search"],
    caveats: [
      {
        id: "industry",
        level: "warning",
        title: "Sample packs are contact centre, mortgage and telecom",
        detail:
          "Bring your own files or connect an existing index; nothing ships for energy. Check model quota in a region that offers Content Understanding (for example Australia East or Sweden Central).",
      },
    ],
    story: {
      source: "Project README and architecture diagram",
      overview: [
        "Upload or connect conversational data and it runs through an AI extraction pipeline, then you explore it through an interactive chat and an auto-generated insights dashboard.",
        "In oil and gas, that's shift-handover logs, control-room or field radio transcripts, and incident and near-miss narratives: patterns surface without anyone reading every record.",
      ],
      benefits: [
        {
          title: "Mined entities and relationships",
          body: "Content Understanding and Azure OpenAI extract entities, topics and relationships to build a richer knowledge base.",
        },
        {
          title: "Ask, follow up, get citations",
          body: "Ask contextual questions and get grounded answers with citations.",
        },
        {
          title: "Dashboards that plan themselves",
          body: "The model reads your data's schema and plans the KPIs and charts for it.",
        },
      ],
      steps: [
        {
          title: "Load your data",
          body: "Upload PDF, Word, JSON, CSV, text, images or audio, or load a sample pack. Uploads are acknowledged at once and processed in the background through Storage queues.",
          services: ["storage"],
        },
        {
          title: "AI extracts the knowledge",
          body: "Content Understanding and Azure OpenAI extract text, summaries, topics and key phrases; embeddings are indexed in AI Search and metadata kept in Azure SQL.",
          services: ["ai-foundry", "ai-search", "sql"],
        },
        {
          title: "Explore by chat",
          body: "Questions go to a Foundry ChatAgent with two tools, AI Search for semantic retrieval and SQL for structured analytics, which reasons across both.",
          services: [],
        },
        {
          title: "Insights plan themselves",
          body: "The model reads the dataset's schema and builds an adaptive dashboard of KPIs and charts.",
          services: [],
        },
        {
          title: "Served from App Service",
          body: "The web app and API run on App Service; Azure SQL keeps chat history and the enrichment cache.",
          services: ["app-service"],
        },
      ],
      diagrams: [{ title: "Architecture", path: "docs/images/architecture.svg" }],
      deploy: { command: "azd up", guide: "docs/DeploymentGuide.md" },
    },
    publish: true,
  },
  {
    n: 11,
    url: "https://github.com/Azure-Samples/chat-with-your-data-solution-accelerator",
    name: "Chat with Your Data",
    category: "Operations & AI",
    description:
      "A conversational assistant grounded in your own documents, answering with inline citations back to the source, with an ingestion pipeline, content safety and voice input.",
    audience:
      "Field, engineering and HSE staff who need answers from manuals, standards and procedures",
    outcome: "Grounded answers from your documents, with the source cited",
    tags: ["foundry", "rag", "search", "assistant"],
    caveats: [
      {
        id: "starting-point",
        level: "warning",
        title: "A starting point, not a turnkey system",
        detail:
          "Per the README, evaluate retrieval quality, answer accuracy and responsible AI behaviour on your own content before relying on it.",
      },
    ],
    story: {
      source: "Project README",
      overview: [
        "Organizations hold vast unstructured knowledge in contracts, policies and product manuals that is hard to search. Chat with Your Data indexes that content and puts a natural-language chat in front of it, with answers cited back to the source.",
        "In oil and gas, that's operating procedures, OEM manuals, engineering standards and HSE procedures, answered at the point of work.",
      ],
      benefits: [
        {
          title: "Answers you can check",
          body: "Responses are grounded in your indexed content, with inline citations back to the source documents.",
        },
        {
          title: "Bring your documents",
          body: "Upload files or index web pages; the pipeline parses, chunks and embeds many file types.",
        },
        {
          title: "No secrets to manage",
          body: "One user-assigned managed identity and Azure RBAC authorize every call: no Key Vault, no application secrets.",
        },
      ],
      steps: [
        {
          title: "Documents are ingested",
          body: "Uploaded documents or web pages land in Storage; a queue triggers the ingestion worker, which parses, chunks and embeds them into the index.",
          services: ["storage", "functions"],
        },
        {
          title: "A user asks",
          body: "People chat in a React app on Container Apps, by typing or by voice.",
          services: ["container-apps"],
        },
        {
          title: "Retrieve and ground",
          body: "The backend retrieves the most relevant passages from AI Search (or PostgreSQL with pgvector) and grounds a Foundry model on them.",
          services: ["ai-search", "ai-foundry"],
        },
        {
          title: "Safe, cited answers",
          body: "Content Safety screens prompts and responses, the answer streams back with citations, and chat history is kept in Cosmos DB or PostgreSQL.",
          services: ["cosmos"],
        },
        {
          title: "One identity",
          body: "A single user-assigned managed identity with RBAC authorizes every downstream call.",
          services: ["managed-identity"],
        },
      ],
      deploy: { command: "azd up" },
    },
    publish: true,
  },
  {
    n: 12,
    url: "https://github.com/microsoft/agentic-applications-for-unified-data-foundation-solution-accelerator",
    name: "Agentic Apps on a Unified Data Foundation",
    category: "Data & Real-Time Intelligence",
    description:
      "Agents built with Microsoft Foundry and Agent Framework that answer questions over governed enterprise data in Microsoft Fabric, through a web app or Copilot Studio.",
    audience: "Business and operations users who need answers from enterprise data",
    outcome: "Plain-language answers over governed Fabric data, in the flow of work",
    tags: ["fabric", "foundry", "agents", "agent-framework"],
    caveats: [
      {
        id: "industry",
        level: "warning",
        title: "Scenario packs are retail and financial services",
        detail:
          "The bundled data is synthetic retail and financial-services data; a custom-data path lets you bring your own. Fabric tenant settings must be enabled, and a build script runs after azd up.",
      },
    ],
    story: {
      source: "Project README and architecture diagram",
      overview: [
        "Build and scale agentic AI workflows on Fabric, grounded in governed enterprise data and configured with scenario packs. Microsoft Foundry agents and Agent Framework orchestration query structured data in SQL Database in Fabric and return insights through a web front end.",
        "In oil and gas, load production, maintenance or trading data and ask questions like which wells are underperforming this month, without building a dashboard first.",
      ],
      steps: [
        {
          title: "A user asks",
          body: "People ask questions in the web front end, served by App Service.",
          services: ["app-service"],
        },
        {
          title: "Agents orchestrate",
          body: "The API runs Agent Framework orchestration: a chat agent on Foundry Agent Service with Azure OpenAI, and a SQL tool.",
          services: ["ai-foundry"],
        },
        {
          title: "Grounded in Fabric data",
          body: "The SQL tool queries SQL Database in Fabric over the unified data foundation on OneLake.",
          services: ["fabric"],
        },
        {
          title: "Answers come back",
          body: "The agent answers in plain language; chat history is kept in SQL Database in Fabric.",
          services: [],
        },
      ],
      diagrams: [
        { title: "Architecture", path: "documents/Images/ReadMe/solution-architecture.png" },
      ],
      deploy: { command: "azd up" },
    },
    publish: true,
  },
  {
    n: 13,
    url: "https://github.com/microsoft/unified-data-foundation-with-fabric-solution-accelerator",
    name: "Unified Data Foundation with Fabric",
    category: "Data & Real-Time Intelligence",
    description:
      "A medallion lakehouse on OneLake (bronze, silver, gold) with data models, notebooks, Power BI semantic models and dashboards, a Fabric Data Agent and Copilot for Power BI, with Purview and Databricks as options.",
    audience: "Data platform teams building an analytics foundation",
    outcome: "A governed data foundation that reports and agents can build on",
    tags: ["fabric", "onelake", "lakehouse", "power-bi"],
    caveats: [
      {
        id: "industry",
        level: "warning",
        title: "Data models are customer, product, sales and finance",
        detail:
          "The schemas, notebooks, semantic models and dashboards are a cohesive set for those domains; adapting to energy data means changing them together, as the README notes.",
      },
    ],
    story: {
      source: "Project README and architecture diagram",
      overview: [
        "A flexible, plug-and-play data foundation: deploy the core Microsoft Fabric medallion lakehouse alone, or with Microsoft Purview for governance and Azure Databricks for cross-platform analytics.",
        "In oil and gas, it's the base for production, maintenance and commercial data domains, which the agentic and real-time accelerators can then build on.",
      ],
      steps: [
        {
          title: "Source data lands",
          body: "Source data is ingested into the bronze layer of a Fabric lakehouse; Databricks data can be mirrored in.",
          services: ["fabric"],
        },
        {
          title: "Validated and enriched",
          body: "Notebooks, dataflows and pipelines validate it into silver and enrich it into gold.",
          services: [],
        },
        {
          title: "Modelled by domain",
          body: "A data mesh of semantic models serves each domain.",
          services: [],
        },
        {
          title: "Reported and questioned",
          body: "Power BI dashboards, Copilot for Power BI and a Fabric Data Agent answer business questions; Purview catalogs and governs the data.",
          services: [],
        },
      ],
      diagrams: [{ title: "Architecture", path: "docs/images/readme/solution-architecture.png" }],
      deploy: { command: "azd up" },
    },
    publish: true,
  },
  {
    n: 1,
    url: "https://github.com/Azure/osdu-developer",
    name: "OSDU Developer Platform",
    category: "Upstream & Resources",
    description:
      "A personal OSDU data platform on AKS for building and testing subsurface applications against well, wellbore, log and seismic data. Cosmos DB, Storage and Key Vault sit behind private endpoints, and Flux deploys the OSDU services.",
    audience: "Subsurface application developers and energy data platform teams",
    outcome:
      "A working OSDU instance to build against, without a full Data Manager for Energy rollout",
    tags: ["osdu", "subsurface", "aks", "gitops"],
    release: "v0.47.0",
    previous: "v0.46.0",
    hosted: true,
    supportUrl: "https://azure.github.io/osdu-developer/",
    caveats: [
      {
        id: "aks-preview",
        level: "warning",
        title: "Uses AKS preview features",
        detail:
          "The README lists the Azure Container Service preview features it needs; register them in the target subscription before deploying.",
      },
    ],
    story: {
      source: "Project README and architecture diagram",
      overview: [
        "OSDU is the open standard for subsurface and well data. This is a developer-tier OSDU you own end to end, for building and testing applications against real OSDU APIs without waiting for a full Azure Data Manager for Energy rollout.",
        "Deploy it with the Azure Developer CLI from a Codespace or your machine. From then on Flux keeps the cluster in step with Git, so the components and applications you add are versioned like code.",
      ],
      benefits: [
        {
          title: "Real OSDU in your own subscription",
          body: "The same OSDU services and APIs your applications will use in production, on infrastructure you control.",
        },
        {
          title: "GitOps from day one",
          body: "Flux installs OSDU components and applications from Git, so every change is reviewed and repeatable.",
        },
        {
          title: "Production-like resilience",
          body: "Node pools spread across three availability zones, with the data services kept private to the cluster's network.",
        },
      ],
      steps: [
        {
          title: "Deploy from Git",
          body: "An engineer deploys with azd from a Codespace or locally. Flux GitOps then installs the OSDU components and applications into AKS from the Git repository.",
          services: ["aks"],
        },
        {
          title: "Users reach OSDU",
          body: "External users come in through a public IP and the external load balancer; internal users through an internal load balancer.",
          services: ["network-spoke"],
        },
        {
          title: "AKS runs the services",
          body: "OSDU services run on AKS across a default pool, an internal pool and three zoned pools, one per availability zone, with autoscale and Azure Policy.",
          services: ["aks"],
        },
        {
          title: "Managed services hold the data",
          body: "Storage accounts, Cosmos DB, Service Bus, Key Vault and Azure Cache for Redis hold OSDU data, messages, secrets and cache, reached from the cluster's virtual network.",
          services: ["storage", "cosmos", "key-vault", "private-endpoints"],
        },
        {
          title: "Configured and observed",
          body: "App Configuration holds the settings and Container Registry the images; Log Analytics and Application Insights collect logs and traces.",
          services: ["app-configuration", "monitoring"],
        },
      ],
      diagrams: [{ title: "Architecture", path: "docs/src/images/architecture.png" }],
      deploy: {
        command: "azd up",
        guide: "https://azure.github.io/osdu-developer/",
        prerequisites: [
          "Azure Developer CLI",
          "The AKS preview features listed in the README, registered in the subscription",
        ],
      },
    },
    publish: true,
  },
  {
    n: 2,
    url: "https://github.com/microsoft/azure-data-manager-for-energy-experience-lab",
    name: "ADME Experience Lab",
    category: "Upstream & Resources",
    description:
      "Creates an Azure Data Manager for Energy developer-tier instance loaded with the TNO open well and wellbore dataset, with a web portal and Power BI reports to explore it. Built for demos, training and evaluation.",
    audience: "Energy data teams evaluating Azure Data Manager for Energy",
    outcome: "A loaded Data Manager for Energy instance to evaluate with real well data",
    tags: ["adme", "osdu", "tno", "training"],
    hosted: true,
    caveats: [
      {
        id: "non-production",
        level: "warning",
        title: "For non-production use",
        detail: "The README recommends the Experience Lab only for non-production use cases.",
      },
    ],
    story: {
      source: "Project README",
      overview: [
        "Experience Lab is an automated, end-to-end deployment accelerator for Azure Data Manager for Energy, with sample data for learning, testing, demos and training.",
        "It creates a Developer-tier instance and includes a simple web UI for basic management (users, legal tags, loading standard sample datasets), so even a non-technical audience can stand up a fully configured, data-loaded instance quickly.",
      ],
      steps: [
        {
          title: "Deploy the control plane",
          body: "A Deploy to Azure template creates the control plane in your subscription: storage, a container registry and template specs.",
          services: ["storage", "container-registry"],
        },
        {
          title: "It creates the instance",
          body: "The control plane creates an Azure Data Manager for Energy developer-tier instance and registers its application in Microsoft Entra ID.",
          services: ["adme"],
        },
        {
          title: "Sample data loads",
          body: "Data-load jobs on Container Instances load the TNO sample well and wellbore dataset.",
          services: ["container-instances"],
        },
        {
          title: "Explore it",
          body: "A web portal handles basic management (users, legal tags, data loads), with REST scripts, Swagger and Power BI reports to check the data.",
          services: [],
        },
      ],
      deploy: {
        command: "Deploy to Azure (ARM template)",
        guide: "control-plane",
        prerequisites: [
          "Owner, or Contributor and User Access Administrator, on the subscription",
          "Permission to register an application in Microsoft Entra ID",
          "A region that offers Azure Data Manager for Energy",
        ],
      },
    },
    publish: true,
  },
  {
    n: 3,
    url: "https://github.com/Azure/osdu-spi-stack",
    name: "OSDU on AKS Automatic",
    category: "Upstream & Resources",
    description:
      "Runs OSDU on AKS Automatic with Azure-native services (Cosmos DB, Service Bus, Storage and Key Vault), workload identity, Flux GitOps and multiple data partitions.",
    audience: "Platform teams that operate OSDU themselves",
    outcome: "Azure-native OSDU on managed Kubernetes, with partitions per business unit",
    tags: ["osdu", "aks-automatic", "gitops", "multi-partition"],
    release: "v0.23.0",
    previous: "v0.22.0",
    hosted: true,
    caveats: [
      {
        id: "non-production",
        level: "warning",
        title: "Not intended for production deployments",
        detail:
          "Stated in the README. Its spi CLI installs the stack end to end in about 45 to 50 minutes.",
      },
    ],
    story: {
      source: "Project README and architecture diagram",
      overview: [
        "The SPI stack runs OSDU on AKS Automatic, where Azure manages the cluster's nodes, upgrades and Istio, and backs OSDU with Azure-native services instead of in-cluster equivalents wherever it can.",
        "One command provisions everything and hands over to GitOps, and multiple data partitions let one deployment serve several business units.",
      ],
      steps: [
        {
          title: "One command deploys it",
          body: "An engineer or CI runs spi up: Bicep provisions the Azure resources and bootstraps GitOps.",
          services: [],
        },
        {
          title: "GitOps installs OSDU",
          body: "Flux controllers in AKS Automatic apply the OSDU sources and configuration from the Git repository.",
          services: ["aks"],
        },
        {
          title: "Clients call OSDU",
          body: "API clients reach OSDU over HTTPS through the spi-gateway on the managed Istio ingress.",
          services: [],
        },
        {
          title: "Azure services hold the data",
          body: "OSDU workloads use Cosmos DB (SQL and Gremlin), Service Bus, Storage and Key Vault with a shared OSDU identity; middleware passwords stay in Key Vault.",
          services: ["cosmos", "service-bus", "storage", "key-vault", "managed-identity"],
        },
        {
          title: "Platform services in the cluster",
          body: "Elasticsearch and Redis serve search and cache; Airflow runs ingestion workflows with Postgres for its metadata; ECK, CloudNativePG, cert-manager and trust-manager manage and certify them.",
          services: [],
        },
      ],
      diagrams: [
        {
          title: "Architecture",
          path: "docs/diagrams/architecture.png",
          caption: "Ownership boundaries and the paths that serve an OSDU request.",
        },
      ],
      deploy: { command: "spi up", minutes: "45–50 minutes" },
    },
    publish: true,
  },
  {
    n: 4,
    url: "https://github.com/Azure/ADME-Solution-Accelerators/tree/main/artifacts/adminui",
    name: "OSDU Admin UI for ADME",
    category: "Upstream & Resources",
    description:
      "A web console for administering an Azure Data Manager for Energy instance (users and entitlements, legal tags, schemas and data partitions), running privately on Container Apps.",
    audience: "Data Manager for Energy administrators and data managers",
    outcome: "Day-to-day OSDU administration without hand-written REST calls",
    tags: ["adme", "osdu", "administration"],
    supportUrl:
      "https://learn.microsoft.com/azure/energy-data-services/how-to-deploy-osdu-admin-ui",
    consumes: ["adme-connection"],
    story: {
      source: "Microsoft Learn and the ARM template",
      steps: [
        {
          title: "Deploy next to the instance",
          body: "An ARM template creates a Container Apps environment in its own virtual network, with a private endpoint and private DNS.",
          services: ["container-apps", "private-endpoints"],
        },
        {
          title: "Administrators sign in",
          body: "Administrators sign in with their Microsoft Entra ID accounts.",
          services: [],
        },
        {
          title: "Manage the data platform",
          body: "The console calls the instance's OSDU APIs to manage users and entitlements, legal tags, schemas and data partitions.",
          services: ["adme-connection"],
        },
        {
          title: "Observed",
          body: "Log Analytics and Application Insights collect its logs and telemetry.",
          services: ["monitoring", "app-insights"],
        },
      ],
      deploy: {
        command: "Deploy to Azure (ARM template)",
        guide: "https://learn.microsoft.com/azure/energy-data-services/how-to-deploy-osdu-admin-ui",
      },
    },
    publish: true,
  },
  {
    n: 5,
    url: "https://github.com/Azure/osdu-data-load-tno",
    name: "OSDU TNO Data Loader",
    category: "Upstream & Resources",
    description:
      "Loads the TNO open subsurface dataset (wells, wellbores, logs and their files) into an OSDU or Azure Data Manager for Energy instance as a Container Apps job, creating legal tags and manifests in dependency order.",
    audience: "Teams standing up OSDU for testing, training and demos",
    outcome: "A populated OSDU instance with reference well data",
    tags: ["osdu", "adme", "tno", "data-load"],
    consumes: ["adme-connection"],
    story: {
      source: "Project README",
      steps: [
        {
          title: "Download the dataset",
          body: "A Container Apps job downloads the official TNO test data from the OSDU GitLab repository.",
          services: ["container-apps"],
        },
        {
          title: "Create the legal tag",
          body: "It creates the legal tag the data is governed by.",
          services: ["adme-connection"],
        },
        {
          title: "Upload the files",
          body: "For each file it runs OSDU's four-step upload: request an upload URL, upload the content, register the metadata, and record the file's ID and version.",
          services: [],
        },
        {
          title: "Generate the manifests",
          body: "It generates manifests for reference data, wells and wellbores from CSV templates, and work-product manifests for the uploaded files.",
          services: [],
        },
        {
          title: "Load in dependency order",
          body: "It submits every manifest in the right order, signing in with Azure Identity (no passwords), with retries and progress logging.",
          services: [],
        },
      ],
      deploy: { command: "azd up" },
    },
    publish: true,
  },
  {
    n: 6,
    url: "https://github.com/Azure-Samples/azure-data-manager-for-energy-openai-demo",
    name: "Well Data Chat with Azure OpenAI",
    category: "Upstream & Resources",
    description:
      "Chat over fields, wells, wellbores, logs and trajectories held in Azure Data Manager for Energy, using retrieval-augmented generation: Azure AI Search finds the relevant data and Azure OpenAI answers with it.",
    audience: "Geoscientists and engineers exploring well data",
    outcome: "Answers about wells in plain language, grounded in ADME data",
    tags: ["adme", "generative-ai", "openai", "search"],
    consumes: ["adme-connection"],
    caveats: [
      {
        id: "retired-models",
        level: "blocking",
        title: "Default models are retired",
        detail:
          "infra/main.bicep defaults to text-davinci-003 and gpt-35-turbo, which Azure OpenAI no longer deploys. Set current models before it can be published.",
      },
    ],
    story: {
      source: "Project README and diagram",
      steps: [
        {
          title: "Well data is indexed",
          body: "When you run azd up, well data from the open TNO dataset is chunked and indexed in Azure AI Search; Databricks is included to show data-preparation approaches.",
          services: ["ai-search", "databricks"],
        },
        {
          title: "A user asks a question",
          body: "Users chat in the web app on App Service.",
          services: ["app-service"],
        },
        {
          title: "Retrieve, then answer",
          body: "The app retrieves the relevant knowledge from AI Search, then sends the prompt with that knowledge to Azure OpenAI for the answer.",
          services: ["ai-foundry"],
        },
      ],
      diagrams: [{ title: "How it answers", path: "docs/appcomponents.png" }],
      deploy: { command: "azd up" },
    },
    publish: false,
  },
];
