# QA Agent para SaaS: exploração, análises e documentação para revisão

Data: 2026-10-17 · Status: design aprovado em conversa (seções 1 a 5); execução autorizada até o PR final.

## 1. Objetivo e contexto

O QA Agent atual executa casos de teste de um Excel. Esta evolução adiciona um modo pensado para **testar um SaaS**: o agente recebe a URL e as credenciais, descobre as telas, as fotografa, as analisa e gera **documentação completa para a engenharia revisar**, além de executar fluxos de negócio descritos em linguagem natural.

### Critérios de sucesso

1. `qa-agent explore <url>` descobre as telas alcançáveis (inclusive abas e modais de leitura) e gera screenshots de cada uma.
2. Cada tela recebe análises objetivas (erros técnicos, acessibilidade, desempenho) e, opcionalmente, análise de UX pelo Claude.
3. A saída é uma pasta Markdown revisável por pull request, com achados acionáveis (onde, evidência, como reproduzir, gravidade).
4. A exploração é **somente leitura**: nenhuma requisição de escrita chega ao SaaS. Isso é verificado por teste.
5. Fluxos-objetivo (`objetivos.md`) rodam com escrita permitida, com evidência por passo e veredito do Judge.
6. Issues só são abertas para achados aprovados por um humano no PR.
7. Execuções repetidas são comparáveis: cada achado é marcado como novo, persistente ou resolvido.

### Restrições

- Reaproveita navegador, `allowedHosts`, sessão SSO, mascaramento, `LLMProvider`, Runner, Judge e relatório HTML existentes. O `run` com Excel continua igual.
- O LLM é chamado no máximo uma vez por tela nova para aprofundar e uma para UX; os resultados ficam em cache.
- Senhas e seletores configurados continuam mascarados em prints e no texto enviado ao LLM.
- Nada é publicado no GitHub sem comando explícito do usuário.

### Fora do escopo

Testes de carga; comparação visual pixel a pixel entre runs; execução paralela e multi-navegador; Jira/Linear (só GitHub Issues); exploração com escrita.

## 2. Abordagem escolhida

**Híbrida:** crawler determinístico para amplitude, Claude para profundidade (abas, modais, "ver detalhes") e fluxos-objetivo à parte. Alternativas descartadas: crawler puro (não enxerga abas e modais de SPAs) e explorador totalmente guiado por LLM (caro, variável e difícil de garantir o modo só leitura).

## 3. Arquitetura

```
URL + credenciais ─▶ Crawler ─▶ Registro de telas ─▶ Aprofundador (LLM) ─┐
                      (guarda só leitura: elemento + rede)               │ cada tela/estado
objetivos.md / Excel ─▶ Fluxos (com escrita) ───────────────────────────┤
                                                                         ▼
                                  Analisadores: técnico · a11y · desempenho · UX
                                                                         ▼
                                  Achados (id estável, dedupe, comparação) ─▶ Markdown ─▶ PR ─▶ Issues
```

| Unidade | Responsabilidade |
|---|---|
| `explore/routes` | Normaliza URLs em padrões de rota (`/projetos/:id`) e calcula a assinatura da tela |
| `explore/registry` | Registra telas únicas, exemplos por rota e caminho de navegação |
| `explore/guard` | Guarda só leitura: bloqueio de elementos de escrita e de requisições que alteram dados |
| `explore/login` | Login por formulário (heurístico) ou sessão SSO salva |
| `explore/crawler` | BFS limitada por telas, profundidade e tempo; coleta links e menus |
| `explore/deepen` | Claude aponta elementos que revelam conteúdo sem alterar dados |
| `analyze/*` | Técnico, acessibilidade (axe), desempenho (LCP/CLS) e UX (LLM) |
| `findings` | Modelo de achado, id estável, deduplicação e comparação entre runs |
| `docs/markdown` | Pasta `qa-report/<runId>/` revisável por PR |
| `publish` | Cria branch, commit e PR; abre issues para achados aprovados |
| `flows` | `objetivos.md` com laço planejar, agir e julgar |

### CLI

```
qa-agent explore <url> [--objetivos objetivos.md] [--max-telas 80] [--sem-ux] [--env-file .env]
qa-agent publish <runId> --pr [--repo dono/nome]
qa-agent issues <runId> [--repo dono/nome]
```

## 4. Exploração e guarda só leitura

- **Descoberta:** `<a href>` do mesmo host, itens com papel `link`/`menuitem`/`tab`. Ignora links externos, `mailto:`, downloads, logout e `ignorarUrls`. Ordem em largura.
- **Limites (configuráveis):** `maxTelas` 80, `maxProfundidade` 4, `tempoMaximoMin` 20, `exemplosPorRota` 3.
- **Identidade da tela:** padrão de rota (números, UUIDs e hashes viram `:id`) mais `h1` e título da aba. Telas iguais com dados diferentes contam como uma, com as URLs visitadas listadas.
- **Aprofundador:** uma chamada do Claude por tela nova devolve até 8 elementos que revelam conteúdo sem alterar dados; o agente abre, fotografa e registra subestados; cache por assinatura de tela.
- **Guarda, camada 1 (elemento):** não clica em `type=submit`, botões dentro de formulários com campos, nomes com verbos de escrita (PT/EN) nem elementos não marcados pelo Aprofundador. Na dúvida, não clica.
- **Guarda, camada 2 (rede):** `PUT`/`PATCH`/`DELETE` sempre bloqueados; `POST` bloqueado exceto em `postPermitidos`; em GraphQL, `query` passa e `mutation` é bloqueada.
- **Toda tentativa bloqueada vira registro** (camada, URL, método, elemento) na seção de cobertura.
- Telas que só existem depois de uma escrita são cobertas pelos fluxos-objetivo.

## 5. Analisadores e achados

| Analisador | Coleta | Vira achado quando |
|---|---|---|
| Técnico | `console.error`, exceções não tratadas, requisições ≥ 400 ou falhas, recursos que não carregam | Qualquer erro; gravidade por tipo |
| Acessibilidade | Varredura axe | Violações; gravidade do axe |
| Desempenho | Tempo de carregamento, LCP, CLS, peso transferido | LCP > 2,5 s, CLS > 0,1 ou carregamento > 5 s (configurável) |
| UX (Claude, desligável) | Screenshot mascarado e texto redigido | O modelo cita evidência visível; sem evidência, é descartado; até 5 por tela; marcado como "opinião do agente" |

```ts
Finding { id, screenId, state?, category: "technical"|"accessibility"|"performance"|"ux"|"coverage",
          severity: "critical"|"high"|"medium"|"low", origin: "measured"|"agent",
          title, description, evidence[], reproduction[], suggestion?, confidence? }
```

- `id` = hash estável de categoria, tela e regra/mensagem normalizada: o mesmo problema mantém o id entre execuções.
- **Deduplicação:** o mesmo erro em várias telas vira um achado com a lista de telas afetadas.
- **Comparação:** cada achado é marcado como novo, persistente ou resolvido em relação ao run anterior.

## 6. Documentação, PR e issues

```
qa-report/<runId>/
├─ README.md        resumo, o que mudou desde o último run, 10 achados mais graves, cobertura
├─ achados.md       achados por gravidade, com checkbox de aprovação
├─ mapa.md          diagrama Mermaid de telas e navegação
├─ cobertura.md     o que foi e o que não foi explorado, e por quê
├─ telas/<tela>.md  screenshot, URL de exemplo, rota, caminho, análises e achados
├─ fluxos/<obj>.md  passo a passo de cada objetivo
├─ img/             screenshots (JPEG)
└─ dados/           achados.json, manifest.json
```

- `publish --pr`: branch `qa/<runId>`, commit da pasta, PR com o resumo do README no corpo. Repositório de destino configurável. Usa `GITHUB_TOKEN` do ambiente, nunca gravado em arquivo.
- Aprovação: cada achado em `achados.md` tem `- [ ] ... · id` e os engenheiros marcam os que merecem issue.
- `issues`: lê o `achados.md` da branch do PR, abre uma issue por achado marcado (título, descrição, reprodução, evidências, rótulo de gravidade), não duplica (procura o id no corpo de issues abertas) e grava o número da issue em `achados.json`.
- Recomendação: não fazer merge do PR de QA; ele serve para revisão.

## 7. Fluxos-objetivo

`objetivos.md`: seções `## Título`, texto do objetivo e `**Sucesso:** critério`. Laço por objetivo: o Claude escolhe a próxima ação a partir do snapshot, a ação é executada com print antes e depois, e o ciclo termina no critério de sucesso ou em 15 passos. Veredito do Judge (`pass`/`fail`/`needs-review`). Escrita permitida, domínio restrito a `allowedHosts`. Telas visitadas pelo fluxo também passam pelos analisadores. Os casos do Excel continuam funcionando e entram na documentação.

## 8. Configuração (`qa-agent.config.yaml`)

```yaml
explorar: { maxTelas: 80, maxProfundidade: 4, tempoMaximoMin: 20, exemplosPorRota: 3,
            ignorarUrls: ["/logout"], verbosEscrita: [], postPermitidos: [] }
analises: { ux: true, limites: { lcpMs: 2500, cls: 0.1, carregamentoMs: 5000 } }
publicar: { repo: "dono/saas", rotulos: ["qa-agent"] }
```

## 9. Erros e robustez

Tela com erro vira achado técnico e o crawler segue. Sessão expirada interrompe o run (retomável). LLM indisponível ou sem orçamento: a exploração continua só com crawler e análises objetivas, e o relatório avisa. Limites de telas, profundidade e tempo mais deduplicação por rota evitam laços (calendários, paginação infinita).

## 10. Testes

- **SaaS sintético local** (`test/saas`): menu lateral, rotas com `:id`, abas, modal de leitura, erro 500, tela lenta, violação de acessibilidade, formulário com "Excluir", endpoint GraphQL. Conta as requisições de escrita recebidas.
- **Aceitação:** `explore` encontra as telas e subestados esperados e gera os achados plantados; **zero requisições de escrita** chegam ao servidor.
- **Unitários:** rotas e assinatura, guarda (elemento e rede, incluindo GraphQL), id estável, deduplicação, comparação entre runs, geração do Markdown, leitura dos checkboxes.
- **PR e issues:** cliente GitHub falso; a publicação real é verificação manual.

## 11. Fases de entrega

1. Exploração e evidências (crawler, registro, guarda, Markdown, mapa).
2. Análises objetivas e achados (técnico, axe, desempenho, id estável, comparação).
3. LLM (Aprofundador e UX).
4. Fluxos-objetivo.
5. Publicação (PR e issues).

## 12. Riscos e questões em aberto

1. **Leituras via POST** fora de GraphQL deixam telas incompletas até a rota entrar em `postPermitidos`; o relatório aponta qual rota foi bloqueada.
2. **Login heurístico** pode falhar em telas de login incomuns; nesses casos usar `qa-agent login` (SSO) ou passos explícitos.
3. **Qualidade do Aprofundador e da UX** com o modelo real só foi verificada em escala pequena; cobertura de SaaS reais é a verificação pendente.
4. **Peso dos screenshots** no repositório: mitigado com JPEG reduzido e recomendação de não fazer merge do PR de QA.
