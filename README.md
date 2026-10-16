# QA Agent

CLI de QA agêntico: lê casos de teste em **linguagem natural** de um Excel, executa no navegador com **Playwright**, captura **screenshots por passo** e gera um **relatório HTML de evidências** (paleta Bayer) com vereditos conservadores.

```
casos.xlsx ─▶ Reader ─▶ Compiler (LLM + cache) ─▶ Runner ─▶ Healer (só em falha) ─▶ Judge ─▶ relatório HTML
```

- **Execuções repetidas são rápidas:** passos compilados ficam em cache e o LLM não é chamado.
- **Em dúvida, nunca aprova:** resultado ambíguo vira `needs-review`; o Healer nunca marca `pass`.
- **Tudo auditável:** autocorreções aparecem no relatório com antes/depois.
- **Dados protegidos:** senhas e seletores configurados são mascarados em prints e no texto enviado ao LLM.
- **LLM trocável:** o Claude é o provedor padrão, atrás da interface `LLMProvider`.

## Status

| Item | Situação |
|---|---|
| Pipeline completo (leitura → execução → autocorreção → julgamento → relatório) | Implementado |
| Suíte de testes | 24 arquivos, 187 testes passando (`npm test`), mais `typecheck` e `build` sem erros |
| Aceitação | Os 12 casos do Excel sintético produzem os vereditos que o próprio arquivo declara, contra um app local que imita a SauceDemo |
| Relatório | Verificado com axe (0 violações nos temas claro e escuro), filtros, lightbox e impressão |
| CI | Workflow de exemplo em `.github/workflows/qa.yml` (validado por teste de estrutura; ainda não executado no GitHub) |

**Ainda não verificado** (exige rede e chave de API):

1. Execução contra a **SauceDemo real**. Os textos de mensagens e os preços do Excel sintético foram escritos de memória; confira e ajuste a coluna "Resultado esperado" se divergirem.
2. Qualidade das ações geradas pelo **Claude real**. Nos testes o LLM é substituído por um provedor com respostas determinísticas, então o que está provado é a orquestração, não o julgamento do modelo.
3. **Login SSO** na aplicação interna real (`qa-agent login`).
4. **Paleta da Bayer:** os valores em `src/reporter/tokens.css` são aproximados. Confira com o brand guide oficial.

## Início rápido

```bash
npm install
npx playwright install chromium
cp fixtures/.env.example .env           # e defina ANTHROPIC_API_KEY
npm run build
node dist/cli/index.js run fixtures/casos-sinteticos.xlsx --dry-run   # só valida o Excel
node dist/cli/index.js run fixtures/casos-sinteticos.xlsx              # executa
node dist/cli/index.js report                                          # gera/reabre o último relatório
```

Requer Node 20.12 ou superior.

## Comandos

```
qa-agent login [--base-url <url>]
qa-agent run <xlsx> [--only <id>] [--base-url <url>] [--no-heal] [--headed]
                    [--resume <runId>] [--max-llm-calls <n>] [--env-file <path>]
                    [--config <yaml>] [--evidence embedded|linked] [--dry-run]
qa-agent report [--run <runId>] [--evidence embedded|linked]
```

Códigos de saída: `0` sem reprovados/bloqueados · `1` há `fail` ou `blocked` · `2` entrada inválida · `3` sessão SSO expirada.

## Vereditos

| Status | Quando |
|---|---|
| `pass` | Todos os passos passaram e as verificações subjetivas tiveram evidência citada pelo Judge |
| `fail` | Um passo falhou (ação não executável ou asserção que não bateu) ou o Judge reprovou |
| `needs-review` | Passo não resolvido com confiança, LLM indisponível ou sem orçamento, ou Judge sem evidência suficiente |
| `blocked` | Linha malformada no Excel |

Passos corrigidos pelo Healer aparecem como `healed`. O Healer só troca ações de interação que falharam; asserções e navegações para hosts não permitidos nunca são "curadas".

## Estrutura

```
src/
  cli/ config/ reader/ vars/        entrada e configuração
  compiler/ runner/ healer/ judge/  núcleo do pipeline
  llm/ masking/ auth/               provedor de LLM, mascaramento e sessão SSO
  run/ reporter/ types/             orquestração, relatório e tipos
test/                               unitários, integração e aceitação (com app local em test/app)
fixtures/                           casos-sinteticos.xlsx e .env.example
docs/usage.md                       guia de uso
docs/superpowers/                   spec de design e plano de implementação
.github/workflows/qa.yml            CI
```

## Documentação

- [`docs/usage.md`](docs/usage.md): formato do Excel, aba `Config`, login SSO, segurança, relatório e CI.
- [`docs/superpowers/specs/2026-10-16-qa-agent-design.md`](docs/superpowers/specs/2026-10-16-qa-agent-design.md): design aprovado.
- [`docs/superpowers/plans/2026-10-16-qa-agent.md`](docs/superpowers/plans/2026-10-16-qa-agent.md): plano de implementação.

## Desenvolvimento

```bash
npm test            # suíte completa (unitários, integração e aceitação com app local)
npm run typecheck   # tipos de src + test
npm run build       # tsc + cópia do tokens.css para dist/
```

## Fora do escopo da v1

Geração de casos a partir de requisitos; execução paralela, multi-navegador, mobile e desktop; painel web e banco de histórico; escrita de resultados de volta no Excel, Jira, Azure DevOps ou TestRail; testes de carga; login com MFA interativo no CI.
