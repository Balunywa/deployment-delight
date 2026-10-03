---
name: prep-customer
description: Prepare an SE/CSA engagement from MSX. Use when the user gives a customer TPID, account or MSX opportunity and wants to set up or prep the customer in Cloud Delivery, link an engagement to an opportunity, or post an engagement's milestone update back to MSX. Pairs the msx-mcp server (reads/writes MSX as the user) with the cloud-delivery MCP server (customer profiles by TPID, context, engagements).
---

# Prep a customer from MSX into Cloud Delivery

MSX is the system of record for accounts and opportunities. Cloud Delivery keeps the link (the TPID and the
opportunity ID) and its own context. Never copy MSX wholesale into Cloud Delivery, and never write to MSX without
the user confirming the exact text first.

Two MCP servers are involved, both configured in this repository's `.vscode/mcp.json`:

- **msx** (msx-mcp, `github.com/mcaps-microsoft/msx-mcp`) reads and writes MSX Dataverse as the signed-in user.
  It needs the Microsoft corporate VPN. Tools used here: `msx_auth_status`, `msx_login`, `dataverse_query`,
  `dataverse_fetchxml`, `dataverse_metadata`, `open_msx_record`, `dataverse_write`. Its own recipes live in its
  `references/dataverse/` folder (accounts, opportunities, milestones) and win over this file if they disagree.
- **cloud-delivery** (this repository's app, `/api/mcp`): `find_customer`, `upsert_customer`, `add_customer_context`,
  `list_engagements`, `create_engagement`, `link_opportunity`, `get_msx_update`.

If either server isn't connected, say which one and stop. Don't guess MSX data.

## Before reading MSX

Call `msx_auth_status`. Continue only when `data.status` is `ready`. If it reports `signInRequired`, tell the user a
browser will open for their @microsoft.com account, then call `msx_login` and check again. A `connectivity` failure
usually means the VPN is off; say so rather than retrying.

## MSX queries (from msx-mcp's recipes)

- **Account by TPID** (top parent): `dataverse_query` with `entity_set: "accounts"`,
  `select: "accountid,name,msp_mstopparentid,msp_parentinglevelcode,statecode"`,
  `filter: "msp_mstopparentid eq '<TPID>' and msp_parentinglevelcode eq 861980000"`. No row means the TPID is
  wrong or not visible to the user; say which, don't invent a name.
- **Account by name** (no TPID): `filter: "contains(name,'<NAME>') and statecode eq 0"`, then group by
  `msp_mstopparentid` and ask the user to pick when more than one TPID matches.
- **Open opportunities for a TPID**: `dataverse_fetchxml` with `entity_set: "opportunities"` and a join on the
  account's TPID (it covers every child account, no batching):

  ```xml
  <fetch>
    <entity name="opportunity">
      <attribute name="opportunityid" /><attribute name="name" /><attribute name="msp_opportunitynumber" />
      <attribute name="msp_activesalesstage" /><attribute name="estimatedclosedate" />
      <attribute name="msp_solutionarea" /><attribute name="msp_forecastcomments" />
      <attribute name="description" /><attribute name="ownerid" />
      <filter><condition attribute="statecode" operator="eq" value="0" /></filter>
      <link-entity name="account" from="accountid" to="parentaccountid" alias="acct">
        <filter><condition attribute="msp_mstopparentid" operator="eq" value="<TPID>" /></filter>
      </link-entity>
    </entity>
  </fetch>
  ```

  This misses opportunities with no parent account. If the user expects one that isn't listed, search by name.
- **Milestones for an opportunity**: `dataverse_query` with `entity_set: "msp_engagementmilestones"`,
  `select: "msp_engagementmilestoneid,msp_milestonenumber,msp_name,msp_milestonestatus,msp_milestonedate,msp_forecastcomments"`,
  `filter: "_msp_opportunityid_value eq <OPPORTUNITY_GUID>"`. Judge "current" by `msp_milestonestatus`, never
  `statecode`.

Use `open_msx_record` to show the user a record instead of pasting MSX URLs.

## Set up or prep a customer

1. Get the TPID from the user, or find it by account name (above). Confirm the account with the user if more than
   one matches.
2. Read the account and its open opportunities (name, number and ID, stage, owner, forecast comments and the
   description that say what the customer wants).
3. `upsert_customer` with the TPID, the name the team uses, and the MSX account name. It returns the existing
   profile if there is one.
4. `add_customer_context` with `source: "msx"`: a short, factual summary of what MSX says about the opportunities the
   user cares about. Quote the customer's goals as written; mark gaps ("MSX doesn't say why now").
5. Ask the user which opportunity this engagement is for, or whether it's proactive (no opportunity yet).
6. `create_engagement` named after the outcome the customer wants, with `opportunityId` and `opportunityName` if
   there is one. If one already exists for that opportunity, it's returned instead; say so.
7. If the user has meeting notes, emails or a transcript, add each with `add_customer_context` (`notes`, `email`,
   `transcript`).
8. Finish with the engagement link, what's known, what's missing, and two or three questions for the first
   conversation, grounded only in what MSX and the added context say.

## Post the milestone update to MSX

1. `get_msx_update` for the engagement. It returns the update text, the TPID and the linked opportunity.
2. If there's no linked opportunity, ask for one and `link_opportunity` first.
3. List the opportunity's milestones (above) and ask which one the update belongs to.
4. Show the user the exact text and the milestone it would go on. Only after they confirm, write it with
   `dataverse_write` (`entity_set: "msp_engagementmilestones"`, `operation: "patch"`, `id: <milestone GUID>`,
   `data: {"msp_forecastcomments": "<text>"}`). Send only the new text: an MSX plug-in appends it to the comment
   history, so never resend or merge prior comments. msx-mcp asks for its own confirmation too; don't bypass it.
   Afterwards offer `open_msx_record` (`type: "msp_engagementmilestone"`). msx-mcp's `msx-write` skill is the
   authority on write rules.
