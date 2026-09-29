/*
 * "Submit a solution": point at a repository, see what the platform found, describe it, name its owners and
 * attest distribution rights. The result is a Community draft that goes through the same architecture
 * review as every other offering before anyone can deploy it.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Github,
  Loader2,
  Plus,
  Trash2,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ServiceIcon } from "@/components/architecture/ServiceIcon";
import { OwnerAvatar } from "@/components/catalog/Badges";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { Textarea } from "@/components/ui/textarea";
import {
  type CatalogInspection,
  importCatalogSource,
  inspectCatalogSource,
} from "@/lib/catalog-import.functions";
import {
  type CurrentUser,
  IAC_LABEL,
  OWNER_ROLES,
  type Owner,
  PLUMBING,
  isSameOwner,
  overlap,
} from "@/lib/solutions";
import { cn } from "@/lib/utils";

const STEPS = ["Source", "Checks", "Details", "Owners & rights"] as const;
const PERMISSIVE = /^(MIT|Apache-2\.0|BSD-[23]-Clause|ISC|MPL-2\.0)$/i;
type Model = "saas_connected" | "customer_hosted" | "enterprise_private";

export type ExistingSolution = { id: string; name: string; services: string[] };

export function SubmitSolutionDialog({
  open,
  onOpenChange,
  user,
  industries,
  existing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: CurrentUser | undefined;
  industries: string[];
  existing: ExistingSolution[];
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const inspectFn = useServerFn(inspectCatalogSource);
  const submitFn = useServerFn(importCatalogSource);

  const [step, setStep] = useState(0);
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [inspection, setInspection] = useState<CatalogInspection | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [audience, setAudience] = useState("");
  const [outcome, setOutcome] = useState("");
  const [industry, setIndustry] = useState("");
  const [customIndustry, setCustomIndustry] = useState("");
  const [tags, setTags] = useState("");
  const [supportUrl, setSupportUrl] = useState("");
  const [model, setModel] = useState<Model>("customer_hosted");
  const [coOwners, setCoOwners] = useState<Owner[]>([]);
  const [attested, setAttested] = useState(false);

  const reset = () => {
    setStep(0);
    setInspection(null);
    setName("");
    setDescription("");
    setAudience("");
    setOutcome("");
    setTags("");
    setSupportUrl("");
    setCoOwners([]);
    setAttested(false);
  };

  const inspect = useMutation({
    mutationFn: () => inspectFn({ data: { repositoryUrl } }),
    onSuccess: (r) => {
      setInspection(r);
      setName((n) => n || r.repository.name);
      setDescription((d) => d || r.repository.description);
      setStep(1);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const category = industry === "__other" ? customIndustry.trim() : industry;
  const tagList = tags
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const owners = user
    ? [user, ...coOwners.filter((o) => o.name.trim() && !isSameOwner(o, user))]
    : coOwners;

  const submit = useMutation({
    mutationFn: () =>
      submitFn({
        data: {
          repositoryUrl,
          name,
          description,
          category,
          audience,
          outcome,
          tags: tagList,
          supportUrl,
          deliveryModel: model,
          owners: coOwners.filter((o) => o.name.trim()),
          licenseAttested: attested,
        },
      }),
    onSuccess: (r) => {
      const blockers = r.checks.filter((c) => c.level === "blocking").length;
      toast.success(
        blockers
          ? `${name} submitted as Community. ${blockers} check${blockers === 1 ? "" : "s"} to resolve before it can be published.`
          : `${name} submitted as Community and is ready for architecture review.`,
      );
      void queryClient.invalidateQueries({ queryKey: ["products"] });
      void queryClient.invalidateQueries({ queryKey: ["offerings"] });
      onOpenChange(false);
      reset();
      void navigate({ to: "/products/$productId", params: { productId: r.productId } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const services = (inspection?.architecture.services ?? []).map((s) => s.id);
  const similar = inspection
    ? existing
        .map((s) => ({
          ...s,
          score: overlap(
            services.filter((x) => !PLUMBING.has(x)),
            s.services.filter((x) => !PLUMBING.has(x)),
          ),
        }))
        .filter((s) => s.score >= 0.4)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
    : [];
  const license = inspection?.repository.license ?? null;
  const permissive = !!license && PERMISSIVE.test(license);
  const remaining = (inspection?.checks ?? []).filter(
    (c) => c.level === "blocking" && !(c.id === "license" && (attested || permissive)),
  );
  const coOwnersValid = coOwners.every(
    (o) =>
      !o.name.trim() ||
      (o.name.trim().length >= 2 && (!o.email || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(o.email))),
  );
  const canNext = [
    !!inspection,
    !!inspection,
    name.trim().length >= 3 &&
      description.trim().length >= 20 &&
      category.length >= 2 &&
      (!supportUrl || /^https?:\/\//.test(supportUrl)),
    coOwnersValid && !!user,
  ];

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v && !submit.isPending) reset();
      }}
    >
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Submit a solution</DialogTitle>
          <DialogDescription>
            Share something you built so others can find and deploy it. It's listed as Community
            under your name, and becomes Validated once an offering passes architecture review.
          </DialogDescription>
        </DialogHeader>

        <ol className="flex items-center gap-2 text-[11px]">
          {STEPS.map((label, i) => (
            <li key={label} className="flex items-center gap-2">
              <button
                type="button"
                disabled={i > step && !canNext.slice(0, i).every(Boolean)}
                onClick={() => i <= step && setStep(i)}
                className={cn(
                  "flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium",
                  i === step
                    ? "border-primary bg-primary text-primary-foreground"
                    : i < step
                      ? "border-success/40 text-success"
                      : "border-border text-muted-foreground",
                )}
              >
                {i < step ? <Check className="size-3" /> : <span>{i + 1}</span>}
                {label}
              </button>
              {i < STEPS.length - 1 && <span className="h-px w-4 bg-border" />}
            </li>
          ))}
        </ol>

        {step === 0 && (
          <div className="space-y-2">
            <Label htmlFor="submit-repo">GitHub repository</Label>
            <div className="flex gap-2">
              <Input
                id="submit-repo"
                value={repositoryUrl}
                onChange={(e) => {
                  setRepositoryUrl(e.target.value);
                  setInspection(null);
                }}
                onKeyDown={(e) => e.key === "Enter" && repositoryUrl && inspect.mutate()}
                placeholder="https://github.com/owner/repository/tree/main/path"
              />
              <Button
                type="button"
                disabled={inspect.isPending || !repositoryUrl}
                onClick={() => inspect.mutate()}
              >
                {inspect.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Github className="size-4" />
                )}
                {inspect.isPending ? "Inspecting…" : "Inspect"}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Terraform, Bicep, ARM templates and containers are recognised. The source is pinned to
              the current commit, and the Azure resources it deploys are mapped to the platform's
              service catalog. Point at a subfolder with <span className="font-mono">/tree/…</span>.
            </p>
          </div>
        )}

        {step === 1 && inspection && (
          <div className="space-y-4">
            <div className="grid gap-3 rounded-md border bg-muted/30 p-3 sm:grid-cols-3">
              <Stat
                label="Pinned source"
                value={inspection.repository.revision.slice(0, 12)}
                detail={`${inspection.repository.owner}/${inspection.repository.name} · ${inspection.counts.files} files`}
              />
              <Stat
                label="Deploys with"
                value={
                  IAC_LABEL[inspection.implementation.driver] ?? inspection.implementation.driver
                }
                detail={inspection.implementation.entrypoints[0] ?? "No entrypoint found"}
              />
              <Stat
                label="Architecture"
                value={`${inspection.architecture.services.length} services mapped`}
                detail={`${inspection.architecture.unmappedResourceTypes.length} resource types not in the catalog`}
              />
            </div>
            {services.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {inspection.architecture.services.map((s) => (
                  <span
                    key={s.id}
                    title={s.evidence.join(", ")}
                    className="inline-flex items-center gap-1 rounded-md border bg-card py-1 pr-2 pl-1 text-xs"
                  >
                    <ServiceIcon id={s.id} size="sm" />
                    {s.name}
                  </span>
                ))}
              </div>
            )}
            <div className="divide-y rounded-md border">
              {inspection.checks.map((c) => {
                const Icon =
                  c.level === "pass"
                    ? CheckCircle2
                    : c.level === "blocking"
                      ? XCircle
                      : AlertTriangle;
                return (
                  <div key={c.id} className="flex gap-2.5 p-2.5">
                    <Icon
                      className={cn(
                        "mt-0.5 size-4 shrink-0",
                        c.level === "pass"
                          ? "text-success"
                          : c.level === "blocking"
                            ? "text-danger"
                            : "text-warning",
                      )}
                    />
                    <div>
                      <p className="text-xs font-medium">{c.title}</p>
                      <p className="text-[11px] text-muted-foreground">{c.detail}</p>
                    </div>
                  </div>
                );
              })}
            </div>
            {similar.length > 0 && (
              <div className="rounded-md border border-info/30 bg-info/5 p-3">
                <p className="text-xs font-semibold">Similar solutions already in the catalog</p>
                <p className="text-[11px] text-muted-foreground">
                  Consider contributing to one of these instead of adding a near-duplicate.
                </p>
                <ul className="mt-2 space-y-1">
                  {similar.map((s) => (
                    <li key={s.id} className="flex items-center justify-between text-xs">
                      <a
                        href={`/products/${s.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium underline"
                      >
                        {s.name}
                      </a>
                      <span className="text-muted-foreground">
                        {Math.round(s.score * 100)}% of services in common
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">
              Blocking checks don't stop you submitting. They keep the solution at Community, and
              stop it from being published or deployed, until they are resolved.
            </p>
          </div>
        )}

        {step === 2 && (
          <div className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Solution name" id="s-name">
                <Input id="s-name" value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label="Industry">
                <Select value={industry} onValueChange={setIndustry}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Pick an industry" />
                  </SelectTrigger>
                  <SelectContent>
                    {industries.map((i) => (
                      <SelectItem key={i} value={i}>
                        {i}
                      </SelectItem>
                    ))}
                    <SelectItem value="__other">Other…</SelectItem>
                  </SelectContent>
                </Select>
                {industry === "__other" && (
                  <Input
                    className="mt-1.5"
                    placeholder="e.g. Healthcare"
                    value={customIndustry}
                    onChange={(e) => setCustomIndustry(e.target.value)}
                  />
                )}
              </Field>
            </div>
            <Field
              label="What it does"
              id="s-desc"
              hint="One or two sentences. Shown on the catalog card (at least 20 characters)."
            >
              <Textarea
                id="s-desc"
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Who it's for" id="s-aud">
                <Input
                  id="s-aud"
                  placeholder="e.g. Utility grid operators"
                  value={audience}
                  onChange={(e) => setAudience(e.target.value)}
                />
              </Field>
              <Field label="Outcome" id="s-out">
                <Input
                  id="s-out"
                  placeholder="e.g. Earlier warning of weather-driven outages"
                  value={outcome}
                  onChange={(e) => setOutcome(e.target.value)}
                />
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Tags" id="s-tags" hint="Comma separated, e.g. fabric, geospatial, ai">
                <Input id="s-tags" value={tags} onChange={(e) => setTags(e.target.value)} />
              </Field>
              <Field label="Support link" id="s-support" hint="Teams channel, issues page or docs">
                <Input
                  id="s-support"
                  placeholder="https://…"
                  value={supportUrl}
                  onChange={(e) => setSupportUrl(e.target.value)}
                />
              </Field>
            </div>
            <Field label="Where it runs first" hint="You can add more delivery models later.">
              <Select value={model} onValueChange={(v) => setModel(v as Model)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="customer_hosted">
                    Customer's Azure · its own network
                  </SelectItem>
                  <SelectItem value="enterprise_private">
                    Customer landing zone · plugs into their hub
                  </SelectItem>
                  <SelectItem value="saas_connected">Hosted · runs in our Azure</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div>
              <p className="text-xs font-semibold">Solution owners</p>
              <p className="text-[11px] text-muted-foreground">
                Owners are shown on the catalog, answer questions and confirm the solution every 90
                days. Add a backup so it doesn't go stale when someone changes roles.
              </p>
              <div className="mt-2 space-y-2">
                {user && (
                  <div className="flex items-center gap-2 rounded-md border bg-muted/30 p-2">
                    <OwnerAvatar owner={user} size={28} />
                    <div className="min-w-0 text-xs">
                      <p className="font-medium">
                        {user.name} <span className="text-muted-foreground">(you)</span>
                      </p>
                      <p className="truncate text-muted-foreground">
                        {[user.role, user.team, user.email].filter(Boolean).join(" · ") ||
                          "Set CATALOG_USER_EMAIL so people can contact you"}
                      </p>
                    </div>
                  </div>
                )}
                {coOwners.map((o, i) => (
                  <div key={i} className="grid grid-cols-[1fr_1fr_110px_auto] gap-2">
                    <Input
                      placeholder="Name"
                      value={o.name}
                      onChange={(e) =>
                        setCoOwners(
                          coOwners.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
                        )
                      }
                    />
                    <Input
                      placeholder="Email"
                      value={o.email}
                      onChange={(e) =>
                        setCoOwners(
                          coOwners.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)),
                        )
                      }
                    />
                    <Select
                      value={o.role}
                      onValueChange={(role) =>
                        setCoOwners(coOwners.map((x, j) => (j === i ? { ...x, role } : x)))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {OWNER_ROLES.map((r) => (
                          <SelectItem key={r} value={r}>
                            {r}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Remove owner"
                      onClick={() => setCoOwners(coOwners.filter((_, j) => j !== i))}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setCoOwners([...coOwners, { name: "", email: "", role: "CSA", team: "" }])
                  }
                >
                  <Plus className="size-3.5" /> Add co-owner
                </Button>
                {owners.length < 2 && (
                  <p className="flex items-center gap-1.5 text-[11px] text-warning">
                    <AlertTriangle className="size-3.5" /> Single owner: recommended to add a
                    backup.
                  </p>
                )}
              </div>
            </div>

            <label className="flex cursor-pointer gap-2.5 rounded-md border p-3">
              <Checkbox
                checked={attested}
                onCheckedChange={(v) => setAttested(v === true)}
                className="mt-0.5"
              />
              <span className="text-xs">
                <span className="font-medium">I have the right to distribute this source</span>
                <span className="mt-0.5 block text-muted-foreground">
                  I or my team own it, or its license allows redistribution, and it contains no
                  customer data or secrets.{" "}
                  {license
                    ? `License detected: ${license}${permissive ? " (permits redistribution)" : ""}.`
                    : "No license was found in the repository."}{" "}
                  This is recorded with your name.
                </span>
              </span>
            </label>

            <div
              className={cn(
                "rounded-md border p-3 text-xs",
                remaining.length
                  ? "border-warning/40 bg-warning/5"
                  : "border-success/40 bg-success/5",
              )}
            >
              <p className="font-semibold">
                Submitted as Community ·{" "}
                {remaining.length
                  ? `${remaining.length} check${remaining.length === 1 ? "" : "s"} to resolve before publishing`
                  : "ready for architecture review"}
              </p>
              {remaining.length > 0 && (
                <ul className="mt-1 list-disc pl-4 text-muted-foreground">
                  {remaining.map((c) => (
                    <li key={c.id}>{c.title}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          {step > 0 && (
            <Button type="button" variant="outline" onClick={() => setStep(step - 1)}>
              Back
            </Button>
          )}
          {step > 0 && step < STEPS.length - 1 && (
            <Button type="button" disabled={!canNext[step]} onClick={() => setStep(step + 1)}>
              Next
            </Button>
          )}
          {step === STEPS.length - 1 && (
            <Button
              type="button"
              disabled={!canNext[step] || submit.isPending}
              onClick={() => submit.mutate()}
            >
              {submit.isPending && <Loader2 className="size-4 animate-spin" />}
              Submit solution
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      <p className="truncate text-sm font-semibold">{value}</p>
      <p className="truncate text-[11px] text-muted-foreground" title={detail}>
        {detail}
      </p>
    </div>
  );
}

function Field({
  label,
  id,
  hint,
  children,
}: {
  label: string;
  id?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <div className="mt-1">{children}</div>
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
