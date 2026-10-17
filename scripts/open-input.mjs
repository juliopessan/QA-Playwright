// Usado pelo workflow explore-web: decifra as credenciais do pedido, mascara-as no log e as exporta
// para os próximos passos (APP_USER/APP_PASS). Nunca imprime os valores.
import { appendFileSync } from "node:fs";
import { openCreds, validateCred } from "../api/_lib/core.js";

const { QA_PAYLOAD, QA_INPUT_KEY, GITHUB_ENV } = process.env;
if (!QA_INPUT_KEY) {
  console.error("Secret QA_INPUT_KEY ausente no repositório.");
  process.exit(2);
}
let creds;
try {
  creds = openCreds(QA_PAYLOAD ?? "", QA_INPUT_KEY);
} catch {
  console.error("Não foi possível decifrar as credenciais do pedido (QA_INPUT_KEY diferente da Vercel?).");
  process.exit(2);
}
for (const [label, v] of [["Usuário", creds.user], ["Senha", creds.pass]]) {
  if (!validateCred(v, label).ok) {
    console.error(`${label} inválido.`);
    process.exit(2);
  }
  if (v) console.log(`::add-mask::${v}`);
}
// Site sem login: o explore exige credenciais, mas o login por formulário só age se houver campo de senha.
const user = creds.user || "sem-login";
const pass = creds.pass || "sem-login";
if (GITHUB_ENV) appendFileSync(GITHUB_ENV, `APP_USER=${user}\nAPP_PASS=${pass}\n`);
console.log(`Credenciais ${creds.user ? "recebidas e mascaradas" : "não informadas: site sem login"}.`);
