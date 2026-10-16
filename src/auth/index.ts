import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { chromium, type BrowserContext, type Page } from "playwright";

export const AUTH_DIR = ".qa-auth";
const STATE_FILE = "state.json";

function ensureGitignore(dir: string): void {
  const gi = join(dirname(dir), ".gitignore");
  const entry = `${AUTH_DIR}/`;
  const current = existsSync(gi) ? readFileSync(gi, "utf8") : "";
  if (current.split("\n").some((l) => l.trim() === entry)) return;
  appendFileSync(gi, `${current && !current.endsWith("\n") ? "\n" : ""}${entry}\n`);
}

/** Salva a sessão autenticada com permissão 0600 e garante que o diretório não seja versionado. */
export async function saveStorageState(ctx: BrowserContext, dir: string = AUTH_DIR): Promise<string> {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, STATE_FILE);
  const state = await ctx.storageState();
  writeFileSync(file, JSON.stringify(state), { mode: 0o600 });
  chmodSync(file, 0o600);
  ensureGitignore(dir);
  return file;
}

export function loadStorageStatePath(dir: string = AUTH_DIR): string | undefined {
  const file = join(dir, STATE_FILE);
  return existsSync(file) ? file : undefined;
}

export function isSessionExpired(page: Page, loginUrlPattern: RegExp): boolean {
  return loginUrlPattern.test(page.url());
}

/** Fluxo interativo: o usuário faz o SSO no navegador e confirma com Enter. */
export async function interactiveLogin(baseUrl: string, dir: string = AUTH_DIR): Promise<string> {
  const browser = await chromium.launch({ headless: false });
  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(baseUrl);
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    await rl.question("Faça o login no navegador e pressione Enter aqui para salvar a sessão... ");
    rl.close();
    return await saveStorageState(ctx, dir);
  } finally {
    await browser.close();
  }
}
