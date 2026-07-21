import { fetchContributorPrOutcomes } from "./pr-outcomes-client.js";
import type { LoopoverBackendAuth, PrOutcomesFetch } from "./pr-outcomes-client.js";
export declare const PR_OUTCOMES_USAGE = "Usage: loopover-miner pr-outcomes [--login|--miner-login <github-login>] [--limit N] [--json]";
export type ParsedPrOutcomesArgs = {
    login: string | null;
    limit: number | undefined;
    json: boolean;
} | {
    error: string;
};
export type RunPrOutcomesOptions = {
    env?: NodeJS.ProcessEnv;
    fetchImpl?: PrOutcomesFetch;
    loopoverAuth?: LoopoverBackendAuth | null;
    fetchContributorPrOutcomes?: typeof fetchContributorPrOutcomes;
};
/** Resolve login from explicit flag, else LOOPOVER_LOGIN, else GITHUB_LOGIN. */
export declare function resolvePrOutcomesLogin(explicit: string | null, env?: NodeJS.ProcessEnv): string | null;
/** Parse `[--login|--miner-login <login>] [--limit N] [--json]`. */
export declare function parsePrOutcomesArgs(args: string[]): ParsedPrOutcomesArgs;
export declare function runPrOutcomes(args: string[], options?: RunPrOutcomesOptions): Promise<number>;
export declare function runPrOutcomesCli(args: string[], options?: RunPrOutcomesOptions): Promise<number>;
