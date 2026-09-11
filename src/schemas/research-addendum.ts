import { z } from "zod";
import { EvidenceSchema, DataPointSchema, SourceSchema } from "./evidence-graph.js";

/**
 * V2.6 "request more research" (spec §12): a small, targeted follow-up artifact rather
 * than restarting the whole research-planner/researcher/evidence-graph stage sequence.
 * Uses the same `AgentTaskGate` mechanism every other stage already does — this is the
 * only new schema `request-more-research` needed.
 */
export const ResearchAddendumSchema = z.object({
  instruction: z.string().min(1),
  newSources: z.array(SourceSchema).optional().default([]),
  newEvidence: z.array(EvidenceSchema).optional().default([]),
  newDataPoints: z.array(DataPointSchema).optional().default([]),
  notes: z.string().optional()
});
export type ResearchAddendum = z.infer<typeof ResearchAddendumSchema>;
