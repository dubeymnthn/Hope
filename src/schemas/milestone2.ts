import { z } from "zod";

export const Milestone2ArtifactSchema = z.object({
  milestone: z.literal(2),
  agent: z.string().min(1),
  status: z.literal("complete"),
  message: z.string().min(1),
  timestamp: z.string().datetime({ offset: true }).or(z.string().min(1)),
});

export type Milestone2Artifact = z.infer<typeof Milestone2ArtifactSchema>;
