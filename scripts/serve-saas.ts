/** Sobe o SaaS sintético (com problemas plantados) numa porta fixa: `npm run test-saas`. */
import { startSaas, SAAS_USER, SAAS_PASS } from "../test/saas/server.js";

const port = Number(process.env.PORT ?? 4020);
const saas = await startSaas(port, { slowMs: 1500 });
console.log(`SaaS sintético em ${saas.url} (${SAAS_USER} / ${SAAS_PASS}). Ctrl+C para encerrar.`);
process.on("SIGINT", () => saas.close().then(() => process.exit(0)));
process.on("SIGTERM", () => saas.close().then(() => process.exit(0)));
