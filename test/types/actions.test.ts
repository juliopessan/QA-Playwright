import { describe, it, expect } from "vitest";
import { ActionSchema, CompileResponseSchema } from "../../src/types/actions.js";

describe("ActionSchema", () => {
  it("aceita click com locator role+name", () => {
    const r = ActionSchema.safeParse({
      kind: "click",
      locator: { role: "button", name: "Login" },
      description: "Clicar em Login",
    });
    expect(r.success).toBe(true);
  });
  it('rejeita kind "exec"', () => {
    const r = ActionSchema.safeParse({ kind: "exec", command: "rm -rf /", description: "x" });
    expect(r.success).toBe(false);
  });
  it("rejeita fill sem locator", () => {
    const r = ActionSchema.safeParse({ kind: "fill", value: "abc", description: "x" });
    expect(r.success).toBe(false);
  });
  it("CompileResponseSchema rejeita confidence 1.5", () => {
    const r = CompileResponseSchema.safeParse({
      kind: "action",
      actions: [],
      confidence: 1.5,
      subjective: false,
    });
    expect(r.success).toBe(false);
  });
});
