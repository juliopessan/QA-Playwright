import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { loadExploreConfig } from "../explore/config.js";
import { GitHubAuthError, HttpGitHubClient, type GitHubClient } from "../publish/github.js";
import { openIssues } from "../publish/issues.js";
import { PublishError, publishRun } from "../publish/publish.js";
import { UsageError } from "./explore.js";
import type { CliIO } from "./index.js";

export interface PublishCliOptions {
  repo?: string;
  base?: string;
  outDir: string;
  config?: string;
  envFile: string;
  pr?: boolean;
}

const REPO_RE = /^[\w.-]+\/[\w.-]+$/;
const RUN_RE = /^[\w.-]+$/;

function setup(runId: string, opts: PublishCliOptions, io: CliIO) {
  if (!RUN_RE.test(runId)) throw new UsageError(`runId inválido: ${runId}`);
  const runDir = join(opts.outDir, runId);
  if (!existsSync(join(runDir, "README.md"))) throw new UsageError(`run não encontrado: ${runDir}`);
  const cfg = loadExploreConfig(opts.config, { repo: opts.repo });
  const repo = cfg.repo;
  if (!repo) throw new UsageError("informe --repo dono/nome ou defina publicar.repo no qa-agent.config.yaml");
  if (!REPO_RE.test(repo)) throw new UsageError(`repositório inválido: ${repo} (use dono/nome)`);
  const env = existsSync(opts.envFile) ? { ...parseEnv(readFileSync(opts.envFile, "utf8")), ...io.env } : io.env;
  let client: GitHubClient;
  try {
    if (!io.github && !env.GITHUB_TOKEN) throw new GitHubAuthError("GITHUB_TOKEN não definido: exporte um token com permissão de escrita no repositório (nunca o grave em arquivo).");
    client = io.github ?? new HttpGitHubClient({ token: env.GITHUB_TOKEN });
  } catch (e) {
    if (e instanceof GitHubAuthError) throw new UsageError(e.message);
    throw e;
  }
  return { runDir, repo, cfg, env, client };
}

const wrap = (e: unknown): never => {
  if (e instanceof PublishError || e instanceof GitHubAuthError) throw new UsageError(e.message);
  throw e;
};

export async function publishCommand(runId: string, opts: PublishCliOptions, io: CliIO): Promise<number> {
  const { runDir, repo, env, client } = setup(runId, opts, io);
  const secrets = Object.entries(env)
    .filter(([k, v]) => /PASS|SECRET|TOKEN|KEY|PWD/i.test(k) && v)
    .map(([, v]) => v as string);
  try {
    const r = await publishRun({ client, repo, runDir, runId, base: opts.base, secrets });
    io.out(`PR aberto: ${r.pr.url} (branch ${r.branch}, ${r.files} arquivos). Não faça merge: o PR serve para revisão.`);
    io.out(`Marque [x] nos achados de achados.md e rode: qa-agent issues ${runId} --repo ${repo}`);
    return 0;
  } catch (e) {
    return wrap(e);
  }
}

export async function issuesCommand(runId: string, opts: PublishCliOptions, io: CliIO): Promise<number> {
  const { runDir, repo, cfg, client } = setup(runId, opts, io);
  try {
    const r = await openIssues({ client, repo, runDir, runId, labels: cfg.labels });
    for (const c of r.created) io.out(`Issue criada: ${c.url} (achado ${c.id})`);
    for (const d of r.duplicates) io.out(`Já existe a issue #${d.number} para o achado ${d.id}: não duplicada`);
    for (const u of r.unknown) io.err(`Achado ${u} marcado no achados.md mas ausente em dados/achados.json: ignorado`);
    if (!r.created.length && !r.duplicates.length && !r.unknown.length) io.out("Nenhum achado marcado com [x] em achados.md: nada a abrir.");
    return 0;
  } catch (e) {
    return wrap(e);
  }
}
