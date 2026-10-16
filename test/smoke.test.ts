import { describe, it, expect } from "vitest";
import { PROGRAM_NAME } from "../src/cli/index.js";

describe("cli", () => {
  it("expõe o nome do CLI", () => {
    expect(PROGRAM_NAME).toBe("qa-agent");
  });
});
