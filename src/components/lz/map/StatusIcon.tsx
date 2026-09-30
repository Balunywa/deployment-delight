import { CheckCircle2, CircleAlert, CircleHelp, XCircle } from "lucide-react";

import type { Check } from "@/lib/alz/access-checks";
import { cn } from "@/lib/utils";

export function StatusIcon({ status, className }: { status: Check["status"]; className?: string }) {
  const cls = cn("size-3.5 shrink-0", className);
  return status === "pass" ? (
    <CheckCircle2 className={cn(cls, "text-[#107c10]")} />
  ) : status === "fail" ? (
    <XCircle className={cn(cls, "text-[#a4262c]")} />
  ) : status === "warn" ? (
    <CircleAlert className={cn(cls, "text-[#c19c00]")} />
  ) : (
    <CircleHelp className={cn(cls, "text-[#0078d4]")} />
  );
}
