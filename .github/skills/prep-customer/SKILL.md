---
name: prep-customer
description: Prepare an SE/CSA engagement from MSX. Use when the user gives a customer TPID, account or MSX opportunity and wants to set up or prep the customer in Cloud Delivery, link an engagement to an opportunity, or post an engagement's milestone update back to MSX. Pairs the msx-mcp server (reads/writes MSX as the user) with the cloud-delivery MCP server (customer profiles by TPID, context, engagements).
---

# Prep a customer from MSX into Cloud Delivery

MSX is the system of record for accounts and opportunities. Cloud Delivery keeps the link (the TPID and the
opportunity ID) and its own context. Never copy MSX wholesale into Cloud Delivery, and never write to MSX without
the user confirming the exact text first.

Two MCP servers are involved:

- **msx-mcp** reads and writes MSX as the signed-in user. Its tool names may change, so list its tools and pick the
  ones that look up an account by TPID, list its opportunities and milestones, and update a milestone or add a note.
- **cloud-delivery** (this repository's app, `/api/mcp`): `find_customer`, `upsert_customer`, `add_customer_context`,
  `list_engagements`, `create_engagement`, `link_opportunity`, `get_msx_update`.

If either server isn't connected, say which one and stop. Don't guess MSX data.

## Set up or prep a customer

1. Get the TPID from the user, or find it with msx-mcp from the account name. Confirm the account with the user if
   more than one matches.
2. With msx-mcp, read the account and its open opportunities (name, number/ID, stage, owner, and the notes or
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
3. Show the user the exact text and the milestone it would go on. Post it with msx-mcp only after they confirm.
