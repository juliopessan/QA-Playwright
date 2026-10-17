import { existsSync, readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import type { PerfLimits } from "../analyze/performance.js";
import type { ExploreLimits } from "./crawler.js";

export interface ExploreSettings {
  limits: ExploreLimits;
  ignoreUrls: string[];
  extraWriteVerbs: string[];
  postAllowed: string[];
  settleMs?: number;
  ux: boolean;
  perf: PerfLimits;
  repo?: string;
  labels: string[];
}

export interface ExploreOverrides {
  maxScreens?: number;
  maxDepth?: number;
  ux?: boolean;
  settleMs?: number;
  repo?: string;
}

const pos = (v: unknown, fallback: number): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : fallback);
const posInt = (v: unknown, fallback: number): number => (Number.isInteger(v) && (v as number) >= 0 ? (v as number) : fallback);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** Lê as seções `explorar`, `analises` e `publicar` do qa-agent.config.yaml; valores inválidos caem no padrão. */
export function loadExploreConfig(configPath = "qa-agent.config.yaml", overrides: ExploreOverrides = {}): ExploreSettings {
  const raw = (existsSync(configPath) ? parseYaml(readFileSync(configPath, "utf8")) : {}) as Record<string, any> | null;
  const e = (raw?.explorar ?? {}) as Record<string, unknown>;
  const a = (raw?.analises ?? {}) as Record<string, any>;
  const p = (raw?.publicar ?? {}) as Record<string, unknown>;
  const lim = (a.limites ?? {}) as Record<string, unknown>;

  const maxMin = pos(e.tempoMaximoMin, 20);
  return {
    limits: {
      maxScreens: overrides.maxScreens ?? posInt(e.maxTelas, 80),
      maxDepth: overrides.maxDepth ?? posInt(e.maxProfundidade, 4),
      timeBudgetMs: Math.round(maxMin * 60_000),
      examplesPerRoute: Math.max(1, posInt(e.exemplosPorRota, 3)),
    },
    ignoreUrls: strs(e.ignorarUrls),
    extraWriteVerbs: strs(e.verbosEscrita),
    postAllowed: strs(e.postPermitidos),
    settleMs: overrides.settleMs ?? (typeof e.estabilidadeMs === "number" ? e.estabilidadeMs : undefined),
    ux: overrides.ux ?? (typeof a.ux === "boolean" ? a.ux : true),
    perf: { lcpMs: pos(lim.lcpMs, 2500), cls: pos(lim.cls, 0.1), loadMs: pos(lim.carregamentoMs, 5000) },
    repo: overrides.repo ?? (typeof p.repo === "string" ? p.repo : undefined),
    labels: strs(p.rotulos),
  };
}
