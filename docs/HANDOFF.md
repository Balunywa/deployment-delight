# Handoff: Cloud Delivery (deployment-delight)

The context another agent needs to continue this work. Written 2 October 2026; the latest commit at the time was `af04162`.
Read this whole file before changing anything, then `README.md` for the product detail.

---

## 1. What this is now, and who it's for

**Cloud Delivery** started as an "ISV deployment factory": an ISV designs an offering once and vends it into many
customer subscriptions. **The direction has changed.** Lukman Balunywa (SE, the owner) and Jarrett agreed on a call
on 2 Oct 2026 that the primary product is an **SE/CSA productivity and customer-engagement tool**: one place to run
ADS, PoC and MVP work end to end, with WAF/CAF and ESLZ built in. The ISV subscription-vending screens still exist but
are no longer the focus. Don't extend them unless asked.

The SE/CSA flow the product should support, in order:

1. **Onboard or find the customer by TPID.** MSX is the system of record; Cloud Delivery keeps the TPID as the link
   plus its own context. Never duplicate MSX.
2. **Prepare** (days before the call): MSX data plus manually supplied context (meeting notes, emails, call
   recordings or transcripts, plain-language prompts) build a context map. Suggest two or three discovery questions and
   technical hints (not a prescribed solution), and similar prior engagements by peers.
3. **Listen and consult** live with the customer; validate assumptions before solutioning.
4. **Engagement**: linked to an existing MSX opportunity, or **proactive** when there's none. It persists across
   sessions (e.g. ExxonMobil, Baker Hughes) with its artifacts and deliverables.
5. **Solution design**: requirements first (criticality, HA, RTO/RPO, data classification, users, downtime), then a
   guided WAF reference design or a blank canvas. Edge/compute/data/network/identity/observability, live traffic
   flows, WAF scoring that updates with every change.
6. **Customer deliverable**: today Markdown; wanted: a **customer-ready PDF** plus the visual.
7. **Prove → realize value**, and post milestone updates back to MSX.

Jarrett's advice, adopted: **take a dependency on msx-mcp** (`github.com/mcaps-microsoft/msx-mcp`) for every MSX
interaction rather than building an MSX integration.

### Follow-ups from the 2 Oct call (the backlog, owner Lukman)

| # | Follow-up | Status |
|---|---|---|
| 1 | Onboarding by TPID: search, reuse an existing profile, retrieve MSX info, create if new | **Partly done.** TPID profiles exist; "retrieve MSX info" works through Copilot + msx-mcp, now wired in `.vscode/mcp.json` (see §5) |
| 2 | Postgres model for engagement state and metadata, MSX as source of truth | **Done** (migration 0014) |
| 3 | MSX integration spec: link engagements to opportunities; milestone, deal team and ACR updates via MSX Helper | **Done for link + milestone update text** via MCP; posting to MSX is msx-mcp's job and isn't verified yet |
| 4 | Manual context (notes, recordings, emails, prompts) → context map | **Storage and UI done** (customer profile context). The context map itself isn't built |
| 5 | Engagement from an existing opportunity or proactive | **Done** |
| 6 | Prep output: discovery questions, technical areas to review, similar prior engagements | **Not started.** Recommended next |
| 7 | Drag-and-drop canvas with real-time changes and scoring | **Not started** (today: click to add, fixed placement) |
| 8 | Document the backend logic: component change → flows → WAF score | **Not started as a doc.** The logic is code (`src/lib/offering/flows.ts`, `src/lib/waf/`), not "static Postgres metadata" as the meeting notes say. Worth correcting with Jarrett |
| 9 | Export: customer-ready PDF instead of Markdown | **Not started** |
| 10 | Realign scope to SE-first; reconcile ISV-oriented work | **Not started.** Nav still leads with ISV concepts (Solution catalog, Releases, Delivery units, Installed base) |

---

## 2. Live environments and how to ship

- **Azure (the one Lukman uses)**: https://clouddelivery-nzdefv.azurewebsites.net, App Service `clouddelivery-nzdefv`
  in resource group `oneplatform`. Azure Database for PostgreSQL with Entra auth (`AZURE_POSTGRES_ENTRA_AUTH`).
  `AUTO_MIGRATE=true`: migrations in `db/migrations` apply on startup. `SEED_DEMO_DATA=false` (demo data must not come
  back).
- **Local**: `http://localhost:3000`, built server from `.output`. Ports 5174 and 5175 are dead old tabs; ignore them.
- **Repo**: `Balunywa/deployment-delight`, branch `main`. Pushing to `main` builds the release zip.

### Deploy to Azure (always do this after a change, then verify)

```bash
git push   # commit messages end with: Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
id=$(gh run list --workflow release-app.yml --limit 1 --json databaseId -q '.[0].databaseId'); gh run watch $id --exit-status
SHA=$(git rev-parse --short HEAD)
az webapp config appsettings set -g oneplatform -n clouddelivery-nzdefv \
  --settings "WEBSITE_RUN_FROM_PACKAGE=https://github.com/Balunywa/deployment-delight/releases/download/app-latest/cloud-delivery-app.zip?v=$SHA" -o none
az webapp restart -g oneplatform -n clouddelivery-nzdefv
sleep 75; curl -s -o /dev/null -w "%{http_code}\n" https://clouddelivery-nzdefv.azurewebsites.net/   # poll until 200
E2E_BASE_URL=https://clouddelivery-nzdefv.azurewebsites.net npx playwright test --grep @readonly   # 27 pass
```

### Local build, run and test

```bash
npx tsc --noEmit -p .          # must be clean
npx eslint src e2e             # baseline: 0 errors, 15 warnings. Don't add warnings
npx prettier --write <files>   # the lint config enforces prettier
npx vite build                 # also regenerates src/routeTree.gen.ts for new routes
lsof -tiTCP:3000 -sTCP:LISTEN  # then: kill <that PID>   (separately from starting!)
HOST=0.0.0.0 PORT=3000 npm start   # run detached; add MCP_TOKEN=... to try /api/mcp locally
npx playwright test            # full suite: 76 pass, 1 skipped (pre-existing). Builds nothing: run vite build first
```

- The e2e suite uses its own database `cloud_delivery_e2e`, **reset and re-seeded with the demo data every run**
  (`e2e/reset-db.mjs`). Tests that need demo customers are tagged `(demo data)` and do not run against Azure; tests
  tagged `@readonly` must be data-agnostic because Azure has no demo data.
- Local Postgres: `/opt/homebrew/opt/postgresql@14/bin/psql -h /tmp -p 5433 -U postgres -d cloud_delivery`. The local
  server does **not** auto-migrate: apply new migration files by hand and insert their name into
  `public.schema_migrations`.
- The audit log (`audit_events`) is append-only by trigger `audit_events_no_update`. Deleting customers fails
  because the FK sets `customer_id` null on audit rows. Data cleanups disable the trigger inside one migration
  transaction and re-enable it (see 0015, 0016).
- A stale server after a rebuild gives blank pages or "Loading…" forever: restart it.
- Screenshots via a small Playwright script (`chromium.launch()`) are the way to check UI; look at them.

### On Lukman's Windows machine (ARM64)

- `git config core.autocrlf false` is set for this repo; with `true`, prettier flags every line (`␍`).
- Install with `bun install` (the lockfile is `bun.lock`; `npm ci` fails). Bun's `.exe` shims aren't found by `npx`,
  so run tools through node: `node node_modules/typescript/bin/tsc --noEmit -p .`,
  `node node_modules/eslint/bin/eslint.js src e2e`, `node node_modules/vite/bin/vite.js build`,
  `node node_modules/@playwright/test/cli.js test`.
- Postgres: Docker container `cd-postgres` (`postgres:14`, trust auth, port 5433). Start Docker Desktop, then
  `docker start cd-postgres`, and set `E2E_DATABASE_URL=postgres://postgres@localhost:5433/cloud_delivery_e2e`.
- Full suite here: 74 pass, 1 skipped, 2 fail: the landing-zone "deploy: readiness" and "deploy: Apply" tests. They
  pass alone and time out on "Checking your Azure access" in a full run; the local deploy runner
  (`src/lib/alz/runner.server.ts`) isn't Windows-ready (e.g. Terraform download is linux/darwin only). Not a
  regression; Azure runs Linux.

---

## 3. Stack and repo map

TanStack Start (React 19, file routes in `src/routes`, server functions via `createServerFn`, server routes via
`server.handlers`), Tailwind + shadcn/ui, PostgreSQL (`pg`, plain SQL migrations), Playwright e2e, Node 23.

| Path | What |
|---|---|
| `src/routes/` | Pages. `engagements.*`, `customers.*`, `offerings.tsx` (the designer), `foundations.*` (landing zones), `well-architected.*`, `settings.tsx`, `api.mcp.ts` (MCP server) |
| `src/lib/engagements*.ts`, `src/lib/conversation.ts` | Engagement model, the listen/consult navigator, `milestoneUpdate()` |
| `src/lib/msx.server.ts`, `msx.functions.ts` | TPID profiles, context, opportunity links, MSX update (shared by app and MCP) |
| `src/lib/catalog.ts` | The Azure service catalog (~40 services) with settings, prices, inputs |
| `src/lib/waf/` | Well-Architected engine: `review(arch)`, checks per service (`services/*.ts`), workload checks, pillar guides |
| `src/lib/offering/flows.ts` | Computed traffic / identity / logging / deploy / operate flows and change impact |
| `src/lib/offering/templates.ts` | Azure Architecture Center reference designs |
| `src/lib/offering/terraform.ts` (+ `*-services.ts`, `sre-agent.ts`) | Terraform generator per offering |
| `src/lib/offering/design-doc.ts` | Markdown design document + findings CSV (the PDF should build on this) |
| `src/components/offering/` | `GuidedWorkload`, `WorkloadStory`, `WafReview`, `WafGuide`, `OperatePanel`, `OfferingNav` |
| `src/components/lz/diagram/` | The shared diagram standard (Story engine, theme, router); used by landing zones and offerings |
| `src/components/customer/` | `FindCustomer` (TPID dialog), `CustomerProfileCard` (TPID + context) |
| `src/components/engagement/` | Engagement UI incl. `MsxLink`, `Realize` |
| `db/migrations/` | 0001–0016. 0014 = MSX keys; 0015/0016 = demo customer removal |
| `db/seed/` | Demo data, used **only** by the e2e database now |
| `.github/skills/prep-customer/SKILL.md` | Copilot skill pairing msx-mcp with Cloud Delivery's MCP server |
| `e2e/` | Playwright specs; `fixtures.ts` fails tests on console/page errors |

---

## 4. What's built (high level; README has detail)

- **Engagements**: Understand → Explore → Illustrate → Validate → Agree → Prove → Realize value; working summary with
  confirmed/hypothesis/unknown; customer-safe recap at `/recap/<id>`; CSA handoff; "Needs you" queue; optional Foundry
  assist (`AZURE_OPENAI_ENDPOINT`). Now also: origin (opportunity | proactive), MSX opportunity link in the header.
- **Customers**: "Find or add by TPID" (searches **Cloud Delivery's own** customers; creates a profile for a new TPID);
  profile card with TPID, MSX account name, and context entries (notes, MSX, email, transcript, prompt).
- **Offerings (solution design)**: lifecycle nav Design / Build / Validate / Release / Operate with a "Next step" bar;
  Guided (10 WAF steps, requirements first) or Canvas; reference designs; computed flows per lens; Well-Architected
  score with one-click fixes; `/well-architected` guide; design doc download; Terraform + pipeline generation;
  Operate stage with Azure SRE Agent (azapi `Microsoft.App/agents`, briefing pack, validated with `terraform validate`).
- **Landing zones**: ALZ guided design, IP plan, design guide, traffic stories in the shared diagram standard.

---

## 5. MSX integration: design and where it stands

**Design.** Cloud Delivery never holds MSX credentials and doesn't call MSX. MSX lives in Microsoft's corporate tenant
behind an app registration the MSX team must approve. The working pattern is **Copilot as the orchestrator**:

- **msx-mcp** (runs locally in VS Code/Copilot as the signed-in SE) reads and writes MSX.
- **Cloud Delivery MCP server** at `/api/mcp` (Streamable HTTP, stateless JSON-RPC; on when `MCP_TOKEN` is set; bearer
  token). Tools: `find_customer`, `upsert_customer`, `add_customer_context`, `list_engagements`, `create_engagement`
  (one engagement per opportunity), `link_opportunity`, `get_msx_update`.
- **Skill** `.github/skills/prep-customer`: TPID → msx-mcp reads account + opportunities → `upsert_customer` →
  `add_customer_context` (source `msx`) → `create_engagement` → first questions. Milestone updates are posted to MSX
  with msx-mcp **only after the user confirms the exact text**.
- **Settings → Connect Copilot** shows the `.vscode/mcp.json` entry. The token is an Azure app setting; read it with
  `az webapp config appsettings list -g oneplatform -n clouddelivery-nzdefv --query "[?name=='MCP_TOKEN'].value" -o tsv`.
  **Never print it in chat, logs or commits.**
- Verified: the MCP endpoint works on Azure (initialize, tools/list, read-only find_customer) and locally (all tools,
  `e2e/msx.spec.ts`).

**Where it stands (updated 2 Oct, evening).** msx-mcp is a dependency now:

- Lukman's EMU GitHub account is `mubaluny_microsoft`. `gh`, git and the GitHub MCP server here are all signed in as
  `Balunywa`, which gets a 404 on the repo, and device-code sign-in annoyed him. What worked: open
  `https://github.com/mcaps-microsoft/msx-mcp/archive/HEAD.zip` in his Edge (already signed in to EMU) and unzip it to
  `C:\Users\mubaluny\msx-mcp`. To update msx-mcp, do the same again. Don't ask him to sign in again.
- msx-mcp v1.5.1 ships a prebuilt bundle: `node ~/msx-mcp/bundle/msx.mjs` (stdio), no `npm install`. The `msx` server
  has 9 generic tools: `msx_login`, `msx_auth_status`, `msx_config`, `dataverse_metadata`, `dataverse_query`,
  `dataverse_fetchxml`, `dataverse_write`, `open_msx_record`, `dataset_access`. There is no "account by TPID" tool;
  its `references/dataverse/*.md` recipes give the queries (`accounts.msp_mstopparentid eq '<TPID>'`).
- Auth: its own isolated Azure CLI profile (`~/.azure-msx`), started by `msx_login` (browser, @microsoft.com). Needs
  the **corporate VPN**. Verified locally: the server starts and lists its tools; `msx_auth_status` said
  `auth_required` (not signed in yet).
- `.vscode/mcp.json` is committed with both servers (`msx` via `${userHome}/msx-mcp/bundle/msx.mjs`, and
  `cloud-delivery` on the Azure URL with the token as a password prompt). The skill now names the real tools and
  queries, and posts milestone updates as `dataverse_write` PATCH of `msp_engagementmilestones.msp_forecastcomments`
  with only the new text (an MSX plug-in appends history; see msx-mcp's `skills/msx-write`).
- The TPID dialog now says it searches Cloud Delivery only, and to ask Copilot "prep customer TPID …" for MSX data.

**Next steps for MSX:**

1. In VS Code: start the `msx` and `cloud-delivery` servers from `.vscode/mcp.json` (paste `MCP_TOKEN` when asked),
   connect the VPN, open a **new** chat (servers added mid-chat aren't visible), and run "prep customer TPID <real>".
   The first MSX call triggers `msx_login`.
2. Fix anything the real run shows in `SKILL.md` (e.g. field names on the opportunity fetch).
3. Later: per-person tokens or Entra sign-in for `/api/mcp`. Today one shared token, and audit says "Copilot (via MCP)".

---

## 6. Data state

- **All made-up demo customers are removed** from Azure and local (migrations 0015 and 0016: the 24 utilities and
  numbered "Metro Energy" duplicates, with their landing zones, installs, deployments, delivery units, engagements and
  related audit events). Azure had 0 customers after cleanup.
- **Kept**: solution catalog, offerings, Well-Architected content, the hosting landing zone, and two engagements on
  Azure with no customer ("AKS POC", "grid", created 1 Oct; likely Lukman's).
- Since cleanup Lukman created a customer **"XOM"** locally (code `xom`) through Onboard customer; it's real usage, keep it.
- The ISV-era sample offerings (GridWorks, OSDU, ADME…) are still in the catalog/offerings; not yet discussed whether
  they count as "fake data".

---

## 7. Working agreements (how Lukman wants this done)

- He's blunt and wants premium, non-"vibe-coded" results with honest copy: **no invented numbers**, say what isn't
  automated, cite Microsoft sources for Azure facts.
- **Always deploy to Azure and verify with Playwright** after a change; take screenshots and look at them.
- Use parallel agents for big research or build pushes.
- Plain language in UI copy and responses; short sentences.
- Keep MSX as the system of record; store keys and context only.
- Destructive data operations: write them as a migration, dry-run on `cloud_delivery_e2e`, then apply.

---

## 8. Recommended next work (in order)

1. **Finish the msx-mcp setup with Lukman**: a real TPID run (§5 next steps 1–2).
2. **Prep** (follow-up 6): from a customer's context (MSX summary, notes, emails, transcripts) produce a context map,
   2–3 discovery questions, technical hints (e.g. Azure Local, AKS, Oracle, DC migration → what to review and ask), and
   similar prior engagements. Use the Foundry assist path that already exists in `engagements.functions.ts`, grounded
   only in stored context.
3. **Customer-ready PDF** (follow-up 9) from `design-doc.ts` + the diagram SVGs (`WorkloadStory` can export SVG/PNG).
4. **SE-first navigation** (follow-up 10): lead with Customers → Engagements → Design; demote ISV vending screens.
5. **Drag-and-drop canvas** (follow-up 7) and a written explanation of the flows/WAF logic (follow-up 8).
