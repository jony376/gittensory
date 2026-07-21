// PagerDuty paging tests for tenant provisioning failures (#7667). Mocks triggerPagerDutyIncident — no live
// Events API calls.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildTenantProvisioningFailureDedupKey,
  buildTenantProvisioningFailureSummary,
  createFakeTenantProvisioningDriver,
  notifyTenantProvisioningFailure,
  provisionTenant,
  type TriggerPagerDutyIncidentFn,
  type Tenant,
  type TenantProvisioningDriver,
} from "../dist/index.js";

function createFailingDriver(failAt: "createContainer" | "provisionDatabase" | "injectSecrets"): TenantProvisioningDriver {
  const base = createFakeTenantProvisioningDriver();
  return {
    ...base,
    async createContainer(request) {
      if (failAt === "createContainer") throw new Error("container boom");
      return base.createContainer(request);
    },
    async provisionDatabase(request) {
      if (failAt === "provisionDatabase") throw new Error("database boom");
      return base.provisionDatabase(request);
    },
    async injectSecrets(request) {
      if (failAt === "injectSecrets") throw new Error("secrets boom");
      return base.injectSecrets(request);
    },
  };
}

test("buildTenantProvisioningFailureDedupKey: stable per tenant/product/step (#7667)", () => {
  const tenant: Tenant = { name: "acme" };
  assert.equal(
    buildTenantProvisioningFailureDedupKey({ tenant, product: "orb", step: "createContainer" }),
    "tenant_provisioning:acme:orb:createContainer",
  );
});

test("buildTenantProvisioningFailureSummary: includes step, tenant, product, and error (#7667)", () => {
  const tenant: Tenant = { name: "acme" };
  const summary = buildTenantProvisioningFailureSummary({
    tenant,
    product: "ams",
    step: "injectSecrets",
    error: new Error("secrets boom"),
  });
  assert.match(summary, /injectSecrets/);
  assert.match(summary, /acme/);
  assert.match(summary, /ams/);
  assert.match(summary, /secrets boom/);
});

test("notifyTenantProvisioningFailure: no-op without env (#7667)", async () => {
  let called = false;
  const trigger: TriggerPagerDutyIncidentFn = async () => {
    called = true;
  };
  await notifyTenantProvisioningFailure(
    undefined,
    { tenant: { name: "acme" }, product: "orb", step: "createContainer", error: new Error("boom") },
    { trigger },
  );
  assert.equal(called, false);
});

test("notifyTenantProvisioningFailure: forwards critical page payload to trigger (#7667)", async () => {
  const calls: Array<Parameters<TriggerPagerDutyIncidentFn>[1]> = [];
  const trigger: TriggerPagerDutyIncidentFn = async (_env, params) => {
    calls.push(params);
  };
  const tenant: Tenant = { name: "acme" };
  await notifyTenantProvisioningFailure(
    { LOOPOVER_ENABLE_PAGERDUTY: "1" },
    { tenant, product: "orb", step: "provisionDatabase", error: new Error("database boom"), repoFullName: "acme/hosting" },
    { trigger },
  );
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    repoFullName: "acme/hosting",
    summary: buildTenantProvisioningFailureSummary({
      tenant,
      product: "orb",
      step: "provisionDatabase",
      error: new Error("database boom"),
    }),
    severity: "critical",
    dedupKey: "tenant_provisioning:acme:orb:provisionDatabase",
    customDetails: {
      tenant: "acme",
      product: "orb",
      step: "provisionDatabase",
      error: "database boom",
    },
  });
});

test("notifyTenantProvisioningFailure: blank repoFullName falls back to loopover/hosting (#7667)", async () => {
  const calls: Array<Parameters<TriggerPagerDutyIncidentFn>[1]> = [];
  const trigger: TriggerPagerDutyIncidentFn = async (_env, params) => {
    calls.push(params);
  };
  await notifyTenantProvisioningFailure(
    {},
    { tenant: { name: "acme" }, product: "orb", step: "createContainer", error: "boom", repoFullName: "   " },
    { trigger },
  );
  assert.equal(calls[0]?.repoFullName, "loopover/hosting");
});

test("provisionTenant: pages then rethrows when a step fails (#7667)", async () => {
  const tenant: Tenant = { name: "acme" };
  const calls: Array<Parameters<TriggerPagerDutyIncidentFn>[1]> = [];
  const trigger: TriggerPagerDutyIncidentFn = async (_env, params) => {
    calls.push(params);
  };
  const driver = createFailingDriver("injectSecrets");

  await assert.rejects(
    () =>
      provisionTenant(tenant, "ams", driver, {
        env: { LOOPOVER_ENABLE_PAGERDUTY: "1" },
        repoFullName: "acme/hosting",
        triggerPagerDuty: trigger,
      }),
    /secrets boom/,
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.dedupKey, "tenant_provisioning:acme:ams:injectSecrets");
  assert.equal(calls[0]?.severity, "critical");
  // Prior steps completed before injectSecrets threw.
  assert.deepEqual(
    driver.calls.map((call) => call.step),
    ["createContainer", "provisionDatabase"],
  );
});

test("provisionTenant: success path does not page (#7667)", async () => {
  const tenant: Tenant = { name: "acme" };
  let called = false;
  const trigger: TriggerPagerDutyIncidentFn = async () => {
    called = true;
  };
  const driver = createFakeTenantProvisioningDriver();

  const result = await provisionTenant(tenant, "orb", driver, {
    env: { LOOPOVER_ENABLE_PAGERDUTY: "1" },
    triggerPagerDuty: trigger,
  });

  assert.deepEqual(result, { tenant, product: "orb", state: "active" });
  assert.equal(called, false);
});

test("provisionTenant: no env skips paging but still rethrows (#7667)", async () => {
  let called = false;
  const trigger: TriggerPagerDutyIncidentFn = async () => {
    called = true;
  };

  await assert.rejects(
    () => provisionTenant({ name: "acme" }, "orb", createFailingDriver("createContainer"), { triggerPagerDuty: trigger }),
    /container boom/,
  );
  assert.equal(called, false);
});
