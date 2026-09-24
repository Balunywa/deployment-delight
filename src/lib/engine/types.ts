/**
 * Provider abstractions for the deployment control plane.
 *
 * The control plane never talks to Azure directly. It talks to these
 * interfaces, so the demo adapter can be replaced with real Bicep/Terraform
 * execution (Container Apps Jobs + ARM) without touching domain logic.
 */

export type ValidationLevel = "PASS" | "WARNING" | "BLOCKING";

export interface ValidationCheck {
  key: string;
  name: string;
  level: ValidationLevel;
  detail: string;
}

export interface PreflightResult {
  checks: ValidationCheck[];
  pass: number;
  warning: number;
  blocking: number;
  deployable: boolean;
}

export interface PlanResource {
  action: "create" | "use_existing" | "update" | "delete";
  type: string;
  name: string;
  module?: string;
}

export interface DeploymentPlan {
  correlationId: string;
  resources: PlanResource[];
  policyAssignments: number;
  roleAssignments: number;
  estimatedMonthlyCost: { low: number; high: number };
  warnings: string[];
  blockers: string[];
  modules: { name: string; version: string }[];
}

export interface DriftFinding {
  resourceId: string;
  category: string;
  expected: Record<string, unknown>;
  actual: Record<string, unknown>;
  severity: "low" | "medium" | "high" | "critical";
  recommendedRemediation: string;
}

export interface StepOutcome {
  sequence: number;
  name: string;
  module: string;
  status: "succeeded" | "failed" | "skipped";
  log: string;
}

/** Implemented by the demo adapter today, by Bicep/Terraform executors later. */
export interface InfrastructureProvider {
  readonly id: string;
  readonly mode: "demo" | "azure";
  validate(input: ProviderContext): Promise<PreflightResult>;
  plan(input: ProviderContext): Promise<DeploymentPlan>;
  apply(input: ProviderContext & { plan: DeploymentPlan }): Promise<StepOutcome[]>;
  getOutputs(input: ProviderContext): Promise<Record<string, string>>;
  detectDrift(input: ProviderContext): Promise<DriftFinding[]>;
  destroy(input: ProviderContext): Promise<StepOutcome[]>;
}

/** Implemented by GitHub Actions / Azure DevOps adapters. */
export interface PipelineProvider {
  readonly id: "github" | "azure_devops" | "demo";
  dispatch(input: { correlationId: string; manifest: unknown }): Promise<{ runUrl: string | null }>;
}

export interface ProviderContext {
  environment: EnvironmentRecord;
  manifest: Record<string, unknown>;
  connection: ConnectionRecord | null;
  deploymentType: string;
}

export interface EnvironmentRecord {
  id: string;
  name: string;
  environment_type: string;
  region: string;
  deployment_boundary: string;
  configuration_json: Record<string, unknown>;
  monthly_cost_estimate: number | null;
}

export interface ConnectionRecord {
  id: string;
  connection_type: string;
  subscription_id: string | null;
  tenant_id: string | null;
  management_group_id: string | null;
  status: string;
}

export const DEPLOYMENT_STATES = [
  "DRAFT",
  "VALIDATING",
  "VALIDATION_FAILED",
  "READY",
  "AWAITING_APPROVAL",
  "PLANNING",
  "PLAN_FAILED",
  "AWAITING_PLAN_APPROVAL",
  "QUEUED",
  "DEPLOYING",
  "SUCCEEDED",
  "FAILED",
  "REQUIRES_REMEDIATION",
  "CANCELLED",
] as const;

export type DeploymentState = (typeof DEPLOYMENT_STATES)[number];

/** Allowed transitions. Enforced server-side before any status write. */
export const TRANSITIONS: Record<DeploymentState, DeploymentState[]> = {
  DRAFT: ["VALIDATING", "CANCELLED"],
  VALIDATING: ["VALIDATION_FAILED", "READY"],
  VALIDATION_FAILED: ["VALIDATING", "CANCELLED"],
  READY: ["PLANNING", "AWAITING_APPROVAL", "CANCELLED"],
  AWAITING_APPROVAL: ["PLANNING", "QUEUED", "CANCELLED"],
  PLANNING: ["PLAN_FAILED", "AWAITING_PLAN_APPROVAL"],
  PLAN_FAILED: ["PLANNING", "CANCELLED"],
  AWAITING_PLAN_APPROVAL: ["QUEUED", "CANCELLED"],
  QUEUED: ["DEPLOYING", "CANCELLED"],
  DEPLOYING: ["SUCCEEDED", "FAILED", "REQUIRES_REMEDIATION"],
  SUCCEEDED: [],
  FAILED: ["REQUIRES_REMEDIATION", "QUEUED", "CANCELLED"],
  REQUIRES_REMEDIATION: ["QUEUED", "CANCELLED"],
  CANCELLED: [],
};

export function canTransition(from: DeploymentState, to: DeploymentState) {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: DeploymentState, to: DeploymentState) {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal deployment transition: ${from} -> ${to}`);
  }
}
