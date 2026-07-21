/** Hosted ORB client for GET /v1/contributors/:login/pr-outcomes (#7658).
 *
 * Fail-loud (same posture as tenant-client.js): missing loopover-mcp session, unreachable host, non-2xx,
 * or a malformed body all throw a clear Error for the CLI to surface as a non-zero exit. Auth is the
 * contributor session Bearer from `resolveLoopoverBackendSession` - the endpoint requires the session
 * actor to match `:login` (see `requireContributorAccess`). Merged-PR outcomes only; no closed/rejected
 * or in-flight attempts.
 */
import { resolveLoopoverBackendSession } from "./github-token-resolution.js";

export type PrOutcomesFetch = (url: string, init: RequestInit) => Promise<Response>;

export type LoopoverBackendAuth = {
  apiUrl: string;
  sessionToken: string;
};

export type ContributorPrOutcomeRow = {
  repoFullName: string;
  pullNumber: number | null;
  outcome: "merged";
  attribution: string;
  deeplink: string;
  recordedAt: string;
};

export type ContributorPrOutcomesPayload = {
  login: string;
  count: number;
  summary: string;
  outcomes: ContributorPrOutcomeRow[];
};

export type FetchContributorPrOutcomesOptions = {
  env?: NodeJS.ProcessEnv;
  /** Injected fetch; defaults to the real global fetch. */
  fetchImpl?: PrOutcomesFetch;
  /** Inject session (tests / forced auth). Undefined => resolve from loopover-mcp config on disk. */
  loopoverAuth?: LoopoverBackendAuth | null;
  requestTimeoutMs?: number;
  limit?: number;
};

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

function resolveAuth(
  env: NodeJS.ProcessEnv,
  loopoverAuth: LoopoverBackendAuth | null | undefined,
): LoopoverBackendAuth {
  if (loopoverAuth === null) {
    throw new Error("no loopover session: run `loopover-mcp login` (or pass a session) before pr-outcomes");
  }
  if (loopoverAuth && typeof loopoverAuth.sessionToken === "string" && loopoverAuth.sessionToken) {
    const apiUrl =
      typeof loopoverAuth.apiUrl === "string" && loopoverAuth.apiUrl.trim()
        ? loopoverAuth.apiUrl.replace(/\/+$/, "")
        : (resolveLoopoverBackendSession(env)?.apiUrl ?? "https://api.loopover.ai");
    return { apiUrl, sessionToken: loopoverAuth.sessionToken };
  }
  const session = resolveLoopoverBackendSession(env);
  if (!session) {
    throw new Error("no loopover session: run `loopover-mcp login` before pr-outcomes");
  }
  return session;
}

function assertLimit(limit: number | undefined): number | undefined {
  if (limit === undefined) return undefined;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("limit must be an integer between 1 and 100");
  }
  return limit;
}

function parsePayload(payload: unknown): ContributorPrOutcomesPayload {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("pr-outcomes returned a malformed response");
  }
  const record = payload as Record<string, unknown>;
  if (typeof record.login !== "string" || !Array.isArray(record.outcomes)) {
    throw new Error("pr-outcomes returned a malformed response");
  }
  return {
    login: record.login,
    count: typeof record.count === "number" ? record.count : record.outcomes.length,
    summary: typeof record.summary === "string" ? record.summary : "",
    outcomes: record.outcomes as ContributorPrOutcomeRow[],
  };
}

/**
 * GET `/v1/contributors/:login/pr-outcomes` with an optional `?limit=` query.
 * Returns the payload exactly as ORB reports it (merged outcomes only).
 */
export async function fetchContributorPrOutcomes(
  login: string,
  options: FetchContributorPrOutcomesOptions = {},
): Promise<ContributorPrOutcomesPayload> {
  const trimmedLogin = typeof login === "string" ? login.trim() : "";
  if (!trimmedLogin) throw new Error("login is required");

  const env = options.env ?? process.env;
  const auth = resolveAuth(env, options.loopoverAuth);
  const limit = assertLimit(options.limit);
  const fetchImpl = options.fetchImpl ?? (fetch as PrOutcomesFetch);
  const timeoutMs =
    Number.isFinite(options.requestTimeoutMs) && (options.requestTimeoutMs as number) > 0
      ? (options.requestTimeoutMs as number)
      : DEFAULT_REQUEST_TIMEOUT_MS;

  const query = new URLSearchParams();
  if (limit !== undefined) query.set("limit", String(limit));
  const suffix = query.size > 0 ? `?${query}` : "";
  const url = `${auth.apiUrl}/v1/contributors/${encodeURIComponent(trimmedLogin)}/pr-outcomes${suffix}`;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: { accept: "application/json", authorization: `Bearer ${auth.sessionToken}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new Error(
      `pr-outcomes unreachable for GET /v1/contributors/:login/pr-outcomes: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (!response.ok) {
    throw new Error(`pr-outcomes returned http_${response.status} for GET /v1/contributors/${trimmedLogin}/pr-outcomes`);
  }
  const payload = (await response.json().catch(() => null)) as unknown;
  return parsePayload(payload);
}
