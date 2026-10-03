/*
 * Team space on the desktop: choose the Microsoft Teams team to share customers and engagements with (through its
 * SharePoint library), sync now, and a small header indicator that syncs on start and every ten minutes.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CloudOff, RefreshCw, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Panel, Pill } from "@/components/Primitives";
import { Button } from "@/components/ui/button";
import { relative } from "@/lib/format";
import {
  chooseTeamSpace,
  getTeamSpace,
  leaveTeamSpace,
  listMyTeams,
  syncTeamSpace,
} from "@/lib/team.functions";
import type { SyncResult, TeamSetting } from "@/lib/team.server";

const KEY = ["team-space"];

function useSync() {
  const queryClient = useQueryClient();
  const run = useServerFn(syncTeamSpace);
  return useMutation<SyncResult, Error, void>({
    mutationFn: () => run(),
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: KEY });
      if (r.pulled) {
        void queryClient.invalidateQueries({ queryKey: ["engagements"] });
        void queryClient.invalidateQueries({ queryKey: ["customers"] });
      }
    },
  });
}

/**
 * False on the server and in the first client render. The header fetches the team space before the page content
 * hydrates, so rendering from the query right away would differ from the server's HTML.
 */
function useMounted() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

/** In the header: which team, when it last synced, and a sync button. Syncs on start and every ten minutes. */
export function TeamSyncIndicator() {
  const load = useServerFn(getTeamSpace);
  const space = useQuery({ queryKey: KEY, queryFn: () => load() });
  const mounted = useMounted();
  const sync = useSync();
  const started = useRef(false);
  const team = space.data?.team;
  useEffect(() => {
    if (!team) return;
    const run = () => {
      if (!sync.isPending) sync.mutate(undefined, { onError: () => {} });
    };
    if (!started.current) {
      started.current = true;
      const last = space.data?.last?.at;
      if (!last || Date.now() - Date.parse(last) > 2 * 60_000) run();
    }
    const t = setInterval(run, 10 * 60_000);
    return () => clearInterval(t);
    // Only when the chosen team changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team?.groupId]);
  if (!mounted || !space.data?.desktop || !team) return null;
  const last = space.data.last;
  const failed = sync.isError || (last?.errors.length ?? 0) > 0;
  return (
    <button
      type="button"
      onClick={() =>
        sync.mutate(undefined, {
          onSuccess: (r) =>
            toast.success(
              `Synced with ${team.name}: ${r.pulled} in, ${r.pushed} out${r.conflicts ? `, ${r.conflicts} conflict${r.conflicts === 1 ? "" : "s"} resolved by the newer edit` : ""}.`,
            ),
          onError: (e: Error) => toast.error(e.message),
        })
      }
      title={`Team space: ${team.name}. Click to sync now.`}
      className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11.5px] text-muted-foreground hover:border-border-strong hover:text-foreground"
    >
      {failed ? (
        <CloudOff className="size-3.5 text-warning" />
      ) : (
        <RefreshCw className={`size-3.5 ${sync.isPending ? "animate-spin" : ""}`} />
      )}
      <span className="max-w-40 truncate">{team.name}</span>
      {last && !sync.isPending && <span>· {relative(last.at)}</span>}
    </button>
  );
}

export function TeamSpacePanel() {
  const queryClient = useQueryClient();
  const load = useServerFn(getTeamSpace);
  const space = useQuery({ queryKey: KEY, queryFn: () => load() });
  const mounted = useMounted();
  const [picking, setPicking] = useState(false);
  const teamsFn = useServerFn(listMyTeams);
  const teams = useQuery({
    queryKey: ["my-teams"],
    queryFn: () => teamsFn(),
    enabled: picking,
    retry: false,
  });
  const [filter, setFilter] = useState("");
  const chooseFn = useServerFn(chooseTeamSpace);
  const choose = useMutation<TeamSetting, Error, { groupId: string; name: string }>({
    mutationFn: (v) => chooseFn({ data: v }),
    onSuccess: (t) => {
      toast.success(`Sharing with ${t.name}. Syncing now.`);
      setPicking(false);
      void queryClient.invalidateQueries({ queryKey: KEY });
      sync.mutate(undefined, { onError: (e: Error) => toast.error(e.message) });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const leave = useMutation({
    mutationFn: useServerFn(leaveTeamSpace),
    onSuccess: () => {
      toast.success("No longer sharing. Nothing was deleted from the team's files.");
      void queryClient.invalidateQueries({ queryKey: KEY });
    },
  });
  const sync = useSync();

  const s = space.data;
  if (!s || !mounted) return null;
  if (!s.desktop)
    return (
      <Panel title="Team space" description="Share customers and engagements with your team.">
        <p className="text-[12.5px] text-muted-foreground">
          Part of the desktop app: each SE's Cloud Delivery shares through a Microsoft Teams team's
          files, inside Microsoft 365.
        </p>
      </Panel>
    );
  const shown = (teams.data ?? []).filter((t) =>
    t.name.toLowerCase().includes(filter.toLowerCase()),
  );

  return (
    <Panel
      title="Team space"
      description="Share customers and engagements with your team through a Microsoft Teams team's files."
      actions={
        s.team ? (
          <Pill tone="success">
            <Users className="size-3" /> {s.team.name}
          </Pill>
        ) : null
      }
    >
      <div className="space-y-3 text-[12.5px]">
        <p className="text-muted-foreground">
          Everything stays in Microsoft 365, in the team's SharePoint library (folder “Cloud
          Delivery”), under the team's permissions: members see each other's customers, context and
          engagements; nobody else does. MSX is never changed. Uses the same Microsoft sign-in as
          MSX on this PC.
        </p>
        {s.team && !picking ? (
          <>
            <p>
              Sharing with <span className="font-medium">{s.team.name}</span>
              {s.last && (
                <span className="text-muted-foreground">
                  {" "}
                  · last sync {relative(s.last.at)}: {s.last.pulled} in, {s.last.pushed} out
                  {s.last.conflicts
                    ? `, ${s.last.conflicts} conflict${s.last.conflicts === 1 ? "" : "s"} (newer edit kept)`
                    : ""}
                </span>
              )}
            </p>
            {s.last?.errors.length ? (
              <ul className="list-disc pl-4 text-danger">
                {s.last.errors.slice(0, 4).map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={sync.isPending}
                onClick={() =>
                  sync.mutate(undefined, {
                    onSuccess: (r) => toast.success(`Synced: ${r.pulled} in, ${r.pushed} out.`),
                    onError: (e: Error) => toast.error(e.message),
                  })
                }
              >
                <RefreshCw className={`size-3.5 ${sync.isPending ? "animate-spin" : ""}`} />
                {sync.isPending ? "Syncing…" : "Sync now"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setPicking(true)}>
                Change team
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={leave.isPending}
                onClick={() => leave.mutate({})}
              >
                Stop sharing
              </Button>
            </div>
          </>
        ) : !picking ? (
          <Button size="sm" onClick={() => setPicking(true)}>
            Choose a team
          </Button>
        ) : (
          <div className="space-y-2">
            {teams.isLoading && <p className="text-muted-foreground">Loading your teams…</p>}
            {teams.error && <p className="text-danger">{(teams.error as Error).message}</p>}
            {teams.data && (
              <>
                <input
                  aria-label="Filter teams"
                  placeholder="Filter your teams"
                  value={filter}
                  onChange={(ev) => setFilter(ev.target.value)}
                  className="h-8 w-full rounded-md border border-border bg-card px-2"
                />
                <ul aria-label="Your teams" className="max-h-64 space-y-1 overflow-auto">
                  {shown.map((t) => (
                    <li key={t.id}>
                      <button
                        type="button"
                        disabled={choose.isPending}
                        onClick={() => choose.mutate({ groupId: t.id, name: t.name })}
                        className="w-full rounded-md border border-border px-3 py-1.5 text-left hover:border-primary"
                      >
                        {t.name}
                      </button>
                    </li>
                  ))}
                  {!shown.length && <li className="text-muted-foreground">No teams match.</li>}
                </ul>
              </>
            )}
            <Button size="sm" variant="ghost" onClick={() => setPicking(false)}>
              Cancel
            </Button>
          </div>
        )}
      </div>
    </Panel>
  );
}
