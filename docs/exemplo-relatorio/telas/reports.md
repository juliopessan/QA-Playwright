# Relatórios · Acme SaaS

- **Rota:** `/reports`
- **Exemplos visitados:** `http://127.0.0.1:4020/reports`
- **Caminho:** Início › Relatórios

![Relatórios · Acme SaaS](../img/reports.jpg)

## Achados (4)

<a id="eebea8e37f"></a>
### **MÉDIA** · Acessibilidade · Acessibilidade: Page should contain a level-one heading

Ensure that the page, or at least one of its frames contains a level-one heading. Regra axe `page-has-heading-one`. https://dequeuniversity.com/rules/axe/4.14/page-has-heading-one?application=playwright

**Evidências**

- /reports: html

**Como reproduzir**

1. Início
2. Relatórios

**Sugestão:** Page must have a level-one heading

`id: eebea8e37f`

<a id="3a29df5760"></a>
### **MÉDIA** · UX · Métrica sem período nem contexto de comparação

> Opinião do agente (confiança 80%): não é uma medição objetiva.

"Receita do mês" não diz qual mês nem traz comparação com o período anterior ou com a meta. Assim, quem lê não sabe se o número é bom ou ruim.

**Evidências**

- Texto "Receita do mês: R$ 120.000" sem mês/ano, sem data de atualização e sem variação.

**Como reproduzir**

1. Início
2. Relatórios

**Sugestão:** Mostrar o período (ex.: "Receita de março/2025"), a variação em relação ao mês anterior e a data da última atualização.

`id: 3a29df5760`

<a id="2b55024e47"></a>
### **MÉDIA** · UX · Página de Relatórios sem filtros, detalhamento ou exportação

> Opinião do agente (confiança 75%): não é uma medição objetiva.

A tela tem o título "Relatórios", mas mostra só um número solto. Não dá para mudar o período, ver a composição da receita nem exportar os dados, que é o que se espera de uma área de relatórios.

**Evidências**

- Abaixo do título "Relatórios" só aparece a linha "Receita do mês: R$ 120.000"; não há filtros, gráficos, tabelas nem botões.

**Como reproduzir**

1. Início
2. Relatórios

**Sugestão:** Incluir um seletor de período, uma tabela ou gráfico com a receita detalhada (por projeto ou cliente) e uma ação para exportar (CSV/PDF).

`id: 2b55024e47`

<a id="3ddc941437"></a>
### **BAIXA** · UX · Rótulo e valor da métrica com o mesmo estilo

> Opinião do agente (confiança 60%): não é uma medição objetiva.

O rótulo e o valor aparecem numa única linha, com a mesma fonte e o mesmo peso. Nada destaca o número, e a métrica fica maior que o próprio título da página, o que inverte a hierarquia.

**Evidências**

- "Receita do mês: R$ 120.000" está em fonte maior que o título "Relatórios", e rótulo e valor têm o mesmo estilo.

**Como reproduzir**

1. Início
2. Relatórios

**Sugestão:** Usar um card de KPI: rótulo pequeno e discreto, valor em destaque e título da página como o elemento principal.

`id: 3ddc941437`
