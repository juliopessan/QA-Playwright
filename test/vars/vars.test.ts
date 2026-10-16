import { describe, it, expect } from "vitest";
import { resolveVars, assertVars, makeRedactor } from "../../src/vars/index.js";

describe("vars", () => {
  it("resolve {{APP_USER}} usando env", () => {
    const r = resolveVars("usuário {{APP_USER}}", { APP_USER: "maria" });
    expect(r.value).toBe("usuário maria");
    expect(r.used).toEqual(["APP_USER"]);
    expect(r.missing).toEqual([]);
  });
  it("retorna missing quando a variável não existe", () => {
    const r = resolveVars("{{A}} e {{B}}", { A: "1" });
    expect(r.missing).toEqual(["B"]);
    expect(r.value).toBe("1 e {{B}}");
  });
  it("assertVars lista todas as ausentes", () => {
    expect(() => assertVars(["X", "Y", "Z"], { Y: "1" })).toThrow("Variáveis ausentes: X, Z");
  });
  it("assertVars trata string vazia como ausente", () => {
    expect(() => assertVars(["X"], { X: "" })).toThrow("Variáveis ausentes: X");
  });
  it("redactor troca o segredo em qualquer posição e múltiplas ocorrências", () => {
    const red = makeRedactor(["secret_sauce"]);
    expect(red("a secret_sauce b secret_sauce")).toBe("a •••• b ••••");
  });
  it("redactor troca primeiro o segredo mais longo", () => {
    const red = makeRedactor(["abc", "abcdef"]);
    expect(red("x abcdef y")).toBe("x •••• y");
  });
  it("redactor com lista vazia devolve o texto intacto", () => {
    expect(makeRedactor([])("texto")).toBe("texto");
    expect(makeRedactor([""])("texto")).toBe("texto");
  });
  it("redactor escapa metacaracteres de regex no segredo", () => {
    expect(makeRedactor(["a.b*c"])("x a.b*c y aXbbbc")).toBe("x •••• y aXbbbc");
  });
});
