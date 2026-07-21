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
/**
 * GET `/v1/contributors/:login/pr-outcomes` with an optional `?limit=` query.
 * Returns the payload exactly as ORB reports it (merged outcomes only).
 */
export declare function fetchContributorPrOutcomes(login: string, options?: FetchContributorPrOutcomesOptions): Promise<ContributorPrOutcomesPayload>;
