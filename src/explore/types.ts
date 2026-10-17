export type Severity = "critical" | "high" | "medium" | "low";
export type Category = "technical" | "accessibility" | "performance" | "ux" | "coverage";

export interface Finding {
  /** Hash estável: o mesmo problema mantém o id entre execuções. */
  id: string;
  category: Category;
  severity: Severity;
  /** `measured`: coletado objetivamente; `agent`: opinião do LLM. */
  origin: "measured" | "agent";
  title: string;
  description: string;
  /** Regra normalizada que originou o achado (base do id). */
  rule: string;
  scope: "screen" | "global";
  screenIds: string[];
  state?: string;
  evidence: string[];
  reproduction: string[];
  suggestion?: string;
  confidence?: number;
  /** Número da issue no GitHub, preenchido por `qa-agent issues`. */
  issue?: number;
}

export interface ScreenState {
  label: string;
  screenshot: string;
}

export interface Screen {
  id: string;
  routePattern: string;
  title: string;
  heading: string;
  exampleUrls: string[];
  /** Caminho de navegação desde a home (rótulos dos links clicados). */
  path: string[];
  screenshot?: string;
  states: ScreenState[];
}

export interface BlockedAttempt {
  layer: "element" | "network";
  reason: string;
  url?: string;
  method?: string;
  element?: string;
  screenId?: string;
}

export interface ExploreResult {
  runId: string;
  baseUrl: string;
  startedAt: string;
  finishedAt?: string;
  screens: Screen[];
  edges: Array<[string, string]>;
  findings: Finding[];
  blocked: BlockedAttempt[];
  /** Limites que interromperam a exploração (ex.: "maxTelas"). */
  limitsHit: string[];
  skipped: Array<{ url: string; reason: string }>;
  llm: { calls: number; inputTokens: number; outputTokens: number; notes: string[] };
}
