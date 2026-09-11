import { z } from "zod";

/**
 * Research Plan — the Antigravity Research Planner's output (V2.3 spec section 2).
 *
 * The planner receives only the topic and channel constraints and decides which research
 * dimensions actually matter for this specific topic. It must not blindly require every
 * category: rejected/unnecessary categories are still recorded, with the reasoning for
 * why they were rejected, so the decision is auditable rather than silent.
 */

export const ResearchCategoryEnum = z.enum([
  "CORE_FACTS",
  "HISTORY",
  "MECHANISM",
  "ECONOMICS",
  "QUANTITATIVE_EVIDENCE",
  "KEY_PLAYERS",
  "SUPPLY_CHAIN",
  "GEOGRAPHY",
  "TIMELINE",
  "CURRENT_STATE",
  "RECENT_DEVELOPMENTS",
  "CONTRADICTIONS",
  "COUNTERARGUMENTS",
  "EXPERT_DISAGREEMENT",
  "REGULATION",
  "TECHNOLOGY",
  "MARKET_STRUCTURE",
  "CONSEQUENCES",
  "FUTURE",
  "PRIMARY_EVIDENCE",
  "VISUAL_EVIDENCE"
]);
export type ResearchCategory = z.infer<typeof ResearchCategoryEnum>;

export const CategoryDecisionEnum = z.enum(["required", "useful", "optional", "unnecessary"]);
export type CategoryDecision = z.infer<typeof CategoryDecisionEnum>;

/** How current the evidence for this category must be (spec section 27). */
export const FreshnessRequirementEnum = z.enum(["irrelevant", "low", "moderate", "high", "real_time"]);
export type FreshnessRequirement = z.infer<typeof FreshnessRequirementEnum>;

export const ResearchCategoryPlanSchema = z.object({
  category: ResearchCategoryEnum,
  decision: CategoryDecisionEnum.describe("Whether this category is required, useful, optional, or unnecessary for THIS topic"),
  rationale: z.string().min(1).describe("Why this category matters (or does not) for this specific topic"),
  expectedEvidenceType: z.string().min(1).describe("What kind of evidence would answer this category, e.g. 'company filings, cost breakdowns'"),
  priority: z.number().int().min(1).max(5).describe("1 = highest priority"),
  freshnessRequirement: FreshnessRequirementEnum,
  primarySourceRequired: z.boolean().describe("Whether a primary source is required for claims in this category"),
  skippableIfUnavailable: z.boolean().describe("Whether the pipeline may proceed if evidence for this category cannot be found")
});
export type ResearchCategoryPlan = z.infer<typeof ResearchCategoryPlanSchema>;

export const ResearchPlanSchema = z.object({
  topic: z.string(),
  categories: z.array(ResearchCategoryPlanSchema).min(1).describe("Every category considered, including rejected ones"),
  version: z.string().optional().default("1.0.0")
});
export type ResearchPlan = z.infer<typeof ResearchPlanSchema>;
