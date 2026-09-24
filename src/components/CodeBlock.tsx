import { toast } from "sonner";

import { cn } from "@/lib/utils";

/** Read-only code viewer with line numbers and copy. */
export function CodeBlock({ title, code }: { title: string; code: string }) {
  const lines = code.split("\n");
  return (
    <div className="overflow-hidden rounded-md border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border bg-muted/60 px-3 py-1.5">
        <span className="font-mono text-[11px] text-muted-foreground">{title}</span>
        <button
          onClick={() => {
            void navigator.clipboard.writeText(code);
            toast.success("Copied to clipboard");
          }}
          className="text-[11px] font-medium text-primary hover:underline"
        >
          Copy
        </button>
      </div>
      <pre className="max-h-[60vh] overflow-auto py-2 font-mono text-[11.5px] leading-[1.55]">
        {lines.map((l, i) => (
          <div key={i} className="flex">
            <span className="w-10 shrink-0 pr-3 text-right text-muted-foreground/50 select-none">
              {i + 1}
            </span>
            <span
              className={cn(
                "whitespace-pre",
                l.trimStart().startsWith("//") || l.trimStart().startsWith("#")
                  ? "text-muted-foreground"
                  : "",
              )}
            >
              {l}
            </span>
          </div>
        ))}
      </pre>
    </div>
  );
}
