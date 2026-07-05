// Units for the exhaustiveness-drift analyzer (#2028). Own file so concurrent analyzer PRs don't collide.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseAddedUnionMembersFromPatch,
  unionRhsMembers,
  findSwitchMissingMember,
  extractSwitchCaseLabels,
  scanExhaustivenessDrift,
} from "../dist/analyzers/exhaustiveness-drift.js";
import { renderBrief } from "../dist/render.js";

const req = (files, extra = {}) => ({
  repoFullName: "octo/repo",
  prNumber: 1,
  githubToken: "ghp_test",
  headSha: "abc123",
  files,
  ...extra,
});

const rawResponse = (text: string) => new Response(text, { status: 200 });
const contentsFetch =
  (byPath: Record<string, string>) =>
  async (url: string) =>
    Object.entries(byPath).some(([path]) => url.includes(encodeURIComponent(path).replace(/%2F/g, "/")) || url.includes(path))
      ? rawResponse(Object.entries(byPath).find(([path]) => url.includes(path))![1])
      : new Response("", { status: 404 });

test("unionRhsMembers: splits string-literal unions", () => {
  assert.deepEqual(unionRhsMembers("'open' | 'closed' | 'pending'"), ["open", "closed", "pending"]);
});

test("parseAddedUnionMembersFromPatch: detects a newly-added union literal", () => {
  const patch = [
    "@@ -1,1 +1,1 @@",
    "-export type Status = 'open' | 'closed';",
    "+export type Status = 'open' | 'closed' | 'pending';",
  ].join("\n");
  assert.deepEqual(parseAddedUnionMembersFromPatch(patch, "src/status.ts"), [
    { file: "src/status.ts", line: 1, unionName: "Status", addedMember: "pending" },
  ]);
});

test("findSwitchMissingMember: flags a switch covering siblings but not the new member", () => {
  const content = [
    "export function run(status: Status) {",
    "  switch (status) {",
    "    case 'open': return 1;",
    "    case 'closed': return 2;",
    "  }",
    "}",
  ].join("\n");
  assert.equal(findSwitchMissingMember(content, "pending", ["open", "closed"]), 2);
});

test("findSwitchMissingMember: returns null when the switch covers the new member", () => {
  const content = [
    "switch (status) {",
    "  case 'open': break;",
    "  case 'closed': break;",
    "  case 'pending': break;",
    "}",
  ].join("\n");
  assert.equal(findSwitchMissingMember(content, "pending", ["open", "closed"]), null);
});

test("extractSwitchCaseLabels: reads identifier and string cases", () => {
  assert.deepEqual(
    extractSwitchCaseLabels("case Open: case 'closed': case Pending:"),
    ["Open", "closed", "Pending"],
  );
});

test("scanExhaustivenessDrift: flags an uncovered added member", async () => {
  const typeFile = "export type Status = 'open' | 'closed' | 'pending';";
  const consumer = [
    "import type { Status } from './status';",
    "export function run(status: Status) {",
    "  switch (status) {",
    "    case 'open': return 1;",
    "    case 'closed': return 2;",
    "  }",
    "}",
  ].join("\n");
  const patch = [
    "@@ -1,1 +1,1 @@",
    "-export type Status = 'open' | 'closed';",
    "+export type Status = 'open' | 'closed' | 'pending';",
  ].join("\n");
  const findings = await scanExhaustivenessDrift(
    req([
      { path: "src/status.ts", patch },
      { path: "src/run.ts", patch: "@@ -0,0 +1,7 @@\n+..." },
    ]),
    contentsFetch({ "src/status.ts": typeFile, "src/run.ts": consumer }),
  );
  assert.deepEqual(findings, [
    {
      file: "src/status.ts",
      line: 1,
      unionName: "Status",
      addedMember: "pending",
      consumerFile: "src/run.ts",
    },
  ]);
});

test("scanExhaustivenessDrift: does not flag a fully-covered switch", async () => {
  const typeFile = "export type Status = 'open' | 'closed' | 'pending';";
  const consumer = [
    "switch (status) {",
    "  case 'open': break;",
    "  case 'closed': break;",
    "  case 'pending': break;",
    "}",
  ].join("\n");
  const patch = [
    "@@ -1,1 +1,1 @@",
    "-export type Status = 'open' | 'closed';",
    "+export type Status = 'open' | 'closed' | 'pending';",
  ].join("\n");
  const findings = await scanExhaustivenessDrift(
    req([
      { path: "src/status.ts", patch },
      { path: "src/run.ts", patch: "@@ -0,0 +1,5 @@\n+..." },
    ]),
    contentsFetch({ "src/status.ts": typeFile, "src/run.ts": consumer }),
  );
  assert.deepEqual(findings, []);
});

test("scanExhaustivenessDrift: respects the fetch cap", async () => {
  let calls = 0;
  const countingFetch = async (url: string) => {
    if (String(url).includes("/contents/")) calls += 1;
    return rawResponse("export type Status = 'open' | 'closed' | 'pending';");
  };
  const patch = [
    "@@ -1,1 +1,1 @@",
    "-export type Status = 'open' | 'closed';",
    "+export type Status = 'open' | 'closed' | 'pending';",
  ].join("\n");
  await scanExhaustivenessDrift(
    req([
      { path: "src/a.ts", patch },
      { path: "src/b.ts", patch },
      { path: "src/c.ts", patch },
    ]),
    countingFetch,
    { maxFetches: 1 },
  );
  assert.equal(calls, 1);
});

test("scanExhaustivenessDrift: skips when github token is absent", async () => {
  let called = false;
  const fetchFn = async () => {
    called = true;
    return rawResponse("");
  };
  const findings = await scanExhaustivenessDrift(
    req([{ path: "src/status.ts", patch: "@@ -0,0 +1,1 @@\n+export type Status = 'open';" }], {
      githubToken: undefined,
    }),
    fetchFn,
  );
  assert.deepEqual(findings, []);
  assert.equal(called, false);
});

test("renderBrief: includes exhaustiveness findings via descriptor render", () => {
  const findings = [
    {
      file: "src/status.ts",
      line: 1,
      unionName: "Status",
      addedMember: "pending",
      consumerFile: "src/run.ts",
    },
  ];
  const brief = renderBrief({ exhaustiveness: findings }).promptSection;
  assert.match(brief, /exhaustiveness drift/i);
  assert.match(brief, /pending/);
});
