/*
 * Offering page helpers: the four-step flow bar (design → review → test deploy → publish) and the
 * Terraform file browser for the Infrastructure as code tab.
 */
import { ArrowRight, Download, FileCode2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { TfFile } from "@/lib/offering/terraform";
import { cn } from "@/lib/utils";

export type OfferingStep = "architecture" | "review" | "deploy" | "releases";

export function OfferingFlow({
  view,
  onGo,
  status,
}: {
  view: string;
  onGo: (s: OfferingStep) => void;
  status: Record<OfferingStep, { text: string; tone?: "warning" | "success" | "danger" | "muted" }>;
}) {
  const steps: [OfferingStep, string][] = [
    ["architecture", "Design"],
    ["review", "Review"],
    ["deploy", "Test deploy"],
    ["releases", "Publish"],
  ];
  return (
    <ol className="flex flex-wrap items-stretch gap-1">
      {steps.map(([id, label], i) => (
        <li key={id} className="flex items-center gap-1">
          {i > 0 && <ArrowRight className="size-3.5 text-muted-foreground/60" />}
          <button
            onClick={() => onGo(id)}
            className={cn(
              "flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-left transition-colors",
              view === id
                ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                : "border-border bg-card hover:border-border-strong",
            )}
          >
            <span
              className={cn(
                "grid size-5 place-items-center rounded-full text-[11px] font-semibold",
                view === id
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {i + 1}
            </span>
            <span>
              <span className="block text-[12.5px] font-medium">{label}</span>
              <span
                className={cn(
                  "block text-[10.5px]",
                  status[id].tone === "warning"
                    ? "text-warning"
                    : status[id].tone === "success"
                      ? "text-success"
                      : status[id].tone === "danger"
                        ? "text-danger"
                        : "text-muted-foreground",
                )}
              >
                {status[id].text}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}

export function TerraformFiles({ files, name }: { files: TfFile[]; name: string }) {
  const [path, setPath] = useState(files.find((f) => f.path === "main.tf")?.path ?? files[0]?.path);
  const file = files.find((f) => f.path === path) ?? files[0];
  const download = () => {
    const text = files.map((f) => `# ===== ${f.path} =====\n${f.content}`).join("\n");
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name}-terraform.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="grid min-h-[520px] grid-cols-[220px_minmax(0,1fr)] overflow-hidden rounded-md border border-border">
      <aside className="border-r border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <p className="text-[12px] font-semibold">offerings/{name}/</p>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-1.5"
            onClick={download}
            title="Download all files"
          >
            <Download className="size-3.5" />
          </Button>
        </div>
        <ul className="p-1">
          {files.map((f) => (
            <li key={f.path}>
              <button
                onClick={() => setPath(f.path)}
                className={cn(
                  "flex w-full items-center gap-1.5 rounded-sm px-2 py-1 text-left font-mono text-[11.5px]",
                  f.path === file?.path
                    ? "bg-accent font-medium text-accent-foreground"
                    : "hover:bg-muted",
                )}
              >
                <FileCode2 className="size-3.5 shrink-0 text-muted-foreground" />
                {f.path}
                <span className="ml-auto text-[10px] text-muted-foreground">
                  {f.content.split("\n").length}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <pre className="overflow-auto bg-[#0d1117] p-3 font-mono text-[11.5px] leading-[1.55] text-[#c9d1d9]">
        {file?.content.split("\n").map((l, i) => (
          <div key={i} className="flex gap-3">
            <span className="w-8 shrink-0 text-right text-[#6e7681] select-none">{i + 1}</span>
            <span
              className={cn(
                "whitespace-pre",
                /^\s*#/.test(l) && "text-[#8b949e]",
                /^(resource|data|variable|output|locals|module|provider|terraform|import)\b/.test(
                  l,
                ) && "text-[#ff7b72]",
              )}
            >
              {l || " "}
            </span>
          </div>
        ))}
      </pre>
    </div>
  );
}
