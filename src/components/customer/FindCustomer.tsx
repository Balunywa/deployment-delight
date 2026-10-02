/*
 * Start from MSX's key: type a TPID (or a name). An existing profile opens; a new TPID creates the profile, so the
 * same customer is never added twice.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Search } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

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
import { findCustomersByTpid, upsertCustomerByTpid } from "@/lib/msx.functions";

export function FindCustomer({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [name, setName] = useState("");
  const [accountName, setAccountName] = useState("");
  const find = useServerFn(findCustomersByTpid);
  const term = q.trim();
  const results = useQuery({
    queryKey: ["find-customer", term],
    queryFn: () => find({ data: { q: term } }),
    enabled: term.length >= 2,
  });
  const create = useMutation({
    mutationFn: useServerFn(upsertCustomerByTpid),
    onSuccess: (r: { customer: { id: string; name: string }; created: boolean }) => {
      toast.success(
        r.created ? `${r.customer.name} added.` : `${r.customer.name} already has that TPID.`,
      );
      onOpenChange(false);
      void navigate({ to: "/customers/$customerId", params: { customerId: r.customer.id } });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const isTpid = /^\d{3,12}$/.test(term);
  const list = results.data ?? [];
  const exact = isTpid && list.some((c) => c.tpid === term);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Find or add a customer</DialogTitle>
          <DialogDescription>
            Start with the TPID from MSX. An existing profile opens; a new TPID creates one. MSX
            stays the record for the account.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
            <Input
              aria-label="TPID or name"
              className="pl-8"
              placeholder="TPID, or part of the name"
              value={q}
              onChange={(ev) => setQ(ev.target.value)}
              autoFocus
            />
          </div>
          {term.length >= 2 && (
            <ul aria-label="Matches" className="space-y-1">
              {list.map((c) => (
                <li key={c.id}>
                  <button
                    onClick={() => {
                      onOpenChange(false);
                      void navigate({ to: "/customers/$customerId", params: { customerId: c.id } });
                    }}
                    className="flex w-full items-center justify-between rounded-md border border-border px-3 py-2 text-left hover:border-primary"
                  >
                    <span className="text-[13px] font-medium">{c.name}</span>
                    <span className="font-mono text-[11.5px] text-muted-foreground">
                      {c.tpid ? `TPID ${c.tpid}` : "no TPID"} · {c.engagements} engagement
                      {c.engagements === 1 ? "" : "s"}
                    </span>
                  </button>
                </li>
              ))}
              {!results.isLoading && !list.length && (
                <li className="text-[12.5px] text-muted-foreground">No customer matches.</li>
              )}
            </ul>
          )}
          {isTpid && !exact && !results.isLoading && (
            <div className="space-y-2 rounded-lg border border-dashed border-border p-3">
              <p className="text-[12.5px] font-medium">New customer with TPID {term}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="new-name" className="text-xs">
                    Name
                  </Label>
                  <Input
                    id="new-name"
                    placeholder="How the team refers to it"
                    value={name}
                    onChange={(ev) => setName(ev.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="new-account" className="text-xs">
                    MSX account name (optional)
                  </Label>
                  <Input
                    id="new-account"
                    value={accountName}
                    onChange={(ev) => setAccountName(ev.target.value)}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {isTpid && !exact && (
            <Button
              disabled={name.trim().length < 2 || create.isPending}
              onClick={() =>
                create.mutate({
                  data: {
                    tpid: term,
                    name: name.trim(),
                    ...(accountName.trim() ? { accountName: accountName.trim() } : {}),
                  },
                })
              }
            >
              Add customer
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
