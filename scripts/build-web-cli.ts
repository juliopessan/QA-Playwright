/** npm run build:web — gera web-dist/ com credenciais novas e grava .env.web (fora do git). */
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { buildWeb, generateCredentials, writeEnvWeb } from "./build-web.js";

const creds = generateCredentials();
buildWeb({ outDir: "web-dist", creds });
const apiKey = existsSync(".env") ? parseEnv(readFileSync(".env", "utf8")).ANTHROPIC_API_KEY : undefined;
writeEnvWeb(".env.web", creds, apiKey);
console.log("Site gerado em web-dist/");
console.log(`Usuário: ${creds.user}`);
console.log(`Senha:   ${creds.pass}`);
console.log(`Usuário bloqueado (mesma senha): ${creds.lockedUser}`);
console.log("Credenciais gravadas em .env.web (use: --env-file .env.web)");
