import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { ChecksBox } from "@/components/onboarding/Delivery";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type Architecture, LANDING_LABEL } from "@/lib/architecture";
import { LANDING_ZONE_LABEL } from "@/lib/alz/engine";
import { SERVICE_BY_ID, type Selected, type Topology } from "@/lib/catalog";
import { createOffering } from "@/lib/factory.functions";
import {
  ENV_KEYS,
  ENV_META,
  type EnvKey,
  regionLabel,
  reviewOffering,
  sortEnvs,
  unsupportedIn,
  regionsSupporting,
} from "@/lib/onboarding";
import { AZURE_REGIONS, UNAVAILABLE } from "@/lib/regions";
import { cn } from "@/lib/utils";

const GEOS = [...new Set(AZURE_REGIONS.map((r) => r.geo))];

/** Every Azure region, grouped by geography; regions that can't run the architecture say why. */
export function RegionPicker({
  selected,
  services,
  value,
  onChange,
}: {
  selected: Selected[];
  services?: boolean;
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const [geo, setGeo] = useState<string>(
    AZURE_REGIONS.find((r) => r.name === value[0])?.geo ?? GEOS[0] ?? "US",
  );
  return (
    <div>
      <div className="mb-1.5 flex flex-wrap gap-1">
        {value.map((r) => {
          const missing = unsupportedIn(selected, r);
          return (
            <span
              key={r}
              title={missing.length ? `Not available: ${missing.join(", ")}` : regionLabel(r)}
              className={cn(
                "inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[11px]",
                missing.length
                  ? "border-danger/40 bg-danger/5 text-danger"
                  : "border-primary/40 bg-primary/10 text-primary",
              )}
            >
              {regionLabel(r)}
              {value.length > 1 && (
                <button
                  aria-label={`Remove ${r}`}
                  onClick={() => onChange(value.filter((x) => x !== r))}
                >
                  <X className="size-3" />
                </button>
              )}
            </span>
          );
        })}
      </div>
      <div className="rounded-sm border border-border">
        <div className="flex flex-wrap gap-0.5 border-b border-border bg-muted/40 p-1">
          {GEOS.map((g) => (
            <button
              key={g}
              onClick={() => setGeo(g)}
              className={cn(
                "rounded-sm px-1.5 py-0.5 text-[10.5px]",
                g === geo
                  ? "bg-card font-medium shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {g}
            </button>
          ))}
        </div>
        <div className="grid max-h-40 grid-cols-2 gap-0.5 overflow-y-auto p-1">
          {AZURE_REGIONS.filter((r) => r.geo === geo).map((r) => {
            const on = value.includes(r.name);
            const missing = services === false ? [] : unsupportedIn(selected, r.name);
            return (
              <button
                key={r.name}
                disabled={!!missing.length && !on}
                onClick={() =>
                  onChange(
                    on
                      ? value.length > 1
                        ? value.filter((x) => x !== r.name)
                        : value
                      : [...value, r.name],
                  )
                }
                title={missing.length ? `Not available here: ${missing.join(", ")}` : r.name}
                className={cn(
                  "flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-left text-[11px]",
                  on ? "bg-primary/10 font-medium text-primary" : "hover:bg-muted",
                  missing.length &&
                    !on &&
                    "cursor-not-allowed text-muted-foreground/60 line-through",
                )}
              >
                {on ? <Check className="size-3 shrink-0" /> : <span className="size-3 shrink-0" />}
                <span className="truncate">{r.display}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[10.5px] text-muted-foreground">
        <span>
          {AZURE_REGIONS.length} Azure regions · {regionsSupporting(selected).length} run this
          architecture. Crossed out: a service isn't offered there.
        </span>
        <button
          className="text-primary hover:underline"
          onClick={() =>
            onChange([
              ...new Set([
                ...value,
                ...AZURE_REGIONS.filter(
                  (r) => r.geo === geo && !unsupportedIn(selected, r.name).length,
                ).map((r) => r.name),
              ]),
            ])
          }
        >
          Add all in {geo}
        </button>
        <button
          className="text-primary hover:underline"
          onClick={() => onChange([...new Set([...value, ...regionsSupporting(selected)])])}
        >
          Add every region
        </button>
      </div>
    </div>
  );
}

/** Architecture review tab: the checks that gate publishing, and a service × region matrix. */
export function ReviewPanel({
  arch,
  hostingAnswers,
  version,
  status,
}: {
  arch: Architecture;
  hostingAnswers: unknown;
  version: string;
  status: string;
}) {
  const checks = reviewOffering({ ...arch, hostingAnswers });
  const regional = arch.selected
    .map((s) => SERVICE_BY_ID.get(s.id))
    .filter((d): d is NonNullable<typeof d> => !!d && d.resourceType in UNAVAILABLE);
  return (
    <div className="max-w-5xl space-y-4 p-4 lg:p-6">
      <div>
        <h2 className="text-sm font-semibold">Architecture review · v{version}</h2>
        <p className="text-xs text-muted-foreground">
          {status === "draft"
            ? "Runs on every change. Publishing is blocked while a check fails — once published, a version is immutable and customers can be onboarded to it."
            : "This version passed review when it was published. Changes create a new draft version that is reviewed again."}
        </p>
      </div>
      <ChecksBox checks={checks} />
      <div className="overflow-x-auto rounded-md border border-border bg-card">
        <p className="border-b border-border px-3 py-2 text-[13px] font-semibold">
          Regions × services
        </p>
        <table className="w-full text-left text-xs">
          <thead className="bg-muted/60 text-[11px] text-muted-foreground">
            <tr>
              <th className="px-3 py-1.5 font-medium">Service</th>
              {arch.topology.regions.map((r) => (
                <th key={r} className="px-2 py-1.5 font-medium whitespace-nowrap">
                  {regionLabel(r)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {arch.selected.map((s) => {
              const d = SERVICE_BY_ID.get(s.id);
              if (!d) return null;
              return (
                <tr key={s.id}>
                  <td className="px-3 py-1.5">
                    {d.name}
                    <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">
                      {d.resourceType}
                    </span>
                  </td>
                  {arch.topology.regions.map((r) => {
                    const ok = !UNAVAILABLE[d.resourceType]?.includes(r);
                    return (
                      <td key={r} className="px-2 py-1.5">
                        {ok ? (
                          <Check className="size-3.5 text-success" />
                        ) : (
                          <X className="size-3.5 text-danger" />
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
          From Azure's resource provider region lists. {regional.length} of {arch.selected.length}{" "}
          services are missing from at least one Azure region; the rest are available everywhere.
        </p>
      </div>
    </div>
  );
}

type Template = { id: string; name: string; arch: Architecture };

export function NewOfferingDialog({
  open,
  onOpenChange,
  templates,
  hostingAnswers,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  templates: Template[];
  hostingAnswers: unknown;
  onCreated: (offeringId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState("");
  const template = templates.find((t) => t.id === templateId) ?? templates[0];
  const [landing, setLanding] = useState<Topology["landing"] | null>(null);
  const [landingZone, setLandingZone] = useState<Topology["landingZone"] | null>(null);
  const [regions, setRegions] = useState<string[] | null>(null);
  const [envs, setEnvs] = useState<EnvKey[] | null>(null);
  const t = template?.arch.topology;
  const l = landing ?? t?.landing ?? "dedicated-spoke";
  const lz = landingZone ?? t?.landingZone ?? "online";
  const rs = regions ?? t?.regions ?? ["eastus2"];
  const es =
    envs ??
    sortEnvs(
      (t?.environments ?? ["development", "production"]).filter((e): e is EnvKey =>
        (ENV_KEYS as readonly string[]).includes(e),
      ),
    );
  const create = useMutation({
    mutationFn: useServerFn(createOffering),
    onSuccess: (r: { offeringId: string }) => {
      toast.success(`${name} created as a v1.0.0 draft — architecture review is running.`);
      void queryClient.invalidateQueries({ queryKey: ["offerings"] });
      onOpenChange(false);
      onCreated(r.offeringId);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const preview = useMemo(
    () =>
      template
        ? reviewOffering({
            selected: template.arch.selected,
            topology: {
              ...template.arch.topology,
              landing: l,
              landingZone: lz,
              regions: rs,
              environments: es,
            },
            hostingAnswers,
          }).filter((c) => c.level !== "pass")
        : [],
    [template, l, lz, rs, es, hostingAnswers],
  );
  if (!template) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New offering</DialogTitle>
          <DialogDescription>
            Starts as a v1.0.0 draft from an existing architecture. It goes through architecture
            review — regions, landing zone and policy fit, guardrails — before customers can be
            onboarded to it.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">Name</Label>
              <Input
                className="mt-1"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Regulated EU"
              />
            </div>
            <div>
              <Label className="text-xs">Start from</Label>
              <Select value={template.id} onValueChange={setTemplateId}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((x) => (
                    <SelectItem key={x.id} value={x.id}>
                      {x.name} · {x.arch.selected.length} services
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label className="text-xs">Where it runs</Label>
            <div className="mt-1 grid gap-1.5 sm:grid-cols-3">
              {(Object.keys(LANDING_LABEL) as Topology["landing"][]).map((k) => (
                <button
                  key={k}
                  onClick={() => setLanding(k)}
                  className={cn(
                    "rounded-sm border p-2 text-left text-[12px]",
                    l === k
                      ? "border-primary bg-primary/5 font-medium"
                      : "border-border text-muted-foreground",
                  )}
                  title={LANDING_LABEL[k].body}
                >
                  {LANDING_LABEL[k].title}
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label className="text-xs">Landing zone (management group installs go to)</Label>
            <div className="mt-1 grid grid-cols-4 gap-1.5">
              {(["corp", "online", "local", "sandbox"] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => setLandingZone(k)}
                  className={cn(
                    "rounded-sm border px-2 py-1 text-[12px]",
                    lz === k
                      ? "border-primary bg-primary/5 font-medium"
                      : "border-border text-muted-foreground",
                  )}
                  title={LANDING_ZONE_LABEL[k]?.body}
                >
                  {LANDING_ZONE_LABEL[k]?.title}
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label className="text-xs">Regions</Label>
            <div className="mt-1">
              <RegionPicker selected={template.arch.selected} value={rs} onChange={setRegions} />
            </div>
          </div>
          <div>
            <Label className="text-xs">Environments each customer can have</Label>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {ENV_KEYS.map((e) => {
                const on = es.includes(e);
                return (
                  <button
                    key={e}
                    onClick={() => setEnvs(on ? es.filter((x) => x !== e) : sortEnvs([...es, e]))}
                    className={cn(
                      "rounded-sm border px-2 py-1 text-[12px]",
                      on
                        ? "border-primary bg-primary/5 font-medium text-primary"
                        : "border-border text-muted-foreground",
                    )}
                  >
                    {ENV_META[e].label}
                  </button>
                );
              })}
            </div>
          </div>
          {preview.length > 0 && <ChecksBox checks={preview} title="Review will flag" />}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              disabled={name.trim().length < 3 || !es.length || create.isPending}
              onClick={() =>
                create.mutate({
                  data: {
                    name: name.trim(),
                    templateOfferingId: template.id,
                    landing: l,
                    landingZone: lz,
                    regions: rs,
                    environments: es,
                  },
                })
              }
            >
              {create.isPending ? "Creating…" : "Create draft & review"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
