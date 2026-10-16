/**
 * Demo local: sem SSO, sem ANTHROPIC_API_KEY e sem rede.
 * Sobe um app de teste (login simples usuário/senha, estilo SauceDemo), roda o Excel sintético com um
 * provedor determinístico no lugar do LLM e gera o relatório HTML.
 *
 *   npm run demo
 */
import { join } from "node:path";
import { startTestApp } from "../test/app/server.js";
import { syntheticProvider } from "../test/support/synthetic-rules.js";
import { loadConfig } from "../src/config/index.js";
import { runAll } from "../src/run/run-all.js";
import { writeReport } from "../src/reporter/write.js";

const XLSX = "fixtures/casos-sinteticos.xlsx";
// Credenciais públicas da demo (as mesmas de fixtures/.env.example); o app local usa as mesmas regras de login.
const env = { APP_USER: "standard_user", APP_PASS: "secret_sauce", LOCKED_USER: "locked_out_user" };

const app = await startTestApp();
try {
  console.log(`App de teste em ${app.url} (login simples: ${env.APP_USER} / ${env.APP_PASS})`);
  const cfg = await loadConfig({ excelPath: XLSX, overrides: { baseUrl: app.url, stepTimeoutMs: 2000 } });
  const runsDir = "runs";
  const manifest = await runAll({
    xlsx: XLSX,
    cfg,
    provider: syntheticProvider(),
    env,
    runsDir,
    cacheDir: join(runsDir, ".demo-cache"),
  });
  for (const v of manifest.verdicts) console.log(`${v.caseId.padEnd(7)} ${v.status.padEnd(13)} ${v.title}`);
  console.log(`\nRelatório: ${await writeReport(join(runsDir, manifest.runId))}`);
} finally {
  await app.close();
}
