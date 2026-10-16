import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { maskedScreenshot, redactText } from "../../src/masking/index.js";
import type { MaskedImage } from "../../src/masking/image.js";

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser.close();
});

async function freshPage(html: string) {
  page = await browser.newPage({ viewport: { width: 400, height: 200 } });
  await page.setContent(html);
}

describe("maskedScreenshot", () => {
  it("screenshot de página com campo de senha preenchido difere de um não mascarado", async () => {
    await freshPage('<input type="password" id="p" style="width:300px;height:40px">');
    await page.fill("#p", "super-secreta");
    const raw = await page.screenshot();
    const masked = await maskedScreenshot(page, []);
    expect(Buffer.compare(raw, masked.data)).not.toBe(0);
    expect(masked.mediaType).toBe("image/png");
    await page.close();
  });

  it("selectors extras também são mascarados", async () => {
    await freshPage('<div id="cpf" style="width:200px;height:40px;background:#fff">123.456.789-09</div>');
    const withoutExtra = await maskedScreenshot(page, []);
    const withExtra = await maskedScreenshot(page, ["#cpf"]);
    expect(Buffer.compare(withoutExtra.data, withExtra.data)).not.toBe(0);
    await page.close();
  });

  it("não é possível construir MaskedImage por literal", () => {
    // @ts-expect-error o brand impede a construção por literal
    const fake: MaskedImage = { data: Buffer.alloc(1), mediaType: "image/png" };
    expect(fake).toBeDefined();
  });
});

describe("redactText", () => {
  it("troca e-mail, CPF e Bearer por [REDIGIDO]", () => {
    const t = redactText("Contato maria@bayer.com CPF 123.456.789-09 Authorization: Bearer abc.DEF-123");
    expect(t).not.toContain("maria@bayer.com");
    expect(t).not.toContain("123.456.789-09");
    expect(t).not.toContain("abc.DEF-123");
    expect(t.match(/\[REDIGIDO\]/g)).toHaveLength(3);
  });
  it("troca JWT", () => {
    expect(redactText("tok eyJhbGciOi.eyJzdWIiOiIx.SflKxwRJSMeKKF2QT4")).toBe("tok [REDIGIDO]");
  });
  it("aplica padrões extras da config", () => {
    expect(redactText("pedido PED-99887 ok", ["PED-\\d+"])).toBe("pedido [REDIGIDO] ok");
  });
  it("texto sem dados sensíveis fica intacto", () => {
    expect(redactText("Products 6 itens")).toBe("Products 6 itens");
  });
});
