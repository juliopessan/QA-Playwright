# QA Agent

CLI de QA agêntico: lê casos de teste em **linguagem natural** de um Excel, executa no navegador com **Playwright**, captura **screenshots por passo** e gera um **relatório HTML de evidências** (paleta Bayer) com vereditos conservadores.

```
casos.xlsx ─▶ Reader ─▶ Compiler (LLM + cache) ─▶ Runner ─▶ Healer (só em falha) ─▶ Judge ─▶ relatório HTML
```

- **Execuções repetidas são rápidas:** passos compilados ficam em cache e o LLM não é chamado.
- **Em dúvida, nunca aprova:** resultado ambíguo vira `needs-review`; o Healer nunca marca `pass`.
- **Tudo auditável:** autocorreções aparecem no relatório com antes/depois.
- **Dados protegidos:** senhas e seletores configurados são mascarados em prints e no texto enviado ao LLM.

## Início rápido

```bash
npm install
npx playwright install chromium
cp fixtures/.env.example .env           # e defina ANTHROPIC_API_KEY
npm run build
node dist/cli/index.js run fixtures/casos-sinteticos.xlsx --dry-run   # só valida o Excel
node dist/cli/index.js run fixtures/casos-sinteticos.xlsx              # executa
node dist/cli/index.js report                                          # reabre o último relatório
```

Guia completo: [`docs/usage.md`](docs/usage.md). Design e plano: [`docs/superpowers/`](docs/superpowers/).

## Desenvolvimento

```bash
npm test            # suíte completa (unitários, integração e aceitação com app local)
npm run typecheck   # tipos de src + test
```
