import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { Command, CommanderError } from "commander";
import { loadConfig } from "../config/index.js";
import { readTestCases } from "../reader/index.js";
import { assertVars } from "../vars/index.js";
import { interactiveLogin } from "../auth/index.js";
import type { LLMProvider } from "../llm/provider.js";
import { AnthropicProvider } from "../llm/anthropic.js";
import { runAll } from "../run/run-all.js";
import { issuesCommand, publishCommand, type PublishCliOptions } from "./publish.js";
import { exploreCommand, UsageError as ExploreUsageError, type ExploreCliOptions } from "./explore.js";
import { writeReport } from "../reporter/write.js";
import type { EvidenceMode } from "../reporter/render.js";

export const PROGRAM_NAME = "qa-agent";

export interface CliIO {
  out: (s: string) => void;
  err: (s: string) => void;
  env: Record<string, string | undefined>;
  /** Provedor de LLM injetável (testes); padrão: AnthropicProvider. */
  provider?: LLMProvider;
  /** Cliente do GitHub injetável (testes); padrão: HttpGitHubClient com GITHUB_TOKEN. */
  github?: import("../publish/github.js").GitHubClient;
  runsDir?: string;
}

export interface RunOptions {
  only?: string;
  baseUrl?: string;
  heal: boolean;
  headed?: boolean;
  resume?: string;
  maxLlmCalls?: string;
  envFile: string;
  config?: string;
  evidence: EvidenceMode;
  dryRun?: boolean;
}

class UsageError extends Error {}

function loadEnv(io: CliIO, envFile: string): Record<string, string | undefined> {
  if (!existsSync(envFile)) return io.env;
  return { ...parseEnv(readFileSync(envFile, "utf8")), ...io.env };
}

async function runCommand(xlsx: string, opts: RunOptions, io: CliIO): Promise<number> {
  if (!existsSync(xlsx)) throw new UsageError(`arquivo não encontrado: ${xlsx}`);
  if (opts.maxLlmCalls !== undefined && !/^[1-9]\d*$/.test(opts.maxLlmCalls)) {
    throw new UsageError("--max-llm-calls deve ser um inteiro positivo");
  }
  const env = loadEnv(io, opts.envFile);
  const cfg = await loadConfig({
    configPath: opts.config,
    excelPath: xlsx,
    overrides: opts.baseUrl ? { baseUrl: opts.baseUrl } : {},
  });
  const { cases: all, issues } = await readTestCases(xlsx, cfg);
  const cases = opts.only ? all.filter((c) => c.id === opts.only) : all;
  if (opts.only && cases.length === 0) throw new UsageError(`caso não encontrado: ${opts.only}`);
  assertVars(cfg.requiredVars, env);

  const steps = cases.reduce((n, c) => n + c.steps.length, 0);
  io.out(`${cases.length} casos, ${steps} passos`);
  for (const i of issues) io.err(`linha ${i.row}${i.caseId ? ` (${i.caseId})` : ""}: ${i.message}`);
  if (issues.length) return 2;
  if (opts.dryRun) return 0;
  if (cases.length === 0) throw new UsageError("nenhum caso para executar");

  const provider = io.provider ?? new AnthropicProvider({ apiKey: env.ANTHROPIC_API_KEY });
  const manifest = await runAll({
    xlsx,
    cfg,
    provider,
    env,
    only: opts.only,
    headed: opts.headed,
    heal: opts.heal,
    resume: opts.resume,
    runsDir: io.runsDir,
    maxLlmCalls: opts.maxLlmCalls ? Number(opts.maxLlmCalls) : undefined,
  });
  const runDir = join(io.runsDir ?? "runs", manifest.runId);
  const report = await writeReport(runDir, { mode: opts.evidence });
  io.out(`Relatório: ${report}`);
  if (manifest.aborted) {
    io.err(`${manifest.aborted} (run ${manifest.runId})`);
    return 3;
  }
  const count = (s: string) => manifest.verdicts.filter((v) => v.status === s).length;
  io.out(
    `Run ${manifest.runId}: ${count("pass")} aprovado(s), ${count("fail")} reprovado(s), ` +
      `${count("needs-review")} para revisão, ${count("blocked")} bloqueado(s)`,
  );
  return count("fail") + count("blocked") > 0 ? 1 : 0;
}

export async function main(argv: string[], io: CliIO): Promise<number> {
  let code = 0;
  const program = new Command(PROGRAM_NAME)
    .exitOverride()
    .configureOutput({ writeOut: (s) => io.out(s.trimEnd()), writeErr: (s) => io.err(s.trimEnd()) });

  program
    .command("run <xlsx>")
    .description("Executa os casos de teste de um Excel")
    .option("--only <id>", "executa apenas o caso indicado")
    .option("--base-url <url>", "sobrescreve a url_base da aba Config")
    .option("--no-heal", "desativa a autocorreção")
    .option("--headed", "abre o navegador visível")
    .option("--resume <runId>", "retoma um run interrompido")
    .option("--max-llm-calls <n>", "teto de chamadas ao LLM")
    .option("--env-file <path>", "arquivo .env com as variáveis", ".env")
    .option("--config <path>", "arquivo de configuração yaml", undefined)
    .option("--evidence <modo>", "relatório: embedded (padrão) ou linked", "embedded")
    .option("--dry-run", "só lê e valida os casos")
    .action(async (xlsx: string, opts: RunOptions) => {
      code = await runCommand(xlsx, opts, io);
    });

  program
    .command("login")
    .description("Abre o navegador para o login SSO e salva a sessão em .qa-auth/")
    .option("--base-url <url>", "URL do sistema (padrão: baseUrl do qa-agent.config.yaml)")
    .action(async (opts: { baseUrl?: string }) => {
      const cfg = await loadConfig({ overrides: opts.baseUrl ? { baseUrl: opts.baseUrl } : {} });
      if (!cfg.baseUrl) throw new UsageError("informe --base-url ou defina baseUrl no qa-agent.config.yaml");
      const file = await interactiveLogin(cfg.baseUrl);
      io.out(`Sessão salva em ${file}`);
    });

  program
    .command("explore <url>")
    .description("Explora um SaaS (somente leitura), analisa cada tela e gera a documentação para revisão")
    .option("--out-dir <dir>", "pasta dos relatórios", "qa-report")
    .option("--max-telas <n>", "número máximo de telas")
    .option("--estabilidade-ms <n>", "tempo sem mudanças no DOM para considerar a tela estável")
    .option("--sem-ux", "desliga a análise de UX pelo LLM")
    .option("--objetivos <arquivo>", "objetivos.md com fluxos de negócio a executar (escrita permitida)")
    .option("--max-llm-calls <n>", "orçamento de chamadas ao LLM na exploração")
    .option("--config <path>", "arquivo de configuração yaml")
    .option("--env-file <path>", "arquivo .env com APP_USER, APP_PASS e ANTHROPIC_API_KEY", ".env")
    .option("--headed", "abre o navegador visível")
    .action(async (url: string, opts: ExploreCliOptions & { semUx?: boolean }) => {
      code = await exploreCommand(url, { ...opts, ux: !opts.semUx }, io);
    });

  program
    .command("publish <runId>")
    .description("Publica o relatório de QA em uma branch qa/<runId> e abre o PR para revisão (não faz merge)")
    .requiredOption("--pr", "cria a branch e o pull request")
    .option("--repo <dono/nome>", "repositório de destino (padrão: publicar.repo do config)")
    .option("--base <branch>", "branch base do PR (padrão: a padrão do repositório)")
    .option("--out-dir <dir>", "pasta dos relatórios", "qa-report")
    .option("--config <path>", "arquivo de configuração yaml")
    .option("--env-file <path>", "arquivo .env", ".env")
    .action(async (runId: string, opts: PublishCliOptions) => {
      code = await publishCommand(runId, opts, io);
    });

  program
    .command("issues <runId>")
    .description("Abre issues para os achados marcados [x] em achados.md no PR (sem duplicar)")
    .option("--repo <dono/nome>", "repositório de destino (padrão: publicar.repo do config)")
    .option("--out-dir <dir>", "pasta dos relatórios", "qa-report")
    .option("--config <path>", "arquivo de configuração yaml")
    .option("--env-file <path>", "arquivo .env", ".env")
    .action(async (runId: string, opts: PublishCliOptions) => {
      code = await issuesCommand(runId, opts, io);
    });

  program
    .command("report")
    .description("Gera/reabre o relatório HTML do último run (ou do indicado)")
    .option("--run <runId>", "run a usar (padrão: o mais recente)")
    .option("--evidence <modo>", "embedded (padrão) ou linked", "embedded")
    .action(async (opts: { run?: string; evidence: EvidenceMode }) => {
      const runsDir = io.runsDir ?? "runs";
      const id = opts.run ?? (existsSync(runsDir) ? readdirSync(runsDir).filter((d) => existsSync(join(runsDir, d, "manifest.json"))).sort().at(-1) : undefined);
      if (!id || !existsSync(join(runsDir, id, "manifest.json"))) throw new UsageError(`run não encontrado: ${opts.run ?? "(nenhum run em " + runsDir + ")"}`);
      io.out(await writeReport(join(runsDir, id), { mode: opts.evidence }));
    });

  try {
    await program.parseAsync(argv, { from: "user" });
    return code;
  } catch (e) {
    if (e instanceof CommanderError) return e.exitCode === 0 ? 0 : 2;
    if (e instanceof UsageError || e instanceof ExploreUsageError || e instanceof Error) {
      io.err(e.message);
      return 2;
    }
    throw e;
  }
}

const entry = process.argv[1] ? realpathSync(process.argv[1]) : "";
if (entry === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2), {
    out: (s) => console.log(s),
    err: (s) => console.error(s),
    env: process.env,
  }).then((c) => process.exit(c));
}
