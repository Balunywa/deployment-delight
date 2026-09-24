import { Lock } from "lucide-react";

import { CodeBlock } from "@/components/CodeBlock";
import { PipelineGraph, type RunState, TriggerTable } from "@/components/onboarding/Delivery";
import {
  DEFAULT_DELIVERY,
  type Delivery,
  ENV_META,
  type EnvKey,
  type EnvPlan,
  TARGET_META,
  TOOL_META,
  type TargetMode,
  namesFor,
  regionLabel,
  ringsFor,
  sortEnvs,
  triggersFor,
} from "@/lib/onboarding";

type EnvLike = {
  id: string;
  environment_type: string;
  region: string;
  configuration_json: Record<string, unknown> | null;
  actual?: unknown;
};

/** How a customer's environments are delivered: targets, placement, pipeline environments, triggers. */
export function CustomerDelivery({
  code,
  envs,
  subscriptionId,
  hosted,
}: {
  code: string;
  envs: EnvLike[];
  subscriptionId: string | null;
  hosted: boolean;
}) {
  const rows = sortEnvs(envs.map((e) => e.environment_type)).map((t) => {
    const e = envs.find((x) => x.environment_type === t)!;
    const target = (e.configuration_json?.["target"] ?? {}) as Partial<
      EnvPlan & { managementGroup: string | null }
    >;
    const plan: EnvPlan = {
      env: t as EnvKey,
      region: e.region,
      target:
        (target.target as TargetMode) ?? (hosted ? "new_subscription" : "existing_subscription"),
      subscriptionId: target.subscriptionId || subscriptionId || "",
      resourceGroup: target.resourceGroup ?? "",
    };
    const delivery = {
      ...DEFAULT_DELIVERY,
      ...((e.configuration_json?.["delivery"] ?? {}) as Partial<Delivery>),
    };
    return {
      e,
      plan,
      delivery,
      names: namesFor(code, plan, delivery),
      mg: target.managementGroup ?? null,
    };
  });
  const delivery = rows[0]?.delivery ?? DEFAULT_DELIVERY;
  const plans = rows.map((r) => r.plan);
  const gh = delivery.tool === "github-actions";
  const live = rows.filter((r) => !!r.e.actual);
  const states: Record<string, RunState> = live.length
    ? {
        pr: "success",
        validate: "success",
        plan: "success",
        ...Object.fromEntries(live.map((r) => [`deploy-${r.plan.env}`, "success" as RunState])),
        ...(live.length === rows.length ? { verify: "success" as RunState } : {}),
      }
    : {};
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
          <p className="text-[13px] font-semibold">
            {TOOL_META[delivery.tool].title} ·{" "}
            <span className="font-mono text-xs">{delivery.repo}</span>
          </p>
          <p className="font-mono text-[11px] text-muted-foreground">installs/{code}.yaml</p>
        </div>
        <table className="w-full text-left text-xs">
          <thead className="bg-muted/60 text-[11px] text-muted-foreground">
            <tr>
              <th className="px-4 py-1.5 font-medium">Environment</th>
              <th className="px-3 py-1.5 font-medium">Region</th>
              <th className="px-3 py-1.5 font-medium">Target</th>
              <th className="px-3 py-1.5 font-medium">Management group</th>
              <th className="px-3 py-1.5 font-medium">
                {gh ? "GitHub environment" : "Pipeline environment"}
              </th>
              <th className="px-3 py-1.5 font-medium">Protection</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map(({ e, plan, names, mg }) => (
              <tr key={e.id}>
                <td className="px-4 py-2 font-medium">{ENV_META[plan.env]?.label ?? plan.env}</td>
                <td className="px-3 py-2">{regionLabel(plan.region)}</td>
                <td className="px-3 py-2">
                  {TARGET_META[plan.target].title}
                  <span className="block font-mono text-[10.5px] text-muted-foreground">
                    {plan.target === "new_subscription"
                      ? names.subscription
                      : `${plan.subscriptionId ? `${plan.subscriptionId.slice(0, 8)}…` : "from install link"} / ${names.resourceGroup}`}
                  </span>
                </td>
                <td className="px-3 py-2 font-mono text-[11px]">{mg ?? "—"}</td>
                <td className="px-3 py-2 font-mono text-[11px]">
                  {names.environment}
                  <span
                    className="block text-[10px] text-muted-foreground"
                    title={names.oidcSubject}
                  >
                    OIDC ·{" "}
                    {names.oidcSubject.length > 44
                      ? `${names.oidcSubject.slice(0, 44)}…`
                      : names.oidcSubject}
                  </span>
                </td>
                <td className="px-3 py-2">
                  {ENV_META[plan.env]?.prod ? (
                    <span className="flex items-center gap-1">
                      <Lock className="size-3 text-warning" />
                      {delivery.prodApprovers || "No reviewers"}
                    </span>
                  ) : delivery.autoDeployNonProd ? (
                    "Auto on merge"
                  ) : (
                    "Plan approval"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <PipelineGraph
        code={code}
        rings={ringsFor(plans, delivery)}
        delivery={delivery}
        states={states}
      />
      <TriggerTable triggers={triggersFor(delivery, code)} />
      {rows.length > 0 && (
        <CodeBlock
          title={`installs/${code}.yaml`}
          code={[
            `customer: ${code}`,
            `environments:`,
            ...rows.flatMap(({ plan, names, mg }) => [
              `  ${ENV_META[plan.env]?.short ?? plan.env}:`,
              `    region: ${plan.region}`,
              `    target: ${plan.target}`,
              plan.target === "new_subscription"
                ? `    subscription: { vend: ${names.subscription}${mg ? `, managementGroup: ${mg}` : ""} }`
                : `    subscription: ${plan.subscriptionId || "<from install link>"}`,
              `    resourceGroup: ${names.resourceGroup}`,
              `    ${gh ? "githubEnvironment" : "adoEnvironment"}: ${names.environment}`,
            ]),
          ].join("\n")}
        />
      )}
    </div>
  );
}
