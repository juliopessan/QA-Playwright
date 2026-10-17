import { createHash } from "node:crypto";
import type { Category, Finding, Severity } from "./types.js";

const RANK: Record<Severity, number> = { low: 0, medium: 1, high: 2, critical: 3 };
export const severityRank = (s: Severity): number => RANK[s];
export const maxSeverity = (a: Severity, b: Severity): Severity => (RANK[a] >= RANK[b] ? a : b);

/** Normaliza a regra para o id não mudar com dados variáveis (números, UUIDs, espaços). */
function normalizeRule(rule: string): string {
  return rule
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, ":n")
    .replace(/\d+/g, ":n")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

export interface FindingInput {
  category: Category;
  severity: Severity;
  origin: "measured" | "agent";
  title: string;
  description: string;
  rule: string;
  scope: "screen" | "global";
  screenId: string;
  state?: string;
  evidence?: string[];
  reproduction?: string[];
  suggestion?: string;
  confidence?: number;
}

export function makeFinding(i: FindingInput): Finding {
  const key = `${i.category}|${i.scope === "global" ? "*" : i.screenId}|${normalizeRule(i.rule)}`;
  return {
    id: createHash("sha1").update(key).digest("hex").slice(0, 10),
    category: i.category,
    severity: i.severity,
    origin: i.origin,
    title: i.title,
    description: i.description,
    rule: normalizeRule(i.rule),
    scope: i.scope,
    screenIds: [i.screenId],
    ...(i.state ? { state: i.state } : {}),
    evidence: i.evidence ?? [],
    reproduction: i.reproduction ?? [],
    ...(i.suggestion ? { suggestion: i.suggestion } : {}),
    ...(i.confidence !== undefined ? { confidence: i.confidence } : {}),
  };
}

const MAX_EVIDENCE = 6;

/** Une achados com o mesmo id: telas somadas, evidências concatenadas (limitadas), maior gravidade. */
export function dedupeFindings(fs: Finding[]): Finding[] {
  const out = new Map<string, Finding>();
  for (const f of fs) {
    const cur = out.get(f.id);
    if (!cur) {
      out.set(f.id, { ...f, screenIds: [...f.screenIds], evidence: [...f.evidence] });
      continue;
    }
    for (const s of f.screenIds) if (!cur.screenIds.includes(s)) cur.screenIds.push(s);
    for (const e of f.evidence) if (cur.evidence.length < MAX_EVIDENCE && !cur.evidence.includes(e)) cur.evidence.push(e);
    cur.severity = maxSeverity(cur.severity, f.severity);
  }
  return [...out.values()];
}

export function compareRuns(
  prev: Finding[] | undefined,
  curr: Finding[],
): { new: Finding[]; persistent: Finding[]; resolved: Finding[] } {
  const before = new Map((prev ?? []).map((f) => [f.id, f]));
  const now = new Map(curr.map((f) => [f.id, f]));
  return {
    new: curr.filter((f) => !before.has(f.id)),
    persistent: curr.filter((f) => before.has(f.id)),
    resolved: (prev ?? []).filter((f) => !now.has(f.id)),
  };
}
