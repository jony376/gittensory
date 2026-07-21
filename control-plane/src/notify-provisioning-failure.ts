// PagerDuty paging on tenant provisioning failures (#7667). Reuses src/services/notify-pagerduty.ts's
// triggerPagerDutyIncident exactly (same flag, routing key, dedup/cooldown/severity floor) — no second
// alerting mechanism. The hosted control-plane runs with a Worker Env when paging is enabled; tests inject
// a mock trigger so no live Events API call is made.

import type { FakeDriverStep, Product, Tenant } from "./tenant-provisioning-driver.js";

export type ProvisioningFailureStep = Extract<
  FakeDriverStep,
  "createContainer" | "provisionDatabase" | "injectSecrets"
>;

export type ProvisioningPagerDutySeverity = "critical" | "error" | "warning" | "info";

export type TriggerPagerDutyIncidentFn = (
  env: unknown,
  params: {
    repoFullName: string;
    summary: string;
    severity: ProvisioningPagerDutySeverity;
    dedupKey: string;
    customDetails?: Record<string, unknown> | undefined;
  },
) => Promise<void>;

const DEFAULT_REPO_FULL_NAME = "loopover/hosting";

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "unknown error";
}

let cachedTrigger: TriggerPagerDutyIncidentFn | undefined;

async function resolveTrigger(
  override?: TriggerPagerDutyIncidentFn,
): Promise<TriggerPagerDutyIncidentFn | null> {
  if (override) return override;
  if (cachedTrigger) return cachedTrigger;
  try {
    // Computed path keeps control-plane's tsc from pulling notify-pagerduty.ts under this package's rootDir.
    const notifyPagerDutyModule = ["..", "..", "src", "services", "notify-pagerduty.js"].join("/");
    const mod = (await import(notifyPagerDutyModule)) as {
      triggerPagerDutyIncident: TriggerPagerDutyIncidentFn;
    };
    cachedTrigger = mod.triggerPagerDutyIncident;
    return cachedTrigger;
  } catch {
    return null;
  }
}

export function buildTenantProvisioningFailureDedupKey(input: {
  tenant: Tenant;
  product: Product;
  step: ProvisioningFailureStep;
}): string {
  return `tenant_provisioning:${input.tenant.name}:${input.product}:${input.step}`;
}

export function buildTenantProvisioningFailureSummary(input: {
  tenant: Tenant;
  product: Product;
  step: ProvisioningFailureStep;
  error: unknown;
}): string {
  const message = errorMessage(input.error);
  return `Tenant provisioning failed at ${input.step} for ${input.tenant.name} (${input.product}): ${message}`.slice(
    0,
    1024,
  );
}

/** Best-effort PagerDuty page for a failed provisioning step (#7667). No-op when `env` is absent, when the
 *  monorepo's notify-pagerduty module is unreachable (standalone package build), or when
 *  triggerPagerDutyIncident denies the page (flag off, below severity floor, cooldown, etc.). Never throws. */
export async function notifyTenantProvisioningFailure(
  env: unknown,
  input: {
    tenant: Tenant;
    product: Product;
    step: ProvisioningFailureStep;
    error: unknown;
    repoFullName?: string | undefined;
  },
  options: { trigger?: TriggerPagerDutyIncidentFn } = {},
): Promise<void> {
  if (env == null) return;
  const trigger = await resolveTrigger(options.trigger);
  if (!trigger) return;
  const repoFullName = (input.repoFullName ?? "").trim() || DEFAULT_REPO_FULL_NAME;
  const message = errorMessage(input.error);
  try {
    await trigger(env, {
      repoFullName,
      summary: buildTenantProvisioningFailureSummary(input),
      severity: "critical",
      dedupKey: buildTenantProvisioningFailureDedupKey(input),
      customDetails: {
        tenant: input.tenant.name,
        product: input.product,
        step: input.step,
        error: message.slice(0, 500),
      },
    });
  } catch {
    // triggerPagerDutyIncident is documented never-throw; this guards test mocks and future drift.
  }
}
