/*
 * Where an engagement is tracked in MSX: under an opportunity, or proactive until one exists. Internal only; MSX stays
 * the record and Cloud Delivery keeps the opportunity ID as the link (for Copilot with msx-mcp, and the update).
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Engagement } from "@/lib/engagements";
import { linkEngagementOpportunity } from "@/lib/msx.functions";

export function MsxLink({ e }: { e: Engagement }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [id, setId] = useState(e.msx_opportunity_id ?? "");
  const [name, setName] = useState(e.msx_opportunity_name ?? "");
  const save = useMutation({
    mutationFn: useServerFn(linkEngagementOpportunity),
    onSuccess: async (r: { msx_opportunity_id: string | null }) => {
      toast.success(
        r.msx_opportunity_id
          ? `Linked to MSX opportunity ${r.msx_opportunity_id}.`
          : "Now a proactive engagement.",
      );
      setOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["engagement", e.id] });
      void queryClient.invalidateQueries({ queryKey: ["engagements"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });
  const ok = /^[A-Za-z0-9][A-Za-z0-9-]{2,63}$/.test(id.trim());
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="inline-flex items-center gap-1 hover:text-foreground"
          title="Where this is tracked in MSX (internal)"
        >
          <Link2 className="size-3.5" />
          {e.msx_opportunity_id
            ? `MSX ${e.msx_opportunity_id}${e.msx_opportunity_name ? ` · ${e.msx_opportunity_name}` : ""}`
            : "Proactive · link an opportunity"}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-2.5">
        <div>
          <p className="text-[13px] font-semibold">MSX opportunity</p>
          <p className="text-[11.5px] text-muted-foreground">
            Internal only. MSX stays the record; this keeps the link
            {e.customer_tpid ? ` (customer TPID ${e.customer_tpid})` : ""}.
          </p>
        </div>
        <Input
          aria-label="Opportunity ID"
          placeholder="7-ABC123XYZ"
          value={id}
          onChange={(ev) => setId(ev.target.value)}
        />
        <Input
          aria-label="Opportunity name"
          placeholder="Opportunity name (optional)"
          value={name}
          onChange={(ev) => setName(ev.target.value)}
        />
        <div className="flex justify-between gap-2">
          {e.msx_opportunity_id ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={save.isPending}
              onClick={() => save.mutate({ data: { engagementId: e.id, opportunityId: null } })}
            >
              Make proactive
            </Button>
          ) : (
            <span />
          )}
          <Button
            size="sm"
            disabled={!ok || save.isPending}
            onClick={() =>
              save.mutate({
                data: {
                  engagementId: e.id,
                  opportunityId: id.trim(),
                  ...(name.trim() ? { opportunityName: name.trim() } : {}),
                },
              })
            }
          >
            Link opportunity
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
