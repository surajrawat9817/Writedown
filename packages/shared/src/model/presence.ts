import { z } from "zod";
import { colorHexSchema, pointSchema } from "./element";

export const presenceUserSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(64),
  color: colorHexSchema
});

export type PresenceUser = z.infer<typeof presenceUserSchema>;

export const presenceStateSchema = z.object({
  user: presenceUserSchema,
  cursor: pointSchema.optional(),
  selectedIds: z.array(z.string().min(1)).optional()
});

export type PresenceState = z.infer<typeof presenceStateSchema>;

