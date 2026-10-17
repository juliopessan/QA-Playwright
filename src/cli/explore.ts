import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { loadStorageStatePath } from "../auth/index.js";
import { writeDocs } from "../docs/markdown.js";
import { loadExploreConfig } from "../explore/config.js";
import { explore } from "../explore/crawler.js";
import { newRunId } from "../run/manifest.js";
import type { Finding } from "../explore/types.js";
import type { CliIO } from "./index.js";

export interface ExploreCliOptions {
  outDir: string;
  maxTelas?: string;
  estabilidadeMs?: string;
  ux: boolean;
  config?: string;
  envFile: string;
  headed?: boolean;
}

export class UsageError extends Error {}

/** Achados do run mais recente anterior a `currentRunId` na pasta de relatórios. */
export function findPreviousFindings(outBase: string, currentRunId: string): Finding[] | undefined {
  if (!existsSync(outBase)) return undefined;
  const runs = readdirSync(outBase)
    .filter((d) => d < currentRunId && existsSync(join(outBase, d, "dados", "achados.json")))
    .sort();
  const last = runs.at(-1);
  if (!last) return undefined;
  try {
    return JSON.parse(readFileSync(join(outBase, last, "dados", "achados.json"), "utf8")) as Finding[];
  } catch {
    return undefined;
  }
}

const posIntOpt = (v: string | undefined, name: string): number | undefined => {
  if (v === undefined) return undefined;
  if (!/^\d+$/.test(v)) throw new UsageError(`${name} deve ser um inteiro não negativo`);
  return Number(v);
};

export async function exploreCommand(url: string, opts: ExploreCliOptions, io: CliIO): Promise<number> {
  try {
    new URL(url);
  } catch {
    throw new UsageError(`URL inválida: ${url}`);
  }
  const env = existsSync(opts.envFile) ? { ...parseEnv(readFileSync(opts.envFile, "utf8")), ...io.env } : io.env;
  const storageState = loadStorageStatePath();
  if (!env.APP_USER && !env.APP_PASS && !storageState) {
    throw new UsageError("informe APP_USER e APP_PASS (no .env ou no ambiente) ou salve uma sessão com `qa-agent login`");
  }
  const cfg = loadExploreConfig(opts.config, {
    maxScreens: posIntOpt(opts.maxTelas, "--max-telas"),
    settleMs: posIntOpt(opts.estabilidadeMs, "--estabilidade-ms"),
    ux: opts.ux ? undefined : false,
  });

  const runId = newRunId();
  const runDir = join(opts.outDir, runId);
  mkdirSync(runDir, { recursive: true });
  const previous = findPreviousFindings(opts.outDir, runId);

  let result;
  try {
    result = await explore({
      baseUrl: url,
      user: env.APP_USER ?? "",
      pass: env.APP_PASS ?? "",
      storageState: env.APP_USER ? undefined : storageState,
      outDir: runDir,
      runId,
      limits: cfg.limits,
      ignoreUrls: cfg.ignoreUrls,
      extraWriteVerbs: cfg.extraWriteVerbs,
      postAllowed: cfg.postAllowed,
      perf: cfg.perf,
      settleMs: cfg.settleMs,
      headed: opts.headed,
    });
  } catch (e) {
    const msg = (e as Error).message.split("\n")[0];
    throw new UsageError(msg.startsWith("Login falhou") ? msg : `exploração falhou: ${msg}`);
  }

  writeDocs(result, runDir, { previous });
  const by = (s: string) => result.findings.filter((f) => f.severity === s).length;
  io.out(
    `Run ${runId}: ${result.screens.length} telas, ${result.findings.length} achados ` +
      `(${by("critical")} críticos, ${by("high")} altos, ${by("medium")} médios, ${by("low")} baixos), ${result.blocked.length} ações bloqueadas`,
  );
  io.out(`Documentação: ${join(runDir, "README.md")}`);
  if (result.limitsHit.includes("sessaoExpirada")) {
    io.err("Sessão expirada durante a exploração: o relatório é parcial. Rode `qa-agent login` e tente de novo.");
    return 3;
  }
  if (result.limitsHit.length) io.out(`Limites atingidos: ${result.limitsHit.join(", ")}`);
  return 0;
}
