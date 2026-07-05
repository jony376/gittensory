// Enum / literal-union exhaustiveness-drift analyzer (#2028, part of #1499). Flags when a PR adds a new member to a
// TS enum or string-literal union but a switch/mapping in the changed set still handles only the old members — a
// classic missed-case bug. Parses added members from the diff, fetches the type file + other changed consumers at
// headSha (injected fetch), and reports only high-confidence gaps (a switch covers >= 2 sibling members but not the
// new one). Deliberately conservative + fail-safe: strict maxFiles + maxFetches caps; missing token/head-sha or any
// fetch error skips that symbol rather than reporting a false positive.
import type { EnrichRequest, ExhaustivenessFinding } from "../types.js";

const GITHUB_API = "https://api.github.com";
const MAX_FILES = 12;
const MAX_FETCHES = 20;
const MAX_FINDINGS = 25;
const MAX_FETCH_BYTES = 1_000_000;
const SOURCE_RE = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const SKIP_RE = /(?:\.d\.ts$|\.min\.|\.test\.|\.spec\.|__tests__\/|(?:^|\/)tests?\/)/;
const SLUG_RE = /^[A-Za-z0-9._-]+$/;
const ENUM_DECL_RE = /^\s*(?:export\s+)?enum\s+([A-Za-z_$][\w$]*)\s*\{/;
const ENUM_MEMBER_RE = /^\s*([A-Za-z_$][\w$]*)\s*(?:=\s*[^,]+)?,?\s*$/;
const TYPE_UNION_RE = /^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=\s*(.+?);?\s*$/;

interface ScanOptions {
  signal?: AbortSignal;
  maxFiles?: number;
  maxFetches?: number;
}

interface AddedMember {
  file: string;
  line: number;
  unionName: string;
  addedMember: string;
}

async function readBoundedText(resp: Response, signal?: AbortSignal): Promise<string | null> {
  const length = Number(resp.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_FETCH_BYTES) return null;
  if (!resp.body) return null;
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  try {
    while (true) {
      if (signal?.aborted) return null;
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_FETCH_BYTES) {
        await reader.cancel();
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    reader.releaseLock();
  }
}

/** Split a union RHS on top-level `|`, respecting ()/{}/[]/<> depth and string literals. Pure. */
export function splitTopLevelPipe(src: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  let quote: string | null = null;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quote) {
      if (ch === quote && src[i - 1] !== "\\") quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "(" || ch === "{" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "}" || ch === "]") depth = Math.max(0, depth - 1);
    else if (ch === "|" && depth === 0) {
      parts.push(src.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(src.slice(start));
  return parts;
}

/** Literal/identifier members of a string-literal union RHS. Pure. */
export function unionRhsMembers(rhs: string): string[] {
  const out: string[] = [];
  for (const part of splitTopLevelPipe(rhs)) {
    const trimmed = part.trim();
    const str = /^['"]([^'"]+)['"]$/.exec(trimmed);
    if (str) {
      out.push(str[1]!);
      continue;
    }
    const ident = /^([A-Za-z_$][\w$]*)$/.exec(trimmed);
    if (ident) out.push(ident[1]!);
  }
  return out;
}

/** Added enum/union members from a unified diff. Pure. */
export function parseAddedUnionMembersFromPatch(
  patch: string,
  file: string,
): AddedMember[] {
  const out: AddedMember[] = [];
  let newLine = 0;
  let activeEnum: string | null = null;
  let enumDepth = 0;
  let enumExistedBefore = false;
  const removedUnionLines = new Map<string, string>();

  const updateEnumContext = (body: string, isAdd: boolean, isDel: boolean) => {
    const enumDecl = ENUM_DECL_RE.exec(body);
    if (enumDecl) {
      activeEnum = enumDecl[1]!;
      enumDepth = 0;
      enumExistedBefore = !isAdd;
    }
    for (const ch of body) {
      if (ch === "{") enumDepth += 1;
      else if (ch === "}") enumDepth -= 1;
    }
    if (activeEnum && enumDepth <= 0) {
      activeEnum = null;
      enumExistedBefore = false;
    }
    if (isDel && enumDecl) enumExistedBefore = true;
  };

  for (const raw of patch.split("\n")) {
    const header = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (header) {
      newLine = Number(header[1]);
      activeEnum = null;
      enumDepth = 0;
      enumExistedBefore = false;
      continue;
    }

    const body = raw.startsWith("+") || raw.startsWith("-") ? raw.slice(1) : raw;
    const isAdd = raw.startsWith("+");
    const isDel = raw.startsWith("-");
    const isContext = !isAdd && !isDel && !raw.startsWith("\\");

    updateEnumContext(body, isAdd, isDel);

    const typeMatch = TYPE_UNION_RE.exec(body);
    if (typeMatch && (isAdd || isDel)) {
      const [, name, rhs] = typeMatch;
      if (isDel && name && rhs) removedUnionLines.set(name, rhs);
      if (isAdd && name && rhs) {
        const oldRhs = removedUnionLines.get(name);
        if (!oldRhs) continue;
        const newMembers = new Set(unionRhsMembers(rhs));
        const oldMembers = new Set(unionRhsMembers(oldRhs));
        for (const member of newMembers) {
          if (!oldMembers.has(member)) {
            out.push({ file, line: newLine, unionName: name, addedMember: member });
          }
        }
      }
    }

    if (isAdd && activeEnum && enumDepth > 0 && enumExistedBefore) {
      const member = ENUM_MEMBER_RE.exec(body);
      if (member) {
        out.push({
          file,
          line: newLine,
          unionName: activeEnum,
          addedMember: member[1]!,
        });
      }
    }

    if (isAdd) newLine += 1;
    else if (isContext) newLine += 1;
  }
  return out;
}

/** Enum member identifiers declared in `content` for `enumName`, or null when not found. Pure. */
export function parseEnumMembers(content: string, enumName: string): string[] | null {
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const decl = new RegExp(`^\\s*(?:export\\s+)?enum\\s+${enumName}\\s*\\{`).exec(lines[i]!);
    if (!decl) continue;
    const members: string[] = [];
    let depth = 0;
    for (let j = i; j < lines.length; j++) {
      const line = lines[j]!;
      for (const ch of line) {
        if (ch === "{") depth += 1;
        else if (ch === "}") depth -= 1;
      }
      if (j > i) {
        const member = ENUM_MEMBER_RE.exec(line);
        if (member) members.push(member[1]!);
      }
      if (depth <= 0 && j > i) return members;
    }
    return members.length ? members : null;
  }
  return null;
}

/** Union members for `typeName` in `content`, or null when not found. Pure. */
export function parseUnionTypeMembers(content: string, typeName: string): string[] | null {
  for (const line of content.split("\n")) {
    const match = new RegExp(`^\\s*(?:export\\s+)?type\\s+${typeName}\\s*=\\s*(.+?);?\\s*$`).exec(line);
    if (!match) continue;
    const members = unionRhsMembers(match[1]!);
    return members.length ? members : null;
  }
  return null;
}

/** Case labels extracted from one switch block body. Pure. */
export function extractSwitchCaseLabels(switchBody: string): string[] {
  const labels: string[] = [];
  const caseRe = /\bcase\s+(?:([A-Za-z_$][\w$]*)|['"]([^'"]+)['"])\s*:/g;
  let match: RegExpExecArray | null;
  while ((match = caseRe.exec(switchBody)) !== null) {
    labels.push(match[1] ?? match[2]!);
  }
  return labels;
}

/** When a switch covers >= 2 `siblingMembers` but not `member`, return the switch's line (1-based). Pure. */
export function findSwitchMissingMember(
  content: string,
  member: string,
  siblingMembers: string[],
): number | null {
  const normalizedMember = member.toLowerCase();
  const normalizedSiblings = new Set(siblingMembers.map((s) => s.toLowerCase()));
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!/\bswitch\s*\(/.test(lines[i]!)) continue;
    let depth = 0;
    let started = false;
    let body = "";
    for (let j = i; j < lines.length; j++) {
      const line = lines[j]!;
      for (const ch of line) {
        if (ch === "{") {
          depth += 1;
          started = true;
        } else if (ch === "}") depth -= 1;
      }
      if (started) body += `${line}\n`;
      if (started && depth <= 0) {
        const labels = extractSwitchCaseLabels(body).map((l) => l.toLowerCase());
        const coveredSiblings = labels.filter((l) => normalizedSiblings.has(l)).length;
        const coversMember = labels.includes(normalizedMember);
        if (coveredSiblings >= 2 && !coversMember) return i + 1;
        break;
      }
    }
  }
  return null;
}

function allMembers(content: string, unionName: string): string[] | null {
  return parseEnumMembers(content, unionName) ?? parseUnionTypeMembers(content, unionName);
}

/** Analyzer entrypoint: flag high-confidence exhaustiveness gaps for added enum/union members. Fail-safe. */
export async function scanExhaustivenessDrift(
  req: EnrichRequest,
  fetchFn: typeof fetch = fetch,
  options: ScanOptions = {},
): Promise<ExhaustivenessFinding[]> {
  const { repoFullName, githubToken, headSha, files = [] } = req;
  if (!githubToken || !headSha) return [];
  const headRef = headSha;
  const parts = repoFullName.split("/");
  const [owner, repo] = parts;
  if (parts.length !== 2 || !owner || !repo || !SLUG_RE.test(owner) || !SLUG_RE.test(repo)) return [];

  const maxFiles = options.maxFiles ?? MAX_FILES;
  const maxFetches = options.maxFetches ?? MAX_FETCHES;
  const candidates: AddedMember[] = [];
  for (const file of files) {
    if (!file.patch || !SOURCE_RE.test(file.path) || SKIP_RE.test(file.path)) continue;
    candidates.push(...parseAddedUnionMembersFromPatch(file.patch, file.path));
  }
  if (!candidates.length) return [];

  const headers: Record<string, string> = {
    Authorization: `Bearer ${githubToken}`,
    Accept: "application/vnd.github.raw",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  const sourceFiles = files
    .filter((f) => f.patch && SOURCE_RE.test(f.path) && !SKIP_RE.test(f.path))
    .slice(0, maxFiles);
  const contentByPath = new Map<string, string>();
  let fetches = 0;

  async function fetchFile(path: string): Promise<string | null> {
    const cached = contentByPath.get(path);
    if (cached !== undefined) return cached;
    if (fetches >= maxFetches) return null;
    fetches += 1;
    try {
      const encoded = path.split("/").map(encodeURIComponent).join("/");
      const resp = await fetchFn(
        `${GITHUB_API}/repos/${encodeURIComponent(owner!)}/${encodeURIComponent(repo!)}/contents/${encoded}?ref=${encodeURIComponent(headRef)}`,
        { headers, signal: options.signal },
      );
      if (!resp.ok) return null;
      const text = await readBoundedText(resp, options.signal);
      if (text) contentByPath.set(path, text);
      return text;
    } catch {
      return null;
    }
  }

  const findings: ExhaustivenessFinding[] = [];
  for (const candidate of candidates) {
    if (options.signal?.aborted) break;

    const typeContent = await fetchFile(candidate.file);
    if (!typeContent) continue;
    const members = allMembers(typeContent, candidate.unionName);
    if (!members?.includes(candidate.addedMember)) continue;
    const siblings = members.filter((m) => m !== candidate.addedMember);

    for (const consumer of sourceFiles) {
      if (options.signal?.aborted) break;
      const content = consumer.path === candidate.file ? typeContent : await fetchFile(consumer.path);
      if (!content) continue;
      const switchLine = findSwitchMissingMember(content, candidate.addedMember, siblings);
      if (switchLine === null) continue;
      findings.push({
        file: candidate.file,
        line: candidate.line,
        unionName: candidate.unionName,
        addedMember: candidate.addedMember,
        consumerFile: consumer.path,
      });
      if (findings.length >= MAX_FINDINGS) return findings;
      break;
    }
  }
  return findings;
}
