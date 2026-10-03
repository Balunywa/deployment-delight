/* Customer onboarding for SE/CSA work: keep the MSX snapshot, and the prep built from everything we hold. */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { Prep } from "./prep";

const by = async () => (await import("./identity.server")).currentUser().name;
const msx = () => import("./msx.server");

const text = (n: number) => z.string().max(n).nullable();
const snapshotSchema = z.object({
  tpid: z.string().regex(/^\d{3,12}$/),
  fetchedAt: z.string().max(40),
  account: z.object({ id: z.string().max(64), name: z.string().max(200) }).nullable(),
  accounts: z.number().int().nonnegative().nullable(),
  team: z
    .array(z.object({ name: z.string().max(200), role: text(200) }))
    .max(50)
    .nullable()
    .optional(),
  opportunities: z
    .array(
      z.object({
        id: z.string().max(64),
        number: text(64),
        name: z.string().max(300),
        stage: text(120),
        solutionArea: text(120),
        salesPlay: text(160),
        closeDate: text(40),
        createdOn: text(40),
        owner: text(160),
        account: text(200),
        description: text(2000),
        forecastComments: text(1500),
      }),
    )
    .max(50),
});

export const saveMsxSnapshot = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ customerId: z.string().uuid(), snapshot: snapshotSchema }).parse(d),
  )
  .handler(async ({ data }) =>
    (await msx()).saveSnapshot(data.customerId, data.snapshot, await by()),
  );

async function prepFor(id: string): Promise<Prep> {
  const m = await msx();
  const { buildPrep } = await import("./prep");
  const [customer, peers] = await Promise.all([m.getCustomer(id), m.peers(id)]);
  return buildPrep({ customer, context: customer.context ?? [], peers });
}

export const getCustomerPrep = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => prepFor(data.id));

const draftSchema = z.object({
  summary: z.string().max(1200).default(""),
  questions: z
    .array(z.object({ text: z.string().max(300), because: z.string().max(300) }))
    .max(3)
    .default([]),
  hints: z
    .array(z.object({ area: z.string().max(80), why: z.string().max(300) }))
    .max(4)
    .default([]),
});
export type PrepDraft = z.infer<typeof draftSchema> & { model: string };

export const getPrepAssist = createServerFn({ method: "GET" }).handler(async () => {
  const { advisorConfigured } = await import("./azure.server");
  return { configured: advisorConfigured() };
});

const DRAFT_SYSTEM = `You help a Microsoft solution engineer prepare for a first customer conversation, days before it. You talk only to the engineer.

You get CONTEXT JSON: what MSX says about the account and its open opportunities, and what the engineer added (notes, emails, transcripts, briefs).

Rules:
- Use only the CONTEXT. Never invent facts, numbers, names, dates, budgets or commitments.
- Anything you infer is a hypothesis: say "may" or "seems".
- Give technical areas to review, not a solution.
- Questions open the conversation and test assumptions; one idea each; plain words a customer would use.
- Short, plain sentences.`;

export const draftPrep = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }): Promise<PrepDraft> => {
    const { chat } = await import("./azure.server");
    const c = await (await msx()).getCustomer(data.id);
    const context = {
      customer: c.name,
      msxAccount: c.msx_account_name,
      entries: (c.context ?? []).map((e) =>
        e.msx
          ? { source: "msx", opportunities: e.msx.opportunities }
          : { source: e.source, title: e.title, text: e.text.slice(0, 6000) },
      ),
    };
    const raw = await chat(
      [
        { role: "system", content: DRAFT_SYSTEM },
        {
          role: "user",
          content: `CONTEXT:\n${JSON.stringify(context)}\n\nTASK: Return JSON {"summary":"3-5 sentences: who the customer is, where the request came from, what they seem to want and why now, and what's unknown","questions":[{"text":"...","because":"..."}],"hints":[{"area":"...","why":"..."}]}. Exactly 3 questions, at most 4 hints.`,
        },
      ],
      { json: true },
    );
    try {
      return {
        ...draftSchema.parse(JSON.parse(raw)),
        model: process.env["AZURE_OPENAI_DEPLOYMENT"] || "gpt-4.1",
      };
    } catch {
      throw new Error("The model's reply wasn't in the expected shape. Try again.");
    }
  });
