import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { GitHubClient, RepoFile } from "./github.js";

export class PublishError extends Error {}

const TEXT_EXT = /\.(md|json|txt|html|css|yaml|yml)$/i;
const MAX_BODY = 60_000;
/** Padrões de segredo que nunca podem subir para um repositório. */
const SECRET_PATTERNS = [/sk-ant-[A-Za-z0-9_-]{10,}/, /ghp_[A-Za-z0-9]{20,}/, /github_pat_[A-Za-z0-9_]{20,}/];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

export const reportRepoPath = (runId: string) => `qa-report/${runId}`;

export interface PublishOptions {
  client: GitHubClient;
  repo: string;
  runDir: string;
  runId: string;
  base?: string;
  /** Valores secretos do ambiente (senhas, tokens) que não podem aparecer nos arquivos publicados. */
  secrets?: string[];
}

/** Cria a branch `qa/<runId>` com a pasta do relatório e abre o PR com o README como corpo. Nunca faz merge. */
export async function publishRun(o: PublishOptions): Promise<{ branch: string; pr: { number: number; url: string }; files: number }> {
  if (!existsSync(join(o.runDir, "README.md"))) throw new PublishError(`pasta do run inválida: ${o.runDir} (sem README.md)`);
  const files: RepoFile[] = [];
  const secrets = (o.secrets ?? []).filter((s) => s.length >= 6);
  for (const abs of walk(o.runDir)) {
    const rel = relative(o.runDir, abs).split(sep).join("/");
    const content = readFileSync(abs);
    if (TEXT_EXT.test(rel)) {
      const text = content.toString("utf8");
      const hit = SECRET_PATTERNS.some((re) => re.test(text)) || secrets.some((s) => text.includes(s));
      if (hit) throw new PublishError(`publicação abortada: ${rel} contém algo que parece um segredo. Nada foi enviado.`);
    }
    files.push({ path: `${reportRepoPath(o.runId)}/${rel}`, content });
  }
  const branch = `qa/${o.runId}`;
  await o.client.createBranchWithFiles({ repo: o.repo, branch, base: o.base, message: `QA Agent: relatório ${o.runId}`, files });

  const readme = readFileSync(join(o.runDir, "README.md"), "utf8");
  const footer = [
    "",
    "---",
    `Pasta do relatório: \`${reportRepoPath(o.runId)}/\`. **Este PR serve para revisão: não faça merge.**`,
    "Para abrir issues, marque `[x]` nos achados de `achados.md` (neste PR) e rode `qa-agent issues " + o.runId + "`.",
  ].join("\n");
  const body = (readme.length > MAX_BODY ? readme.slice(0, MAX_BODY) + "\n\n_(resumo truncado; veja README.md na branch)_" : readme) + footer;
  const pr = await o.client.createPR({ repo: o.repo, head: branch, base: o.base, title: `QA Agent: relatório ${o.runId}`, body });
  return { branch, pr, files: files.length };
}
