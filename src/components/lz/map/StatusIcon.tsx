import { CheckCircle2, CircleAlert, CircleHelp, XCircle } from "lucide-react";

import type { Check } from "@/lib/alz/access-checks";
import { cn } from "@/lib/utils";

import { OUTCOME } from "../diagram/theme";

export function StatusIcon({ status, className }: { status: Check["status"]; className?: string }) {
  const cls = cn("size-3.5 shrink-0", className);
  return status === "pass" ? (
    <CheckCircle2 className={cls} style={{ color: OUTCOME.reaches.color }} />
  ) : status === "fail" ? (
    <XCircle className={cls} style={{ color: OUTCOME.broken.color }} />
  ) : status === "warn" ? (
    <CircleAlert className={cls} style={{ color: OUTCOME["needs-rules"].color }} />
  ) : (
    <CircleHelp className={cls} style={{ color: OUTCOME.isolated.color }} />
  );
}
