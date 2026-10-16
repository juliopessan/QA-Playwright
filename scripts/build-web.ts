/**
 * Gera uma versão publicável do app de teste com credenciais novas (para testar o QA Agent na web).
 * As credenciais ficam no JavaScript da página: servem apenas para teste, nunca para nada real.
 */
import { randomBytes } from "node:crypto";
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface WebCredentials {
  user: string;
  pass: string;
  lockedUser: string;
}

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), "..", "test", "app", "public");

export function generateCredentials(): WebCredentials {
  const id = randomBytes(3).toString("hex");
  return { user: `qa_${id}`, pass: randomBytes(12).toString("base64url"), lockedUser: `qa_bloqueado_${id}` };
}

/** Credenciais fixadas por variáveis de ambiente (ex.: no painel da Vercel), para não mudarem a cada deploy. */
export function credentialsFromEnv(env: Record<string, string | undefined>): WebCredentials | undefined {
  const user = env.QA_WEB_USER?.trim();
  const pass = env.QA_WEB_PASS?.trim();
  if (!user || !pass) return undefined;
  return { user, pass, lockedUser: env.QA_WEB_LOCKED_USER?.trim() || `${user}_bloqueado` };
}

/** Credenciais fixas versionadas (são públicas na página de qualquer forma); evitam trocar a cada deploy. */
export function credentialsFromFile(file: string): WebCredentials | undefined {
  if (!existsSync(file)) return undefined;
  try {
    const c = JSON.parse(readFileSync(file, "utf8")) as Partial<WebCredentials>;
    return c.user && c.pass && c.lockedUser ? { user: c.user, pass: c.pass, lockedUser: c.lockedUser } : undefined;
  } catch {
    return undefined;
  }
}

export function buildWeb(opts: { outDir: string; creds: WebCredentials }): void {
  rmSync(opts.outDir, { recursive: true, force: true });
  mkdirSync(opts.outDir, { recursive: true });
  cpSync(PUBLIC, opts.outDir, { recursive: true });
  // Marca neutra: a página pública não deve se passar pela SauceDemo.
  for (const f of readdirSync(opts.outDir).filter((n) => n.endsWith(".html"))) {
    const file = join(opts.outDir, f);
    const html = readFileSync(file, "utf8")
      .replace("<title>Swag Labs (local)</title>", "<title>QA Agent · Loja de teste</title>")
      .replace(
        "<h1>Swag Labs</h1>",
        '<h1>QA Agent</h1>\n  <p>Site de teste do QA Agent. Não é a SauceDemo; credenciais apenas para testes.</p>',
      );
    writeFileSync(file, html);
  }
  writeFileSync(join(opts.outDir, ".nojekyll"), "");
  const { user, pass, lockedUser } = opts.creds;
  const config = `// Gerado por npm run build:web. Credenciais de TESTE, públicas por natureza.
window.APP_CONFIG = {
  users: ${JSON.stringify({ [user]: pass, [lockedUser]: pass })},
  locked: ${JSON.stringify([lockedUser])},
};
`;
  writeFileSync(join(opts.outDir, "config.js"), config);
}

export function writeEnvWeb(file: string, creds: WebCredentials, apiKey?: string): void {
  const lines = [
    "# Gerado por npm run build:web: credenciais do app de teste publicado. Não versionar.",
    `APP_USER=${creds.user}`,
    `APP_PASS=${creds.pass}`,
    `LOCKED_USER=${creds.lockedUser}`,
    ...(apiKey ? [`ANTHROPIC_API_KEY=${apiKey}`] : []),
  ];
  writeFileSync(file, lines.join("\n") + "\n", { mode: 0o600 });
  chmodSync(file, 0o600);
}
