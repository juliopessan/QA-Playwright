# Modo SaaS: explorar, analisar e documentar

`qa-agent explore` recebe a URL de um SaaS e as credenciais, descobre as telas, as fotografa, as analisa e gera **documentação em Markdown para a engenharia revisar em um pull request**. O comando `run` com Excel continua igual.

```
URL + credenciais ─▶ Crawler (somente leitura) ─▶ Aprofundador (Claude) ─┐
objetivos.md ─▶ Fluxos (escrita permitida) ───────────────────────────────┤
                                  Analisadores: técnico · a11y · desempenho · UX
                                                                          ▼
                      Achados com id estável ─▶ qa-report/<runId>/ ─▶ PR ─▶ issues
```

## Uso

```bash
# .env (nunca versionado): APP_USER, APP_PASS, ANTHROPIC_API_KEY, GITHUB_TOKEN
qa-agent explore https://app.exemplo.com                      # explora e gera qa-report/<runId>/
qa-agent explore https://app.exemplo.com --objetivos objetivos.md
qa-agent explore https://app.exemplo.com --sem-ux --max-telas 30 --max-llm-calls 100
qa-agent publish <runId> --pr --repo dono/repo                # branch qa/<runId> + PR (nunca faz merge)
# a engenharia marca [x] em achados.md, no PR
qa-agent issues <runId> --repo dono/repo                      # uma issue por achado marcado, sem duplicar
```

Para SSO, rode `qa-agent login` antes: a sessão salva é usada no lugar de `APP_USER`/`APP_PASS`.

Sem `ANTHROPIC_API_KEY` (ou com `--sem-ux`) a exploração segue só com crawler e análises objetivas, e a cobertura avisa o que não rodou.

Códigos de saída: `0` ok · `1` algum fluxo-objetivo reprovou ou ficou bloqueado · `2` entrada inválida, login recusado ou erro de publicação · `3` sessão expirada durante a exploração.

## Exploração somente leitura

A exploração nunca altera dados do SaaS. Duas camadas independentes:

1. **Elemento:** só clica em `link`, `tab` e `menuitem`; botões apenas se o Aprofundador os marcou como reveladores de conteúdo. Nunca clica em `type=submit`, em botões dentro de formulários com campos nem em rótulos com verbos de escrita (PT/EN: salvar, excluir, convidar, pagar, delete, invite…). Na dúvida, não clica. Verbos extras em `explorar.verbosEscrita`.
2. **Rede:** `PUT`/`PATCH`/`DELETE` sempre bloqueados; `POST` bloqueado, salvo prefixos em `explorar.postPermitidos` (busca, telemetria); em GraphQL, `query` passa e `mutation` é bloqueada (inclusive em lote).

Toda tentativa bloqueada aparece em `cobertura.md`, com camada, tela e alvo. Telas que só existem depois de uma escrita são cobertas pelos fluxos-objetivo. O login é a única escrita permitida e acontece antes da guarda entrar.

## Aprofundador e UX (Claude)

- **Aprofundador:** uma chamada por tela nova devolve até 8 elementos que apenas revelam conteúdo (abas, modais de leitura, "ver detalhes"). Cada um passa pela guarda; os de escrita são recusados e registrados. A lista fica em cache por rota+título, então a segunda execução não gasta chamadas.
- **UX:** uma chamada por tela nova, com screenshot mascarado e texto redigido. Só vale achado que cite evidência visível; no máximo 5 por tela; gravidade limitada a média; sempre marcado como **opinião do agente** com a confiança informada.
- O conteúdo das páginas é tratado como dado não confiável (delimitadores no prompt e instrução explícita). Falha ou orçamento esgotado do LLM não derrubam a exploração: viram observação na cobertura.

## Analisadores

| Analisador | Vira achado quando |
|---|---|
| Técnico | `console.error`, exceção não tratada, resposta ≥ 400, falha de rede |
| Acessibilidade (axe) | Violação, com a gravidade do axe |
| Desempenho | LCP > 2,5 s, CLS > 0,1 ou carregamento > 5 s (`analises.limites`) |
| UX (Claude) | Ver acima |

O id do achado é um hash estável de categoria, tela e regra normalizada: o mesmo problema mantém o id entre execuções, e o README marca cada achado como novo, persistente ou resolvido em relação ao run anterior. O mesmo erro em várias telas vira um achado com a lista de telas.

## Fluxos-objetivo (`objetivos.md`)

```markdown
## Convidar um usuário
Entrar na tela de equipe e convidar um novo usuário.
**Sucesso:** o convite aparece como enviado.
```

Para cada objetivo, o Claude escolhe uma ação por vez a partir do snapshot da página (no máximo 15 passos), cada passo ganha print antes e depois, e **um avaliador independente (Judge) decide** se o critério de sucesso foi atingido, com evidência obrigatória. Veredito `pass`, `fail` ou `needs-review`; atingir o limite de passos ou o agente desistir vira `needs-review`, nunca aprovação. Aqui a escrita é permitida; a navegação continua restrita ao host do SaaS. Senhas entram como `{{APP_PASS}}`: o modelo nunca as vê. As telas por onde o fluxo passa também são analisadas.

## O que sai em `qa-report/<runId>/`

```
README.md        resumo, o que mudou, 10 achados mais graves, fluxos
achados.md       achados por gravidade, com checkbox de aprovação
mapa.md          diagrama Mermaid de telas e navegação
cobertura.md     o que foi e o que não foi explorado, bloqueios e observações
telas/<tela>.md  screenshot, rota, caminho, subestados e achados
fluxos/<obj>.md  passo a passo de cada objetivo
img/             screenshots (JPEG)
dados/           achados.json e manifest.json
```

## Publicação

- `publish --pr`: branch `qa/<runId>` com a pasta do relatório e PR com o README no corpo. Antes de enviar, procura segredos (senhas do ambiente, `sk-ant-…`, tokens do GitHub) nos arquivos de texto e **aborta sem enviar nada** se achar. Recomendação: não fazer merge desse PR; ele serve para revisão.
- `issues`: lê o `achados.md` da branch, abre uma issue por achado marcado `[x]` (título, descrição, reprodução, evidências, rótulos `severidade:*`), não duplica (procura o marcador `qa-agent:finding:<id>` em issues abertas) e grava o número em `dados/achados.json`.
- `GITHUB_TOKEN` vem só do ambiente ou do `.env` (ignorado pelo git). Nada é publicado sem esses comandos.

## Configuração (`qa-agent.config.yaml`)

```yaml
explorar: { maxTelas: 80, maxProfundidade: 4, tempoMaximoMin: 20, exemplosPorRota: 3,
            ignorarUrls: ["/logout"], verbosEscrita: [], postPermitidos: [], estabilidadeMs: 1000 }
analises: { ux: true, limites: { lcpMs: 2500, cls: 0.1, carregamentoMs: 5000 } }
publicar: { repo: "dono/saas", rotulos: ["qa-agent"] }
```

## Testar localmente

`npm run test-saas` sobe um SaaS sintético em `http://127.0.0.1:4020` (`qa_user` / `qa_pass`) com problemas plantados (HTTP 500, tela lenta, violações de acessibilidade, exceção JavaScript, link destrutivo, abas e modal, GraphQL). A suíte de aceitação confere que a exploração o encontra e que **nenhuma requisição de escrita chega ao servidor**.

## Limitações conhecidas

- Leituras via `POST` fora de GraphQL deixam a tela incompleta até a rota entrar em `postPermitidos`; a cobertura aponta a rota bloqueada.
- O login por formulário é heurístico; telas incomuns exigem `qa-agent login` (SSO).
- O LCP é medido depois que a tela estabiliza; conteúdo que aparece muito tarde pode ficar de fora.
- Os casos do Excel (`run`) ainda não entram na pasta `fluxos/` do relatório; hoje têm o relatório HTML próprio.
- Qualidade do Aprofundador e da UX com o Claude real verificada em escala pequena (SaaS sintético); falta verificar em SaaS reais.
