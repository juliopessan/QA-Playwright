declare const maskedBrand: unique symbol;

/**
 * Imagem já mascarada. Só `maskedScreenshot` (src/masking/index.ts) deve construir este tipo;
 * o brand impede passar um Buffer cru para o LLM em tempo de compilação.
 */
export interface MaskedImage {
  readonly [maskedBrand]: true;
  readonly data: Buffer;
  readonly mediaType: "image/png";
}

/** Uso interno do módulo de mascaramento. Não reexportar fora de src/masking. */
export function brandMaskedImage(data: Buffer): MaskedImage {
  return { data, mediaType: "image/png" } as unknown as MaskedImage;
}
