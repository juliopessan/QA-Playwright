import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CompiledStep } from "../types/index.js";

export const COMPILER_VERSION = "1";

export interface CacheKeyParts {
  stepText: string;
  /** Template de `Dados` (com {{VAR}} sem resolver). */
  data?: string;
  expected?: string;
  url: string;
  compilerVersion: string;
  providerId: string;
}

function stableUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url;
  }
}

export function cacheKey(p: CacheKeyParts): string {
  const payload = JSON.stringify([
    p.stepText,
    p.data ?? "",
    p.expected ?? "",
    stableUrl(p.url),
    p.compilerVersion,
    p.providerId,
  ]);
  return createHash("sha256").update(payload).digest("hex");
}

export class CompileCache {
  constructor(private readonly dir: string) {}
  private file(key: string) {
    return join(this.dir, `${key}.json`);
  }
  async get(key: string): Promise<CompiledStep | undefined> {
    try {
      return JSON.parse(await readFile(this.file(key), "utf8")) as CompiledStep;
    } catch {
      return undefined;
    }
  }
  async set(key: string, value: CompiledStep): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.file(key), JSON.stringify({ ...value, fromCache: false }, null, 2));
  }
  async delete(key: string): Promise<void> {
    await rm(this.file(key), { force: true });
  }
}
