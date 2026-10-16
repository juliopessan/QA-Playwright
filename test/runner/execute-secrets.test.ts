import { describe, it, expect } from "vitest";
import { redactSecrets, type ExecCtx } from "../../src/runner/execute.js";

const ctx = (env: Record<string, string>, secrets: string[] = []): ExecCtx => ({
  timeoutMs: 1000,
  allowedHosts: [],
  baseUrl: "",
  env,
  secrets: new Set(secrets),
  blocked: [],
});

describe("redactSecrets", () => {
  it("redige valores longos de variáveis com PASS/TOKEN/KEY/SECRET no nome", () => {
    const c = ctx({ APP_PASS: "secret_sauce", API_TOKEN: "tok-123456789" });
    expect(redactSecrets("a secret_sauce b tok-123456789", c)).toBe("a •••• b ••••");
  });

  it("ignora valores curtos de variáveis sensíveis (ex.: FLAG_KEY=1 não pode destruir URLs e números)", () => {
    const c = ctx({ SOME_KEY: "1", OTHER_TOKEN: "0", DEBUG_SECRET: "true" });
    expect(redactSecrets("http://127.0.0.1:4010 total 10 true", c)).toBe("http://127.0.0.1:4010 total 10 true");
  });

  it("valores digitados em campo de senha (ctx.secrets) são sempre redigidos, mesmo curtos", () => {
    const c = ctx({}, ["1234"]);
    expect(redactSecrets("senha 1234 ok", c)).toBe("senha •••• ok");
  });
});
