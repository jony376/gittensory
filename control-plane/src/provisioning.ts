// provisionTenant / deprovisionTenant orchestration (#7524) over the injectable `TenantProvisioningDriver`.
// Product-agnostic: an ORB tenant and an AMS tenant take the identical call shape — `product` is forwarded to
// every driver step but never branched on. Provision runs #7180's three steps in order (create-container,
// provision-DB, inject-secrets); deprovision tears them down in REVERSE (revoke-secrets, drop-DB,
// destroy-container) so a secret is never left addressable after the DB/container it belonged to is gone.
//
// #7667: a provisioning-step failure pages via src/services/notify-pagerduty.ts's triggerPagerDutyIncident
// (opt-in via env + LOOPOVER_ENABLE_PAGERDUTY) before rethrowing — best-effort, never blocks teardown.

import { notifyTenantProvisioningFailure, type TriggerPagerDutyIncidentFn } from "./notify-provisioning-failure.js";
import type {
  FakeDriverStep,
  Product,
  Tenant,
  TenantLifecycleState,
  TenantProvisioningDriver,
  TenantProvisioningRequest,
} from "./tenant-provisioning-driver.js";

/** Result of a successful provision — terminal lifecycle state `"active"` (the vocabulary tenant-client.ts
 *  passes through from this API). */
export type TenantProvisioningResult = {
  tenant: Tenant;
  product: Product;
  state: Extract<TenantLifecycleState, "active">;
};

/** Result of a successful deprovision — terminal lifecycle state `"torn down"`. */
export type TenantDeprovisioningResult = {
  tenant: Tenant;
  product: Product;
  state: Extract<TenantLifecycleState, "torn down">;
};

/** Optional paging context forwarded to notify-pagerduty.ts when a provisioning step throws (#7667). */
export type ProvisionTenantOptions = {
  /** Worker Env (or self-host env bag) passed through to triggerPagerDutyIncident. */
  env?: unknown;
  /** Repo key for PagerDuty routing; defaults to loopover/hosting. */
  repoFullName?: string | undefined;
  /** Test override for triggerPagerDutyIncident — mocks the PagerDuty Events API call. */
  triggerPagerDuty?: TriggerPagerDutyIncidentFn;
};

const PROVISION_STEPS: Array<{
  step: Extract<FakeDriverStep, "createContainer" | "provisionDatabase" | "injectSecrets">;
  run: (driver: TenantProvisioningDriver, request: TenantProvisioningRequest) => Promise<void>;
}> = [
  { step: "createContainer", run: (driver, request) => driver.createContainer(request) },
  { step: "provisionDatabase", run: (driver, request) => driver.provisionDatabase(request) },
  { step: "injectSecrets", run: (driver, request) => driver.injectSecrets(request) },
];

/** Provision a tenant by running #7180's three steps in order against the injected driver. Product-agnostic:
 *  `product` is forwarded to every step, never branched on, so ORB and AMS share one call shape. */
export async function provisionTenant(
  tenant: Tenant,
  product: Product,
  driver: TenantProvisioningDriver,
  options: ProvisionTenantOptions = {},
): Promise<TenantProvisioningResult> {
  const request: TenantProvisioningRequest = { tenant, product };
  for (const { step, run } of PROVISION_STEPS) {
    try {
      await run(driver, request);
    } catch (error) {
      await notifyTenantProvisioningFailure(
        options.env,
        { tenant, product, step, error, repoFullName: options.repoFullName },
        { trigger: options.triggerPagerDuty },
      );
      throw error;
    }
  }
  return { tenant, product, state: "active" };
}

/** Deprovision a tenant by tearing #7180's three steps down in REVERSE order. Same product-agnostic call shape
 *  as provisionTenant. Idempotent by driver contract: deprovisioning a tenant that was never provisioned is a
 *  safe no-op, never a throw. */
export async function deprovisionTenant(
  tenant: Tenant,
  product: Product,
  driver: TenantProvisioningDriver,
): Promise<TenantDeprovisioningResult> {
  const request: TenantProvisioningRequest = { tenant, product };
  await driver.revokeSecrets(request);
  await driver.dropDatabase(request);
  await driver.destroyContainer(request);
  return { tenant, product, state: "torn down" };
}
