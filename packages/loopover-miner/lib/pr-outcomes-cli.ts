/** `pr-outcomes` CLI (#7658): list the current miner's hosted post-merge PR outcomes from ORB
 * `GET /v1/contributors/:login/pr-outcomes`. Thin argv + render layer over pr-outcomes-client.js
 * (fail-loud HTTP). Mirrors tenant-cli.js structure and loopover-mcp's pr-outcomes text layout.
 * Merged outcomes only - closed/rejected/in-flight remain local-only (#7656).
 */
import { argsWantJson, describeCliError, reportCliFailure } from "./cli-error.js";
import { fetchContributorPrOutcomes } from "./pr-outcomes-client.js";
import type {
  ContributorPrOutcomesPayload,
  FetchContributorPrOutcomesOptions,
  LoopoverBackendAuth,
  PrOutcomesFetch,
} from "./pr-outcomes-client.js";

export const PR_OUTCOMES_USAGE =
  "Usage: loopover-miner pr-outcomes [--login|--miner-login <github-login>] [--limit N] [--json]";

export type ParsedPrOutcomesArgs =
  | { login: string | null; limit: number | undefined; json: boolean }
  | { error: string };

export type RunPrOutcomesOptions = {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: PrOutcomesFetch;
  loopoverAuth?: LoopoverBackendAuth | null;
  fetchContributorPrOutcomes?: typeof fetchContributorPrOutcomes;
};

/** Resolve login from explicit flag, else LOOPOVER_LOGIN, else GITHUB_LOGIN. */
export function resolvePrOutcomesLogin(
  explicit: string | null,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (explicit && explicit.trim()) return explicit.trim();
  const fromLoopover = typeof env.LOOPOVER_LOGIN === "string" ? env.LOOPOVER_LOGIN.trim() : "";
  if (fromLoopover) return fromLoopover;
  const fromGithub = typeof env.GITHUB_LOGIN === "string" ? env.GITHUB_LOGIN.trim() : "";
  return fromGithub || null;
}

/** Parse `[--login|--miner-login <login>] [--limit N] [--json]`. */
export function parsePrOutcomesArgs(args: string[]): ParsedPrOutcomesArgs {
  let login: string | null = null;
  let limit: number | undefined;
  let json = false;
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]!;
    if (token === "--json") {
      json = true;
      continue;
    }
    if (token === "--login" || token === "--miner-login") {
      const value = args[index + 1];
      if (!value || value.startsWith("-")) return { error: PR_OUTCOMES_USAGE };
      if (login !== null) return { error: PR_OUTCOMES_USAGE };
      login = value;
      index += 1;
      continue;
    }
    if (token === "--limit") {
      const value = args[index + 1];
      if (!value || value.startsWith("-")) return { error: PR_OUTCOMES_USAGE };
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
        return { error: "Pass --limit as an integer between 1 and 100." };
      }
      limit = parsed;
      index += 1;
      continue;
    }
    if (token.startsWith("-")) return { error: `Unknown option: ${token}` };
    return { error: PR_OUTCOMES_USAGE };
  }
  return { login, limit, json };
}

function renderPrOutcomes(login: string, payload: ContributorPrOutcomesPayload): string {
  const summary =
    typeof payload.summary === "string" && payload.summary.trim()
      ? payload.summary.trim()
      : `LoopOver post-merge outcomes for ${login}.`;
  const lines = [summary];
  for (const outcome of payload.outcomes ?? []) {
    const heading = `${outcome.repoFullName}#${outcome.pullNumber ?? "?"} [${outcome.outcome}]`;
    lines.push(heading);
    if (outcome.attribution) lines.push(`  ${outcome.attribution}`);
  }
  return lines.join("\n");
}

export async function runPrOutcomes(args: string[], options: RunPrOutcomesOptions = {}): Promise<number> {
  const parsed = parsePrOutcomesArgs(args);
  if ("error" in parsed) return reportCliFailure(argsWantJson(args), parsed.error);

  const env = options.env ?? process.env;
  const login = resolvePrOutcomesLogin(parsed.login, env);
  if (!login) {
    return reportCliFailure(
      parsed.json,
      "Pass --login <github-login> (or --miner-login) or set LOOPOVER_LOGIN / GITHUB_LOGIN.",
    );
  }

  const fetchFn = options.fetchContributorPrOutcomes ?? fetchContributorPrOutcomes;
  const clientOptions: FetchContributorPrOutcomesOptions = {
    env,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    ...(options.loopoverAuth !== undefined ? { loopoverAuth: options.loopoverAuth } : {}),
    ...(parsed.limit !== undefined ? { limit: parsed.limit } : {}),
  };

  try {
    const payload = await fetchFn(login, clientOptions);
    if (parsed.json) {
      console.log(JSON.stringify(payload, null, 2));
    } else {
      console.log(renderPrOutcomes(login, payload));
    }
    return 0;
  } catch (error) {
    return reportCliFailure(parsed.json, describeCliError(error));
  }
}

export async function runPrOutcomesCli(args: string[], options: RunPrOutcomesOptions = {}): Promise<number> {
  return runPrOutcomes(args, options);
}
