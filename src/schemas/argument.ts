import { z } from "zod";
import { FactCategoryEnum } from "./research.js";

export const ClaimStrengthEnum = z.enum(["strong", "moderate", "weak"]);
export type ClaimStrength = z.infer<typeof ClaimStrengthEnum>;

/**
 * V2.3 (spec §24): the Argument Agent must explicitly distinguish how well-supported each
 * claim is. UNSUPPORTED claims may still appear (flagged as such) but must never be
 * asserted as settled fact downstream — enforced editorially via the script brief's
 * prohibitions, the same free-text-prohibition mechanism every other stage already uses.
 */
export const EvidenceStatusEnum = z.enum(["SUPPORTED", "PLAUSIBLE", "UNCERTAIN", "DISPUTED", "UNSUPPORTED"]);
export type EvidenceStatus = z.infer<typeof EvidenceStatusEnum>;

export const SupportingClaimSchema = z.object({
  claim: z.string().describe("Core assertion or supporting thesis claim"),
  evidence: z.array(z.string()).describe("Direct references to research facts or source data"),
  category: FactCategoryEnum.describe("Factual rigor category"),
  strength: ClaimStrengthEnum.describe("Assessed strength of empirical backing"),
  evidenceStatus: EvidenceStatusEnum.optional().describe(
    "V2.3: SUPPORTED/PLAUSIBLE/UNCERTAIN/DISPUTED/UNSUPPORTED — set when an evidence graph is available"
  ),
  evidenceIds: z
    .array(z.string())
    .optional()
    .default([])
    .describe("evidence-graph.json claimId/evidenceId references backing this claim, when available")
});
export type SupportingClaim = z.infer<typeof SupportingClaimSchema>;

export const CounterArgumentSchema = z.object({
  position: z.string().describe("Alternative explanation or opposing industry viewpoint"),
  rebuttal: z.string().describe("Evidence-backed response or contextual nuance"),
  evidenceGap: z.string().describe("Identified uncertainty or remaining unknown")
});
export type CounterArgument = z.infer<typeof CounterArgumentSchema>;

export const NarrativeProgressionPhaseSchema = z.object({
  phase: z.string().describe("Editorial phase identifier (e.g. cold_open, central_question, mechanism, bottleneck, consequence, synthesis)"),
  purpose: z.string().describe("Narrative and analytical objective of this section"),
  keyPoints: z.array(z.string()).describe("Core arguments and narrative revelations introduced"),
  transitionQuestion: z.string().describe("Forward-propelling question transitioning to the next beat")
});
export type NarrativeProgressionPhase = z.infer<typeof NarrativeProgressionPhaseSchema>;

export const ArgumentResultSchema = z.object({
  topic: z.string().describe("Investigative documentary topic"),
  centralQuestion: z.string().describe("The core curiosity or investigative question"),
  centralThesis: z.string().describe("The overarching thesis statement explaining the phenomenon"),
  supportingClaims: z.array(SupportingClaimSchema).min(3).describe("Key claims establishing the thesis"),
  counterArguments: z.array(CounterArgumentSchema).min(1).describe("Counter-arguments and nuances addressed"),
  narrativeProgression: z.array(NarrativeProgressionPhaseSchema).min(4).describe("Sequential editorial phases structuring the documentary"),
  conclusion: z.string().describe("Final synthesis and broader implication"),
  estimatedDepthMinutes: z.number().positive().describe("Estimated research depth support in minutes (e.g. 7 - 12)")
});
export type ArgumentResult = z.infer<typeof ArgumentResultSchema>;
