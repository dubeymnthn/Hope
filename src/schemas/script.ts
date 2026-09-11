import { z } from "zod";

/**
 * V2.6: who last touched this artifact/claim, and whether a human's edit has been
 * re-verified. `PROVENANCE_REQUIRES_REVIEW` is set automatically when narration text
 * changes in a way that alters its numeric content (see `detectFactualDrift` in
 * script-qa.ts) and blocks script approval (`assertScriptApproved`,
 * src/orchestrator/production-gate.ts) until it's cleared by re-validation or an explicit,
 * justified override (-> HUMAN_OVERRIDDEN). Never silently reverts to a verified status.
 */
export const EditedBySchema = z.enum(["AGENT", "HUMAN"]);
export type EditedBy = z.infer<typeof EditedBySchema>;

export const ClaimProvenanceStatusEnum = z.enum([
  "SUPPORTED",
  "PLAUSIBLE",
  "UNCERTAIN",
  "DISPUTED",
  "PROVENANCE_REQUIRES_REVIEW",
  "HUMAN_OVERRIDDEN"
]);
export type ClaimProvenanceStatus = z.infer<typeof ClaimProvenanceStatusEnum>;

/**
 * V2.3 (spec §25): a structured, evidence-traceable claim carried by a scene, as opposed
 * to the legacy free-text `claims: string[]`. Every factual sentence that cites this
 * should be resolvable to real evidence-graph.json ids — enforced by the claim-gate's
 * new "Claim -> Evidence Traceability" check (src/agents/script-qa.ts), which only runs
 * when `scriptClaims` is populated and an evidence graph was supplied.
 */
export const ScriptClaimSchema = z.object({
  scriptClaimId: z.string(),
  claimText: z.string().min(1),
  evidenceIds: z.array(z.string()).min(1).describe("evidence-graph.json claimId/evidenceId references"),
  confidence: z.number().min(0).max(1),
  narrativeRole: z.string().describe("Why this claim appears here, e.g. 'establishes the central tension'"),
  visualOpportunityId: z.string().optional().describe("visual-evidence-map.json visualOpportunityId, if this claim has one"),
  provenanceStatus: ClaimProvenanceStatusEnum.optional().describe("V2.6: set by the claim gate / narration editor, see ClaimProvenanceStatusEnum"),
  overrideReason: z.string().optional().describe("V2.6: required justification when provenanceStatus is HUMAN_OVERRIDDEN"),
  overriddenAt: z.string().optional()
});
export type ScriptClaim = z.infer<typeof ScriptClaimSchema>;

export const ScriptSceneSchema = z.object({
  id: z.string().describe("Unique scene identifier, e.g. scene-001"),
  narration: z.string().describe("Spoken voiceover text for this scene beat"),
  purpose: z.string().describe("Editorial intention (e.g. 'Hook viewer with sudden price surge')"),
  visual_hint: z.string().describe("Visual cue for the storyboard agent"),
  chapter: z.string().optional().describe("Parent chapter identifier"),
  wordCount: z.number().optional().describe("Word count of the spoken voiceover"),
  estimatedDurationSeconds: z.number().optional().describe("Estimated spoken duration in seconds at ~150 wpm"),
  claims: z.array(z.string()).optional().default([]).describe("Key claims or fact citations supported in this scene"),
  scriptClaims: z
    .array(ScriptClaimSchema)
    .optional()
    .default([])
    .describe("V2.3: structured, evidence-id-traceable claims for this scene (no orphan factual claims)"),
  visualMode: z.string().optional().describe("Intended visual mode (e.g. data_visualization, technical_diagram, comparison)"),
  editedBy: EditedBySchema.optional().describe("V2.6: who last wrote this scene's narration"),
  originalNarration: z.string().optional().describe("V2.6: agent-authored narration before the first human edit, kept for diffing/rollback context")
});
export type ScriptScene = z.infer<typeof ScriptSceneSchema>;

export const ChapterSchema = z.object({
  id: z.string().describe("Chapter identifier, e.g. chapter-01"),
  title: z.string().describe("Editorial chapter title"),
  act: z.enum(["I", "II", "III"]).optional().describe("Three-act structural classification"),
  narrativePurpose: z.string().describe("Dramatic and intellectual purpose of this chapter"),
  transitionQuestion: z.string().optional().describe("Hook question leading to the subsequent chapter"),
  sceneIds: z.array(z.string()).optional().describe("IDs of scenes in this chapter")
});
export type Chapter = z.infer<typeof ChapterSchema>;

export const ScriptResultSchema = z.object({
  title: z.string().describe("Compelling title for the YouTube video"),
  hook: z.string().describe("High-retention opening thesis / hook (first 10s)"),
  scenes: z.array(ScriptSceneSchema).min(1).describe("Ordered list of narrative scenes"),
  ending: z.string().describe("Closing takeaway or call to action"),
  chapters: z.array(ChapterSchema).optional().describe("Editorial chapters segmenting the script"),
  totalWordCount: z.number().optional().describe("Total spoken words in the script"),
  estimatedDurationMinutes: z.number().optional().describe("Total estimated runtime in minutes"),
  editorialVoice: z.string().optional().describe("Tone and editorial style profile"),
  version: z.string().optional().default("2.0.0").describe("Script format version")
});
export type ScriptResult = z.infer<typeof ScriptResultSchema>;
