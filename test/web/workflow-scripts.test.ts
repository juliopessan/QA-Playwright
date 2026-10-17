import { describe, it, expect } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sealCreds } from "../../api/_lib/core.js";

const run = (script: string, args: string[], env: Record<string, string>) =>
  spawnSync("node", [script, ...args], { env: { PATH: process.env.PATH ?? "", ...env }, encoding: "utf8" });

describe("scripts/open-input.mjs", () => {
  it("decifra, mascara no log (sem imprimir em claro fora da máscara) e exporta APP_USER/APP_PASS", () => {
    const dir = mkdtempSync(join(tmpdir(), "qa-in-"));
    const envFile = join(dir, "env");
    writeFileSync(envFile, "");
    const r = run("scripts/open-input.mjs", [], { QA_PAYLOAD: sealCreds({ user: "ana", pass: "s3gr3do!" }, "k"), QA_INPUT_KEY: "k", GITHUB_ENV: envFile });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("::add-mask::s3gr3do!");
    expect(r.stdout.replace("::add-mask::s3gr3do!", "")).not.toContain("s3gr3do!");
    expect(readFileSync(envFile, "utf8")).toBe("APP_USER=ana\nAPP_PASS=s3gr3do!\n");
  });

  it("site sem login: exporta um marcador e não falha", () => {
    const dir = mkdtempSync(join(tmpdir(), "qa-in-"));
    const envFile = join(dir, "env");
    writeFileSync(envFile, "");
    const r = run("scripts/open-input.mjs", [], { QA_PAYLOAD: sealCreds({ user: "", pass: "" }, "k"), QA_INPUT_KEY: "k", GITHUB_ENV: envFile });
    expect(r.status).toBe(0);
    expect(readFileSync(envFile, "utf8")).toBe("APP_USER=sem-login\nAPP_PASS=sem-login\n");
  });

  it("chave errada sai com 2 sem vazar nada", () => {
    const r = run("scripts/open-input.mjs", [], { QA_PAYLOAD: sealCreds({ user: "ana", pass: "s3gr3do!" }, "k"), QA_INPUT_KEY: "outra" });
    expect(r.status).toBe(2);
    expect(r.stdout + r.stderr).not.toContain("s3gr3do!");
  });
});

describe("scripts/redact-file.mjs", () => {
  it("tira usuário e senha do arquivo de erro", () => {
    const f = join(mkdtempSync(join(tmpdir(), "qa-red-")), "erro.txt");
    writeFileSync(f, "Login falhou para ana com s3gr3do!");
    execFileSync("node", ["scripts/redact-file.mjs", f], { env: { PATH: process.env.PATH ?? "", APP_USER: "ana", APP_PASS: "s3gr3do!" } });
    expect(readFileSync(f, "utf8")).toBe("Login falhou para •••• com ••••");
  });
});
