import { existsSync, readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { parse as parseYaml } from "yaml";

export interface AppConfig {
  columns: { id: string; title: string; stepNo: string; step: string; data: string; expected: string };
  env: string;
  baseUrl: string;
  stepTimeoutMs: number;
  maskSelectors: string[];
  allowedHosts: string[];
  requiredVars: string[];
  minConfidence: number;
  maxHealAttempts: number;
  redactPatterns: string[];
  /** Regex (fonte) da URL de login/SSO; quando definida, ativa a detecção de sessão expirada. */
  loginUrlPattern?: string;
}

export interface LoadConfigOptions {
  configPath?: string;
  excelPath?: string;
  overrides?: Partial<AppConfig>;
}

const DEFAULTS: AppConfig = {
  columns: {
    id: "ID",
    title: "Título",
    stepNo: "Passo nº",
    step: "Passo",
    data: "Dados",
    expected: "Resultado esperado",
  },
  env: "default",
  baseUrl: "",
  stepTimeoutMs: 15000,
  maskSelectors: [],
  allowedHosts: [],
  requiredVars: [],
  minConfidence: 0.6,
  maxHealAttempts: 2,
  redactPatterns: [],
};

const splitList = (v: string, sep: RegExp) =>
  v.split(sep).map((s) => s.trim()).filter(Boolean);

/** Lê a aba "Config" (Parâmetro | Valor | Descrição) para um objeto parcial de AppConfig. */
async function readConfigSheet(excelPath: string): Promise<Partial<AppConfig>> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(excelPath);
  const ws = wb.getWorksheet("Config");
  if (!ws) return {};
  const raw: Record<string, string> = {};
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const k = String(row.getCell(1).value ?? "").trim();
    const v = row.getCell(2).value;
    if (k) raw[k] = v == null ? "" : String(v).trim();
  });
  const out: Partial<AppConfig> = {};
  if (raw.ambiente) out.env = raw.ambiente;
  if (raw.url_base) out.baseUrl = raw.url_base;
  if (raw.timeout_passo_s) out.stepTimeoutMs = Number(raw.timeout_passo_s) * 1000;
  if (raw.mascarar_seletores) out.maskSelectors = splitList(raw.mascarar_seletores, /;/);
  if (raw.variaveis_esperadas) out.requiredVars = splitList(raw.variaveis_esperadas, /,/);
  if (raw.padrao_url_login) out.loginUrlPattern = raw.padrao_url_login;
  if (raw.hosts_permitidos) out.allowedHosts = splitList(raw.hosts_permitidos, /,/);
  return out;
}

const hostOf = (url: string): string | undefined => {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
};

export async function loadConfig(opts: LoadConfigOptions = {}): Promise<AppConfig> {
  const yamlPath = opts.configPath ?? "qa-agent.config.yaml";
  const fromYaml: Partial<AppConfig> =
    existsSync(yamlPath) ? (parseYaml(readFileSync(yamlPath, "utf8")) ?? {}) : {};
  const fromSheet = opts.excelPath ? await readConfigSheet(opts.excelPath) : {};
  const o = opts.overrides ?? {};

  const merged: AppConfig = {
    ...DEFAULTS,
    ...fromYaml,
    ...fromSheet,
    ...o,
    columns: { ...DEFAULTS.columns, ...(fromYaml.columns ?? {}), ...(o.columns ?? {}) },
  };

  // allowedHosts: host da baseUrl sempre incluído (primeiro), somado aos extras do yaml/aba/overrides.
  const extras = [
    ...(fromYaml.allowedHosts ?? []),
    ...(fromSheet.allowedHosts ?? []),
    ...(o.allowedHosts ?? []),
  ];
  const baseHost = hostOf(merged.baseUrl);
  merged.allowedHosts = [...new Set([...(baseHost ? [baseHost] : []), ...extras])];
  return merged;
}
