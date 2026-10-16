/**
 * npm run build:web [-- --new]
 * Gera web-dist/ e grava .env.web (fora do git). Ordem das credenciais: variáveis QA_WEB_USER/
 * QA_WEB_PASS/QA_WEB_LOCKED_USER (ex.: painel da Vercel) > .env.web existente > novas geradas (--new força).
 */
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { buildWeb, credentialsFromEnv, generateCredentials, writeEnvWeb, type WebCredentials } from "./build-web.js";

function existing(): WebCredentials | undefined {
  if (process.argv.includes("--new") || !existsSync(".env.web")) return undefined;
  const e = parseEnv(readFileSync(".env.web", "utf8"));
  return e.APP_USER && e.APP_PASS && e.LOCKED_USER
    ? { user: e.APP_USER, pass: e.APP_PASS, lockedUser: e.LOCKED_USER }
    : undefined;
}

const fromEnv = process.argv.includes("--new") ? undefined : credentialsFromEnv(process.env);
const reused = fromEnv ?? existing();
const creds = reused ?? generateCredentials();
buildWeb({ outDir: "web-dist", creds });
const apiKey = existsSync(".env") ? parseEnv(readFileSync(".env", "utf8")).ANTHROPIC_API_KEY : undefined;
writeEnvWeb(".env.web", creds, apiKey);
console.log(`Site gerado em web-dist/ (${fromEnv ? "credenciais das variáveis QA_WEB_*" : reused ? "credenciais reaproveitadas de .env.web" : "credenciais novas"})`);
console.log(`Usuário: ${creds.user}`);
console.log(`Senha:   ${creds.pass}`);
console.log(`Usuário bloqueado (mesma senha): ${creds.lockedUser}`);
console.log("Use: --env-file .env.web");
