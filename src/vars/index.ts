export type Env = Record<string, string | undefined>;

const VAR_RE = /\{\{\s*([A-Z0-9_]+)\s*\}\}/g;

export function resolveVars(
  text: string,
  env: Env,
): { value: string; used: string[]; missing: string[] } {
  const used: string[] = [];
  const missing: string[] = [];
  const value = text.replace(VAR_RE, (whole, name: string) => {
    const v = env[name];
    if (v === undefined || v === "") {
      if (!missing.includes(name)) missing.push(name);
      return whole;
    }
    if (!used.includes(name)) used.push(name);
    return v;
  });
  return { value, used, missing };
}

export function assertVars(names: string[], env: Env): void {
  const missing = names.filter((n) => env[n] === undefined || env[n] === "");
  if (missing.length) throw new Error(`Variáveis ausentes: ${missing.join(", ")}`);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function makeRedactor(secrets: string[]): (s: string) => string {
  const list = [...new Set(secrets.filter((s) => s.length > 0))].sort((a, b) => b.length - a.length);
  if (list.length === 0) return (s) => s;
  const re = new RegExp(list.map(escapeRe).join("|"), "g");
  return (s) => s.replace(re, "••••");
}
