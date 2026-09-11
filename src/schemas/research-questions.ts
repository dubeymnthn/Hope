import { z } from "zod";
import { ResearchCategoryEnum, FreshnessRequirementEnum } from "./research-plan.js";

/**
 * Research Questions — the Antigravity Research Planner's second output (V2.3 spec
 * section 3). Generated per selected category, after research-plan.json exists, so
 * questions only get written for categories the plan actually selected.
 */

export const QuestionStatusEnum = z.enum(["open", "answered", "partially_answered", "blocked"]);
export type QuestionStatus = z.infer<typeof QuestionStatusEnum>;

/** How strong the evidence backing an answer must be before the question counts as answered. */
export const EvidenceLevelEnum = z.enum([
  "any",
  "secondary_acceptable",
  "primary_required",
  "primary_and_corroborated"
]);
export type EvidenceLevel = z.infer<typeof EvidenceLevelEnum>;

export const ResearchQuestionSchema = z.object({
  questionId: z.string().describe("Stable id, e.g. q-economics-01"),
  category: ResearchCategoryEnum,
  questionText: z.string().min(1),
  priority: z.number().int().min(1).max(5),
  status: QuestionStatusEnum.default("open"),
  requiredEvidenceLevel: EvidenceLevelEnum,
  freshnessRequirement: FreshnessRequirementEnum,
  dependentQuestions: z.array(z.string()).default([]).describe("questionIds that should be answered first"),
  answeredBy: z.array(z.string()).default([]).describe("claimIds (from evidence-graph.json) that answer this question"),
  remainingGap: z.string().optional().describe("What is still missing if not fully answered")
});
export type ResearchQuestion = z.infer<typeof ResearchQuestionSchema>;

export const ResearchQuestionSetSchema = z.object({
  topic: z.string(),
  questions: z.array(ResearchQuestionSchema).min(1),
  version: z.string().optional().default("1.0.0")
});
export type ResearchQuestionSet = z.infer<typeof ResearchQuestionSetSchema>;
