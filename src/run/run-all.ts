import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { loadStorageStatePath } from "../auth/index.js";
import { CompileCache } from "../compiler/cache.js";
import type { AppConfig } from "../config/index.js";
import { BudgetedProvider } from "../llm/budget.js";
import type { LLMProvider } from "../llm/provider.js";
import { judgeCase } from "../judge/index.js";
import { readTestCases } from "../reader/index.js";
import { runCase, safeId, type HealFn } from "../runner/run-case.js";
import type { Env } from "../vars/index.js";
import type { CaseVerdict, RunManifest, TestCase } from "../types/index.js";
import { ManifestWriter, newRunId } from "./manifest.js";

export interface RunAllOptions {
  xlsx: string;
  cfg: AppConfig;
  provider: LLMProvider;
  env: Env;
  only?: string;
  headed?: boolean;
  heal?: boolean;
  resume?: string;
  runsDir?: string;
  cacheDir?: string;
  authDir?: string;
  maxLlmCalls?: number;
  /** Fábrica do healer (Task 18). */
  makeHealer?: (ctx: { provider: LLMProvider; cache: CompileCache; cfg: AppConfig; env: Env }) => HealFn;
}

function cliVersion(): string {
  try {
    const p = new URL("../../package.json", import.meta.url);
    return (JSON.parse(readFileSync(p, "utf8")) as { version: string }).version;
  } catch {
    return "0.0.0";
  }
}

function gitCommit(): string | undefined {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return undefined;
  }
}

const blockedVerdict = (tc: TestCase, reason: string): CaseVerdict => ({
  caseId: tc.id,
  title: tc.title,
  status: "blocked",
  reasoning: reason,
  evidenceRefs: [],
  steps: [],
});

export async function runAll(opts: RunAllOptions): Promise<RunManifest> {
  const { cfg } = opts;
  const { cases: all, issues } = await readTestCases(opts.xlsx, cfg);
  const cases = opts.only ? all.filter((c) => c.id === opts.only) : all;

  const runsDir = opts.runsDir ?? "runs";
  const provider = new BudgetedProvider(opts.provider, opts.maxLlmCalls ?? Number.POSITIVE_INFINITY);

  let writer: ManifestWriter;
  if (opts.resume) {
    writer = await ManifestWriter.resume(join(runsDir, opts.resume)).catch(() => {
      throw new Error(`run não encontrado: ${opts.resume}`);
    });
  } else {
    const runId = newRunId();
    writer = new ManifestWriter(join(runsDir, runId), {
      runId,
      startedAt: new Date().toISOString(),
      env: cfg.env,
      cliVersion: cliVersion(),
      model: opts.provider.id,
      commit: gitCommit(),
      issues,
    });
  }
  const runDir = writer.runDir;
  const done = new Set(writer.manifest.verdicts.map((v) => v.caseId));
  const cache = new CompileCache(opts.cacheDir ?? ".qa-cache");
  const heal =
    opts.heal !== false && opts.makeHealer
      ? opts.makeHealer({ provider, cache, cfg, env: opts.env })
      : undefined;

  const todo = cases.filter((c) => !done.has(c.id));
  const needsBrowser = todo.some((c) => !c.readError);
  const browser = needsBrowser ? await chromium.launch({ headless: !opts.headed }) : undefined;

  try {
    for (const tc of todo) {
      if (tc.readError || !browser) {
        await writer.append(blockedVerdict(tc, `Passo(s) malformado(s) no Excel: ${tc.readError}`));
        continue;
      }
      const storageState = loadStorageStatePath(opts.authDir);
      const context = await browser.newContext(storageState ? { storageState } : {});
      try {
        const page = await context.newPage();
        const result = await runCase(tc, {
          page,
          provider,
          cache,
          cfg,
          env: opts.env,
          evidenceDir: join(runDir, "evidence"),
          heal,
        });
        const verdict = await judgeCase(tc, result, { provider, cfg, runDir });
        writer.setUsage(provider.usage);
        await writer.append(verdict);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser?.close();
  }
  writer.setUsage(provider.usage);
  return writer.finish();
}

export { safeId };
