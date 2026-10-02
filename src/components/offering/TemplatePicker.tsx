import { Check, ExternalLink } from "lucide-react";

import { ServiceIcon } from "@/components/architecture/ServiceIcon";
import { REFERENCE_DESIGNS } from "@/lib/offering/templates";
import { SERVICE_BY_ID } from "@/lib/catalog";
import { cn } from "@/lib/utils";

export function TemplatePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {REFERENCE_DESIGNS.map((design) => {
        const selected = value === design.id;
        return (
          <article
            key={design.id}
            className={cn(
              "flex h-full flex-col overflow-hidden rounded-xl border text-left transition-colors",
              selected
                ? "border-primary/50 bg-primary/[0.05] ring-1 ring-primary/25"
                : "border-border bg-card",
            )}
          >
            <button
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(design.id)}
              className={cn(
                "flex flex-1 flex-col p-4 text-left transition-colors",
                !selected && "hover:bg-muted/30",
              )}
            >
              <span className="flex items-start justify-between gap-3">
                <span>
                  <span className="block text-[14px] font-semibold">{design.title}</span>
                  <span className="mt-1.5 block text-[12.5px] leading-relaxed text-muted-foreground">
                    {design.summary}
                  </span>
                </span>
                <span
                  className={cn(
                    "grid size-4 shrink-0 place-items-center rounded-full border",
                    selected
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border",
                  )}
                >
                  {selected && <Check className="size-3" />}
                </span>
              </span>

              <span className="mt-3 block text-[12px] leading-relaxed">
                <span className="font-semibold">When to choose: </span>
                <span className="text-muted-foreground">{design.when}</span>
              </span>

              <span className="mt-3 flex flex-wrap gap-1.5" aria-label="Included services">
                {design.architecture.selected.map((service) => {
                  const def = SERVICE_BY_ID.get(service.id);
                  return (
                    <span
                      key={service.id}
                      title={def?.name ?? service.id}
                      aria-label={def?.name ?? service.id}
                    >
                      <ServiceIcon id={service.id} size="sm" />
                    </span>
                  );
                })}
              </span>
            </button>

            <div className="space-y-2 border-t border-border px-4 py-3 text-[11.5px] leading-relaxed text-muted-foreground">
              <a
                href={design.source.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
              >
                Based on {design.source.title}
                <ExternalLink className="size-3" />
              </a>
              <p>{design.differences.join(" ")}</p>
            </div>
          </article>
        );
      })}
    </div>
  );
}
