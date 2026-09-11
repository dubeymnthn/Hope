import { z } from "zod";
import { VisualModeEnum } from "./storyboard.js";

/**
 * Visual Evidence Map — the research-to-visual reasoning stage (V2.3 spec section 20).
 *
 * For every major claim, this asks "what is the best way to show this evidence" BEFORE
 * the Visual Director lays out scenes. It does not invent data: every `evidenceIds` /
 * `dataRequirements` entry must resolve into evidence-graph.json (enforced in
 * `src/agents/visual-evidence-mapper.ts`, the same "must not invent data" pattern as the
 * existing chart-data-integrity check in visual-director.ts).
 */

export const VisualPurposeEnum = z.enum([
  "show_magnitude",
  "show_trend",
  "show_comparison",
  "show_structure",
  "show_process",
  "show_location",
  "show_relationship",
  "show_change_over_time",
  "ground_in_primary_document",
  "emphasize_key_number"
]);
export type VisualPurpose = z.infer<typeof VisualPurposeEnum>;

export const AnimationPotentialEnum = z.enum(["low", "moderate", "high"]);
export type AnimationPotential = z.infer<typeof AnimationPotentialEnum>;

export const VisualOpportunitySchema = z.object({
  visualOpportunityId: z.string(),
  claimId: z.string().describe("evidence-graph.json claimId this visual represents"),
  evidenceIds: z.array(z.string()).min(1),
  visualMode: VisualModeEnum,
  visualPurpose: VisualPurposeEnum,
  dataRequirements: z.array(z.string()).default([]).describe("evidence-graph.json dataPointIds this visual needs"),
  entityIds: z.array(z.string()).default([]),
  timelineEventIds: z.array(z.string()).default([]),
  geographicDataIds: z.array(z.string()).default([]),
  animationPotential: AnimationPotentialEnum,
  confidence: z.number().min(0).max(1),
  rationale: z.string().describe("Why this visual mode was chosen over a simpler alternative (e.g. a chart over a big number)")
});
export type VisualOpportunity = z.infer<typeof VisualOpportunitySchema>;

export const VisualEvidenceMapSchema = z.object({
  topic: z.string(),
  opportunities: z.array(VisualOpportunitySchema).min(1),
  version: z.string().optional().default("1.0.0")
});
export type VisualEvidenceMap = z.infer<typeof VisualEvidenceMapSchema>;
