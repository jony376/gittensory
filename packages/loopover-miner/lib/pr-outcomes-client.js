/** Hosted ORB client for GET /v1/contributors/:login/pr-outcomes (#7658).
 *
 * Fail-loud (same posture as tenant-client.js): missing loopover-mcp session, unreachable host, non-2xx,
 * or a malformed body all throw a clear Error for the CLI to surface as a non-zero exit. Auth is the
 * contributor session Bearer from `resolveLoopoverBackendSession` - the endpoint requires the session
 * actor to match `:login` (see `requireContributorAccess`). Merged-PR outcomes only; no closed/rejected
 * or in-flight attempts.
 */
import { resolveLoopoverBackendSession } from "./github-token-resolution.js";
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
function resolveAuth(env, loopoverAuth) {
    if (loopoverAuth === null) {
        throw new Error("no loopover session: run `loopover-mcp login` (or pass a session) before pr-outcomes");
    }
    if (loopoverAuth && typeof loopoverAuth.sessionToken === "string" && loopoverAuth.sessionToken) {
        const apiUrl = typeof loopoverAuth.apiUrl === "string" && loopoverAuth.apiUrl.trim()
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
function assertLimit(limit) {
    if (limit === undefined)
        return undefined;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw new Error("limit must be an integer between 1 and 100");
    }
    return limit;
}
function parsePayload(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new Error("pr-outcomes returned a malformed response");
    }
    const record = payload;
    if (typeof record.login !== "string" || !Array.isArray(record.outcomes)) {
        throw new Error("pr-outcomes returned a malformed response");
    }
    return {
        login: record.login,
        count: typeof record.count === "number" ? record.count : record.outcomes.length,
        summary: typeof record.summary === "string" ? record.summary : "",
        outcomes: record.outcomes,
    };
}
/**
 * GET `/v1/contributors/:login/pr-outcomes` with an optional `?limit=` query.
 * Returns the payload exactly as ORB reports it (merged outcomes only).
 */
export async function fetchContributorPrOutcomes(login, options = {}) {
    const trimmedLogin = typeof login === "string" ? login.trim() : "";
    if (!trimmedLogin)
        throw new Error("login is required");
    const env = options.env ?? process.env;
    const auth = resolveAuth(env, options.loopoverAuth);
    const limit = assertLimit(options.limit);
    const fetchImpl = options.fetchImpl ?? fetch;
    const timeoutMs = Number.isFinite(options.requestTimeoutMs) && options.requestTimeoutMs > 0
        ? options.requestTimeoutMs
        : DEFAULT_REQUEST_TIMEOUT_MS;
    const query = new URLSearchParams();
    if (limit !== undefined)
        query.set("limit", String(limit));
    const suffix = query.size > 0 ? `?${query}` : "";
    const url = `${auth.apiUrl}/v1/contributors/${encodeURIComponent(trimmedLogin)}/pr-outcomes${suffix}`;
    let response;
    try {
        response = await fetchImpl(url, {
            method: "GET",
            headers: { accept: "application/json", authorization: `Bearer ${auth.sessionToken}` },
            signal: AbortSignal.timeout(timeoutMs),
        });
    }
    catch (error) {
        throw new Error(`pr-outcomes unreachable for GET /v1/contributors/:login/pr-outcomes: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!response.ok) {
        throw new Error(`pr-outcomes returned http_${response.status} for GET /v1/contributors/${trimmedLogin}/pr-outcomes`);
    }
    const payload = (await response.json().catch(() => null));
    return parsePayload(payload);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicHItb3V0Y29tZXMtY2xpZW50LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsicHItb3V0Y29tZXMtY2xpZW50LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBOzs7Ozs7O0dBT0c7QUFDSCxPQUFPLEVBQUUsNkJBQTZCLEVBQUUsTUFBTSw4QkFBOEIsQ0FBQztBQW1DN0UsTUFBTSwwQkFBMEIsR0FBRyxNQUFNLENBQUM7QUFFMUMsU0FBUyxXQUFXLENBQ2xCLEdBQXNCLEVBQ3RCLFlBQW9EO0lBRXBELElBQUksWUFBWSxLQUFLLElBQUksRUFBRSxDQUFDO1FBQzFCLE1BQU0sSUFBSSxLQUFLLENBQUMsc0ZBQXNGLENBQUMsQ0FBQztJQUMxRyxDQUFDO0lBQ0QsSUFBSSxZQUFZLElBQUksT0FBTyxZQUFZLENBQUMsWUFBWSxLQUFLLFFBQVEsSUFBSSxZQUFZLENBQUMsWUFBWSxFQUFFLENBQUM7UUFDL0YsTUFBTSxNQUFNLEdBQ1YsT0FBTyxZQUFZLENBQUMsTUFBTSxLQUFLLFFBQVEsSUFBSSxZQUFZLENBQUMsTUFBTSxDQUFDLElBQUksRUFBRTtZQUNuRSxDQUFDLENBQUMsWUFBWSxDQUFDLE1BQU0sQ0FBQyxPQUFPLENBQUMsTUFBTSxFQUFFLEVBQUUsQ0FBQztZQUN6QyxDQUFDLENBQUMsQ0FBQyw2QkFBNkIsQ0FBQyxHQUFHLENBQUMsRUFBRSxNQUFNLElBQUkseUJBQXlCLENBQUMsQ0FBQztRQUNoRixPQUFPLEVBQUUsTUFBTSxFQUFFLFlBQVksRUFBRSxZQUFZLENBQUMsWUFBWSxFQUFFLENBQUM7SUFDN0QsQ0FBQztJQUNELE1BQU0sT0FBTyxHQUFHLDZCQUE2QixDQUFDLEdBQUcsQ0FBQyxDQUFDO0lBQ25ELElBQUksQ0FBQyxPQUFPLEVBQUUsQ0FBQztRQUNiLE1BQU0sSUFBSSxLQUFLLENBQUMsa0VBQWtFLENBQUMsQ0FBQztJQUN0RixDQUFDO0lBQ0QsT0FBTyxPQUFPLENBQUM7QUFDakIsQ0FBQztBQUVELFNBQVMsV0FBVyxD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