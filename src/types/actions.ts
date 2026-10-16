import { z } from "zod";

export const LocatorSchema = z.object({
  role: z.string().min(1),
  name: z.string().optional(),
  /** Desambiguação quando vários elementos têm o mesmo papel e nome (índice 0-based). */
  nth: z.number().int().min(0).optional(),
});
export type Locator = z.infer<typeof LocatorSchema>;

const desc = { description: z.string() };

export const ActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("goto"), url: z.string(), ...desc }),
  z.object({ kind: z.literal("click"), locator: LocatorSchema, ...desc }),
  z.object({
    kind: z.literal("fill"),
    locator: LocatorSchema,
    value: z.string(),
    secret: z.boolean().optional(),
    ...desc,
  }),
  z.object({ kind: z.literal("select"), locator: LocatorSchema, value: z.string(), ...desc }),
  z.object({ kind: z.literal("press"), key: z.string(), locator: LocatorSchema.optional(), ...desc }),
  z.object({
    kind: z.literal("waitFor"),
    locator: LocatorSchema,
    state: z.enum(["visible", "hidden"]).optional(),
    ...desc,
  }),
  z.object({
    kind: z.literal("expectText"),
    text: z.string(),
    mode: z.enum(["contains", "equals"]),
    locator: LocatorSchema.optional(),
    ...desc,
  }),
  z.object({ kind: z.literal("expectUrl"), pattern: z.string(), ...desc }),
]);
export type Action = z.infer<typeof ActionSchema>;

export const CompileResponseSchema = z.object({
  kind: z.enum(["action", "verification"]),
  actions: z.array(ActionSchema),
  confidence: z.number().min(0).max(1),
  subjective: z.boolean(),
});
export type CompileResponse = z.infer<typeof CompileResponseSchema>;
