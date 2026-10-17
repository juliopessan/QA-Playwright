import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Cache de respostas do LLM em disco (um JSON por chave), para execuções repetidas não gastarem chamadas. */
export class DiskCache {
  constructor(private readonly dir: string) {}

  private file(key: string): string {
    return join(this.dir, `${createHash("sha1").update(key).digest("hex")}.json`);
  }

  get<T>(key: string): T | undefined {
    try {
      return JSON.parse(readFileSync(this.file(key), "utf8")) as T;
    } catch {
      return undefined;
    }
  }

  set(key: string, value: unknown): void {
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(this.file(key), JSON.stringify(value));
  }
}
