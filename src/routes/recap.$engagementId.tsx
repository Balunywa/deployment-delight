import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Printer } from "lucide-react";

import { RecapDocument } from "@/components/engagement/Recap";
import { Button } from "@/components/ui/button";
import { recapQuery } from "@/lib/queries";

/** The customer's view of an engagement: no app chrome, no presenter notes. Safe to put on a shared screen. */
export const Route = createFileRoute("/recap/$engagementId")({
  head: () => ({ meta: [{ title: "Recap" }] }),
  component: RecapPage,
});

function RecapPage() {
  const { engagementId } = Route.useParams();
  const q = useQuery(recapQuery(engagementId));
  return (
    <div className="min-h-screen bg-muted/40 px-4 py-10 print:bg-white print:p-0">
      <div className="mx-auto max-w-3xl">
        <div className="mb-4 flex justify-end print:hidden">
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="size-3.5" /> Print or save as PDF
          </Button>
        </div>
        {q.data ? (
          <RecapDocument recap={q.data} className="shadow-sm print:border-0 print:shadow-none" />
        ) : (
          <p className="text-center text-[13px] text-muted-foreground">
            {q.error ? "This recap isn't available." : "Loading…"}
          </p>
        )}
      </div>
    </div>
  );
}
