# Guia de uso

## Instalação

```bash
npm install
npx playwright install chromium
npm run build
```

Requer Node 20.12+ (usa `util.parseEnv`).

## Variáveis (`.env`)

Segredos ficam **somente** no `.env` (ou nos *secrets* do CI), nunca no Excel. Veja `fixtures/.env.example`.

| Variável | Uso |
|---|---|
| `ANTHROPIC_API_KEY` | Chave da API do Claude (provedor padrão). |
| `QA_AGENT_MODEL` | Modelo a usar (padrão `claude-opus-5-5`; `claude-sonnet-5-5` é mais barato). |
| `APP_USER`, `APP_PASS`, ... | As que o seu Excel referenciar como `{{NOME}}` na coluna `Dados`. |

Valores de variáveis cujo nome contém `PASS`, `SECRET`, `TOKEN`, `KEY` ou `PWD` são redigidos (`••••`) em erros, logs e relatório.

## Formato do Excel

Aba **`Casos`**, uma linha por **passo**; passos com o mesmo `ID` formam um caso (ordenados por `Passo nº`).

| ID | Título | Passo nº | Passo | Dados | Resultado esperado |
|---|---|---|---|---|---|

- `Resultado esperado` preenchido num passo = verificação feita naquele passo.
- `Dados` aceita literal ou `{{VARIAVEL}}`.
- Colunas desconhecidas são ignoradas. Os nomes das colunas são configuráveis (`columns` em `qa-agent.config.yaml`).
- Linha malformada (sem ID, sem Passo, Passo nº duplicado) → o caso inteiro fica `blocked` e a linha é listada no relatório.

Aba opcional **`Config`** (`Parâmetro | Valor | Descrição`):

| Parâmetro | Efeito |
|---|---|
| `ambiente` | Nome do ambiente (aparece no relatório). |
| `url_base` | URL base; `goto` relativo é resolvido contra ela. |
| `timeout_passo_s` | Tempo máximo por ação, em segundos. |
| `mascarar_seletores` | Seletores CSS a mascarar nos prints, separados por `;` (campos de senha já são sempre mascarados). |
| `variaveis_esperadas` | Variáveis obrigatórias (o run aborta com a lista das ausentes). |
| `hosts_permitidos` | Hosts extras permitidos, separados por vírgula (ex.: o host do SSO). |
| `padrao_url_login` | Regex da URL de login/SSO; ativa a detecção de sessão expirada. |

Precedência: padrões < `qa-agent.config.yaml` < aba `Config` < opções da CLI.

## Login simples (sem SSO)

Para sistemas com login por formulário (usuário e senha), **não é preciso `qa-agent login`**: faça o login nos próprios passos do Excel, com os dados em variáveis.

| ID | Passo nº | Passo | Dados |
|---|---|---|---|
| TC-001 | 2 | Preencher o campo de usuário | `{{APP_USER}}` |
| TC-001 | 3 | Preencher o campo de senha | `{{APP_PASS}}` |
| TC-001 | 4 | Clicar no botão Login | |

Defina `APP_USER` e `APP_PASS` no `.env` e **não** configure `padrao_url_login`: sem ele, a detecção de sessão expirada fica desligada e nada é tratado como SSO. O campo de senha é sempre mascarado nos prints.

Para testar o pipeline sem chave de API e sem rede, use `npm run demo` (app local com este mesmo tipo de login).

## Login SSO

```bash
node dist/cli/index.js login --base-url https://app.interna.exemplo
```

Abre o navegador; faça o SSO e pressione Enter no terminal. A sessão é salva em `.qa-auth/state.json` (modo 0600, ignorado pelo git) e reutilizada em todos os casos. Se a sessão expirar durante um run (a URL passa a casar com `padrao_url_login`), o run **para** sem reprovar casos e sai com código 3; rode `login` de novo e use `--resume <runId>`.

> A v1 assume SSO sem MFA, ou contas de serviço. MFA interativo no CI está fora do escopo.

## Comandos

```
qa-agent login [--base-url <url>]
qa-agent run <xlsx> [--only <id>] [--base-url <url>] [--no-heal] [--headed]
                    [--resume <runId>] [--max-llm-calls <n>] [--env-file <path>]
                    [--config <yaml>] [--evidence embedded|linked] [--dry-run]
qa-agent report [--run <runId>] [--evidence embedded|linked]
```

## Códigos de saída

| Código | Significado |
|---|---|
| 0 | Nenhum caso reprovado ou bloqueado (`needs-review` não derruba o exit; aparece no resumo). |
| 1 | Há casos `fail` ou `blocked`. |
| 2 | Entrada inválida (arquivo, variável ausente, linha malformada, run inexistente, `ANTHROPIC_API_KEY` ausente). |
| 3 | Sessão SSO expirada; run interrompido. |

## Vereditos

| Status | Quando |
|---|---|
| `pass` | Todos os passos passaram e as verificações subjetivas tiveram evidência citada pelo Judge. |
| `fail` | Um passo falhou (ação não executável ou asserção que não bateu) ou o Judge reprovou. |
| `needs-review` | Passo não resolvido com confiança, LLM indisponível/sem orçamento, ou Judge sem evidência suficiente. |
| `blocked` | Linha malformada no Excel. |

Passos corrigidos pelo Healer aparecem como `healed`, com a nota e o antes/depois. O Healer **só** troca ações de interação que falharam; asserções (`expectText`/`expectUrl`) e navegações para hosts não permitidos nunca são "curadas".

## Segurança

- Prints e texto de página enviados ao LLM passam por mascaramento/redação (e-mail, CPF, Bearer, JWT e padrões extras em `redactPatterns`).
- Conteúdo da página é tratado como **dado não confiável** nos prompts; o schema só admite as ações listadas.
- O Runner só navega em `allowedHosts` (padrão: host da `url_base` + `hosts_permitidos`); navegação para outro host falha explicitamente.

## Relatório

`runs/<runId>/report/index.html`. Por padrão as imagens vão embutidas (arquivo único, fácil de anexar); use `--evidence linked` em runs grandes para referenciar `runs/<runId>/evidence/`. As cores de marca são aproximadas: ajuste apenas `src/reporter/tokens.css`.

## CI

`.github/workflows/qa.yml` roda por agendamento ou manualmente e publica `report/` e `manifest.json` como artefato (mesmo em falha). Configure:

- *Secrets*: `ANTHROPIC_API_KEY`, `APP_USER`, `APP_PASS`, `LOCKED_USER` (conforme o seu Excel).
- *Variable*: `QA_BASE_URL`.

Para aplicações atrás de SSO, o runner precisa de rede até a aplicação e de uma conta de serviço sem MFA; a sessão salva por `login` não é portátil entre máquinas.
