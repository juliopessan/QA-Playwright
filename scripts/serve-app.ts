/** Sobe o app local de teste (login simples, sem SSO) numa porta fixa: `npm run test-app`. */
import { startTestApp } from "../test/app/server.js";

const port = Number(process.env.PORT ?? 4010);
const app = await startTestApp(port);
console.log(`App de teste em ${app.url} (standard_user / secret_sauce). Ctrl+C para encerrar.`);
process.on("SIGINT", () => app.close().then(() => process.exit(0)));
process.on("SIGTERM", () => app.close().then(() => process.exit(0)));
