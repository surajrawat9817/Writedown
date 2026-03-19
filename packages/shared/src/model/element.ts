import { z } from "zod";

export const colorHexSchema = z
  .string()
  .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, "Invalid hex color");

export const pointSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite()
});

export type Point = z.infer<typeof pointSchema>;

export const elementBaseSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["rect", "ellipse", "line", "arrow", "freehand", "text"]),
  x: z.number().finite(),
  y: z.number().finite(),
  rotation: z.number().finite().default(0),
  opacity: z.number().finite().min(0).max(1).default(1),
  strokeColor: colorHexSchema.default("#1f2937"),
  fillColor: colorHexSchema.optional(),
  strokeWidth: z.number().finite().min(0).max(64).default(2),
  roughness: z.number().finite().min(0).max(3).default(0),
  locked: z.boolean().default(false),
  createdBy: z.string().min(1).optional(),
  createdAt: z.number().int().nonnegative()
});

export const rectElementSchema = elementBaseSchema.extend({
  type: z.literal("rect"),
  w: z.number().finite(),
  h: z.number().finite(),
  cornerRadius: z.number().finite().min(0).max(64).default(0)
});

export const ellipseElementSchema = elementBaseSchema.extend({
  type: z.literal("ellipse"),
  w: z.number().finite(),
  h: z.number().finite()
});

export const lineElementSchema = elementBaseSchema.extend({
  type: z.literal("line"),
  x2: z.number().finite(),
  y2: z.number().finite()
});

export const arrowElementSchema = elementBaseSchema.extend({
  type: z.literal("arrow"),
  x2: z.number().finite(),
  y2: z.number().finite(),
  headSize: z.number().finite().min(4).max(64).default(14)
});

export const freehandElementSchema = elementBaseSchema.extend({
  type: z.literal("freehand"),
  points: z.array(pointSchema),
  streamline: z.number().finite().min(0).max(1).default(0.35)
});

export const textElementSchema = elementBaseSchema.extend({
  type: z.literal("text"),
  text: z.string(),
  fontSize: z.number().finite().min(8).max(96).default(24),
  fontFamily: z
    .string()
    .default("\"Bradley Hand\", \"Segoe Print\", \"Comic Sans MS\", \"Chalkboard SE\", \"Marker Felt\", ui-rounded, system-ui, -apple-system, Segoe UI, Roboto, cursive"),
  align: z.enum(["left", "center", "right"]).default("left"),
  w: z.number().finite().optional(),
  h: z.number().finite().optional()
});

export const elementSchema = z.discriminatedUnion("type", [
  rectElementSchema,
  ellipseElementSchema,
  lineElementSchema,
  arrowElementSchema,
  freehandElementSchema,
  textElementSchema
]);

export type Element = z.infer<typeof elementSchema>;
export type RectElement = z.infer<typeof rectElementSchema>;
export type EllipseElement = z.infer<typeof ellipseElementSchema>;
export type LineElement = z.infer<typeof lineElementSchema>;
export type ArrowElement = z.infer<typeof arrowElementSchema>;
export type FreehandElement = z.infer<typeof freehandElementSchema>;
export type TextElement = z.infer<typeof textElementSchema>;

export type ElementType = Element["type"];
