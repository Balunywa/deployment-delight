/* Team space (desktop): choose the team to share with, sync now, and what happened last time. */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { SyncResult, TeamSetting } from "./team.server";

const me = async () => (await import("./identity.server")).currentUser().name;
const team = () => import("./team.server");

async function desktopOnly() {
  const t = await team();
  if (!t.isDesktop()) throw new Error("The team space is part of the desktop app.");
  return t;
}

export const getTeamSpace = createServerFn({ method: "GET" }).handler(async () => {
  const t = await team();
  if (!t.isDesktop()) return { desktop: false as const, team: null, last: null };
  return { desktop: true as const, team: await t.getTeam(), last: await t.lastSync() };
});

export const listMyTeams = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ id: string; name: string }[]> => (await desktopOnly()).listTeams(),
);

export const chooseTeamSpace = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ groupId: z.string().uuid(), name: z.string().trim().min(1).max(256) }).parse(d),
  )
  .handler(async ({ data }) =>
    (await desktopOnly()).chooseTeam(data.groupId, data.name, await me()),
  );

export const leaveTeamSpace = createServerFn({ method: "POST" }).handler(async () => {
  await (await desktopOnly()).leaveTeam();
  return { ok: true };
});

export const syncTeamSpace = createServerFn({ method: "POST" }).handler(
  async (): Promise<SyncResult> => (await desktopOnly()).syncNow(await me()),
);
