/**
 * npm run build:web [-- --new]
 * Gera web-dist/ (landing na raiz, app de teste em demo/) e grava .env.web (fora do git). Ordem das credenciais: variáveis QA_WEB_USER/
 * QA_WEB_PASS/QA_WEB_LOCKED_USER (ex.: painel da Vercel) > web-credentials.json (versionado) >
 * .env.web existente > novas geradas. --new ignora tudo e gera novas.
 */
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { buildSite, credentialsFromEnv, credentialsFromFile, generateCredentials, writeEnvWeb, type WebCredentials } from "./build-web.js";

function existing(): WebCredentials | undefined {
  if (process.argv.includes("--new") || !existsSync(".env.web")) return undefined;
  const e = parseEnv(readFileSync(".env.web", "utf8"));
  return e.APP_USER && e.APP_PASS && e.LOCKED_USER
    ? { user: e.APP_USER, pass: e.APP_PASS, lockedUser: e.LOCKED_USER }
    : undefined;
}

const forceNew = process.argv.includes("--new");
const fromEnv = forceNew ? undefined : credentialsFromEnv(process.env);
const fromFile = forceNew ? undefined : credentialsFromFile("web-credentials.json");
const reused = fromEnv ?? fromFile ?? existing();
const creds = reused ?? generateCredentials();
buildSite({ outDir: "web-dist", creds, landing: "landing/index.html" });
const apiKey = existsSync(".env") ? parseEnv(readFileSync(".env", "utf8")).ANTHROPIC_API_KEY : undefined;
writeEnvWeb(".env.web", creds, apiKey);
console.log(`Site gerado em web-dist/: landing na raiz, app de teste em web-dist/demo/ (${fromEnv ? "credenciais das variáveis QA_WEB_*" : fromFile ? "credenciais de web-credentials.json" : reused ? "credenciais reaproveitadas de .env.web" : "credenciais novas"})`);
console.log(`Usuário: ${creds.user}`);
console.log(`Senha:   ${creds.pass}`);
console.log(`Usuário bloqueado (mesma senha): ${creds.lockedUser}`);
console.log("Use: --env-file .env.web");
