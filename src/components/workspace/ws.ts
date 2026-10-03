/*
 * The engagement workspace's shared state: the context every view reads and saves through, the save state shown in
 * the header, autosave, and small constants. Components live in ui.tsx.
 */
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type { Engagement } from "@/lib/engagements";
import type { EvidenceStatus, Tab, Workspace, WorkspaceEngagement } from "@/lib/workspace";
import { type WorkspaceData, saveWorkspace } from "@/lib/workspace.functions";
/* ------------------------------------------------------------------------------------------ context */

export type SaveState = { state: "idle" | "saving" | "saved" | "error"; at: string | null };

export type Ws = {
  data: WorkspaceData;
  e: WorkspaceEngagement;
  /** Saves part of the workspace; shows at once and saves in the background. */
  saveWs: (patch: Partial<Workspace>, reason?: string) => Promise<void>;
  /** Saves engagement fields (findings, actions, brief…) through the existing engagement save. */
  apply: (patch: Partial<Engagement>, message?: string) => void;
  save: SaveState;
  go: (tab: Tab) => void;
  refresh: () => void;
};

const Ctx = createContext<Ws | null>(null);
export const WsProvider = Ctx.Provider;
export function useWs() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWs outside the workspace");
  return v;
}

/* Server saves waiting to go, one per engagement and workspace part. Module-level so every view shares them. */
const pending = new Map<string, { timer: ReturnType<typeof setTimeout>; run: () => void }>();
function schedule(key: string, run: () => void, delay = 900) {
  const p = pending.get(key);
  if (p) clearTimeout(p.timer);
  pending.set(key, {
    run,
    timer: setTimeout(() => {
      pending.delete(key);
      run();
    }, delay),
  });
}
function flush(key: string) {
  const p = pending.get(key);
  if (!p) return;
  clearTimeout(p.timer);
  pending.delete(key);
  p.run();
}
/** Sends every waiting save now (before leaving the page, say). */
export function flushAll() {
  for (const k of [...pending.keys()]) flush(k);
}
if (typeof window !== "undefined") window.addEventListener("pagehide", flushAll);

/**
 * One part of the workspace (the point of view, the call plans…), edited in place. Every change shows in every view
 * at once (it's written to the shared data); the server save follows a moment later, and is sent at once if the
 * view closes first. So switching views never shows stale data or loses typing.
 */
export function useWsValue<K extends keyof Workspace>(key: K, reason: string) {
  type V = NonNullable<Workspace[K]>;
  const { e, saveWs } = useWs();
  const queryClient = useQueryClient();
  const slot = `${e.id}:${String(key)}`;
  const qk = ["workspace", e.id];
  /** A value, or a function of the latest value (which may not exist yet). */
  const set = (u: V | ((current: Workspace[K] | undefined) => V)) => {
    const current = queryClient.getQueryData<WorkspaceData>(qk)?.engagement.workspace[key];
    const v = typeof u === "function" ? (u as (c: Workspace[K] | undefined) => V)(current) : u;
    queryClient.setQueryData<WorkspaceData>(qk, (old) =>
      old
        ? {
            ...old,
            engagement: {
              ...old.engagement,
              workspace: { ...old.engagement.workspace, [key]: v },
            },
          }
        : old,
    );
    schedule(slot, () => void saveWs({ [key]: v } as Partial<Workspace>, reason));
  };
  useEffect(() => () => flush(slot), [slot]);
  return [e.workspace[key], set] as const;
}

/** The workspace save, with optimistic cache updates and a save state for the header. */
export function useWorkspaceSave(id: string) {
  const queryClient = useQueryClient();
  const save = useServerFn(saveWorkspace);
  const [state, setState] = useState<SaveState>({ state: "idle", at: null });
  const pending = useRef(0);
  const saveWs = async (patch: Partial<Workspace>, reason = "Edited") => {
    queryClient.setQueryData<WorkspaceData>(["workspace", id], (old) =>
      old
        ? {
            ...old,
            engagement: {
              ...old.engagement,
              workspace: { ...old.engagement.workspace, ...patch },
            },
          }
        : old,
    );
    pending.current++;
    setState((s) => ({ ...s, state: "saving" }));
    try {
      const r = await save({ data: { id, patch: patch as never, reason } });
      pending.current--;
      if (!pending.current) setState({ state: "saved", at: r.at });
      void queryClient.invalidateQueries({ queryKey: ["engagements"] });
      void queryClient.invalidateQueries({ queryKey: ["engagement", id] });
    } catch (err) {
      pending.current--;
      setState((s) => ({ ...s, state: "error" }));
      toast.error((err as Error).message);
      void queryClient.invalidateQueries({ queryKey: ["workspace", id] });
    }
  };
  return { saveWs, state };
}

/**
 * Saves a value a moment after it stops changing, and at once if the view closes first, so switching tabs never
 * loses typing. The value it started with is never saved back.
 */
export function useAutosave<T>(value: T, onSave: (v: T) => void, delay = 900) {
  const json = JSON.stringify(value);
  const last = useRef(json);
  const latest = useRef(onSave);
  latest.current = onSave;
  const pending = useRef<string | null>(null);
  useEffect(() => {
    if (json === last.current) {
      pending.current = null;
      return;
    }
    pending.current = json;
    const t = setTimeout(() => {
      last.current = json;
      pending.current = null;
      latest.current(JSON.parse(json) as T);
    }, delay);
    return () => clearTimeout(t);
  }, [json, delay]);
  useEffect(
    () => () => {
      if (pending.current) {
        last.current = pending.current;
        latest.current(JSON.parse(pending.current) as T);
        pending.current = null;
      }
    },
    [],
  );
}

export const STATUS_TONE: Record<EvidenceStatus, string> = {
  confirmed: "bg-success/10 text-success ring-success/25",
  "needs-validation": "bg-warning/12 text-[oklch(0.5_0.12_70)] ring-warning/30",
  contradicted: "bg-danger/10 text-danger ring-danger/25",
  unknown: "bg-muted text-muted-foreground ring-border",
};

export const day = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" })
    : "";
