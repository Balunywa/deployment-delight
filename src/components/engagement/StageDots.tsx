import { Check } from "lucide-react";

import { STAGES, type Engagement, progressOf } from "@/lib/engagements";
import { cn } from "@/lib/utils";

export function StageDots({ e }: { e: Engagement }) {
  const { current } = progressOf(e);
  return (
    <ol className="flex items-center gap-1" aria-label="Stages">
      {STAGES.map((s, i) => (
        <li key={s.key} className="flex items-center gap-1" title={s.title}>
          <span
            className={cn(
              "grid size-5 place-items-center rounded-full text-[10px] font-semibold",
              i < current
                ? "bg-success text-white"
                : i === current
                  ? "bg-primary text-primary-foreground ring-4 ring-primary/15"
                  : "bg-muted text-muted-foreground",
            )}
          >
            {i < current ? <Check className="size-3" /> : i + 1}
          </span>
          {i < STAGES.length - 1 && (
            <span className={cn("h-0.5 w-4", i < current ? "bg-success/60" : "bg-border")} />
          )}
        </li>
      ))}
    </ol>
  );
}
