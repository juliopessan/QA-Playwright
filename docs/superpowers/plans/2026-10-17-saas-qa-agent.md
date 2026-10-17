# QA Agent para SaaS: plano de implementação

> **Para agentes:** execute tarefa a tarefa com TDD (teste vermelho, implementação, teste verde, commit). Spec: `docs/superpowers/specs/2026-10-17-saas-qa-agent-design.md`.

**Objetivo:** adicionar `qa-agent explore`, `publish` e `issues`: exploração somente leitura de um SaaS, análises por tela, achados com id estável, documentação Markdown para PR e fluxos-objetivo.

**Stack:** a existente (TypeScript, Playwright, vitest, zod) mais `@axe-core/playwright` (passa de devDependency para dependency).

## Restrições globais

- O comando `run` com Excel e todos os testes atuais continuam passando.
- A exploração é somente leitura: guarda de elemento mais guarda de rede; teste de aceitação exige **zero** requisições de escrita no servidor.
- Mensagens ao usuário em português; identificadores em inglês.
- LLM só pela interface `LLMProvider`; imagens só como `MaskedImage`; segredos nunca em arquivos de saída.
- `GITHUB_TOKEN` só do ambiente; nada é publicado sem `publish`/`issues` explícitos.

## Estrutura de arquivos

```
src/explore/{types,routes,findings,guard,login,collect,crawler,deepen,config}.ts
src/analyze/{technical,accessibility,performance,ux}.ts
src/docs/{markdown,approvals}.ts
src/flows/{parse,run-flow}.ts
src/publish/{github,publish,issues}.ts
test/saas/server.ts                     # SaaS sintético
test/explore/*.test.ts · test/analyze/*.test.ts · test/docs/*.test.ts · test/flows/*.test.ts · test/publish/*.test.ts
```

## Tarefas

### 1. Rotas e assinatura de tela
`normalizeRoute(url:string): string` (números, UUIDs, hashes e slugs com dígitos viram `:id`; remove query e hash); `screenSlug(pattern:string, heading:string): string`.
Testes: `/projetos/123` e `/projetos/456` dão o mesmo padrão; UUID e hash viram `:id`; query ignorada; raiz vira `/`; slug seguro para arquivo (acentos, barras).

### 2. Achados: id estável, deduplicação, comparação
`Finding`, `findingId(category,screenKey,rule)`, `dedupeFindings(fs)`, `compareRuns(prev:Finding[],curr:Finding[]): {new,persistent,resolved}`.
Testes: mesmo problema mantém o id; ids diferem entre categorias; mesma regra em 3 telas vira 1 achado com 3 telas; comparação classifica novo, persistente e resolvido.

### 3. Guarda somente leitura
`isWriteLabel(name,extra?)`, `shouldClick(el:{name,role,type?,inForm?,revealing?},extra?)`, `installNetworkGuard(context,opts): {blocked: BlockedAttempt[]}`.
Testes: rótulos PT/EN de escrita bloqueados; "Ver detalhes" permitido; `type=submit` e botão em formulário com campos bloqueados; `PUT/PATCH/DELETE` sempre bloqueados; `POST` bloqueado exceto em `postPermitidos`; GraphQL `query` passa e `mutation` é bloqueada; bloqueios são registrados.

### 4. SaaS sintético
`startSaas(port?): {url, writes: Req[], close()}` com login (`qa_user`/`qa_pass`), dashboard, projetos (`/projects`, `/projects/:id`), equipe com abas, modal de leitura, `/billing` (HTTP 500), `/reports` (lenta), `/settings` (violação axe), formulário com "Excluir" (`POST /api/delete`) e `/graphql`.
Testes: login funciona; `writes` registra POST/PUT/DELETE e mutations; rotas existem.

### 5. Analisadores objetivos
`attachCollectors(page): Collected`; `technicalFindings(screen,collected)`, `accessibilityFindings(page,screen)`, `performanceFindings(metrics,limits,screen)`; `collectMetrics(page)`.
Testes: erro de console e 500 viram achados com gravidade; axe acha imagem sem alt; LCP/CLS acima do limite viram achado e abaixo não.

### 6. Crawler, registro e login
`login(page,{baseUrl,user,pass})` heurístico; `explore(opts): Promise<ExploreResult>` com BFS, limites, dedupe por rota, screenshots JPEG, caminho de navegação, arestas e coleta de achados.
Testes (SaaS sintético): descobre dashboard, projetos (uma tela com exemplos), equipe, billing, reports, settings; ignora logout; respeita `maxTelas`; achados plantados presentes (500, axe, lenta); **zero escritas no servidor**; cada bloqueio registrado.

### 7. Documentação Markdown e aprovações
`writeDocs(result,outDir)`; `parseApprovals(achadosMd): string[]`.
Testes: gera README, achados, mapa (Mermaid), cobertura e uma página por tela; checkbox por achado; `parseApprovals` lê só os marcados; "o que mudou" quando há run anterior.

### 8. Comando `explore`
CLI `explore <url>`, `runId`, pasta `qa-report/<runId>`, `dados/achados.json` e `manifest.json`, comparação com o run anterior, códigos de saída.
Testes: CLI end-to-end no SaaS sintético; saída 2 sem credenciais; `--sem-ux`.

### 9. Aprofundador e UX (LLM)
`deepen(screen,ctx)` (até 8 elementos, cache por assinatura); `uxFindings(screen,ctx)` (evidência obrigatória, máximo 5, origem `agent`).
Testes (`FakeLLMProvider`): abre aba e modal e registra subestados; elemento de escrita sugerido pelo modelo é recusado pela guarda; UX sem evidência descartada; limite de 5; LLM indisponível não derruba a exploração.

### 10. Fluxos-objetivo
`parseObjectives(md)`; `runFlow(objective,deps)` com laço de até 15 passos e Judge.
Testes: parser; fluxo no SaaS sintético com provedor roteirizado que cria algo (escrita permitida) e passa; limite de passos; falha vira `fail`.

### 11. Publicação e issues
`GitHubClient` (interface: `createBranchWithFiles`, `createPR`, `listOpenIssues`, `createIssue`); `HttpGitHubClient` (fetch + `GITHUB_TOKEN`); `publishRun`, `openIssues`.
Testes (cliente falso): PR com branch `qa/<runId>` e corpo do README; issues só dos aprovados; não duplica por id; grava número da issue em `achados.json`; sem token falha com mensagem clara.

### 12. Documentação final e verificação
README e `docs/saas-explore.md`; suíte completa; execução real do `explore` com o Claude contra o SaaS sintético; PR.
