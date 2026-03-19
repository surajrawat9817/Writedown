import { z } from "zod";
import { elementSchema } from "./element";

export const boardSnapshotSchema = z.object({
  id: z.string().min(1),
  version: z.number().int().nonnegative(),
  order: z.array(z.string().min(1)),
  elements: z.record(z.string().min(1), elementSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export type BoardSnapshot = z.infer<typeof boardSnapshotSchema>;

