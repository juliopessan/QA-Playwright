# Análise pela landing page

A landing page publicada na Vercel tem um formulário em que a pessoa cola a URL de um site, o login (opcional) e um código de acesso. O QA Agent roda a análise completa no GitHub Actions e o relatório volta para a própria página.

```
Landing (#analisar) ─▶ /api/analyze ─▶ GitHub Actions: explore-web.yml ─▶ artefato qa-report-<id>
        ▲                (Vercel)        explore somente leitura,            │
        └──── /api/status e /api/report ◀── todas as análises ───────────────┘
```

## Como funciona

1. **`/api/analyze`** (Vercel) confere o código de acesso, aceita só URLs públicas em http(s) (recusa localhost, IPs privados e nomes internos), exige a confirmação de autorização, aplica o limite diário e dispara o workflow `explore-web.yml`. As credenciais do site vão **cifradas** (AES-256-GCM com `QA_INPUT_KEY`) no input do workflow, que fica visível para quem tem acesso ao repositório.
2. **`explore-web.yml`** (GitHub Actions) decifra as credenciais, as **mascara** no log, roda `qa-agent explore` com até 25 telas e 150 chamadas ao modelo e publica a pasta do relatório como artefato por 7 dias. Em falha, publica `erro.txt`, sem usuário e senha.
3. **`/api/status`** acompanha a execução (fila, em andamento, pronto ou falha). **`/api/report`** serve o `relatorio.html` e as imagens do artefato com uma CSP que **proíbe scripts**, porque o conteúdo vem do site analisado. O acesso ao andamento e ao relatório exige o token assinado devolvido no envio, válido por 3 dias.

As análises entram numa fila única (uma por vez). Sem configuração, as funções respondem que a análise pela web não está configurada, e o resto da landing funciona normalmente.

## Configuração (uma vez)

### 1. Chave compartilhada

Gere uma chave e use **o mesmo valor** na Vercel e no GitHub:

```bash
openssl rand -base64 32
```

### 2. GitHub: secrets do repositório

Em Settings → Secrets and variables → Actions → New repository secret:

| Secret | Valor |
|---|---|
| `ANTHROPIC_API_KEY` | chave da API da Anthropic |
| `QA_INPUT_KEY` | a chave do passo 1 |

### 3. GitHub: token para a Vercel disparar o workflow

Crie um *fine-grained personal access token* (Settings → Developer settings) com acesso **só a este repositório** e a permissão **Actions: Read and write** (o resto como "No access").

### 4. Vercel: variáveis de ambiente do projeto

Em Project → Settings → Environment Variables (ambiente Production):

| Variável | Valor |
|---|---|
| `QA_GITHUB_TOKEN` | o token do passo 3 |
| `QA_GITHUB_REPO` | `juliopessan/QA-Playwright` |
| `QA_INPUT_KEY` | a chave do passo 1 |
| `QA_ACCESS_CODES` | códigos de acesso separados por vírgula (mínimo 6 caracteres cada), por exemplo `TIME-QA-2026` |
| `QA_DAILY_LIMIT` | opcional: análises por 24 horas (padrão 10) |
| `QA_GITHUB_REF` | opcional: branch do workflow (padrão `main`) |

Depois de salvar, faça um *redeploy* para as funções lerem as variáveis.

## Segurança e limites

- **Somente leitura:** a exploração usa as duas travas do QA Agent (elemento e rede). Fluxos com escrita (`objetivos.md`) não estão disponíveis pela web.
- **Quem pode rodar:** só quem tem um código de acesso. Revogue um código tirando-o de `QA_ACCESS_CODES` e fazendo redeploy.
- **Custo:** cada análise consome minutos do GitHub Actions e chamadas ao Claude (até 150). O limite diário vale para todo o site.
- **Credenciais:** não são gravadas. Saem do navegador por HTTPS para a função, seguem cifradas até o workflow e ficam mascaradas no log. Recomende usuários de teste em homologação.
- **Relatório:** fica no artefato por 7 dias e só abre com o link assinado. Ele contém screenshots do site analisado, com campos de senha cobertos.
- **Autorização:** a pessoa confirma que pode testar o site. A análise só aceita sites públicos na internet.

## Desenvolvimento

- Funções: `api/analyze.js`, `api/status.js`, `api/report.js` e `api/_lib/` (JavaScript puro, sem build).
- Workflow: `.github/workflows/explore-web.yml`, com `scripts/open-input.mjs` e `scripts/redact-file.mjs`.
- Landing: `landing/index.src.html` (fonte) e `landing/index.html` (gerado com o Ledger); o build do site (`npm run build:web`) coloca a landing na raiz e o app de teste em `/demo/`.
- Testes: `test/web/` (funções e scripts, com GitHub simulado), `test/ci/workflow.test.ts` (estrutura do workflow) e `test/app/landing.test.ts` (landing no navegador com a API simulada).
