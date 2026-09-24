import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState, PageHeader, Panel, Pill } from "@/components/Primitives";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  createOfferingVersion,
  draftBlueprintFromDescription,
  publishOfferingVersion,
  validateBlueprint,
} from "@/lib/factory.functions";
import { currency, shortDate, titleize } from "@/lib/format";
import { modulesQuery, offeringsQuery } from "@/lib/queries";

export const Route = createFileRoute("/offerings")({
  head: () => ({
    meta: [
      { title: "Offerings catalog · Azure ISV Deployment Factory" },
      {
        name: "description",
        content:
          "Versioned deployment offerings — SaaS Connected, Customer Hosted, Enterprise Private, Regulated and Sandbox — with immutable published blueprint versions.",
      },
      { property: "og:title", content: "Offerings catalog · Azure ISV Deployment Factory" },
      { property: "og:description", content: "Versioned, immutable Azure deployment offerings for ISV customers." },
    ],
  }),
  component: Offerings,
});

type OfferingVersion = {
  id: string;
  version: string;
  status: string;
  release_notes: string | null;
  published_at: string | null;
  manifest_json: Record<string, unknown>;
  ai_generated: boolean;
};

function Offerings() {
  const offerings = useQuery(offeringsQuery);
  const modules = useQuery(modulesQuery);
  const queryClient = useQueryClient();
  const [intakeFor, setIntakeFor] = useState<{ id: string; name: string } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const publish = useMutation({
    mutationFn: useServerFn(publishOfferingVersion),
    onSuccess: (v) => {
      toast.success(`Published version ${v.version}. It is now immutable.`);
      queryClient.invalidateQueries({ queryKey: ["offerings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const list = offerings.data ?? [];
  const active = list.find((o) => o.id === selected) ?? null;

  return (
    <>
      <PageHeader
        title="Offerings catalog"
        description="Every offering is a deployable product line with a versioned blueprint: modules, network model, security profile, policy pack and supported regions. Published versions are immutable."
        meta={<Pill tone="neutral">{modules.data?.length ?? 0} infrastructure modules registered</Pill>}
      />

      {offerings.isLoading && <EmptyState title="Loading catalog…" />}

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {list.map((offering) => {
          const versions = ((offering.offering_versions ?? []) as OfferingVersion[]).sort((a, b) =>
            b.version.localeCompare(a.version),
          );
          const current = versions.find((v) => v.status === "published");
          const manifestModules = ((current?.manifest_json?.["modules"] as { name: string; version: string }[]) ?? []);
          const envCount = ((offering.environments ?? []) as { id: string }[]).length;

          return (
            <Panel
              key={offering.id}
              title={offering.name}
              description={offering.description ?? undefined}
              actions={<Pill tone="primary">v{current?.version ?? "unpublished"}</Pill>}
            >
              <dl className="space-y-1.5 text-xs">
                <Field label="Offering type" value={titleize(offering.offering_type)} />
                <Field label="Boundary" value={offering.deployment_boundary} />
                <Field label="Network pattern" value={titleize(offering.network_profile)} />
                <Field label="Security level" value={titleize(offering.security_profile)} />
                <Field label="Regions" value={(offering.supported_regions ?? []).join(", ") || "—"} />
                <Field
                  label="Estimated monthly"
                  value={`${currency(offering.estimated_monthly_cost_low)} – ${currency(offering.estimated_monthly_cost_high)}`}
                />
                <Field label="Customer environments" value={String(envCount)} />
              </dl>

              {manifestModules.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1">
                  {manifestModules.map((m) => (
                    <span key={m.name} className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                      {m.name}@{m.version}
                    </span>
                  ))}
                </div>
              )}

              <div className="mt-4 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => setSelected(offering.id)}>
                  Versions ({versions.length})
                </Button>
                <Button size="sm" variant="outline" onClick={() => setIntakeFor({ id: offering.id, name: offering.name })}>
                  <Sparkles className="size-3.5" /> Architecture intake
                </Button>
              </div>
            </Panel>
          );
        })}
      </div>

      <Dialog open={!!active} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{active?.name} — versions</DialogTitle>
            <DialogDescription>
              Published versions can never be overwritten. Changes require a new version.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {((active?.offering_versions ?? []) as OfferingVersion[])
              .sort((a, b) => b.version.localeCompare(a.version))
              .map((v) => (
                <div key={v.id} className="rounded-md border border-border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold">v{v.version}</p>
                      <p className="text-xs text-muted-foreground">
                        {v.published_at ? `Published ${shortDate(v.published_at)}` : "Not published"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {v.ai_generated && <Pill tone="warning">AI draft</Pill>}
                      <Pill tone={v.status === "published" ? "success" : v.status === "draft" ? "warning" : "neutral"}>
                        {v.status}
                      </Pill>
                      {v.status !== "published" && v.status !== "retired" && (
                        <Button size="sm" disabled={publish.isPending} onClick={() => publish.mutate({ data: { versionId: v.id } })}>
                          Publish
                        </Button>
                      )}
                    </div>
                  </div>
                  {v.release_notes && <p className="mt-2 text-xs text-muted-foreground">{v.release_notes}</p>}
                  <pre className="mt-2 max-h-48 overflow-auto rounded-sm bg-muted p-2 font-mono text-[11px] text-muted-foreground">
                    {JSON.stringify(v.manifest_json, null, 2)}
                  </pre>
                </div>
              ))}
          </div>
        </DialogContent>
      </Dialog>

      <IntakeDialog offering={intakeFor} onClose={() => setIntakeFor(null)} />
    </>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium text-foreground">{value}</dd>
    </div>
  );
}

function IntakeDialog({
  offering,
  onClose,
}: {
  offering: { id: string; name: string } | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [description, setDescription] = useState(
    "Our application runs on AKS and PostgreSQL. Customers need dedicated subscriptions. All services must be private. AKS connects to PostgreSQL using managed identity. We need Event Hubs Premium for telemetry. Logs should go to the customer's existing Log Analytics workspace. We support East US 2 and Central US. Production needs zone redundancy. Customers should be able to use their existing hub network.",
  );
  const [draft, setDraft] = useState<{
    manifest: Record<string, unknown>;
    validation: { schema: string; issues: string[] };
    policyIssues: { level: string; message: string }[];
  } | null>(null);

  const generate = useMutation({
    mutationFn: useServerFn(draftBlueprintFromDescription),
    onSuccess: (result) => {
      setDraft(result);
      toast.info("Draft blueprint generated. It must pass validation and human review before publishing.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const revalidate = useMutation({
    mutationFn: useServerFn(validateBlueprint),
    onSuccess: (result) => {
      setDraft((d) => (d ? { ...d, validation: result, policyIssues: result.policyIssues } : d));
      toast.success(result.schema === "PASS" ? "Schema validation passed." : "Schema validation found issues.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const save = useMutation({
    mutationFn: useServerFn(createOfferingVersion),
    onSuccess: (v) => {
      toast.success(`Draft version ${v.version} saved. Review and publish it from the version list.`);
      queryClient.invalidateQueries({ queryKey: ["offerings"] });
      setDraft(null);
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const blockers = (draft?.policyIssues ?? []).filter((i) => i.level === "BLOCKING");

  return (
    <Dialog open={!!offering} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Architecture intake — {offering?.name}</DialogTitle>
          <DialogDescription>
            Describe your Azure architecture. The assistant drafts a blueprint manifest; deterministic schema and
            architecture-policy validation run next, then a human publishes. The assistant never touches Azure.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label htmlFor="intake" className="text-xs">
              Describe your Azure architecture
            </Label>
            <Textarea
              id="intake"
              rows={7}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-1 font-mono text-xs"
            />
          </div>
          <Button
            disabled={generate.isPending || description.trim().length < 30 || !offering}
            onClick={() => offering && generate.mutate({ data: { description, offeringId: offering.id } })}
          >
            <Sparkles className="size-4" />
            {generate.isPending ? "Drafting…" : "Generate draft blueprint"}
          </Button>

          {draft && (
            <div className="space-y-3 rounded-md border border-warning/40 bg-warning/5 p-3">
              <div className="flex items-center gap-2">
                <Pill tone="warning">AI-generated draft — requires validation</Pill>
                <Pill tone={draft.validation.schema === "PASS" ? "success" : "danger"}>
                  Schema {draft.validation.schema}
                </Pill>
                <Pill tone={blockers.length ? "danger" : "success"}>
                  Architecture policy {blockers.length ? `${blockers.length} blocking` : "PASS"}
                </Pill>
              </div>

              {draft.validation.issues.length > 0 && (
                <ul className="list-disc space-y-1 pl-5 text-xs text-danger">
                  {draft.validation.issues.map((i) => (
                    <li key={i}>{i}</li>
                  ))}
                </ul>
              )}
              {draft.policyIssues.length > 0 && (
                <ul className="list-disc space-y-1 pl-5 text-xs">
                  {draft.policyIssues.map((i) => (
                    <li key={i.message} className={i.level === "BLOCKING" ? "text-danger" : "text-warning"}>
                      {i.level}: {i.message}
                    </li>
                  ))}
                </ul>
              )}

              <Textarea
                rows={14}
                value={JSON.stringify(draft.manifest, null, 2)}
                onChange={(e) => {
                  try {
                    setDraft({ ...draft, manifest: JSON.parse(e.target.value) });
                  } catch {
                    /* keep typing; validation runs on demand */
                  }
                }}
                className="font-mono text-[11px]"
              />

              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={revalidate.isPending}
                  onClick={() => revalidate.mutate({ data: { manifest: draft.manifest } })}
                >
                  Re-run validation
                </Button>
                <Button
                  size="sm"
                  disabled={save.isPending || draft.validation.schema !== "PASS" || blockers.length > 0 || !offering}
                  onClick={() =>
                    offering &&
                    save.mutate({
                      data: {
                        offeringId: offering.id,
                        manifest: draft.manifest,
                        releaseNotes: "Drafted from natural-language architecture intake.",
                        aiGenerated: true,
                      },
                    })
                  }
                >
                  Save as draft version
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
