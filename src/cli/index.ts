import { existsSync, readFileSync, realpathSync } from "node:fs";
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

export const PROGRAM_NAME = "qa-agent";

export interface CliIO {
  out: (s: string) => void;
  err: (s: string) => void;
  env: Record<string, string | undefined>;
  /** Provedor de LLM injetável (testes); padrão: AnthropicProvider. */
  provider?: LLMProvider;
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
  dryRun?: boolean;
}

class UsageError extends Error {}

function loadEnv(io: CliIO, envFile: string): Record<string, string | undefined> {
  if (!existsSync(envFile)) return io.env;
  return { ...parseEnv(readFileSync(envFile, "utf8")), ...io.env };
}

async function runCommand(xlsx: string, opts: RunOptions, io: CliIO): Promise<number> {
  if (!existsSync(xlsx)) throw new UsageError(`arquivo não encontrado: ${xlsx}`);
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

  try {
    await program.parseAsync(argv, { from: "user" });
    return code;
  } catch (e) {
    if (e instanceof CommanderError) return e.exitCode === 0 ? 0 : 2;
    if (e instanceof UsageError || e instanceof Error) {
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
