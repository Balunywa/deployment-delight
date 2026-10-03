/*
 * The engagement workspace's small form primitives and display pieces. Visual language matches the rest of the app.
 * Shared state (context, autosave, save state) is in ws.ts.
 */
import { Check, CircleAlert, Loader2, Plus, X } from "lucide-react";
import { type ReactNode, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { relative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { type EvidenceStatus, STATUS_LABEL } from "@/lib/workspace";

import { STATUS_TONE, type SaveState } from "./ws";

export function SaveIndicator({ save }: { save: SaveState }) {
  const base = "inline-flex items-center gap-1 text-[11.5px]";
  if (save.state === "saving")
    return (
      <span className={cn(base, "text-muted-foreground")} role="status">
        <Loader2 className="size-3 animate-spin" /> Saving…
      </span>
    );
  if (save.state === "error")
    return (
      <span className={cn(base, "text-danger")} role="status">
        <CircleAlert className="size-3" /> Not saved
      </span>
    );
  if (save.state === "saved" && save.at)
    return (
      <span className={cn(base, "text-muted-foreground")} role="status">
        <Check className="size-3 text-success" /> Saved {relative(save.at)}
      </span>
    );
  return (
    <span className={cn(base, "text-muted-foreground")} role="status">
      Saves as you type
    </span>
  );
}

/* --------------------------------------------------------------------------------------- primitives */

export function Panel({
  title,
  sub,
  actions,
  children,
  className,
  tone,
  label,
}: {
  title?: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string | undefined;
  tone?: "primary" | "warning" | undefined;
  /** Accessible name when the title isn't plain text. */
  label?: string | undefined;
}) {
  return (
    <section
      aria-label={label ?? (typeof title === "string" ? title : undefined)}
      className={cn(
        "rounded-xl border bg-card p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)] sm:p-5",
        tone === "primary"
          ? "border-primary/30 bg-primary/[0.03]"
          : tone === "warning"
            ? "border-warning/40 bg-warning/5"
            : "border-border",
        className,
      )}
    >
      {(title || actions) && (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {title && <h2 className="text-[14.5px] font-semibold tracking-tight">{title}</h2>}
            {sub && <p className="mt-0.5 text-[12.5px] text-muted-foreground">{sub}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {children && <div className={title || sub ? "mt-3.5" : ""}>{children}</div>}
    </section>
  );
}

export function Field({
  label,
  hint,
  htmlFor,
  children,
  className,
}: {
  label: string;
  hint?: ReactNode;
  htmlFor?: string | undefined;
  children: ReactNode;
  className?: string | undefined;
}) {
  return (
    <div className={cn("space-y-1", className)}>
      <label htmlFor={htmlFor} className="block text-[12.5px] font-medium">
        {label}
      </label>
      {children}
      {hint && <p className="text-[11.5px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

let seq = 0;
const nextId = () => `wf-${++seq}`;

export function TextField({
  label,
  hint,
  value,
  onChange,
  placeholder,
  rows,
  className,
  type,
}: {
  label: string;
  hint?: ReactNode;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  /** Multi-line when set. */
  rows?: number;
  className?: string;
  type?: "date" | "text";
}) {
  const [id] = useState(nextId);
  return (
    <Field label={label} hint={hint} htmlFor={id} className={className}>
      {rows ? (
        <Textarea
          id={id}
          rows={rows}
          value={value}
          placeholder={placeholder}
          onChange={(ev) => onChange(ev.target.value)}
          className="text-[13px]"
        />
      ) : (
        <Input
          id={id}
          type={type ?? "text"}
          value={value}
          placeholder={placeholder}
          onChange={(ev) => onChange(ev.target.value)}
          className="text-[13px]"
        />
      )}
    </Field>
  );
}

/** A list of short strings: edit in place, add, remove. */
export function StringList({
  label,
  hint,
  values,
  onChange,
  placeholder,
  addLabel = "Add",
}: {
  label: string;
  hint?: ReactNode;
  values: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  addLabel?: string;
}) {
  return (
    <div role="group" aria-label={label} className="space-y-1.5">
      <p className="text-[12.5px] font-medium">{label}</p>
      {hint && <p className="text-[11.5px] text-muted-foreground">{hint}</p>}
      {values.map((v, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <Input
            aria-label={`${label} ${i + 1}`}
            value={v}
            placeholder={placeholder}
            onChange={(ev) => onChange(values.map((x, j) => (j === i ? ev.target.value : x)))}
            className="h-8 text-[12.5px]"
          />
          <button
            type="button"
            aria-label={`Remove ${label.toLowerCase()} ${i + 1}`}
            onClick={() => onChange(values.filter((_, j) => j !== i))}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
      <Button type="button" size="sm" variant="ghost" onClick={() => onChange([...values, ""])}>
        <Plus className="size-3.5" /> {addLabel}
      </Button>
    </div>
  );
}

export function StatusChip({ status }: { status: EvidenceStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ring-1 ring-inset",
        STATUS_TONE[status],
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

export function Chip({
  children,
  className,
}: {
  children: ReactNode;
  className?: string | undefined;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium whitespace-nowrap text-muted-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}
