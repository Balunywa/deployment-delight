/* Hooks shared by the customer onboarding and prep screens. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { connectorStatus, msxCustomer } from "@/lib/msx-connector";
import { saveMsxSnapshot } from "@/lib/prep.functions";

/** Whether the MSX connector on this PC is running and signed in to MSX. */
export function useConnector() {
  return useQuery({
    queryKey: ["msx-connector"],
    queryFn: connectorStatus,
    refetchInterval: (q) =>
      ({ ready: 60_000, "signed-out": 5_000, error: 15_000, off: 15_000 })[
        q.state.data?.state ?? "off"
      ],
    retry: false,
  });
}

/** Pulls the customer's account and open opportunities from MSX (through the connector) and keeps the snapshot. */
export function useRefreshFromMsx(customerId: string | null) {
  const queryClient = useQueryClient();
  const save = useServerFn(saveMsxSnapshot);
  return useMutation({
    mutationFn: async (tpid: string) => {
      if (!customerId) throw new Error("No customer yet.");
      const snapshot = await msxCustomer(tpid);
      await save({ data: { customerId, snapshot } });
      return snapshot;
    },
    onSuccess: (s) => {
      toast.success(
        s.account
          ? `MSX: ${s.account.name}, ${s.opportunities.length} open opportunit${s.opportunities.length === 1 ? "y" : "ies"}.`
          : `MSX has no account with TPID ${s.tpid} that you can see.`,
      );
      void queryClient.invalidateQueries({ queryKey: ["customer-profile", customerId] });
      void queryClient.invalidateQueries({ queryKey: ["customer-prep", customerId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
