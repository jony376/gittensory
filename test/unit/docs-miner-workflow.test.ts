import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const MINER_WORKFLOW_PATH = resolve(
  import.meta.dirname,
  "../../apps/loopover-ui/content/docs/miner-workflow.mdx",
);
const QUICKSTART_PATH = resolve(
  import.meta.dirname,
  "../../apps/loopover-ui/content/docs/quickstart.mdx",
);

describe("docs miner workflow page", () => {
  const source = readFileSync(MINER_WORKFLOW_PATH, "utf8");
  const normalizedSource = source.replace(/\s+/g, " ");
  const quickstartSource = readFileSync(QUICKSTART_PATH, "utf8");
  const normalizedQuickstartSource = quickstartSource.replace(/\s+/g, " ");

  it("cross-links to the miner coding-agent driver page before the loop steps", () => {
    expect(normalizedSource).toMatch(/Miner coding-agent driver/);
    expect(source).toMatch(/\/docs\/miner-coding-agent/);
  });

  it("documents that AMS works without ORB registration or a repo manifest", () => {
    expect(normalizedSource).toMatch(/not limited to ORB-managed repos/i);
    expect(normalizedSource).toMatch(/any GitHub repository you can access/i);
    expect(normalizedSource).toMatch(/not gittensor-registered/i);
    expect(normalizedSource).toMatch(/does not ship a `\.loopover\.yml`/i);
    expect(normalizedQuickstartSource).toMatch(/ordinary GitHub repositories/i);
    expect(normalizedQuickstartSource).toMatch(/ORB is optional/i);
    expect(normalizedQuickstartSource).toMatch(/gittensor registration is optional/i);
    expect(normalizedQuickstartSource).toMatch(/missing `\.loopover\.yml` does not block discovery, analysis, or attempts/i);
    expect(normalizedQuickstartSource).toMatch(/LOOPOVER_MINER_LIVE_MODE=live/i);
    expect(normalizedQuickstartSource).toMatch(/`\.loopover-miner\.yml` opt-in/i);
    expect(normalizedSource).toMatch(/Autonomous PR writes remain gated separately by AMS live-mode opt-ins/i);
  });
});
