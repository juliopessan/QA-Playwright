# QA Agent: design

Data: 2026-10-16 · Status: aprovado em conversa, aguardando revisão da spec escrita

## 1. Objetivo e contexto

Hoje o QA é manual: alguém executa cada caso no navegador, tira prints e cola tudo em um Excel.
O QA Agent automatiza o fluxo de ponta a ponta:

**caso de teste (linhas de Excel em linguagem natural) → execução no navegador (Playwright) → evidência (prints por passo) → relatório HTML navegável.**

### Critérios de sucesso

1. A partir de um Excel com passos em linguagem natural, o agente executa os casos sem intervenção, captura evidência por passo e gera o relatório.
2. A evidência é confiável: em dúvida, o sistema nunca marca `pass`.
3. Execuções repetidas são rápidas e reprodutíveis (compilação em cache; LLM fora do caminho quente).
4. Toda ação que o agente corrigiu sozinho fica visível e auditável.
5. Roda localmente como CLI e pode ir ao CI sem redesenho.

### Restrições

- Aplicação alvo: interna, com SSO corporativo (sem MFA ou com contas de serviço).
- Entrada: linhas do Excel, passos em linguagem natural.
- Saída: relatório HTML autocontido, com a paleta da Bayer.
- LLM: Claude como padrão, atrás de interface trocável (política de LLM da empresa ainda não confirmada).
- Dados sensíveis: prints e texto de página não podem vazar para o LLM nem para o relatório sem mascaramento.

### Fora do escopo da v1

Geração de casos a partir de requisitos; execução paralela, multi-navegador, mobile e desktop; painel web e banco de histórico; escrita de resultados de volta em Excel, Jira, Azure DevOps ou TestRail; testes de carga e de API; login com MFA interativo no CI.

## 2. Abordagem escolhida

Híbrida com autocorreção:

1. **Compilar:** o LLM converte cada passo em ações estruturadas, resolvendo seletores com o snapshot real da página. O resultado vai para cache.
2. **Executar:** as ações em cache rodam de forma determinística, com screenshot antes e depois de cada passo.
3. **Autocorrigir:** se uma ação falha, o Healer assume só aquele passo em modo ao vivo, tenta resolver e registra a correção como `healed`.
4. **Julgar:** o Judge compara esperado e observado citando evidência objetiva. Resultado ambíguo vira `needs-review`.

Alternativas descartadas: agente ao vivo em todos os passos (lento, caro, não reprodutível) e compilar-e-executar puro (frágil a mudanças de tela).

Stack: TypeScript, Playwright (Chromium), Node.

## 3. Arquitetura

```
casos.xlsx ─▶ Reader ─▶ TestCase[]
                          │
                   Compiler ◀── snapshot da página + LLMProvider
                          │       (cache em .qa-cache/)
                     CompiledCase
                          │
                    Runner ── Playwright, screenshot por passo
                          │     └─ ação falhou? ─▶ Healer (ao vivo, só aquele passo)
                  StepResult[] + evidências
                          │
                     Judge ◀── LLMProvider (esperado vs. observado)
                          │
                    CaseVerdict
                          │
                   Reporter ─▶ runs/<runId>/report/index.html
```

| Unidade | Responsabilidade | Depende de |
|---|---|---|
| Reader | Lê o Excel e produz `TestCase`; valida colunas e sinaliza linhas malformadas | biblioteca xlsx |
| Compiler | Converte passos em ações; classifica cada passo como ação ou verificação; cache por hash | `LLMProvider`, Playwright |
| Runner | Executa ações, captura screenshots, usa `storageState` do SSO, respeita `allowedHosts` | Playwright |
| Healer | Corrige uma ação falha em modo ao vivo; atualiza o cache; marca `healed` | `LLMProvider`, Playwright |
| Judge | Julga resultado esperado vs. observado; só usa o LLM quando o critério é subjetivo | `LLMProvider` |
| Reporter | Gera o relatório HTML a partir de manifest e evidências | `tokens.css` |
| llm | `LLMProvider`, `AnthropicProvider`, `FakeLLMProvider` | SDK do provedor |
| masking | Mascara prints e texto antes de gravar ou enviar ao LLM | Playwright |
| auth | `qa-agent login` salva a sessão SSO (`storageState`) | Playwright |
| types | Tipos compartilhados | n/a |

### CLI

```
qa-agent login
qa-agent run casos.xlsx [--only TC-012] [--no-heal] [--headed] [--resume] [--max-llm-calls N]
qa-agent report            # reabre o último relatório
```

O CLI não exige interação, por isso roda igual no CI.

## 4. Entrada: Excel e modelo de dados

### Formato

Uma aba de casos, uma linha por **passo**; passos com o mesmo ID formam um caso. O mapeamento de colunas é configurável (`qa-agent.config.yaml`), pois o Excel real do time pode ter outro layout.

| ID | Título | Passo nº | Passo | Dados | Resultado esperado |
|---|---|---|---|---|---|

- `Resultado esperado` preenchido em um passo = verificação naquele passo. Vazio = passo de ação.
- `Dados` aceita literal ou variável `{{NOME}}`, resolvida a partir de `.env`. Credenciais nunca ficam no Excel.
- Colunas desconhecidas são ignoradas.
- Aba opcional `Config`: ambiente, URL base, timeouts, seletores a mascarar, `allowedHosts`, nomes das variáveis esperadas.

Exemplo completo: `fixtures/casos-sinteticos.xlsx` (12 casos, 80 passos, contra a SauceDemo) e `fixtures/.env.example`.

### Tipos principais

```ts
TestCase      { id, title, steps: Step[], expected?: string }
Step          { index, text, data?, expected? }
CompiledStep  { stepIndex, actions: Action[], confidence, fromCache }
Action        = goto | click | fill | select | press | waitFor | expectText | expectUrl
                // cada uma com locator resolvido, valor e descrição legível
StepResult    { stepIndex, status: pass|fail|healed|skipped,
                screenshotBefore, screenshotAfter, durationMs, error?, healNote? }
CaseVerdict   { caseId, status: pass|fail|needs-review|blocked,
                reasoning, evidenceRefs[], steps: StepResult[] }
RunManifest   { runId, startedAt, env, versões do CLI e do modelo, commit, verdicts[] }
```

### Regras

- Locators por papel e nome (`getByRole`), nunca seletores frágeis.
- Chave de cache = hash(texto do passo + URL de origem + versão do compilador + `provider.id`).
- Passo classificado como verificação vira `expectText`/`expectUrl` determinístico sempre que possível; o Judge (LLM) só entra em critérios subjetivos.
- Falha sem correção: os passos seguintes do mesmo caso viram `blocked`; os outros casos continuam.
- Passo que o Compiler não resolve com confiança vira `needs-review`; o sistema não inventa um clique.
- O manifest é gravado de forma incremental, o que permite `--resume`.

## 5. Relatório HTML e identidade visual

### Princípios

Um único `index.html` autocontido (CSS, JS e imagens embutidos; opção de pasta `evidence/` para originais). Sem framework nem build de front-end. Toda afirmação aponta para um print ou trecho de texto observado.

### Estrutura

1. Cabeçalho (azul-marinho): run, ambiente, data e hora, versões do modelo e do CLI, commit.
2. Resumo: contadores (Aprovados, Reprovados, Revisão humana, Bloqueados, Autocorrigidos), barra de proporção, tempo total.
3. Filtros: por status, busca por ID/título, "mostrar só o que exige atenção" (padrão).
4. Lista de casos (acordeão): parecer do Judge e linha do tempo dos passos com prints antes/depois (lightbox).
5. Seção "Autocorreções": o que o Healer mudou, antes e depois.
6. Rodapé: manifest (download), aviso de dados mascarados, link para trace do Playwright.

### Tokens visuais (`tokens.css`)

Valores abaixo são **aproximados e não verificados** contra o brand guide oficial; trocar apenas este arquivo caso necessário.

| Uso | Cor |
|---|---|
| Cabeçalho, títulos | `#10384F` |
| Links, destaques, foco | `#0091DF` |
| Acentos | `#00BCFF` |
| Aprovado | `#89D329` |
| Reprovado | `#D9363E` (fora da marca, por semântica) |
| Revisão humana | `#F5A623` (fora da marca, por semântica) |
| Bloqueado | `#8A97A0` |

- Status nunca dependem só de cor: ícone e texto em todos os selos.
- Validar a razão de contraste na implementação (o verde claro pode falhar com texto branco).
- Modo escuro via `prefers-color-scheme`; folha `@media print` expande os casos e remove controles.
- Pilha de fontes do sistema; não se imita a tipografia proprietária da marca.
- Miniaturas embutidas e originais em `evidence/` por padrão; modo totalmente embutido opcional.

## 6. Erros, segurança e interface do LLM

### `LLMProvider`

```ts
interface LLMProvider {
  readonly id: string;
  complete<T>(req: {
    task: "compile" | "heal" | "judge";
    system: string; prompt: string;
    images?: MaskedImage[];
    schema: JSONSchema;
  }): Promise<{ data: T; usage: Usage }>;
}
```

- Saída sempre estruturada e validada por schema; uma retentativa com o erro anexado; depois disso, `needs-review`.
- `MaskedImage` só é construído pelo módulo `masking`; o compilador impede enviar print cru.
- Tokens e custo por run no manifest; teto configurável por `--max-llm-calls`.

### Taxonomia de erros

| Situação | Tratamento | Resultado |
|---|---|---|
| Linha malformada | Rejeitada na leitura e listada no relatório | caso `blocked` |
| LLM indisponível ou limite atingido | Recuo exponencial; segue só com ações em cache | passos sem cache: `blocked` |
| Ação falha | Healer tenta até N vezes (padrão 2) | `healed` ou `fail` |
| Sessão SSO expirada | Detectada por redirecionamento ao login; run para cedo | run abortado, sem falsos reprovados |
| Resposta inválida do LLM | 1 retentativa | `needs-review` |
| Judge sem evidência suficiente | Veredito explícito de incerteza | `needs-review` |
| Crash no run | Manifest e evidências incrementais | `--resume` |

Regra de ouro: em dúvida, nunca promover para `pass`. O Healer nunca marca `pass`; um passo corrigido ainda passa pelo Judge e fica rotulado `healed`.

### Segurança

- Segredos só em `.env` ou no cofre do CI; nunca em Excel, cache, manifest ou relatório; valores secretos viram `••••` em logs e no texto dos passos.
- Mascaramento: campos de senha sempre; seletores extras via `Config`; vale para o print salvo e para o que vai ao LLM.
- Texto de página enviado ao LLM passa por filtro de padrões sensíveis (e-mails, CPF, tokens).
- Prompt injection: conteúdo da página é dado, não instrução; prompts o delimitam como não confiável; o schema só permite as ações listadas; não existe ação de executar código.
- O Runner só navega em `allowedHosts`; redirecionamento externo é falha explícita.
- `storageState` com permissões restritas e fora do versionamento (`.gitignore` gerado por `qa-agent login`).

### Testes do próprio sistema

- Unitários: Reader (layouts válidos e inválidos), hash de cache, mascaramento, classificação de status, schemas.
- `FakeLLMProvider` com respostas gravadas: testa Compiler, Healer e Judge sem rede nem custo.
- Integração: contra um app de teste local servido com o projeto (sem depender da SauceDemo no CI). O Excel sintético é o conjunto de aceitação: os vereditos devem bater com a coluna "Observação (sintético)".
- Relatório: snapshot visual com dados fixos e verificação de acessibilidade (axe).

## 7. Estrutura do repositório

```
QA-Playwright/
├─ src/{cli,reader,compiler,runner,healer,judge,reporter,llm,masking,auth,types}/
├─ test/
├─ fixtures/            # casos-sinteticos.xlsx, .env.example, respostas gravadas do LLM
├─ docs/
├─ .qa-cache/           # .gitignore
├─ runs/<runId>/        # .gitignore: manifest.json, evidence/, report/index.html
└─ qa-agent.config.yaml
```

## 8. Fases de entrega

| Fase | Entrega | Pronto quando |
|---|---|---|
| 1. Esqueleto | Tipos, Reader, `FakeLLMProvider`, CLI `run` básico, testes unitários | O Excel sintético é lido e linhas malformadas são reportadas |
| 2. Execução | Compiler com cache, Runner com screenshots, login SSO | TC-001 a 008 e 012 rodam na SauceDemo com prints por passo |
| 3. Julgamento | Judge, `needs-review` e `blocked`, manifest incremental, `--resume` | TC-009, TC-010 e TC-011 produzem os vereditos previstos |
| 4. Autocorreção | Healer, registro de `healed`, teto de chamadas ao LLM | Uma quebra induzida de seletor é corrigida e aparece na evidência |
| 5. Relatório | HTML com paleta Bayer, filtros, lightbox, impressão, mascaramento | Relatório do Excel sintético revisado e sem violações do axe |
| 6. CI | Workflow de exemplo (GitHub Actions) e documentação | Run agendado publica o relatório como artefato |

As fases 4 e 6 podem ser adiadas sem quebrar o restante.

## 9. Riscos e questões em aberto

1. **Excel real × sintético.** Mitigação: mapeamento de colunas configurável; a primeira tarefa da fase 1 valida com o arquivo real do time.
2. **SSO corporativo.** Particularidades do fluxo (redirecionamentos, política de dispositivo) só se resolvem com teste real; a fase 2 inclui um ensaio.
3. **Qualidade da compilação por LLM** em telas complexas. Mitigação: confiança por passo, `needs-review` em dúvida, Healer.
4. **Política de LLM da empresa.** O provedor trocável cobre isso, mas pode exigir uma segunda implementação.
5. **Valores de cor** da Bayer aproximados; confirmar com o brand guide.
6. **Textos e preços da SauceDemo** no Excel sintético foram escritos de memória; conferir na primeira execução.
