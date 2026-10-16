import type { Action } from "./actions.js";
export * from "./actions.js";

export type StepStatus = "pass" | "fail" | "healed" | "skipped";
export type CaseStatus = "pass" | "fail" | "needs-review" | "blocked";

export interface Step {
  index: number;
  text: string;
  data?: string;
  expected?: string;
}

export interface TestCase {
  id: string;
  title: string;
  steps: Step[];
  expected?: string;
  /** Preenchido pelo Reader quando uma linha do caso é malformada; o caso vira `blocked`. */
  readError?: string;
}

export interface CompiledStep {
  stepIndex: number;
  kind: "action" | "verification";
  actions: Action[];
  confidence: number;
  subjective: boolean;
  fromCache: boolean;
}

export interface HealRecord {
  /** Descrição da ação que falhou. */
  from: string;
  /** Descrições das ações que a substituíram. */
  to: string[];
  note: string;
}

export interface StepResult {
  stepIndex: number;
  /** Texto original do passo no Excel. */
  text?: string;
  expected?: string;
  /** Descrições legíveis das ações executadas (já sem segredos). */
  actions?: string[];
  heals?: HealRecord[];
  status: StepStatus;
  screenshotBefore?: string;
  screenshotAfter?: string;
  durationMs: number;
  error?: string;
  healNote?: string;
  observed?: string;
}

export interface CaseVerdict {
  caseId: string;
  title: string;
  status: CaseStatus;
  reasoning: string;
  evidenceRefs: string[];
  steps: StepResult[];
}

export interface ReadIssue {
  row: number;
  caseId?: string;
  message: string;
}

export interface Usage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

export interface RunManifest {
  runId: string;
  startedAt: string;
  finishedAt?: string;
  env: string;
  cliVersion: string;
  model: string;
  commit?: string;
  usage: Usage;
  verdicts: CaseVerdict[];
  issues: ReadIssue[];
  aborted?: string;
}
