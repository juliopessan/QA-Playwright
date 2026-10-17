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

## Modo SaaS: explorar, analisar e documentar

Além do Excel, o `qa-agent explore <url>` testa um **SaaS inteiro**: descobre as telas (BFS, inclusive abas e modais de leitura com ajuda do Claude), fotografa cada uma, roda análises objetivas (erros técnicos, acessibilidade com axe, desempenho) e de UX, e gera uma pasta Markdown para a engenharia **revisar em um PR**. A exploração é **somente leitura** (guarda de elemento + guarda de rede, verificada por teste: zero requisições de escrita chegam ao servidor). Fluxos de negócio vêm de um `objetivos.md` e rodam com escrita permitida, com veredito do Judge. Issues só são abertas para achados que a engenharia marcar `[x]`.

```bash
qa-agent explore https://app.exemplo.com [--objetivos objetivos.md] [--sem-ux] [--max-telas 80] [--max-llm-calls 100]
qa-agent publish <runId> --pr --repo dono/repo      # branch qa/<runId> + PR (não faça merge)
qa-agent issues <runId> --repo dono/repo            # uma issue por achado marcado [x], sem duplicar
npm run test-saas                                   # SaaS sintético com problemas plantados
```

Detalhes, formato do relatório, configuração e limitações em [`docs/saas-explore.md`](docs/saas-explore.md).

**Pela web:** a landing page publicada tem um formulário em que se cola a URL do site e o QA Agent roda a análise completa no GitHub Actions, com o relatório voltando para a página. Configuração e segurança em [`docs/web-analise.md`](docs/web-analise.md).

## Status

| Item | Situação |
|---|---|
| Pipeline completo (leitura → execução → autocorreção → julgamento → relatório) | Implementado |
| Suíte de testes | 41 arquivos, 350+ testes passando (`npm test`), mais `typecheck` e `build` sem erros |
| Modo SaaS (`explore`, `publish`, `issues`) | Implementado; aceitação contra um SaaS sintético confere os problemas plantados e **zero escritas** no servidor. Rodado com o Claude real (`claude-opus-5-5`) contra o SaaS sintético: 8 telas, 3 subestados, 1 fluxo-objetivo (23 chamadas, ~49 mil tokens de entrada). `publish`/`issues` só foram testados com cliente GitHub falso e com a camada HTTP simulada: a publicação real é verificação manual |
| Aceitação | Os 12 casos do Excel sintético produzem os vereditos que o próprio arquivo declara, contra um app local que imita a SauceDemo |
| Relatório | Verificado com axe (0 violações nos temas claro e escuro), filtros, lightbox e impressão |
| CI | Workflow de exemplo em `.github/workflows/qa.yml` (validado por teste de estrutura; ainda não executado no GitHub) |

**Ainda não verificado** (exige rede e chave de API):

0. **Modo SaaS em SaaS reais:** o Aprofundador e a UX foram vistos só no SaaS sintético. Na UX, o modelo tende a classificar como "média" e a repetir problemas do layout compartilhado; o prompt já pede para não repetir, mas a calibração em produto real é pendente. Os casos do Excel ainda não entram na pasta `fluxos/` do relatório do `explore`.

1. Execução contra a **SauceDemo real**. Os textos de mensagens e os preços do Excel sintético foram escritos de memória; confira e ajuste a coluna "Resultado esperado" se divergirem.
2. Qualidade das ações geradas pelo **Claude real** contra a SauceDemo e contra a aplicação interna. Verificado contra o **app local** (`npm run test-app`) com `claude-opus-5-5`: os 12 casos do Excel sintético rodaram em ~2 min com 30 chamadas (~84 mil tokens de entrada, ~7 mil de saída, perto de US$ 0,50) e 11 coincidiram com o esperado; o TC-011 (botão inexistente) saiu em `needs-review` em vez de `fail`, porque o modelo informa que não encontra o elemento. Uma 2ª execução faz 0 chamadas (cache). O Healer com o modelo real ainda não foi exercitado (nenhum passo precisou de autocorreção); nos testes automatizados o LLM é um provedor determinístico.
3. **Login SSO** na aplicação interna real (`qa-agent login`).
4. **Paleta da Bayer:** os valores em `src/reporter/tokens.css` são aproximados. Confira com o brand guide oficial.

## Teste rápido sem SSO, sem chave e sem rede

```bash
npm install && npm run demo
```

Sobe um app local com **login simples (usuário e senha, sem SSO)**, roda os 12 casos do Excel sintético com um provedor determinístico no lugar do LLM e gera o relatório em `runs/<runId>/report/index.html`. Credenciais da demo: `standard_user` / `secret_sauce` (as mesmas de `fixtures/.env.example`). Serve para ver o pipeline e o relatório funcionando; a qualidade das ações geradas pelo Claude só se verifica com `ANTHROPIC_API_KEY`.

## Início rápido (com Claude e a SauceDemo real)

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
  explore/ analyze/ docs/           modo SaaS: crawler, guarda somente leitura, analisadores, Markdown
  flows/ publish/                   fluxos-objetivo, PR e issues
  cli/ config/ reader/ vars/        entrada e configuração
  compiler/ runner/ healer/ judge/  núcleo do pipeline
  llm/ masking/ auth/               provedor de LLM, mascaramento e sessão SSO
  run/ reporter/ types/             orquestração, relatório e tipos
test/                               unitários, integração e aceitação (com app local em test/app)
fixtures/                           casos-sinteticos.xlsx e .env.example
docs/usage.md                       guia de uso
docs/superpowers/                   specs de design e planos de implementação
.github/workflows/qa.yml            CI
```

## Documentação

- [`docs/saas-explore.md`](docs/saas-explore.md): modo SaaS (explore, publish, issues).
- [`docs/usage.md`](docs/usage.md): formato do Excel, aba `Config`, login SSO, segurança, relatório e CI.
- [`docs/superpowers/specs/2026-10-16-qa-agent-design.md`](docs/superpowers/specs/2026-10-16-qa-agent-design.md): design aprovado.
- [`docs/superpowers/plans/2026-10-16-qa-agent.md`](docs/superpowers/plans/2026-10-16-qa-agent.md): plano de implementação.
- [`docs/superpowers/specs/2026-10-17-saas-qa-agent-design.md`](docs/superpowers/specs/2026-10-17-saas-qa-agent-design.md) e [plano](docs/superpowers/plans/2026-10-17-saas-qa-agent.md): modo SaaS.

## Desenvolvimento

```bash
npm test            # suíte completa (unitários, integração e aceitação com app local)
npm run typecheck   # tipos de src + test
npm run build       # tsc + cópia do tokens.css para dist/
```

## Fora do escopo da v1

Geração de casos a partir de requisitos; execução paralela, multi-navegador, mobile e desktop; painel web e banco de histórico; escrita de resultados de volta no Excel, Jira, Azure DevOps ou TestRail; testes de carga; login com MFA interativo no CI.
