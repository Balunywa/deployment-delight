import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { PageHeader, Panel, Pill } from "@/components/Primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateBranding } from "@/lib/factory.functions";
import { modulesQuery, organizationQuery } from "@/lib/queries";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings · Cloud Delivery" },
      {
        name: "description",
        content:
          "White-label the portal, review registered infrastructure modules, role model and the active execution mode.",
      },
      { property: "og:title", content: "Settings · Cloud Delivery" },
      {
        property: "og:description",
        content: "Branding, module registry, roles and execution mode.",
      },
    ],
  }),
  component: Settings,
});

const ROLES = [
  [
    "Platform Super Admin",
    "Full control of the control plane, including organizations and branding.",
  ],
  ["ISV Admin", "Manages products, offerings, customers and rollouts for one organization."],
  ["ISV Platform Engineer", "Publishes blueprint versions, plans and runs deployments."],
  ["Onboarding Engineer", "Onboards customers and validates Azure connections."],
  ["Security Approver", "Approves production plans and policy pack changes."],
  ["Network Approver", "Approves network integration into customer hubs."],
  ["Customer Administrator", "Read access to their own tenant's environments and evidence."],
  ["Read Only Auditor", "Read access to evidence and the immutable audit trail."],
];

function Settings() {
  const organization = useQuery(organizationQuery);
  const modules = useQuery(modulesQuery);
  const queryClient = useQueryClient();

  const [form, setForm] = useState({ name: "", portalTitle: "", supportUrl: "", primaryColor: "" });

  useEffect(() => {
    if (organization.data) {
      setForm({
        name: organization.data.name ?? "",
        portalTitle: organization.data.portal_title ?? "",
        supportUrl: organization.data.support_url ?? "",
        primaryColor: organization.data.primary_color ?? "",
      });
    }
  }, [organization.data]);

  const save = useMutation({
    mutationFn: useServerFn(updateBranding),
    onSuccess: () => {
      toast.success("Branding updated.");
      queryClient.invalidateQueries({ queryKey: ["organization"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <PageHeader
        title="Settings"
        description="Branding, module registry, roles and execution mode for this organization."
        meta={<Pill tone="warning">Execution mode: demo — no Azure calls are made</Pill>}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="White labelling" description="Shown to your customers in the portal.">
          <div className="space-y-3">
            <div>
              <Label htmlFor="name">Company name</Label>
              <Input
                id="name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="portalTitle">Portal title</Label>
              <Input
                id="portalTitle"
                value={form.portalTitle}
                onChange={(e) => setForm({ ...form, portalTitle: e.target.value })}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="supportUrl">Support link</Label>
              <Input
                id="supportUrl"
                placeholder="https://support.example.com"
                value={form.supportUrl}
                onChange={(e) => setForm({ ...form, supportUrl: e.target.value })}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="primaryColor">Accent colour</Label>
              <Input
                id="primaryColor"
                value={form.primaryColor}
                onChange={(e) => setForm({ ...form, primaryColor: e.target.value })}
                className="mt-1"
              />
            </div>
            <Button disabled={save.isPending} onClick={() => save.mutate({ data: form })}>
              {save.isPending ? "Saving…" : "Save branding"}
            </Button>
            <p className="text-xs text-muted-foreground">
              Business-facing screens use your terminology — offering names and environment labels —
              not tool names.
            </p>
          </div>
        </Panel>

        <Panel title="Execution mode" description="The active mode is always shown in the header.">
          <div className="space-y-3 text-sm">
            <div className="rounded-md border border-warning/40 bg-warning/5 p-3">
              <p className="font-semibold text-warning">Demo mode is active</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Deployments follow the real state machine and produce realistic logs, but no Azure
                API call is made and no resource is created. Simulated runs are labelled{" "}
                <span className="font-mono">mode: demo</span> everywhere.
              </p>
            </div>
            <div className="rounded-md border border-border p-3">
              <p className="font-semibold">Real Azure mode</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Unavailable in this environment. It requires the Azure executor (Container Apps Job
                running Bicep and Terraform), a federated identity per customer and a central
                pipeline connection. The control plane already talks only to provider interfaces, so
                enabling it does not change any screen or domain rule.
              </p>
            </div>
          </div>
        </Panel>

        <Panel
          title="Role model"
          description="Authorization is enforced server-side per action."
          bodyClassName="p-0"
        >
          <ul className="divide-y divide-border">
            {ROLES.map(([role, description]) => (
              <li key={role} className="px-4 py-2.5">
                <p className="text-[13px] font-medium">{role}</p>
                <p className="text-xs text-muted-foreground">{description}</p>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel
          title="Module registry"
          description="Versioned input/output contracts. One implementation, all customers."
          bodyClassName="p-0"
        >
          <table className="data-table">
            <thead>
              <tr>
                <th>Module</th>
                <th>Version</th>
                <th>Provider</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {(modules.data ?? []).map((m) => (
                <tr key={m.id}>
                  <td className="font-mono text-[12px]">{m.name}</td>
                  <td className="mono-num">{m.version}</td>
                  <td className="text-muted-foreground">{m.provider}</td>
                  <td className="truncate text-muted-foreground">{m.source ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>
    </>
  );
}
