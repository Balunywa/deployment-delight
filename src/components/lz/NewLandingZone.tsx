import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { SCENARIOS } from "@/lib/alz/scenarios";
import { createFoundation } from "@/lib/factory.functions";
import { AZURE_REGIONS } from "@/lib/regions";
import { cn } from "@/lib/utils";

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 8);

/** Starts a platform landing zone for a customer tenant from one of Microsoft's accelerator scenarios. */
export function NewLandingZone({
  open,
  onOpenChange,
  customers,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  customers: { id: string; name: string }[];
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [customerId, setCustomerId] = useState("");
  const [prefix, setPrefix] = useState<string | null>(null);
  const [scenario, setScenario] = useState("smb-single-hub");
  const [region, setRegion] = useState("eastus2");
  const [secondary, setSecondary] = useState("centralus");
  const [email, setEmail] = useState("");
  const customer = customers.find((c) => c.id === customerId);
  const p = prefix ?? (customer ? slug(customer.name) : "");
  const s = SCENARIOS.find((x) => x.id === scenario)!;
  const create = useMutation({
    mutationFn: useServerFn(createFoundation),
    onSuccess: (r: { foundationId: string }) => {
      toast.success("Landing zone created. Review the design, then deploy it.");
      void queryClient.invalidateQueries({ queryKey: ["foundations"] });
      onOpenChange(false);
      void navigate({ to: "/foundations/$foundationId", params: { foundationId: r.foundationId } });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const valid =
    !!customer &&
    /^[a-z][a-z0-9-]{1,9}$/.test(p) &&
    /.+@.+\..+/.test(email) &&
    (!s.multiRegion || secondary !== region);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New landing zone</DialogTitle>
          <DialogDescription>
            A platform landing zone for a customer tenant, starting from one of the scenarios
            Microsoft ships with the Azure Landing Zones accelerator. You can change everything on
            the design canvas before deploying.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">Customer</Label>
              <Select value={customerId} onValueChange={setCustomerId}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Choose a customer" />
                </SelectTrigger>
                <SelectContent>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Management group prefix</Label>
              <Input
                className="mt-1 font-mono"
                value={p}
                onChange={(e) => setPrefix(e.target.value.toLowerCase())}
                placeholder="e.g. contoso"
              />
            </div>
          </div>
          <div>
            <Label className="text-xs">Scenario</Label>
            <div className="mt-1 grid gap-1.5 sm:grid-cols-2">
              {SCENARIOS.map((x) => (
                <button
                  key={x.id}
                  disabled={!x.supported}
                  onClick={() => setScenario(x.id)}
                  className={cn(
                    "rounded-md border p-2.5 text-left",
                    scenario === x.id
                      ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                      : "border-border",
                    !x.supported && "cursor-not-allowed opacity-50",
                  )}
                >
                  <p className="text-[12.5px] font-medium">{x.name}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{x.body}</p>
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">Primary region</Label>
              <Select value={region} onValueChange={setRegion}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AZURE_REGIONS.map((r) => (
                    <SelectItem key={r.name} value={r.name}>
                      {r.display}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {s.multiRegion && (
              <div>
                <Label className="text-xs">Second region</Label>
                <Select value={secondary} onValueChange={setSecondary}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {AZURE_REGIONS.filter((r) => r.name !== region).map((r) => (
                      <SelectItem key={r.name} value={r.name}>
                        {r.display}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label className="text-xs">Security contact email</Label>
              <Input
                className="mt-1"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="secops@example.com"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              disabled={!valid || create.isPending}
              onClick={() =>
                create.mutate({
                  data: {
                    customerId,
                    name: `${customer!.name} landing zone`,
                    prefix: p,
                    displayName: customer!.name,
                    region,
                    secondaryRegion: s.multiRegion ? secondary : "",
                    scenario,
                    securityContactEmail: email,
                  },
                })
              }
            >
              {create.isPending ? "Creating…" : "Create landing zone"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
