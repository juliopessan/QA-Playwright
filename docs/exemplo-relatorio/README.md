# Relatório de QA — http://127.0.0.1:4020

- **Run:** `20261017-185552-269d`
- **Início:** 2026-10-17T18:55:52.577Z · **Fim:** 2026-10-17T18:58:28.504Z
- **Cobertura:** 8 telas (+ 3 subestados), 1 ações bloqueadas pelo modo somente leitura
- **LLM:** 23 chamadas, 49316 tokens de entrada, 11646 de saída

## Resumo dos achados

| Gravidade | Qtde |
|---|---|
| Crítica | 2 |
| Alta | 4 |
| Média | 27 |
| Baixa | 5 |

Por categoria: Técnico 4 · Acessibilidade 7 · UX 27

## Fluxos-objetivo

| Fluxo | Resultado |
|---|---|
| [Ver os detalhes da equipe](fluxos/ver-os-detalhes-da-equipe.md) | Aprovado |

## Principais achados

- **CRÍTICA** · Acessibilidade: Form elements must have labels · [detalhes](telas/settings.md#184f66be55)
- **CRÍTICA** · Acessibilidade: Images must have alternative text · [detalhes](telas/settings.md#8a50490b34)
- **ALTA** · Acessibilidade: <html> element must have a lang attribute · [detalhes](telas/help.md#98cabb27ac)
- **ALTA** · Acessibilidade: Documents must have <title> element to aid in navigation · [detalhes](telas/help.md#17ad4e8bdd)
- **ALTA** · Exceção JavaScript não tratada: undefinedHelper is not defined · [detalhes](telas/dashboard.md#fc58b53f3e)
- **ALTA** · HTTP 500 em GET /api/invoices · [detalhes](telas/billing.md#323f2d8dee)
- **MÉDIA** · Acessibilidade: All page content should be contained by landmarks · [detalhes](telas/help.md#a70e66eee2)
- **MÉDIA** · Acessibilidade: Document should have one main landmark · [detalhes](telas/help.md#1364f07991)
- **MÉDIA** · Acessibilidade: Page should contain a level-one heading · [detalhes](telas/reports.md#eebea8e37f)
- **MÉDIA** · Erro no console: Falha ao carregar faturas: 500 · [detalhes](telas/billing.md#2d4e419975)

## Arquivos

- [`achados.md`](achados.md): todos os achados, com checkbox de aprovação para virar issue
- [`mapa.md`](mapa.md): mapa de telas e navegação
- [`cobertura.md`](cobertura.md): o que foi e o que não foi explorado
- `telas/`: uma página por tela, com screenshots e análises
- `fluxos/`: passo a passo de cada fluxo-objetivo (quando houver)
- `dados/`: `achados.json` e `manifest.json`
