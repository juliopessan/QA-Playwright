import { describe, it, expect } from "vitest";
import { parseObjectives } from "../../src/flows/parse.js";

describe("parseObjectives", () => {
  it("lê título, objetivo e critério de sucesso", () => {
    const { objectives, errors } = parseObjectives(`# Objetivos

## Convidar um usuário
Entrar na tela de equipe e convidar um novo usuário.
**Sucesso:** a requisição de convite é enviada.

## Ver faturas
Abrir a tela de faturas.
**Sucesso:**
A lista de faturas aparece.
`);
    expect(errors).toEqual([]);
    expect(objectives).toHaveLength(2);
    expect(objectives[0]).toMatchObject({ title: "Convidar um usuário", goal: "Entrar na tela de equipe e convidar um novo usuário.", success: "a requisição de convite é enviada." });
    expect(objectives[0].id).toBe("convidar-um-usuario");
    expect(objectives[1].success).toBe("A lista de faturas aparece.");
  });

  it("aponta objetivos sem texto ou sem critério e segue com os válidos", () => {
    const { objectives, errors } = parseObjectives("## A\nfaz algo\n\n## B\n**Sucesso:** x\n\n## C\ntexto\n**Sucesso:** ok");
    expect(objectives.map((o) => o.title)).toEqual(["C"]);
    expect(errors).toHaveLength(2);
    expect(errors.join(" ")).toMatch(/"A".*critério/);
    expect(errors.join(" ")).toMatch(/"B".*objetivo/);
  });

  it("ids repetidos ganham sufixo", () => {
    const { objectives } = parseObjectives("## Igual\nx\n**Sucesso:** y\n\n## Igual\nz\n**Sucesso:** w");
    expect(objectives.map((o) => o.id)).toEqual(["igual", "igual-2"]);
  });

  it("arquivo vazio não dá objetivos nem erros", () => {
    expect(parseObjectives("")).toEqual({ objectives: [], errors: [] });
  });
});
