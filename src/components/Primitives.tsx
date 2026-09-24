import { type ReactNode } from "react";

import { cn } from "@/lib/utils";

type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "primary";

const toneClass: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground border-border",
  success: "bg-success/10 text-success border-success/25",
  warning: "bg-warning/12 text-warning border-warning/30",
  danger: "bg-danger/10 text-danger border-danger/25",
  info: "bg-info/10 text-info border-info/25",
  primary: "bg-primary/10 text-primary border-primary/25",
};

export function Pill({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm border px-1.5 py-px text-[11px] font-medium whitespace-nowrap",
        toneClass[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Dot({ tone = "neutral" }: { tone?: Tone }) {
  const bg: Record<Tone, string> = {
    neutral: "bg-muted-foreground",
    success: "bg-success",
    warning: "bg-warning",
    danger: "bg-danger",
    info: "bg-info",
    primary: "bg-primary",
  };
  return <span className={cn("size-1.5 shrink-0 rounded-full", bg[tone])} />;
}

export function Panel({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("rounded-md border border-border bg-card", className)}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-4 border-b border-border px-4 py-3">
          <div>
            {title && <h2 className="text-sm font-semibold text-foreground">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn("p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

export function Metric({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
}) {
  const valueTone: Record<Tone, string> = {
    neutral: "text-foreground",
    success: "text-success",
    warning: "text-warning",
    danger: "text-danger",
    info: "text-info",
    primary: "text-primary",
  };
  return (
    <div className="rounded-md border border-border bg-card px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1 font-mono text-2xl leading-none font-semibold tabular-nums",
          valueTone[tone],
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  meta,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-[22px] leading-tight font-semibold text-foreground">{title}</h1>
        {description && (
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p>
        )}
        {meta && <div className="mt-2 flex flex-wrap items-center gap-2">{meta}</div>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="rounded-md border border-dashed border-border px-6 py-10 text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
    </div>
  );
}

const resultTone: Record<string, Tone> = {
  PASS: "success",
  WARNING: "warning",
  BLOCKING: "danger",
  FAIL: "danger",
};

const resultLabel: Record<string, string> = {
  PASS: "Pass",
  WARNING: "Warning",
  BLOCKING: "Blocking",
  FAIL: "Fail",
};

export function ResultPill({ result }: { result: string }) {
  return (
    <Pill tone={resultTone[result] ?? "neutral"}>
      <Dot tone={resultTone[result] ?? "neutral"} />
      {resultLabel[result] ?? result}
    </Pill>
  );
}

export const statusLabel = (status: string) => {
  const s = status.replace(/_/g, " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/** Small section label used above groups of content. */
export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-xs font-medium text-muted-foreground", className)}>{children}</p>;
}

export const deploymentTone = (status: string): Tone => {
  if (status === "SUCCEEDED") return "success";
  if (["FAILED", "VALIDATION_FAILED", "PLAN_FAILED", "REQUIRES_REMEDIATION"].includes(status))
    return "danger";
  if (["AWAITING_APPROVAL", "AWAITING_PLAN_APPROVAL", "VALIDATING", "PLANNING"].includes(status))
    return "warning";
  if (["DEPLOYING", "QUEUED"].includes(status)) return "info";
  return "neutral";
};

export const severityTone = (severity: string): Tone =>
  severity === "critical" || severity === "high"
    ? "danger"
    : severity === "medium"
      ? "warning"
      : "neutral";
