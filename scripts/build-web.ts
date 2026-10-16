/**
 * Gera uma versão publicável do app de teste com credenciais novas (para testar o QA Agent na web).
 * As credenciais ficam no JavaScript da página: servem apenas para teste, nunca para nada real.
 */
import { randomBytes } from "node:crypto";
import { chmodSync, cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
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

export function buildWeb(opts: { outDir: string; creds: WebCredentials }): void {
  rmSync(opts.outDir, { recursive: true, force: true });
  mkdirSync(opts.outDir, { recursive: true });
  cpSync(PUBLIC, opts.outDir, { recursive: true });
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
