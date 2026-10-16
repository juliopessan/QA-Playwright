// Copia ativos não-TS (CSS) para dist/ depois do tsc.
import { cpSync, mkdirSync } from "node:fs";
mkdirSync("dist/reporter", { recursive: true });
cpSync("src/reporter/tokens.css", "dist/reporter/tokens.css");
