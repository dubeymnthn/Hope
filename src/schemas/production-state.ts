import { z } from "zod";

/**
 * The production phase state machine (V2.6 spec section 1). Three human checkpoints —
 * research, script, final edit — gate the pipeline; everything between them is
 * autonomous. `ARGUMENT_GENERATING` has no separate approval gate (spec section 26 caps
 * checkpoints at 3), it's a transient phase between RESEARCH_APPROVED and SCRIPT_REVIEW.
 */
export const ProductionPhaseEnum = z.enum([
  "RESEARCHING",
  "RESEARCH_REVIEW",
  "RESEARCH_APPROVED",
  "ARGUMENT_GENERATING",
  "SCRIPT_REVIEW",
  "SCRIPT_APPROVED",
  "PRODUCTION_READY",
  "TTS_GENERATING",
  "VISUAL_GENERATING",
  "RENDERING",
  "QA",
  "EXPORTED"
]);
export type ProductionPhase = z.infer<typeof ProductionPhaseEnum>;

/**
 * An approval is valid only while `approvedArtifactHash` still matches the live artifact
 * hash — a content-hash check, not a monotonic counter, so an undo that restores the
 * approved content also restores the approval (see CLAUDE.md V2.6 notes).
 */
export const ApprovalRecordSchema = z.object({
  approvedAt: z.string(),
  approvedArtifactHash: z.string(),
  /** The human-readable revision counter at approval time, for display only. */
  atRevision: z.number().int().nonnegative()
});
export type ApprovalRecord = z.infer<typeof ApprovalRecordSchema>;

export const ApprovalsSchema = z.object({
  research: ApprovalRecordSchema.nullable().default(null),
  script: ApprovalRecordSchema.nullable().default(null)
});
export type Approvals = z.infer<typeof ApprovalsSchema>;

export const RevisionCountersSchema = z.object({
  research: z.number().int().nonnegative().default(0),
  argument: z.number().int().nonnegative().default(0),
  script: z.number().int().nonnegative().default(0),
  design: z.number().int().nonnegative().default(0)
});
export type RevisionCounters = z.infer<typeof RevisionCountersSchema>;
