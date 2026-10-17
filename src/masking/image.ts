declare const maskedBrand: unique symbol;

/**
 * Imagem já mascarada. Só `maskedScreenshot` (src/masking/index.ts) deve construir este tipo;
 * o brand impede passar um Buffer cru para o LLM em tempo de compilação.
 */
export interface MaskedImage {
  readonly [maskedBrand]: true;
  readonly data: Buffer;
  readonly mediaType: "image/png" | "image/jpeg";
}

/** Uso interno do módulo de mascaramento. Não reexportar fora de src/masking. */
export function brandMaskedImage(data: Buffer, mediaType: "image/png" | "image/jpeg" = "image/png"): MaskedImage {
  return { data, mediaType } as unknown as MaskedImage;
}
