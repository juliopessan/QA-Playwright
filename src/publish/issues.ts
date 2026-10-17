import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseApprovals } from "../docs/approvals.js";
import type { Finding } from "../explore/types.js";
import type { GitHubClient } from "./github.js";
import { PublishError, reportRepoPath } from "./publish.js";

export const issueMarker = (id: string) => `<!-- qa-agent:finding:${id} -->`;
const SEV_LABEL: Record<Finding["severity"], string> = { critical: "CRÍTICA", high: "ALTA", medium: "MÉDIA", low: "BAIXA" };

export function issueBody(f: Finding, ctx: { repo: string; branch: string; runId: string; prUrl?: string }): string {
  const base = `https://github.com/${ctx.repo}/blob/${ctx.branch}/${reportRepoPath(ctx.runId)}`;
  const L = [issueMarker(f.id), "", `**Gravidade:** ${SEV_LABEL[f.severity]} · **Categoria:** ${f.category}${f.origin === "agent" ? " · _opinião do agente_" : ""}`, "", f.description, ""];
  if (f.reproduction.length) L.push("**Como reproduzir**", "", ...f.reproduction.map((p, i) => `${i + 1}. ${p}`), "");
  if (f.evidence.length) L.push("**Evidências**", "", ...f.evidence.map((e) => `- ${e.replace(/\s+/g, " ")}`), "");
  if (f.suggestion) L.push(`**Sugestão:** ${f.suggestion}`, "");
  L.push(`**Telas afetadas:** ${f.screenIds.map((s) => `[${s}](${base}/telas/${s}.md#${f.id})`).join(", ")}`, "");
  if (ctx.prUrl) L.push(`Relatório de QA: ${ctx.prUrl}`);
  L.push(`\`id: ${f.id}\` · run \`${ctx.runId}\``);
  return L.join("\n");
}

export interface OpenIssuesOptions {
  client: GitHubClient;
  repo: string;
  runDir: string;
  runId: string;
  labels?: string[];
  /** Branch com o `achados.md` aprovado (padrão: `qa/<runId>`). */
  branch?: string;
}

export interface OpenIssuesResult {
  created: Array<{ id: string; number: number; url: string }>;
  duplicates: Array<{ id: string; number: number }>;
  unknown: string[];
}

/** Abre uma issue por achado marcado `[x]` em `achados.md` (lido da branch do PR), sem duplicar por id. */
export async function openIssues(o: OpenIssuesOptions): Promise<OpenIssuesResult> {
  const branch = o.branch ?? `qa/${o.runId}`;
  const root = reportRepoPath(o.runId);
  const achadosMd = await o.client.getFile({ repo: o.repo, ref: branch, path: `${root}/achados.md` });
  if (achadosMd === undefined) throw new PublishError(`achados.md não encontrado na branch ${branch} de ${o.repo}. Rode primeiro \`qa-agent publish ${o.runId} --pr\`.`);
  const approved = parseApprovals(achadosMd);

  const localJson = join(o.runDir, "dados", "achados.json");
  let findings: Finding[];
  if (existsSync(localJson)) findings = JSON.parse(readFileSync(localJson, "utf8")) as Finding[];
  else {
    const remote = await o.client.getFile({ repo: o.repo, ref: branch, path: `${root}/dados/achados.json` });
    if (remote === undefined) throw new PublishError("dados/achados.json não encontrado (local nem na branch).");
    findings = JSON.parse(remote) as Finding[];
  }
  const byId = new Map(findings.map((f) => [f.id, f]));

  const result: OpenIssuesResult = { created: [], duplicates: [], unknown: [] };
  if (approved.length === 0) return result;
  const open = await o.client.listOpenIssues({ repo: o.repo });
  for (const id of approved) {
    const f = byId.get(id);
    if (!f) {
      result.unknown.push(id);
      continue;
    }
    const existing = open.find((i) => i.body.includes(issueMarker(id)));
    if (existing) {
      result.duplicates.push({ id, number: existing.number });
      f.issue = existing.number;
      continue;
    }
    const issue = await o.client.createIssue({
      repo: o.repo,
      title: `[QA][${SEV_LABEL[f.severity]}] ${f.title}`.slice(0, 250),
      body: issueBody(f, { repo: o.repo, branch, runId: o.runId }),
      labels: [...(o.labels ?? []), `severidade:${f.severity}`],
    });
    result.created.push({ id, number: issue.number, url: issue.url });
    f.issue = issue.number;
  }
  mkdirSync(join(o.runDir, "dados"), { recursive: true });
  writeFileSync(localJson, JSON.stringify(findings, null, 2), "utf8");
  return result;
}
