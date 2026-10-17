// Remove APP_USER e APP_PASS (do ambiente) de um arquivo de texto antes de publicá-lo.
import { readFileSync, writeFileSync } from "node:fs";

const file = process.argv[2];
const secrets = [process.env.APP_PASS, process.env.APP_USER].filter((s) => s && s !== "sem-login" && s.length >= 3);
let text = readFileSync(file, "utf8");
for (const s of secrets) text = text.split(s).join("••••");
writeFileSync(file, text);
