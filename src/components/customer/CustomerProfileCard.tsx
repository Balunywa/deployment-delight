/*
 * The customer's profile for SE/CSA work: the TPID that links it to MSX, and context MSX doesn't hold (meeting notes,
 * emails, transcripts, a plain-language brief) for preparing the next conversation. Internal only.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { FileText, Mail, MessageSquareText, Mic, NotebookPen, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { relative } from "@/lib/format";
import {
  addCustomerContext,
  getCustomerProfile,
  removeCustomerContext,
  setCustomerTpid,
} from "@/lib/msx.functions";
import type { ContextEntry } from "@/lib/msx.server";

const SOURCES: { id: ContextEntry["source"]; label: string; icon: typeof FileText }[] = [
  { id: "notes", label: "Meeting notes", icon: NotebookPen },
  { id: "msx", label: "From MSX", icon: FileText },
  { id: "email", label: "Email", icon: Mail },
  { id: "transcript", label: "Call transcript", icon: Mic },
  { id: "prompt", label: "Brief in my words", icon: MessageSquareText },
  { id: "other", label: "Other", icon: FileText },
];

export function CustomerProfileCard({
  customerId,
  onChange,
}: {
  customerId: string;
  /** Called after context is added or removed, so views built on it can refresh. */
  onChange?: () => void;
}) {
  const queryClient = useQueryClient();
  const key = ["customer-profile", customerId];
  const load = useServerFn(getCustomerProfile);
  const profile = useQuery({
    queryKey: key,
    queryFn: () => load({ data: { id: customerId } }),
  });
  const refresh = () => {
    onChange?.();
    return queryClient.invalidateQueries({ queryKey: key });
  };
  const [tpid, setTpid] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [source, setSource] = useState<ContextEntry["source"]>("notes");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");

  const saveTpid = useMutation({
    mutationFn: useServerFn(setCustomerTpid),
    onSuccess: () => {
      toast.success("TPID saved.");
      setTpid(null);
      void refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const add = useMutation({
    mutationFn: useServerFn(addCustomerContext),
    onSuccess: () => {
      toast.success("Context added.");
      setAdding(false);
      setTitle("");
      setText("");
      void refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: useServerFn(removeCustomerContext),
    onSuccess: () => void refresh(),
    onError: (e: Error) => toast.error(e.message),
  });

  const c = profile.data;
  if (!c) return null;
  const entries = [...(c.context ?? [])].reverse();
  const editing = tpid !== null;

  return (
    <section
      aria-label="Customer profile"
      className="mb-5 rounded-xl border border-border bg-card p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h2 className="text-[14px] font-semibold">Profile and context</h2>
          <p className="text-[12px] text-muted-foreground">
            MSX stays the record for the account and its opportunities; the TPID is the link.
            Context here is what MSX doesn't hold, for preparing the next conversation. Internal
            only.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
          <span className="text-muted-foreground">TPID</span>
          {editing ? (
            <>
              <Input
                aria-label="TPID"
                className="h-8 w-32 font-mono"
                value={tpid}
                onChange={(ev) => setTpid(ev.target.value.replace(/\D/g, ""))}
                placeholder="digits"
              />
              <Button
                size="sm"
                disabled={saveTpid.isPending || !/^\d{3,12}$/.test(tpid ?? "")}
                onClick={() => saveTpid.mutate({ data: { id: c.id, tpid } })}
              >
                Save TPID
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setTpid(null)}>
                Cancel
              </Button>
            </>
          ) : (
            <button
              onClick={() => setTpid(c.tpid ?? "")}
              className="rounded-md border border-border px-2 py-1 font-mono hover:border-border-strong"
              title="Set the MSX top parent ID"
            >
              {c.tpid ?? "Add TPID"}
            </button>
          )}
          {c.msx_account_name && (
            <span className="text-muted-foreground">· MSX account {c.msx_account_name}</span>
          )}
        </div>
      </div>

      <div className="mt-3 space-y-2">
        {entries.length === 0 && !adding && (
          <p className="rounded-lg border border-dashed border-border px-3 py-3 text-[12.5px] text-muted-foreground">
            No context yet. Pull from MSX, or add meeting notes, an email, a call transcript, or a
            brief in your own words.
          </p>
        )}
        {entries.map((x) => {
          const s = SOURCES.find((y) => y.id === x.source) ?? SOURCES[5]!;
          return (
            <article key={x.id} className="group rounded-lg border border-border px-3 py-2.5">
              <div className="flex items-start justify-between gap-2">
                <p className="flex flex-wrap items-center gap-1.5 text-[12.5px] font-semibold">
                  <s.icon className="size-3.5 text-muted-foreground" /> {x.title}
                  <span className="font-normal text-muted-foreground">
                    · {s.label} · {x.by} · {relative(x.at)}
                  </span>
                </p>
                <button
                  aria-label={`Remove ${x.title}`}
                  onClick={() => remove.mutate({ data: { customerId: c.id, entryId: x.id } })}
                  className="text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-danger focus:opacity-100"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
              <p className="mt-1 line-clamp-4 text-[12.5px] whitespace-pre-wrap text-foreground/85">
                {x.text}
              </p>
            </article>
          );
        })}
        {adding ? (
          <div className="space-y-2 rounded-lg border border-border p-3">
            <div className="grid gap-2 sm:grid-cols-[180px_1fr]">
              <Select value={source} onValueChange={(v) => setSource(v as ContextEntry["source"])}>
                <SelectTrigger aria-label="Source">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SOURCES.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                aria-label="Title"
                placeholder="e.g. Discovery call, 3 Oct"
                value={title}
                onChange={(ev) => setTitle(ev.target.value)}
              />
            </div>
            <Textarea
              aria-label="Context"
              rows={5}
              placeholder="Paste the notes, email or transcript, or describe what you know in your own words."
              value={text}
              onChange={(ev) => setText(ev.target.value)}
            />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={title.trim().length < 2 || text.trim().length < 2 || add.isPending}
                onClick={() => add.mutate({ data: { customerId: c.id, source, title, text } })}
              >
                Save context
              </Button>
            </div>
          </div>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus className="size-3.5" /> Add context
          </Button>
        )}
      </div>
    </section>
  );
}
