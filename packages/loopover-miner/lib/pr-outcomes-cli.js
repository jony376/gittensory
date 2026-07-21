/** `pr-outcomes` CLI (#7658): list the current miner's hosted post-merge PR outcomes from ORB
 * `GET /v1/contributors/:login/pr-outcomes`. Thin argv + render layer over pr-outcomes-client.js
 * (fail-loud HTTP). Mirrors tenant-cli.js structure and loopover-mcp's pr-outcomes text layout.
 * Merged outcomes only - closed/rejected/in-flight remain local-only (#7656).
 */
import { argsWantJson, describeCliError, reportCliFailure } from "./cli-error.js";
import { fetchContributorPrOutcomes } from "./pr-outcomes-client.js";
export const PR_OUTCOMES_USAGE = "Usage: loopover-miner pr-outcomes [--login|--miner-login <github-login>] [--limit N] [--json]";
/** Resolve login from explicit flag, else LOOPOVER_LOGIN, else GITHUB_LOGIN. */
export function resolvePrOutcomesLogin(explicit, env = process.env) {
    if (explicit && explicit.trim())
        return explicit.trim();
    const fromLoopover = typeof env.LOOPOVER_LOGIN === "string" ? env.LOOPOVER_LOGIN.trim() : "";
    if (fromLoopover)
        return fromLoopover;
    const fromGithub = typeof env.GITHUB_LOGIN === "string" ? env.GITHUB_LOGIN.trim() : "";
    return fromGithub || null;
}
/** Parse `[--login|--miner-login <login>] [--limit N] [--json]`. */
export function parsePrOutcomesArgs(args) {
    let login = null;
    let limit;
    let json = false;
    for (let index = 0; index < args.length; index += 1) {
        const token = args[index];
        if (token === "--json") {
            json = true;
            continue;
        }
        if (token === "--login" || token === "--miner-login") {
            const value = args[index + 1];
            if (!value || value.startsWith("-"))
                return { error: PR_OUTCOMES_USAGE };
            if (login !== null)
                return { error: PR_OUTCOMES_USAGE };
            login = value;
            index += 1;
            continue;
        }
        if (token === "--limit") {
            const value = args[index + 1];
            if (!value || value.startsWith("-"))
                return { error: PR_OUTCOMES_USAGE };
            const parsed = Number(value);
            if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
                return { error: "Pass --limit as an integer between 1 and 100." };
            }
            limit = parsed;
            index += 1;
            continue;
        }
        if (token.startsWith("-"))
            return { error: `Unknown option: ${token}` };
        return { error: PR_OUTCOMES_USAGE };
    }
    return { login, limit, json };
}
function renderPrOutcomes(login, payload) {
    const summary = typeof payload.summary === "string" && payload.summary.trim()
        ? payload.summary.trim()
        : `LoopOver post-merge outcomes for ${login}.`;
    const lines = [summary];
    for (const outcome of payload.outcomes ?? []) {
        const heading = `${outcome.repoFullName}#${outcome.pullNumber ?? "?"} [${outcome.outcome}]`;
        lines.push(heading);
        if (outcome.attribution)
            lines.push(`  ${outcome.attribution}`);
    }
    return lines.join("\n");
}
export async function runPrOutcomes(args, options = {}) {
    const parsed = parsePrOutcomesArgs(args);
    if ("error" in parsed)
        return reportCliFailure(argsWantJson(args), parsed.error);
    const env = options.env ?? process.env;
    const login = resolvePrOutcomesLogin(parsed.login, env);
    if (!login) {
        return reportCliFailure(parsed.json, "Pass --login <github-login> (or --miner-login) or set LOOPOVER_LOGIN / GITHUB_LOGIN.");
    }
    const fetchFn = options.fetchContributorPrOutcomes ?? fetchContributorPrOutcomes;
    const clientOptions = {
        env,
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        ...(options.loopoverAuth !== undefined ? { loopoverAuth: options.loopoverAuth } : {}),
        ...(parsed.limit !== undefined ? { limit: parsed.limit } : {}),
    };
    try {
        const payload = await fetchFn(login, clientOptions);
        if (parsed.json) {
            console.log(JSON.stringify(payload, null, 2));
        }
        else {
            console.log(renderPrOutcomes(login, payload));
        }
        return 0;
    }
    catch (error) {
        return reportCliFailure(parsed.json, describeCliError(error));
    }
}
export async function runPrOutcomesCli(args, options = {}) {
    return runPrOutcomes(args, options);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicHItb3V0Y29tZXMtY2xpLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsicHItb3V0Y29tZXMtY2xpLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBOzs7O0dBSUc7QUFDSCxPQUFPLEVBQUUsWUFBWSxFQUFFLGdCQUFnQixFQUFFLGdCQUFnQixFQUFFLE1BQU0sZ0JBQWdCLENBQUM7QUFDbEYsT0FBTyxFQUFFLDBCQUEwQixFQUFFLE1BQU0seUJBQXlCLENBQUM7QUFRckUsTUFBTSxDQUFDLE1BQU0saUJBQWlCLEdBQzVCLCtGQUErRixDQUFDO0FBYWxHLGdGQUFnRjtBQUNoRixNQUFNLFVBQVUsc0JBQXNCLENBQ3BDLFFBQXVCLEVBQ3ZCLE1BQXlCLE9BQU8sQ0FBQyxHQUFHO0lBRXBDLElBQUksUUFBUSxJQUFJLFFBQVEsQ0FBQyxJQUFJLEVBQUU7UUFBRSxPQUFPLFFBQVEsQ0FBQyxJQUFJLEVBQUUsQ0FBQztJQUN4RCxNQUFNLFlBQVksR0FBRyxPQUFPLEdBQUcsQ0FBQyxjQUFjLEtBQUssUUFBUSxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsY0FBYyxDQUFDLElBQUksRUFBRSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUM7SUFDN0YsSUFBSSxZQUFZO1FBQUUsT0FBTyxZQUFZLENBQUM7SUFDdEMsTUFBTSxVQUFVLEdBQUcsT0FBTyxHQUFHLENBQUMsWUFBWSxLQUFLLFFBQVEsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLFlBQVksQ0FBQyxJQUFJLEVBQUUsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDO0lBQ3ZGLE9BQU8sVUFBVSxJQUFJLElBQUksQ0FBQztBQUM1QixDQUFDO0FBRUQsb0VBQW9FO0FBQ3BFLE1BQU0sVUFBVSxtQkFBbUIsQ0FBQyxJQUFjO0lBQ2hELElBQUksS0FBSyxHQUFrQixJQUFJLENBQUM7SUFDaEMsSUFBSSxLQUF5QixDQUFDO0lBQzlCLElBQUksSUFBSSxHQUFHLEtBQUssQ0FBQztJQUNqQixLQUFLLElBQUks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