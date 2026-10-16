import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { Command, CommanderError } from "commander";
import { loadConfig } from "../config/index.js";
import { readTestCases } from "../reader/index.js";
import { assertVars } from "../vars/index.js";

export const PROGRAM_NAME = "qa-agent";

export interface CliIO {
  out: (s: string) => void;
  err: (s: string) => void;
  env: Record<string, string | undefined>;
}

export interface RunOptions {
  only?: string;
  baseUrl?: string;
  heal: boolean;
  headed?: boolean;
  resume?: string;
  maxLlmCalls?: string;
  envFile: string;
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
  throw new UsageError("execução ainda não disponível (use --dry-run)");
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
    .option("--dry-run", "só lê e valida os casos")
    .action(async (xlsx: string, opts: RunOptions) => {
      code = await runCommand(xlsx, opts, io);
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

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2), {
    out: (s) => console.log(s),
    err: (s) => console.error(s),
    env: process.env,
  }).then((c) => process.exit(c));
}
