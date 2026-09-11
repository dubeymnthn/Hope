import { z } from "zod";
import { ResearchCategoryEnum } from "./research-plan.js";

/**
 * Evidence Graph — the structured research artifact (V2.3 spec sections 4-19).
 *
 * This is the deepened replacement for a flat "list of facts": every claim traces to
 * evidence, every evidence item traces to a source, sources are classified by authority,
 * numbers carry their exact definition/scope/unit, and contradictions/uncertainty are
 * first-class rather than folded into free text. `research/research.json` (the existing
 * V2/V2.2 artifact) is untouched and still required upstream; this artifact deepens and
 * restructures that same evidence, it does not replace the earlier gate.
 *
 * Referential integrity (every *Id reference actually resolving) is enforced outside this
 * schema, in `src/research/evidence-graph-integrity.ts` — the same split used elsewhere in
 * this codebase (e.g. visual-director.ts's chart-data-integrity check).
 */

export const SourceTypeEnum = z.enum([
  "PRIMARY_GOVERNMENT",
  "PRIMARY_REGULATOR",
  "PRIMARY_COMPANY",
  "PRIMARY_FILING",
  "PRIMARY_DATASET",
  "PRIMARY_RESEARCH",
  "ACADEMIC_PAPER",
  "TECHNICAL_REPORT",
  "INDUSTRY_REPORT",
  "SECONDARY_ANALYSIS",
  "NEWS_REPORT",
  "REFERENCE_PAGE"
]);
export type SourceType = z.infer<typeof SourceTypeEnum>;

export const PrimaryOrSecondaryEnum = z.enum(["primary", "secondary"]);
export type PrimaryOrSecondary = z.infer<typeof PrimaryOrSecondaryEnum>;

/**
 * V2.6: distinguishes agent-authored content from a human's edit/addition and an
 * unverified manual entry — never treat a human-added number as verified research just
 * because it sits in the same JSON shape (spec §9 "evidence safety"). Absent (undefined)
 * is treated as AGENT_GENERATED everywhere this is read, so every pre-V2.6 fixture and
 * workspace needs no rewrite.
 */
export const EvidenceProvenanceEnum = z.enum(["AGENT_GENERATED", "HUMAN_EDIT", "UNVERIFIED"]);
export type EvidenceProvenance = z.infer<typeof EvidenceProvenanceEnum>;

/** Temporal status of a piece of evidence (spec section 13) — never mix these silently. */
export const TemporalStatusEnum = z.enum([
  "HISTORICAL",
  "CURRENT",
  "RECENT",
  "ANNOUNCED",
  "PLANNED",
  "UNDER_DEVELOPMENT",
  "FORECAST",
  "SPECULATIVE"
]);
export type TemporalStatus = z.infer<typeof TemporalStatusEnum>;

export const SourceSchema = z.object({
  sourceId: z.string(),
  sourceType: SourceTypeEnum,
  title: z.string(),
  publisher: z.string().optional(),
  organization: z.string().optional(),
  url: z.string(),
  retrievedAt: z.string().optional().describe("ISO timestamp when retrieved"),
  publicationDate: z.string().optional(),
  author: z.string().optional(),
  primaryOrSecondary: PrimaryOrSecondaryEnum,
  independentSourceGroup: z
    .string()
    .optional()
    .describe("Sources sharing this key are NOT independent of each other (e.g. two outlets syndicating the same wire report)"),
  notes: z.string().optional()
});
export type Source = z.infer<typeof SourceSchema>;

export const EvidenceSchema = z.object({
  evidenceId: z.string(),
  sourceId: z.string(),
  evidenceExcerpt: z.string().min(1).describe("The actual retrieved text/data this evidence rests on"),
  claim: z.string().optional().describe("Free-text summary of what this evidence shows"),
  dataValue: z.string().optional(),
  unit: z.string().optional(),
  date: z.string().optional(),
  geography: z.string().optional(),
  entity: z.string().optional(),
  methodology: z.string().optional(),
  confidence: z.number().min(0).max(1),
  relevance: z.number().min(0).max(1),
  temporalStatus: TemporalStatusEnum,
  notes: z.string().optional(),
  provenance: EvidenceProvenanceEnum.optional()
});
export type Evidence = z.infer<typeof EvidenceSchema>;

/**
 * A single verified number (spec sections 7-8). `scope` and `definition` are what keep
 * two superficially-similar numbers (cell price vs. pack price vs. consumer price) from
 * being silently merged; `comparableGroup` is the explicit opt-in when two data points
 * genuinely ARE directly comparable.
 */
export const DataPointSchema = z.object({
  dataPointId: z.string(),
  metric: z.string(),
  value: z.number(),
  unit: z.string(),
  currency: z.string().optional(),
  date: z.string().optional(),
  geography: z.string().optional(),
  scope: z.string().describe("Exactly what is being measured, e.g. 'cell price' vs 'pack price' vs 'consumer price'"),
  definition: z.string().describe("The precise definition/methodology behind this number"),
  sourceId: z.string(),
  sourceExcerpt: z.string(),
  confidence: z.number().min(0).max(1),
  comparableGroup: z
    .string()
    .optional()
    .describe("Data points sharing this key are asserted directly comparable; otherwise never merge them"),
  provenance: EvidenceProvenanceEnum.optional()
});
export type DataPoint = z.infer<typeof DataPointSchema>;

export const EntityTypeEnum = z.enum([
  "COMPANY",
  "ORGANIZATION",
  "GOVERNMENT",
  "PRODUCT",
  "TECHNOLOGY",
  "FACILITY",
  "COUNTRY",
  "MATERIAL",
  "INFRASTRUCTURE",
  "PERSON",
  "MARKET"
]);
export type EntityType = z.infer<typeof EntityTypeEnum>;

export const EntityRelationTypeEnum = z.enum([
  "SUPPLIES",
  "MANUFACTURES",
  "OWNS",
  "REGULATES",
  "INVESTS_IN",
  "COMPETES_WITH",
  "DEPENDS_ON",
  "LOCATED_IN",
  "USES",
  "PRODUCES",
  "CONSTRAINS"
]);
export type EntityRelationType = z.infer<typeof EntityRelationTypeEnum>;

export const EntitySchema = z.object({
  entityId: z.string(),
  type: EntityTypeEnum,
  name: z.string(),
  description: z.string().optional(),
  geography: z.string().optional()
});
export type Entity = z.infer<typeof EntitySchema>;

export const EntityRelationSchema = z.object({
  fromEntityId: z.string(),
  relation: EntityRelationTypeEnum,
  toEntityId: z.string(),
  evidenceIds: z.array(z.string()).default([])
});
export type EntityRelation = z.infer<typeof EntityRelationSchema>;

export const EventSchema = z.object({
  eventId: z.string(),
  date: z.string(),
  datePrecision: z.enum(["day", "month", "year", "decade", "approximate"]),
  title: z.string(),
  description: z.string(),
  entity: z.string().optional(),
  sourceId: z.string(),
  importance: z.number().int().min(1).max(5)
});
export type Event = z.infer<typeof EventSchema>;

/** Kind of expert disagreement (spec section 18) — do not manufacture disagreement. */
export const DisagreementTypeEnum = z.enum(["FACTUAL", "DEFINITIONAL", "FORECAST", "METHODOLOGICAL"]);
export type DisagreementType = z.infer<typeof DisagreementTypeEnum>;

export const ContradictionSchema = z.object({
  contradictionId: z.string(),
  claimId: z.string(),
  disagreementType: DisagreementTypeEnum,
  description: z.string(),
  supportingEvidenceIds: z.array(z.string()).min(1),
  contradictingEvidenceIds: z.array(z.string()).min(1),
  consensus: z.string().optional(),
  majorityView: z.string().optional(),
  minorityView: z.string().optional()
});
export type Contradiction = z.infer<typeof ContradictionSchema>;

export const UncertaintySchema = z.object({
  uncertaintyId: z.string(),
  claimId: z.string(),
  description: z.string(),
  reason: z.enum(["insufficient_evidence", "conflicting_evidence", "methodological_limits", "forecast_uncertainty"])
});
export type Uncertainty = z.infer<typeof UncertaintySchema>;

export const ClaimSchema = z.object({
  claimId: z.string(),
  questionIds: z.array(z.string()).default([]).describe("research-questions.json questionIds this claim answers"),
  statement: z.string().min(1),
  category: ResearchCategoryEnum,
  supportingEvidenceIds: z.array(z.string()).default([]),
  contradictingEvidenceIds: z.array(z.string()).default([]),
  dataPointIds: z.array(z.string()).default([]),
  entityIds: z.array(z.string()).default([]),
  eventIds: z.array(z.string()).default([]),
  temporalStatus: TemporalStatusEnum,
  confidence: z.number().min(0).max(1),
  provenance: EvidenceProvenanceEnum.optional()
});
export type Claim = z.infer<typeof ClaimSchema>;

/** Thesis stress test (spec section 12): candidate explanations evaluated against each other. */
export const ThesisCandidateSchema = z.object({
  thesisId: z.string(),
  statement: z.string(),
  supportingClaimIds: z.array(z.string()).default([]),
  contradictingClaimIds: z.array(z.string()).default([]),
  unansweredQuestionIds: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1)
});
export type ThesisCandidate = z.infer<typeof ThesisCandidateSchema>;

export const EvidenceGraphSchema = z.object({
  topic: z.string(),
  sources: z.array(SourceSchema).min(1),
  evidence: z.array(EvidenceSchema).min(1),
  dataPoints: z.array(DataPointSchema).default([]),
  entities: z.array(EntitySchema).default([]),
  entityRelations: z.array(EntityRelationSchema).default([]),
  events: z.array(EventSchema).default([]),
  claims: z.array(ClaimSchema).min(1),
  contradictions: z.array(ContradictionSchema).default([]),
  uncertainties: z.array(UncertaintySchema).default([]),
  thesisStressTest: z.array(ThesisCandidateSchema).default([]),
  version: z.string().optional().default("1.0.0")
});
export type EvidenceGraph = z.infer<typeof EvidenceGraphSchema>;
