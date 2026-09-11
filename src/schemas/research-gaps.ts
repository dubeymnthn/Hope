import { z } from "zod";
import { ResearchCategoryEnum } from "./research-plan.js";

/**
 * Research Completeness / Gaps report (V2.3 spec sections 10, 22).
 *
 * Unlike every other artifact in this file, `research-gaps.json` is generated
 * deterministically by TypeScript (`src/research/gap-detection.ts`), not authored by the
 * reasoning agent — it is a measurement OVER the agent-authored research-plan.json,
 * research-questions.json and evidence-graph.json, the same way `duration-gate.ts`
 * measures the agent-authored script/audio rather than writing them. It is still
 * schema-validated like every other artifact (spec section 23).
 */

export const GapTypeEnum = z.enum([
  "UNANSWERED",
  "WEAKLY_SUPPORTED",
  "SECONDARY_ONLY",
  "STALE",
  "CONTRADICTED",
  "AMBIGUOUS",
  "DEFINITION_MISMATCH",
  "MISSING_PRIMARY_SOURCE",
  "INSUFFICIENT_QUANTITATIVE_EVIDENCE"
]);
export type GapType = z.infer<typeof GapTypeEnum>;

export const GapSchema = z.object({
  gapId: z.string(),
  gapType: GapTypeEnum,
  category: ResearchCategoryEnum.optional(),
  questionId: z.string().optional(),
  claimId: z.string().optional(),
  description: z.string(),
  suggestedFollowUp: z.string().optional()
});
export type Gap = z.infer<typeof GapSchema>;

export const CoverageStatusEnum = z.enum(["complete", "partial", "weak", "not_applicable"]);
export type CoverageStatus = z.infer<typeof CoverageStatusEnum>;

export const CategoryCoverageSchema = z.object({
  category: ResearchCategoryEnum,
  coveragePercent: z.number().min(0).max(100),
  status: CoverageStatusEnum
});
export type CategoryCoverage = z.infer<typeof CategoryCoverageSchema>;

export const ResearchCompletenessSchema = z.object({
  topic: z.string(),
  categoryCoverage: z.array(CategoryCoverageSchema),
  overallCompletenessPercent: z.number().min(0).max(100),
  gaps: z.array(GapSchema),
  generatedAt: z.string(),
  version: z.string().optional().default("1.0.0")
});
export type ResearchCompleteness = z.infer<typeof ResearchCompletenessSchema>;
