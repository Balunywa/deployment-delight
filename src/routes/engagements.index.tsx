import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, Ear, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState, PageHeader } from "@/components/Primitives";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StageDots } from "@/components/engagement/StageDots";
import { STAGES, progressOf } from "@/lib/engagements";
import { createEngagement } from "@/lib/engagements.functions";
import { relative } from "@/lib/format";
import { customersQuery, engagementsQuery } from "@/lib/queries";

export const Route = createFileRoute("/engagements/")({
  head: () => ({ meta: [{ title: "Engagements · Cloud Delivery" }] }),
  component: Engagements,
});

function Engagements() {
  const list = useQuery(engagementsQuery);
  const [open, setOpen] = useState(false);
  const items = list.data ?? [];
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Engagements"
        description="Listen and consult before solutioning. A conversation navigator for SEs and CSAs: one question at a time, a working summary of what's confirmed and what's still a hypothesis, examples from the catalog chosen by what the customer said, and owned next steps. Then a customer-safe recap, an internal handoff, and a proof."
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus className="size-4" /> Start an engagement
          </Button>
        }
      />

      <ol className="mb-6 grid gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {STAGES.map((s, i) => (
          <li key={s.key} className="rounded-xl border border-border bg-card px-3.5 py-3">
            <p className="font-mono text-[11px] text-muted-foreground">0{i + 1}</p>
            <p className="text-[13.5px] font-semibold">{s.title}</p>
            <p className="text-[12px] text-muted-foreground">{s.sub}</p>
          </li>
        ))}
      </ol>

      {list.isLoading ? (
        <EmptyState title="Loading engagements…" />
      ) : !items.length ? (
        <EmptyState
          title="No engagements yet"
          description="Start one before the first solutioning conversation: listen first, then show what the catalog already has."
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {items.map((e) => {
            const { next } = progressOf(e);
            return (
              <article
                key={e.id}
                className="group relative rounded-xl border border-border bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_14px_32px_-18px_rgba(30,64,175,0.45)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      to="/engagements/$engagementId"
                      params={{ engagementId: e.id }}
                      className="text-[15px] leading-tight font-semibold group-hover:text-primary after:absolute after:inset-0 after:rounded-xl after:content-['']"
                    >
                      {e.name}
                    </Link>
                    <p className="mt-0.5 line-clamp-1 text-[12px] text-muted-foreground">
                      {e.customer_name ?? "No customer yet"}
                      {e.brief.workflow ? ` · ${e.brief.workflow}` : ""}
                    </p>
                  </div>
                  <StageDots e={e} />
                </div>
                {(e.brief.outcome || e.brief.words) && (
                  <p className="mt-2 line-clamp-2 text-[12.5px] text-foreground/85">
                    {e.brief.outcome || `“${e.brief.words}”`}
                  </p>
                )}
                <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-2.5 text-[11.5px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1 font-medium text-foreground">
                    <ArrowRight className="size-3 text-primary" /> {next}
                  </span>
                  <span>
                    {e.owner_name ? `${e.owner_name} · ` : ""}
                    {relative(e.updated_at)}
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      )}
      <NewEngagement open={open} onOpenChange={setOpen} />
    </div>
  );
}

function NewEngagement({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const customers = useQuery(customersQuery);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [customerId, setCustomerId] = useState<string>("none");
  const create = useMutation({
    mutationFn: useServerFn(createEngagement),
    onSuccess: (r: { id: string }) => {
      void queryClient.invalidateQueries({ queryKey: ["engagements"] });
      onOpenChange(false);
      toast.success("Engagement started. Start with what they're trying to accomplish.");
      void navigate({ to: "/engagements/$engagementId", params: { engagementId: r.id } });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Ear className="size-4 text-primary" /> Start an engagement
          </DialogTitle>
          <DialogDescription>
            Name it after the outcome the customer wants, not the technology.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="eng-name">Engagement</Label>
            <Input
              id="eng-name"
              placeholder="e.g. Maintenance work packages in days, not weeks"
              value={name}
              onChange={(ev) => setName(ev.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Customer</Label>
            <Select value={customerId} onValueChange={setCustomerId}>
              <SelectTrigger aria-label="Customer">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not a customer yet</SelectItem>
                {(customers.data ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={name.trim().length < 3 || create.isPending}
            onClick={() =>
              create.mutate({
                data: {
                  name: name.trim(),
                  customerId: customerId === "none" ? null : customerId,
                  signals: [],
                  words: "",
                },
              })
            }
          >
            Start listening
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
