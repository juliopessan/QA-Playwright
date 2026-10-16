import type { Locator as PwLocator, Page } from "playwright";
import { makeRedactor, resolveVars, type Env } from "../vars/index.js";
import type { Action, Locator } from "../types/index.js";

export class ActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActionError";
  }
}
export class HostNotAllowedError extends ActionError {
  constructor(host: string) {
    super(`Host não permitido: ${host}`);
    this.name = "HostNotAllowedError";
  }
}
export class ExpectationFailed extends ActionError {
  constructor(
    message: string,
    readonly observed: string,
  ) {
    super(message);
    this.name = "ExpectationFailed";
  }
}

export interface ExecCtx {
  timeoutMs: number;
  allowedHosts: string[];
  baseUrl: string;
  env: Env;
  /** Valores sensíveis já vistos neste caso (senhas digitadas etc.); nunca saem em texto. */
  secrets: Set<string>;
  /** Hosts de navegações abortadas pelo guard (preenchido pelo Runner). */
  blocked: string[];
}

const SECRET_NAME = /PASS|SECRET|TOKEN|KEY|PWD/i;
/** Valores de ambiente mais curtos que isto não são tratados como segredo (ex.: FLAG_KEY=1 estragaria qualquer texto). */
const MIN_ENV_SECRET_LENGTH = 6;
const MAX_OBSERVED = 500;

export function secretsOf(ctx: ExecCtx): string[] {
  const fromEnv = Object.entries(ctx.env)
    .filter(([k, v]) => SECRET_NAME.test(k) && v && v.length >= MIN_ENV_SECRET_LENGTH)
    .map(([, v]) => v as string);
  return [...ctx.secrets, ...fromEnv];
}

export const redactSecrets = (text: string, ctx: ExecCtx): string => makeRedactor(secretsOf(ctx))(text);

/**
 * Resolve o destino de um goto. Caminhos ("/x", "x") são relativos à URL base, inclusive quando
 * ela fica numa subpasta (ex.: GitHub Pages); URLs absolutas são mantidas.
 */
export function resolveGotoUrl(target: string, baseUrl: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) || !baseUrl) return new URL(target, baseUrl || undefined).href;
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(target.replace(/^\/+/, ""), base).href;
}

export function isHostAllowed(url: string, allowedHosts: string[]): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return true;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return true; // about:blank, data:...
  return allowedHosts.includes(u.hostname);
}

function locate(page: Page, l: Locator): PwLocator {
  const loc = page.getByRole(l.role as Parameters<Page["getByRole"]>[0], l.name ? { name: l.name } : undefined);
  return l.nth !== undefined ? loc.nth(l.nth) : loc;
}

const describeLocator = (l: Locator) => `${l.role}${l.name ? ` "${l.name}"` : ""}`;

async function poll<T>(timeoutMs: number, fn: () => Promise<T | undefined>): Promise<T | undefined> {
  const end = Date.now() + timeoutMs;
  let last: T | undefined;
  do {
    last = await fn();
    if (last !== undefined) return last;
    await new Promise((r) => setTimeout(r, 100));
  } while (Date.now() < end);
  return undefined;
}

function resolveOrThrow(text: string, ctx: ExecCtx): string {
  const r = resolveVars(text, ctx.env);
  if (r.missing.length) throw new ActionError(`Variáveis ausentes: ${r.missing.join(", ")}`);
  return r.value;
}

export function assertPageHost(page: Page, ctx: ExecCtx): void {
  if (ctx.blocked.length) throw new HostNotAllowedError(ctx.blocked.splice(0).join(", "));
  if (!isHostAllowed(page.url(), ctx.allowedHosts)) {
    throw new HostNotAllowedError(new URL(page.url()).hostname);
  }
}

async function run(page: Page, a: Action, ctx: ExecCtx): Promise<{ observed?: string }> {
  const t = ctx.timeoutMs;
  switch (a.kind) {
    case "goto": {
      const href = resolveGotoUrl(resolveOrThrow(a.url, ctx), ctx.baseUrl);
      if (!isHostAllowed(href, ctx.allowedHosts)) throw new HostNotAllowedError(new URL(href).hostname);
      await page.goto(href, { timeout: t, waitUntil: "load" });
      return {};
    }
    case "click":
      await locate(page, a.locator).click({ timeout: t });
      return {};
    case "fill": {
      const value = resolveOrThrow(a.value, ctx);
      const loc = locate(page, a.locator);
      const isPassword = await loc
        .evaluate((el) => (el as HTMLInputElement).type === "password", undefined, { timeout: t })
        .catch(() => false);
      if (a.secret || isPassword) ctx.secrets.add(value);
      await loc.fill(value, { timeout: t });
      return {};
    }
    case "select": {
      const value = resolveOrThrow(a.value, ctx);
      const loc = locate(page, a.locator);
      await loc.selectOption({ label: value }, { timeout: t }).catch(async () => {
        await loc.selectOption({ value }, { timeout: t });
      });
      return {};
    }
    case "press":
      if (a.locator) await locate(page, a.locator).press(a.key, { timeout: t });
      else await page.keyboard.press(a.key);
      return {};
    case "waitFor":
      await locate(page, a.locator).waitFor({ state: a.state ?? "visible", timeout: t });
      return {};
    case "expectText": {
      const expected = resolveOrThrow(a.text, ctx);
      const target = a.locator ? locate(page, a.locator) : page.locator("body");
      let observed = "";
      const ok = await poll(t, async () => {
        observed = (await target.innerText({ timeout: t }).catch(() => "")).trim();
        const hit = a.mode === "equals" ? observed === expected : observed.includes(expected);
        return hit ? true : undefined;
      });
      const shown = observed.slice(0, MAX_OBSERVED);
      if (!ok) {
        throw new ExpectationFailed(
          `Texto esperado (${a.mode === "equals" ? "igual a" : "contendo"}) "${expected}" não encontrado em ${
            a.locator ? describeLocator(a.locator) : "página"
          }. Observado: "${shown}"`,
          shown,
        );
      }
      return { observed: shown };
    }
    case "expectUrl": {
      const pat = resolveOrThrow(a.pattern, ctx);
      const isRegex = pat.length > 2 && pat.startsWith("/") && pat.endsWith("/");
      const re = isRegex ? new RegExp(pat.slice(1, -1)) : undefined;
      const ok = await poll(t, async () => {
        const u = page.url();
        return (re ? re.test(u) : u.includes(pat)) ? true : undefined;
      });
      if (!ok) throw new ExpectationFailed(`URL esperada "${pat}" não encontrada. URL atual: ${page.url()}`, page.url());
      return { observed: page.url() };
    }
  }
}

/** Executa uma ação; erros saem como ActionError com segredos redigidos e 1 linha de contexto. */
export async function executeAction(page: Page, action: Action, ctx: ExecCtx): Promise<{ observed?: string }> {
  try {
    const r = await run(page, action, ctx);
    if (action.kind !== "expectText" && action.kind !== "expectUrl") {
      await page.waitForLoadState("domcontentloaded").catch(() => undefined);
    }
    assertPageHost(page, ctx);
    return { observed: r.observed ? redactSecrets(r.observed, ctx) : undefined };
  } catch (e) {
    if (e instanceof HostNotAllowedError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("ERR_BLOCKED_BY_CLIENT")) throw new HostNotAllowedError("(bloqueado pelo guard de navegação)");
    const line = msg.split("\n")[0];
    const err = e instanceof ExpectationFailed
      ? new ExpectationFailed(redactSecrets(e.message, ctx), redactSecrets(e.observed, ctx))
      : new ActionError(redactSecrets(line, ctx));
    throw err;
  }
}
