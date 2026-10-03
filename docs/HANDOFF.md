# Handoff: Cloud Delivery (deployment-delight)

The context another agent needs to continue this work. Updated 3 October 2026: Cloud Delivery is now a **desktop
app** (§2, §5b); the Azure-hosted console is retired. Read this whole file before changing anything, then `README.md`
for the product detail.

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
| 1 | Onboarding by TPID: search, reuse an existing profile, retrieve MSX info, create if new | **Done in the web app**: `/customers/onboard` (Onboard customer). MSX is read through the local MSX connector (see §5). Not yet run against real MSX (needs Lukman's MSX sign-in) |
| 2 | Postgres model for engagement state and metadata, MSX as source of truth | **Done** (migration 0014) |
| 3 | MSX integration spec: link engagements to opportunities; milestone, deal team and ACR updates via MSX Helper | **Done for link + milestone update text** via MCP; posting to MSX is msx-mcp's job and isn't verified yet |
| 4 | Manual context (notes, recordings, emails, prompts) → context map | **Done.** Context entries (paste text; recordings as transcripts) feed the context map in the prep |
| 5 | Engagement from an existing opportunity or proactive | **Done**, now as a draft that becomes the engagement after review |
| 6 | Prep output: discovery questions, technical areas to review, similar prior engagements | **Done (v2).** The engagement workspace (§4): evidence brief, point of view, call plan by purpose, meeting view, findings. Rules in `src/lib/workspace.ts` + `prep.ts`, guidance in `playbook.ts` |
| 7 | Drag-and-drop canvas with real-time changes and scoring | **Not started** (today: click to add, fixed placement) |
| 8 | Document the backend logic: component change → flows → WAF score | **Not started as a doc.** The logic is code (`src/lib/offering/flows.ts`, `src/lib/waf/`), not "static Postgres metadata" as the meeting notes say. Worth correcting with Jarrett |
| 9 | Export: customer-ready PDF instead of Markdown | **Not started** |
| 10 | Realign scope to SE-first; reconcile ISV-oriented work | **Started.** Nav: Engage (Customers, Engagements) first; the old ISV wizard is "Deployment onboarding" (`/onboard`) under Platform with Installed base. Catalog/Releases/Delivery units still ISV-shaped |

---

## 2. Where it runs and how to ship

- **The desktop app (the product, since 3 Oct)**: each SE/CSA installs Cloud Delivery on their Windows PC
  (`docs/INSTALL-DESKTOP.md`). Data is local (PGlite in `%LOCALAPPDATA%\CloudDelivery\db`); sharing between SEs goes
  through a Microsoft Teams team's SharePoint files (§5b). Lukman chose this for an internal tool: no customer data in
  a hosted service.
- **Azure: retired.** App Service `clouddelivery-nzdefv` (resource group `oneplatform`) is stopped. It had no
  sign-in: anyone with the URL could use it. Don't deploy there or put data there. `release-app.yml` (the web zip)
  now only runs by hand; `deploy/azure` stays for anyone who self-hosts.
- **Repo**: `Balunywa/deployment-delight`, branch `main`. Lukman will make it private once the desktop app is done.

### Ship a desktop build

```bash
git push   # commit messages end with: Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
gh workflow run desktop.yml --ref main   # a test build: installers as artifacts, version 0.1.<run>
gh run watch <id> --exit-status; gh run download <id> -D desktop-build
git tag vX.Y.Z && git push origin vX.Y.Z   # a release: desktop.yml publishes both architectures' installers
```

`desktop.yml` builds on `windows-latest` and cross-compiles ARM64, so it keeps working when the repo is private
(GitHub's ARM64 Windows runners are free for public repos only). The installers aren't code-signed yet.

Verify a build by installing it (`-setup.exe`, per user, no admin), starting it from the Start menu and walking the
pages; the window's log is `%LOCALAPPDATA%\CloudDelivery\logs\desktop.log`.

### Run the desktop runtime from the repo

```bash
npx vite build
node desktop/launcher.mjs --open         # = npm run desktop; data in %LOCALAPPDATA%\CloudDelivery
CD_DATA_DIR=%TEMP%\cd-se-a CATALOG_USER_NAME="SE A (test)" node desktop/launcher.mjs   # a second, separate "SE"
```

It prints `{"event":"ready","url":"http://127.0.0.1:<port>/__cd/session?k=..."}`; open that URL (Playwright too).
Two launchers on the same data folder are refused (the database would be corrupted).

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
- Full suite here (3 Oct): 78 pass, 1 skipped. The landing-zone deploy tests wait on a live Azure CLI check
  ("Checking your Azure access"), which can take a while on this laptop. The local deploy runner
  (`src/lib/alz/runner.server.ts`) now works on Windows: it downloads the Windows Terraform build, starts `az.cmd`
  through `cmd.exe`, and hides console windows.
- Hydration: the server renders without query data. A component that renders from a query shared with the header
  (which hydrates first) must wait until it has mounted (see `useMounted` in `TeamSpace.tsx`), or a click during
  hydration fails with React error 418.

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
| `src/components/customer/` | `CustomerProfileCard` (TPID + context), `PrepPanel` (prep), `MsxConnect` (connector status, sign-in), `hooks.ts` |
| `src/routes/customers.onboard.tsx` | Customer onboarding: Find → What MSX says → Add context → Prep and start |
| `src/lib/prep.ts`, `prep.functions.ts` | Prep engine (rules) and server functions (snapshot, prep, AI draft) |
| `src/lib/msx-connector.ts`, `public/msx-connector.mjs` | Browser client for, and the source of, the local MSX connector |
| `desktop/launcher.mjs` | Desktop runtime: PGlite + socket, app server, gate, MSX connector (§5b) |
| `desktop/shell/index.html`, `src-tauri/` | The Tauri window (Rust `main.rs`: starts the launcher, shows its URL, stops it on close) |
| `scripts/stage-desktop.mjs`, `.github/workflows/desktop.yml` | Stage the bundled runtime (incl. Node LTS, SHA-256 checked); build the installers |
| `src/lib/team.server.ts`, `team.functions.ts`, `src/components/TeamSpace.tsx` | Team space sync over Microsoft Graph (§5b) |
| `src/components/engagement/` | Engagement UI incl. `MsxLink`, `Realize` |
| `db/migrations/` | 0001–0018. 0014 = MSX keys; 0015/0016 = demo customer removal; 0017 = workspace; 0018 = team space |
| `db/seed/` | Demo data, used **only** by the e2e database now |
| `.github/skills/prep-customer/SKILL.md` | Copilot skill pairing msx-mcp with Cloud Delivery's MCP server |
| `e2e/` | Playwright specs; `fixtures.ts` fails tests on console/page errors |

---

## 4. What's built (high level; README has detail)

- **The engagement workspace** (`/engagements/<id>`, redesigned 3 Oct from Lukman's "SE/CSA workflow" prompt): one
  record from the first look at a customer to production. Persistent header (customer, TPID, MSX link, phase, save
  state), journey nav, a side rail (next action, transparent readiness checks, working hypothesis, evidence, open
  actions). Tabs: Overview · Prepare (Context, Point of view, Call plan) · Engage (Meeting, Findings, Engagement plan)
  · Deliver (Validate, Handoff, Realize value) · Share (Customer recap); the old question navigator is "Question
  bank" and "Fit & gap". Journey A–E: **A** resolve the customer (`/customers/onboard`) → **B** Context: the evidence
  brief, every item with source, dates, documented vs interpretation, and status (confirmed / needs validation /
  contradicted / unknown; marks kept on `customers.evidence` with history; refresh never erases them), "What matters
  for this conversation", what changed in MSX → **C** Point of view: pressure, stakeholders, consequence, technical
  factors, linked evidence, assumptions, what would disprove it, the opening as a "working hypothesis", 2–3 paths
  incl. keeping today's approach, revision history (server-side, `workspace.povHistory`) → **D** Call plan by purpose
  (discovery, architecture, workshop, demo, POC planning, kickoff) and length: agenda, prioritized questions (POV
  assumptions, playbook, technical), follow-ups tied to gaps, listen-for, objections worth exploring, constraints,
  next step, resources essential vs optional; a Meeting focus view (answers, assumption results, actions, agreed
  next step) → **E** Findings (assumptions confirmed/corrected/rejected update the POV and the findings, need,
  trade-offs, decisions vs open, actions, missing stakeholders) → Engagement plan (charter; success criteria warn
  when they're activities) → **Create engagement** (draft → active; never touches MSX). After: Validate (POC/pilot
  plan with pass/fail, "is a POC the right step?", then the existing proof), Handoff (Technical Close Plan for
  production milestones; STU→CSU checklist; acceptance recorded only by `acceptHandoff` with the receiving owner's
  name), Realize value, recap.
  Code: `src/lib/workspace.ts` (types, brief, POV, call plan, readiness, next action), `src/lib/playbook.ts`
  (versioned guidance: purposes, resources, handoff criteria, routing), `src/lib/workspace.functions.ts`,
  `src/components/workspace/*` (views; `ws.ts` = shared state: every edit writes to the shared query data at once and
  the server save is debounced and flushed when a view closes), migration `0017` (`engagements.status`,
  `engagements.workspace`, `customers.evidence`).
- **Engagements (list)**: grouped by phase (Preparing, Discovery, Validation, Handoff, Delivery and value, Closed) with
  the next action and readiness per card; "New engagement" goes through onboarding by TPID; "Start without a
  customer" keeps the old quick dialog (lands in the question bank).
- **Customers**: **Onboard customer** (`/customers/onboard`, the sidebar's main button) is step A: TPID → MSX account,
  parent/subsidiary count, account team, sources available vs not, existing engagements ("Continue") or a new one
  under an opportunity or proactive ("Prepare discovery" opens a draft). Works without a TPID or MSX. "Deployment
  onboarding" (`/onboard`) is the old ISV wizard that puts a customer onto an offering.
- **Offerings (solution design)**: lifecycle nav Design / Build / Validate / Release / Operate with a "Next step" bar;
  Guided (10 WAF steps, requirements first) or Canvas; reference designs; computed flows per lens; Well-Architected
  score with one-click fixes; `/well-architected` guide; design doc download; Terraform + pipeline generation;
  Operate stage with Azure SRE Agent (azapi `Microsoft.App/agents`, briefing pack, validated with `terraform validate`).
- **Landing zones**: ALZ guided design, IP plan, design guide, traffic stories in the shared diagram standard.

---

## 5. MSX integration: design and where it stands

**Design (revised 2 Oct, late: Lukman wants onboarding in the web app, not in a Copilot chat).** Cloud Delivery's
server never holds MSX credentials and never calls MSX: a token for MSX Dataverse comes only from the SE's own
signed-in device (an app registration would need MSX team approval). So:

- **MSX connector** (`public/msx-connector.mjs`, served at `/msx-connector.mjs`): a no-dependency Node program on the
  SE's PC, `http://127.0.0.1:47615`. It runs msx-mcp's `msx` server over stdio (silent auth) and answers only fixed
  read-only questions: `GET /status`, `POST /signin` (runs `msx_login`; needs header `x-cloud-delivery: 1`),
  `GET /customer?tpid=` (top-parent account, active account count, open opportunities via the TPID FetchXML join).
  Allows only Cloud Delivery's origins (Azure URL, localhost:3000; more via `MSX_CONNECTOR_ORIGINS`), checks the Host
  header, answers the Private Network Access preflight. `--install` copies it to `%LOCALAPPDATA%\CloudDelivery`,
  stops a running one (`POST /shutdown`, local callers only: no Origin, header `x-cloud-delivery: 1`) and adds a
  hidden start at Windows sign-in (Startup folder `.vbs`); `--uninstall` stops it and removes that.
- **One-click install** (`public/install-msx-connector.cmd`, linked on the page as "Install MSX connector"): checks
  Node 22+, gets msx-mcp if missing (opens the GitHub zip in the browser, which is signed in to EMU, then unzips it
  to `%USERPROFILE%\msx-mcp`), downloads the connector from the app and runs `--install`, opens Onboard customer.
  Tested: fresh install, replacing a running connector, the msx-mcp unzip (sandbox). Windows asks once whether to run
  a downloaded `.cmd`. An `.exe` was considered: it would still need Node for msx-mcp and would need code signing to
  get past SmartScreen/Defender on managed laptops.
- **Edge's Local Network Access**: a public site calling `127.0.0.1` needs the user's one-time Allow (verified on
  Azure with Edge 154: blocked until allowed, then the page reaches the connector). Never call `process.exit()` right
  after a `fetch` in the connector: on Windows it crashes Node on exit (libuv `UV_HANDLE_CLOSING`).
- **The browser** (on the SE's PC) calls the connector, shows the data, and sends Cloud Delivery a **snapshot**: a
  context entry with `source: "msx"` and an `msx` field (account, opportunities: number, name, stage, solution area,
  sales play, dates, owner, description, forecast comments). One snapshot per customer; refresh replaces it. No
  estimated values are stored. Edge/Chrome may ask once to allow local network access.
- Tested: connector against real msx-mcp (status `signed-out`, origin/host/TPID checks, preflight, `--install` in a
  sandbox); the whole onboarding with a mocked connector in `e2e/msx.spec.ts`. **Not yet run against real MSX.**

**Copilot path (still there):**

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
- The old TPID dialog is gone; onboarding is `/customers/onboard`.

**Next steps for MSX:**

1. With Lukman: connector running (`--install`), VPN on, **Onboard customer** → "Sign in to MSX" once → a real TPID.
   Check the account, counts and opportunity fields against MSX; fix the connector's FetchXML if a field is wrong.
2. Milestone updates from the app (today only via the Copilot skill): add a confirmed write path to the connector
   (`dataverse_write` PATCH of `msp_forecastcomments`, new text only) behind an explicit confirm in the UI.
3. Later: per-person tokens or Entra sign-in for `/api/mcp`. Today one shared token, and audit says "Copilot (via MCP)".

---

## 5b. The desktop app and the team space

Modelled on `mcaps-microsoft/caip-ssp-dashboard` (Tauri, per-user installers on GitHub Releases, local data), but the
app itself is unchanged: the same TanStack Start build runs locally.

- **Shell** (`src-tauri/src/main.rs`): opens a splash (`desktop/shell/index.html`), starts the bundled `node.exe` with
  `desktop/launcher.mjs --shell`, and navigates to the URL from its `ready` line. Closing the window closes the
  launcher's stdin, so it stops the server and closes the database cleanly (killed after 10 s). Links to other sites
  open in the default browser. One instance (single-instance plugin). Logs:
  `%LOCALAPPDATA%\CloudDelivery\logs\desktop.log`. There is no local Rust toolchain on Lukman's laptop: the shell is
  only compiled in `desktop.yml`.
- **Launcher** (`desktop/launcher.mjs`): PGlite (Postgres in WebAssembly) in `<data>/db`, served on a random loopback
  port through `pglite-socket`, so the app's `pg` code is unchanged (`PGPOOL_MAX=1`: PGlite is one session). The app
  server runs with `AUTO_MIGRATE=true`, `DB_DIR` = the bundled `db/`, `SEED_DEMO_DATA=false`; the migrator then
  creates the workspace organization (`1111…`). A **gate** proxy on a second port is the only way in: Host must be
  the loopback port, and the session cookie comes from a one-time `/__cd/session?k=` link that only the window gets.
  The app server rejects requests without the gate's header (`CD_GATE_KEY`, `src/server.ts`). It starts the MSX
  connector with the app's origin allowed (no Local Network Access prompt: the page is itself on loopback). The user's email comes from the msx-mcp Azure CLI profile (`~/.azure-msx`), the display name from Graph
  (`az ad signed-in-user show`, cached in `<data>/profile.json`). `app.lock` in the data folder stops a second
  launcher.
- **Azure from the desktop**: ARM calls use `DefaultAzureCredential` (the user's own `az login`); Terraform deploys
  use the same sign-in.
- **Team space** (`src/lib/team.server.ts`): Settings → Team space lists the user's Microsoft 365 groups that have a
  Team (Graph `memberOf`), using a Graph token from the msx-mcp Azure CLI profile (Azure CLI client; it has
  `Group.ReadWrite.All` but no `Sites.*`/`Files.*` scopes). The data lives in the team's document library, folder
  `Cloud Delivery/{customers,engagements}`: one `<tpid>.json` or `<engagement id>.json` per record.
  - **The Microsoft tenant blocks downloading file content with this sign-in** (`/content` and its pre-signed URL
    both return 401; a SharePoint token gets 403), and creating lists is denied. Uploading files and reading or
    writing list fields works. So each upload also writes the document into the file's hidden Description column
    (`_ExtendedDescription`), and sync reads that column with the folder listing (one Graph call). SharePoint
    HTML-encodes that column, even `:`, so the value is `cdv1` + base64url(JSON). Writing the column changes the
    file's eTag. Tested up to 1 MB.
  - Sync (`syncNow`, one at a time per app): pull customers (match by TPID, merge context and evidence marks), pull
    engagements (a local change since the last exchange plus a remote change = conflict; the newer `updated_at`
    wins, the older stays in SharePoint's version history), then push what changed locally (`If-Match` on the eTag;
    a 412 means someone else wrote first, so the next sync merges). `sync_state` (migration 0018) keeps eTag and
    content hash per record. Runs at start (unless it ran in the last 2 minutes), every 10 minutes, and from the
    header button. Deletions aren't synced yet.
  - Test team: "Cloud Delivery – SE team space" (M365 group `2ebe2e89-8d38-4ac2-8005-c67bd342b300`, private, only
    Lukman). Verified 3 Oct with two launchers (separate data folders): SE A's customer and engagement reached SE B,
    SE B's point-of-view edit reached SE A. Its `Cloud Delivery` folder holds test records (TPID 99000001).

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
- **Always build, run the desktop app and verify with Playwright** after a change; take screenshots and look at them.
  (The Azure deploy step is retired with the Azure app.)
- Use parallel agents for big research or build pushes.
- Plain language in UI copy and responses; short sentences.
- Keep MSX as the system of record; store keys and context only.
- Destructive data operations: write them as a migration, dry-run on `cloud_delivery_e2e`, then apply.

---

## 8. Recommended next work (in order)

1. **First real MSX run with Lukman** (§5 next step 1), then the full journey on a real customer, in the desktop app.
2. **Desktop app, next**: code-sign the installers (SmartScreen warns today); an "update available" notice (check
   GitHub Releases at start, like caip-ssp-dashboard); sync deletions; show who changed a shared engagement and when;
   a first-run checklist (msx-mcp found, az signed in, team chosen). The MCP endpoint and the Copilot skill still
   point at the retired Azure URL: point them at the desktop app (or drop them).
3. **Workspace, next**: an AI-suggested POV and call plan from the same evidence (labelled, human-reviewed; the
   Azure OpenAI path exists); mark brief items confirmed automatically when a meeting confirms the matching
   assumption; read .docx attachments; per-person sign-in so "who confirmed" and handoff acceptance are real
   identities; MSX milestone post from the Findings view (confirmed text only, through the connector).
4. **Customer-ready PDF** (follow-up 9) from `design-doc.ts` + the diagram SVGs (`WorkloadStory` can export SVG/PNG).
5. **SE-first navigation** (follow-up 10): started; the catalog, releases and delivery units are still ISV-shaped.
6. **Drag-and-drop canvas** (follow-up 7) and a written explanation of the flows/WAF logic (follow-up 8).
