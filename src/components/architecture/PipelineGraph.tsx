import { CircleCheck, CircleDashed, CircleX, Clock, Loader2, ShieldCheck } from "lucide-react";
import { Fragment } from "react";

import type { Job, Stage } from "@/lib/pipeline";
import { cn } from "@/lib/utils";

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "waiting" | "skipped";

type Props = {
  stages: Stage[];
  status?: (job: Job, stage: Stage) => JobStatus | undefined;
  onSelect?: (job: Job) => void;
  selectedJob?: string | null;
};

const ICON: Record<JobStatus, { icon: typeof CircleCheck; cls: string }> = {
  queued: { icon: CircleDashed, cls: "text-muted-foreground" },
  running: { icon: Loader2, cls: "animate-spin text-info" },
  succeeded: { icon: CircleCheck, cls: "text-success" },
  failed: { icon: CircleX, cls: "text-danger" },
  waiting: { icon: Clock, cls: "text-warning" },
  skipped: { icon: CircleDashed, cls: "text-muted-foreground/50" },
};

/** Stage → job graph in the style of a CI/CD run view. */
export function PipelineGraph({ stages, status, onSelect, selectedJob }: Props) {
  return (
    <div className="canvas-grid overflow-x-auto rounded-md border border-border p-5">
      <div className="flex min-w-max items-stretch">
        {stages.map((stage, i) => (
          <Fragment key={stage.id}>
            {i > 0 && (
              <div className="flex w-8 shrink-0 items-center" aria-hidden>
                <span className="h-px w-full bg-border-strong" />
              </div>
            )}
            <div className="flex w-52 shrink-0 flex-col">
              <p className="mb-2 text-[11px] font-semibold text-muted-foreground">{stage.name}</p>
              <div className="flex flex-col gap-1.5 rounded-md border border-border bg-card p-1.5">
                {stage.jobs.map((job) => {
                  const st = status?.(job, stage);
                  const Icon = st ? ICON[st].icon : job.gate ? ShieldCheck : CircleDashed;
                  return (
                    <button
                      key={job.id}
                      onClick={() => onSelect?.(job)}
                      title={job.detail}
                      className={cn(
                        "flex items-center gap-2 rounded-sm px-2 py-1.5 text-left transition-colors hover:bg-muted",
                        selectedJob === job.id && "bg-accent",
                        job.gate && "border border-dashed border-warning/50",
                      )}
                    >
                      <Icon
                        className={cn(
                          "size-3.5 shrink-0",
                          st ? ICON[st].cls : job.gate ? "text-warning" : "text-muted-foreground",
                        )}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12px] font-medium">{job.name}</span>
                        <span className="block truncate font-mono text-[10px] text-muted-foreground">
                          {job.detail}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </Fragment>
        ))}
      </div>
    </div>
  );
}
